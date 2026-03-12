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
  const pid = claim?.patient?.id ?? claim?.patient?.patient_id ?? claim?.patient_id ?? null;
  if (!pid) throw new Error('Patienten-ID fehlt im Claim-Payload.');
  return pid;
};

// XSD-Validierung via xmllint (optional, abhaengig von Aufrufparametern)
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
    'SELECT patient_id FROM patients WHERE patient_id = $1 LIMIT 1',
    [patientId]
  );
  if (!rows.length) {
    throw new Error('Patient nicht gefunden oder nicht dem Mandanten zugeordnet.');
  }
};

const fetchPatientWithInsurance = async (tenantCtx, patientId) => {
  const { rows } = await tenantCtx.db.query(
    `SELECT p.patient_id,
            p.patient_id AS id,
            p.first_name,
            p.first_name AS vorname,
            p.last_name,
            p.last_name AS nachname,
            p.birth_date,
            p.birth_date AS birthdate,
            p.birth_date AS geburtsdatum,
            p.treated_sex,
            p.ahv_number,
            p.ahv_number AS ahv_nummer,
            p.ahv_number AS insurance_number,
            p.ahv_number AS versichertennummer,
            jsonb_build_object('street', p.street, 'houseNumber', p.house_number, 'zip', p.postal_code, 'city', p.city) AS address,
            p.insurance_id,
            i.name AS insurance_name,
            i.ean AS insurance_ean,
            i.address AS insurance_address,
            i.postal_code AS insurance_zip,
            i.city AS insurance_city,
            i.canton AS insurance_canton,
            i.bfs_code AS insurance_bfs_code
       FROM patients p
       LEFT JOIN insurances i ON i.insurance_id = p.insurance_id
      WHERE p.patient_id = $1
      LIMIT 1`,
    [patientId]
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
    street: '',
    houseNo: '',
    zip: '',
    city: '',
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

  fillIfMissing(pat, 'first_name', patientRow.first_name || patientRow.vorname || '');
  fillIfMissing(pat, 'last_name', patientRow.last_name || patientRow.nachname || '');
  fillIfMissing(pat, 'birthdate', patientRow.birth_date || patientRow.birthdate || patientRow.geburtsdatum || '');
  fillIfMissing(pat, 'ahv', patientRow.ahv_number || patientRow.ahv_nummer || '');
  fillIfMissing(pat, 'sex', patientRow.treated_sex || '');
  fillIfMissing(pat, 'insured_id', patientRow.ahv_number || patientRow.insurance_number || patientRow.versichertennummer || '');

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
    ${ins ? `<receiver><name>${esc(ins.name || 'Versicherer')}</name></receiver>` : `<receiver><name>${esc(rec.name || 'Empfaenger')}</name></receiver>`}
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
    throw new Error('Claim benoetigt eine invoice.id');
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
  const createdBy =
    enrichedClaim.invoice?.created_by ??
    enrichedClaim.created_by ??
    enrichedClaim.provider?.email ??
    (typeof userId === 'string' ? userId : null);

  const payload = cloneDeep(enrichedClaim);

  // Optional: XSD-Validierung erzwingen, um Schema-Fehler vor Persistenz zu vermeiden.
  if (validateXML) {
    if (!xsdPath) throw new Error('XSD-Pfad fuer XML-Validierung fehlt.');
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
         invoice_id,
         patient_id,
         status,
         created_by,
         amount,
         currency
       )
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (invoice_id)
       DO UPDATE SET
         patient_id = EXCLUDED.patient_id,
         status = EXCLUDED.status,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         created_by = COALESCE(invoices.created_by, EXCLUDED.created_by)
       RETURNING *`,
      [
        invoiceId,
        patientId,
        status,
        createdBy || userId || null,
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
      console.error('Fehler beim Rendern der PDF:', err?.message || err);
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

    await client.query('COMMIT');
    return upsertResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const listInvoices = async (tenantCtx, { status = null, limit = 100 } = {}) => {
  const params = [];
  let sql = `SELECT invoice_id,
                    invoice_id AS id,
                    patient_id,
                    status,
                    created_by,
                    created_at,
                    updated_at,
                    amount,
                    amount AS total,
                    currency,
                    medidata_ref,
                    due_date,
                    sent_at,
                    paid_at
               FROM invoices
              WHERE 1=1`;

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
    `SELECT invoice_id,
            invoice_id AS id,
            patient_id,
            status,
            created_by,
            created_at,
            updated_at,
            amount,
            amount AS total,
            currency,
            medidata_ref,
            due_date,
            sent_at,
            paid_at
       FROM invoices
      WHERE invoice_id = $1
      LIMIT 1`,
    [invoiceId]
  );
  return result.rows[0] || null;
};

module.exports = {
  saveInvoiceRecord,
  listInvoices,
  getInvoiceRecord
};
