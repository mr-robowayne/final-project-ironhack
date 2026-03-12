'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { resolveInvoicePaths } = require('./paths');
const { getTenantBillingConfig } = require('./tenantConfig');
const { renderInvoicePdf } = require('./pdf');
const { buildGeneralInvoice50RequestXML } = require('./generalInvoice50');
const { describeTenantStorage } = require('../storage');

const fsp = fs.promises;

const cloneDeep = (value) => JSON.parse(JSON.stringify(value ?? {}));

const xmlEscape = (s = '') =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const toISODateOnly = (input) => {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const extractPatientId = (claim) => {
  const pid = claim?.patient?.id ?? claim?.patient_id ?? null;
  if (!pid) throw new Error('Patienten-ID fehlt im Claim-Payload.');
  return Number(pid);
};

// XSD-Validierung via xmllint (optional, abhängig von Aufrufparametern)
async function validateXMLWithXSD(xmlString, xsdPath) {
  if (!xmlString || !xsdPath) return { ok: true };
  const tmp = require('os').tmpdir();
  const xmlPath = path.join(tmp, `invoice_${Date.now()}.xml`);
  try {
    fs.writeFileSync(xmlPath, xmlString, 'utf8');
    await new Promise((resolve, reject) => {
      execFile('xmllint', ['--noout', '--schema', xsdPath, xmlPath], (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    try { fs.unlinkSync(xmlPath); } catch {}
  }
}

const ensurePatientExists = async (tenantCtx, patientId) => {
  const { rows } = await tenantCtx.db.query(
    'SELECT id FROM patients WHERE tenant_id = $1 AND id = $2 LIMIT 1',
    [tenantCtx.id, patientId]
  );
  if (!rows.length) {
    throw new Error('Patient nicht gefunden oder nicht dem Mandanten zugeordnet.');
  }
};

const fetchPatientWithInsurance = async (tenantCtx, patientId) => {
  const { rows } = await tenantCtx.db.query(
    `SELECT p.id,
            p.vorname, p.nachname,
            p.birthdate, p.geburtsdatum,
            p.gender, p.geschlecht,
            p.treated_sex,
            p.ahv_nummer,
            p.insurance_number, p.versichertennummer,
            p.address, p.adresse, p.hausnummer, p.plz, p.ort,
            p.insurance_id,
            i.name AS insurance_name,
            i.ean AS insurance_ean,
            i.address AS insurance_address,
            i.zip AS insurance_zip,
            i.city AS insurance_city,
            i.canton AS insurance_canton,
            i.bfs_code AS insurance_bfs_code
       FROM patients p
       LEFT JOIN insurances i ON i.id = p.insurance_id AND i.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.id = $2
      LIMIT 1`,
    [tenantCtx.id, patientId]
  );
  return rows[0] || null;
};

const parsePatientAddressFromRow = (row) => {
  const value = row?.address;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return {
    street: row?.adresse || '',
    houseNo: row?.hausnummer || '',
    zip: row?.plz || '',
    city: row?.ort || '',
    country: 'CH'
  };
};

const fillIfMissing = (target, key, value) => {
  if (!target) return;
  if (value == null) return;
  const current = target[key];
  if (current == null) {
    target[key] = value;
    return;
  }
  if (typeof current === 'string' && !current.trim() && typeof value === 'string') {
    target[key] = value;
  }
};

const hydrateClaimFromPatientRow = (claim, patientRow) => {
  if (!claim || !patientRow) return;
  claim.patient = claim.patient || {};
  const pat = claim.patient;

  fillIfMissing(pat, 'first_name', patientRow.vorname || '');
  fillIfMissing(pat, 'last_name', patientRow.nachname || '');
  fillIfMissing(pat, 'birthdate', patientRow.birthdate || patientRow.geburtsdatum || '');
  fillIfMissing(pat, 'ahv', patientRow.ahv_nummer || '');
  fillIfMissing(pat, 'gender', patientRow.gender || patientRow.geschlecht || '');
  fillIfMissing(pat, 'sex', patientRow.treated_sex || '');
  fillIfMissing(pat, 'insured_id', patientRow.insurance_number || patientRow.versichertennummer || '');

  const rowAddr = parsePatientAddressFromRow(patientRow);
  pat.address = pat.address && typeof pat.address === 'object' ? pat.address : {};
  pat.address = {
    street: pat.address.street || rowAddr.street || '',
    houseNo: pat.address.houseNo || rowAddr.houseNo || '',
    zip: pat.address.zip || rowAddr.zip || '',
    city: pat.address.city || rowAddr.city || '',
    country: pat.address.country || rowAddr.country || 'CH'
  };

  if (patientRow.insurance_id) {
    claim.insurer = claim.insurer || {};
    const ins = claim.insurer;
    fillIfMissing(ins, 'name', patientRow.insurance_name || '');
    fillIfMissing(ins, 'gln', patientRow.insurance_ean || '');
    fillIfMissing(ins, 'ean', patientRow.insurance_ean || '');
    fillIfMissing(ins, 'address', patientRow.insurance_address || '');
    fillIfMissing(ins, 'zip', patientRow.insurance_zip || '');
    fillIfMissing(ins, 'city', patientRow.insurance_city || '');
    fillIfMissing(ins, 'canton', patientRow.insurance_canton || '');
    fillIfMissing(ins, 'bfs_code', patientRow.insurance_bfs_code || '');
  }
};

const buildProviderFromConfig = (tenantConfig) => {
  const clinic = tenantConfig.clinic || {};
  return {
    organization: clinic.name || '',
    department: clinic.subtitle || '',
    gln: clinic.gln || '',
    zsr: clinic.zsr || '',
    address: {
      street: clinic.address?.street || '',
      houseNo: clinic.address?.houseNo || '',
      zip: clinic.address?.zip || '',
      city: clinic.address?.city || '',
      country: clinic.address?.country || 'CH'
    },
    contact: {
      phone: clinic.contact?.phone || '',
      email: clinic.contact?.email || '',
      website: clinic.contact?.website || ''
    },
    iban: clinic.qrIban || clinic.iban || ''
  };
};

const enrichClaimWithConfig = (claim, tenantConfig) => {
  const enriched = cloneDeep(claim);
  enriched.provider = buildProviderFromConfig(tenantConfig);

  enriched.invoice = {
    status: 'draft',
    currency: 'CHF',
    billing_mode: 'TP',
    payment_terms: tenantConfig.invoice.paymentTerms,
    ...cloneDeep(claim.invoice || {})
  };

  enriched.invoice.currency = enriched.invoice.currency || 'CHF';
  enriched.invoice.billing_mode = enriched.invoice.billing_mode || 'TP';
  enriched.invoice.payment_terms = tenantConfig.invoice.paymentTerms || enriched.invoice.payment_terms;

  const refType = tenantConfig.invoice.paymentReferenceType || enriched.invoice.payment_ref?.type || 'NON';
  const refValue = tenantConfig.invoice.paymentReference || enriched.invoice.payment_ref?.value || '';

  enriched.invoice.payment_ref = {
    type: refType,
    value: refValue || enriched.invoice.payment_ref?.value || ''
  };

  if (enriched.invoice.payment_ref.type === 'NON') {
    enriched.invoice.payment_ref.value = '';
  }

  return enriched;
};

// Compute Swiss VAT (MWST) according to billing type
const computeVatTotals = (claim) => {
  const inv = claim.invoice || {};
  const billingType = String(inv.insuranceType || inv.billingType || claim.billingType || 'KVG').toUpperCase();
  const items = Array.isArray(claim.services) ? claim.services : [];
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const sum = items.reduce((acc, it) => acc + (Number(it.amount_chf ?? it.total_amount_chf ?? 0) || 0), 0);
  if (['KVG','UVG','IV','IVG'].includes(billingType)) {
    return { net: round2(sum), vat: 0, total: round2(sum) };
  }
  // Selbstzahler: tax only for taxable items
  const TAX_RATE = 0.081; // 8.1% since 2024
  let net = 0, vat = 0;
  for (const it of items) {
    const line = Number(it.amount_chf ?? it.total_amount_chf ?? 0) || 0;
    if (it.isTaxable === true) {
      const base = line / (1 + TAX_RATE);
      const tax = line - base;
      net += base; vat += tax;
    } else {
      net += line;
    }
  }
  net = round2(net); vat = round2(vat); const total = round2(net + vat);
  return { net, vat, total };
};

const writePdfArtifacts = async (buffer, tenantCtx, patientId, invoiceId) => {
  const paths = resolveInvoicePaths(tenantCtx, patientId, invoiceId);
  const tmpTarget = `${paths.patientPath}.${process.pid}.tmp`;

  await fsp.writeFile(tmpTarget, buffer, { mode: 0o640 });
  await fsp.rename(tmpTarget, paths.patientPath);

  try {
    await fsp.unlink(paths.tenantPath);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  try {
    await fsp.link(paths.patientPath, paths.tenantPath);
  } catch (err) {
    if (err && !['EXDEV', 'EPERM', 'EEXIST'].includes(err.code)) throw err;
    if (err && ['EXDEV', 'EPERM'].includes(err.code)) {
      await fsp.copyFile(paths.patientPath, paths.tenantPath);
    }
  }

  return paths;
};

// Minimal GeneralInvoice 4.5 XML (kept for compatibility, but defaults to TARDOC)
function buildGeneralInvoice45XML(claim) {
  const inv = claim.invoice || {};
  const prov = claim.provider || {};
  const pat  = claim.patient || {};
  const rec  = claim.recipient || {};
  const ins  = claim.insurer || null;
  const setl = claim.settlement || {};
  const services = claim.services || [];
  const totals = claim.totals || { total_chf: 0, vat_chf: 0, net_chf: 0 };
  const NS = 'http://www.forum-datenaustausch.ch/invoice/4.5';
  const esc = (s)=>String(s ?? '').replace(/[&<>]/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  const isoDate = (d)=>new Date(d||Date.now()).toISOString().slice(0,10);
  const invoiceId = inv.id || `INV-${Date.now()}`;
  const payType = inv.payment_ref?.type || 'NON';
  const payVal  = inv.payment_ref?.value || '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<generalInvoice xmlns="${NS}" version="4.5">
  <header>
    <sender>
      ${prov.gln ? `<gln>${esc(prov.gln)}</gln>` : ''}
      ${prov.zsr ? `<zsr>${esc(prov.zsr)}</zsr>` : ''}
      <name>${esc(prov.organization || '')}</name>
    </sender>
    ${ins ? `<receiver><name>${esc(ins.name || 'Versicherer')}</name></receiver>` : `<receiver><name>${esc(rec.name || 'Empfänger')}</name></receiver>`}
    <date>${esc(isoDate(inv.created_at))}</date>
    <invoiceId>${esc(invoiceId)}</invoiceId>
    <currency>${esc(inv.currency || 'CHF')}</currency>
    <billingMode>${esc(inv.billing_mode || 'TP')}</billingMode>
  </header>
  <provider>
    ${prov.gln ? `<gln>${esc(prov.gln)}</gln>` : ''}
    ${prov.zsr ? `<zsr>${esc(prov.zsr)}</zsr>` : ''}
    <company>${esc(prov.organization || '')}</company>
    <address>
      <street>${esc(prov.address?.street || '')}</street>
      <houseNo>${esc(prov.address?.houseNo || '')}</houseNo>
      <zip>${esc(prov.address?.zip || '')}</zip>
      <city>${esc(prov.address?.city || '')}</city>
      <country>CH</country>
    </address>
    ${prov.iban ? `<iban>${esc(String(prov.iban).replace(/\s/g,''))}</iban>` : ''}
  </provider>
  <patient>
    <firstName>${esc(pat.first_name || '')}</firstName>
    <lastName>${esc(pat.last_name || '')}</lastName>
    ${pat.birthdate ? `<birthdate>${esc(pat.birthdate)}</birthdate>` : ''}
    ${pat.ahv ? `<ahv>${esc(pat.ahv)}</ahv>` : ''}
    ${pat.insured_id ? `<insuredId>${esc(pat.insured_id)}</insuredId>` : ''}
    <address>
      <street>${esc(pat.address?.street || '')}</street>
      <houseNo>${esc(pat.address?.houseNo || '')}</houseNo>
      <zip>${esc(pat.address?.zip || '')}</zip>
      <city>${esc(pat.address?.city || '')}</city>
      <country>CH</country>
    </address>
  </patient>
  ${ins ? `<insurer><name>${esc(ins.name || '')}</name></insurer>` : ''}
  <services>
    ${(services||[]).map(s => `
    <service>
      <date>${esc(isoDate(s.date || inv.created_at))}</date>
      <codeSystem>${esc(s.code_system || 'TARDOC')}</codeSystem>
      <code>${esc(s.code || '')}</code>
      ${s.text ? `<text>${esc(s.text)}</text>` : ''}
      <alPoints>${Number(s.al_points || 0).toFixed(2)}</alPoints>
      <tlPoints>${Number(s.tl_points || 0).toFixed(2)}</tlPoints>
      <quantity>${Number(s.quantity || 1)}</quantity>
      <pointValueCHF>${Number(s.point_value_chf || 0).toFixed(2)}</pointValueCHF>
      <amountCHF>${Number(s.amount_chf || 0).toFixed(2)}</amountCHF>
    </service>`).join('')}
  </services>
  <totals>
    <netCHF>${Number(claim.totals?.net_chf ?? totals.net_chf ?? totals.total_chf ?? 0).toFixed(2)}</netCHF>
    <vatCHF>${Number(claim.totals?.vat_chf ?? totals.vat_chf ?? 0).toFixed(2)}</vatCHF>
    <totalCHF>${Number(claim.totals?.total_chf ?? totals.total_chf ?? 0).toFixed(2)}</totalCHF>
  </totals>
  <payment>
    ${prov.iban ? `<iban>${esc(String(prov.iban).replace(/\s/g,''))}</iban>` : ''}
    <reference type="${esc(payType)}">${esc(payVal)}</reference>
  </payment>
</generalInvoice>`;
}

// GeneralInvoice 5.0 request (invoice:request aligned to generalInvoiceRequest_500.xsd)
function buildGeneralInvoice50XML(claim) {
  return buildGeneralInvoice50RequestXML(claim, { language: 'de', modus: 'production' });
}

const saveInvoiceRecord = async ({ tenantCtx, claim, userId, appDir, validateXML = false, xsdPath = '' }) => {
  if (!claim?.invoice?.id) {
    throw new Error('Claim benötigt eine invoice.id');
  }

  const tenantConfig = await getTenantBillingConfig(tenantCtx);
  const patientId = extractPatientId(claim);
  await ensurePatientExists(tenantCtx, patientId);
  const patientRow = await fetchPatientWithInsurance(tenantCtx, patientId);

  const enrichedClaim = enrichClaimWithConfig(claim, tenantConfig);
  enrichedClaim.patient.id = patientId;
  hydrateClaimFromPatientRow(enrichedClaim, patientRow);
  const invoiceId = String(enrichedClaim.invoice.id).trim();
  const status = enrichedClaim.invoice.status || 'draft';
  const totalAmount = Number(enrichedClaim.totals?.total_chf ?? enrichedClaim.totals?.net_chf ?? 0) || 0;
  const currency = enrichedClaim.invoice.currency || 'CHF';
  const doctorId =
    enrichedClaim.invoice?.doctor_id ??
    enrichedClaim.doctor?.id ??
    enrichedClaim.provider?.id ??
    null;
  const createdByUserId = (userId !== null && userId !== undefined && Number.isFinite(Number(userId)))
    ? Number(userId)
    : null;
  const createdBy =
    enrichedClaim.invoice?.created_by ??
    enrichedClaim.created_by ??
    enrichedClaim.provider?.email ??
    (typeof userId === 'string' ? userId : null);

  const payload = cloneDeep(enrichedClaim);

  // Optional: XSD-Validierung erzwingen, um Schema-Fehler vor Persistenz zu vermeiden.
  if (validateXML) {
    if (!xsdPath) throw new Error('XSD-Pfad für XML-Validierung fehlt.');
    const xml = buildGeneralInvoice50XML(enrichedClaim);
    const validation = await validateXMLWithXSD(xml, xsdPath);
    if (!validation.ok) {
      throw new Error(`XML-Validierung fehlgeschlagen: ${validation.error}`);
    }
  }

  const client = await tenantCtx.db.connect();
  try {
    await client.query('BEGIN');

    const upsertResult = await client.query(
      `INSERT INTO invoices (
         tenant_id,
         id,
         patient_id,
         doctor_id,
         status,
         payload,
         created_by,
         created_by_user_id,
         total,
         currency
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, id)
       DO UPDATE SET
         patient_id = EXCLUDED.patient_id,
         doctor_id = EXCLUDED.doctor_id,
         status = EXCLUDED.status,
         payload = EXCLUDED.payload,
         total = EXCLUDED.total,
         currency = EXCLUDED.currency,
         created_by = COALESCE(invoices.created_by, EXCLUDED.created_by),
         created_by_user_id = COALESCE(invoices.created_by_user_id, EXCLUDED.created_by_user_id)
       RETURNING *`,
      [
        tenantCtx.id,
        invoiceId,
        patientId,
        doctorId || null,
        status,
        JSON.stringify(payload),
        createdBy,
        createdByUserId,
        totalAmount,
        currency
      ]
    );

    // Ensure totals follow Swiss VAT rules
    try {
      const vatTotals = computeVatTotals(enrichedClaim);
      enrichedClaim.totals = {
        net_chf: vatTotals.net,
        vat_chf: vatTotals.vat,
        total_chf: vatTotals.total
      };
    } catch (e) {
      // non-fatal: keep provided totals
    }

    let pdf, paths;
    try {
      pdf = await renderInvoicePdf(enrichedClaim, tenantConfig, appDir);
      paths = await writePdfArtifacts(pdf.buffer, tenantCtx, patientId, invoiceId);
    } catch (err) {
      console.error('❌ Fehler beim Rendern der PDF:', err?.message || err);
      throw new Error('PDF-Rendering fehlgeschlagen');
    }

    // Also persist JSON and XML artifacts for the invoice payload
    try {
      const storage = describeTenantStorage(tenantCtx);
      const jsonPath = require('path').join(storage.documents.json, `${invoiceId}.json`);
      const xmlPath  = require('path').join(storage.documents.xml, `${invoiceId}.xml`);
      await fsp.writeFile(jsonPath, JSON.stringify(enrichedClaim, null, 2), 'utf8');
      const xml = buildGeneralInvoice50XML(enrichedClaim);
      await fsp.writeFile(xmlPath, xml, 'utf8');
    } catch (e) {
      // Non-fatal: JSON/XML are convenience artifacts
    }

    const updateResult = await client.query(
      `UPDATE invoices
          SET storage_path = $1,
              tenant_storage_path = $2,
              filesize = $3,
              pdf_checksum = $4,
              pdf_generated_at = now()
        WHERE tenant_id = $5
          AND id = $6
        RETURNING *`,
      [
        paths.patientPath,
        paths.tenantPath,
        pdf.size || null,
        pdf.checksum || null,
        tenantCtx.id,
        invoiceId
      ]
    );

    await client.query('COMMIT');
    return updateResult.rows[0] || upsertResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const listInvoices = async (tenantCtx, { status = null, limit = 100 } = {}) => {
  const params = [tenantCtx.id];
  let sql = `SELECT tenant_id,
                    id,
                    patient_id,
                    doctor_id,
                    status,
                    storage_path,
                    tenant_storage_path,
                    filesize,
                    pdf_checksum,
                    created_by,
                    created_by_user_id,
                    created_at,
                    updated_at,
                    pdf_generated_at,
                    total,
                    currency,
                    payload
               FROM invoices
              WHERE tenant_id = $1`;

  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }

  sql += ' ORDER BY created_at DESC';
  if (limit) {
    params.push(Number(limit));
    sql += ` LIMIT $${params.length}`;
  }

  const result = await tenantCtx.db.query(sql, params);
  return result.rows;
};

const getInvoiceRecord = async (tenantCtx, invoiceId) => {
  const result = await tenantCtx.db.query(
    `SELECT tenant_id,
            id,
            patient_id,
            doctor_id,
            status,
            storage_path,
            tenant_storage_path,
            filesize,
            pdf_checksum,
            created_by,
            created_by_user_id,
            created_at,
            updated_at,
            pdf_generated_at,
            total,
            currency,
            payload
       FROM invoices
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantCtx.id, invoiceId]
  );
  return result.rows[0] || null;
};

module.exports = {
  saveInvoiceRecord,
  listInvoices,
  getInvoiceRecord
};
