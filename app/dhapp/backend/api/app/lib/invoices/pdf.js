'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { launchBrowser } = require('../pdf/browser');

let QRCodeLib = null;
try {
  QRCodeLib = require('qrcode');
} catch {
  try {
    QRCodeLib = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'qrcode'));
  } catch {
    QRCodeLib = null;
  }
}

const htmlEscape = (value = '') =>
  String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const sanitizeLine = (val = '') => String(val || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

const sanitizeIban = (val = '') => String(val || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const fmtChDate = (val) => {
  if (!val) return '';
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-CH');
};

const fmtChCurrency = (val) => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 'CHF 0.00';
  return num.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' }).replace(/\u00a0/g, ' ');
};

const logoCache = new Map();

const resolveLogoDataUrl = (tenantConfig, appDir) => {
  const branding = tenantConfig?.branding || {};
  const configured = branding.logo || process.env.CLINIC_LOGO_PATH || '';
  const cacheKey = `${configured || 'default'}`;
  if (logoCache.has(cacheKey)) return logoCache.get(cacheKey);

  const fallback = path.join(appDir, 'assets', 'logo.png');
  const candidate = configured
    ? (path.isAbsolute(configured) ? configured : path.join(appDir, configured.replace(/^\//, '')))
    : fallback;

  try {
    const buf = fs.readFileSync(candidate);
    const ext = path.extname(candidate).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.svg'
        ? 'image/svg+xml'
        : 'image/png';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    logoCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    logoCache.set(cacheKey, null);
    return null;
  }
};

// Luhn/Mod10 recursive checksum for Swiss QR reference (27 digits total)
const mod10Recursive = (numberStr) => {
  const table = [0,9,4,6,8,2,7,1,3,5];
  let carry = 0;
  for (const ch of String(numberStr).replace(/\D/g, '')) {
    carry = table[(carry + Number(ch)) % 10];
  }
  const check = (10 - carry) % 10;
  return String(check);
};

const buildStructuredQrr = (base) => {
  const digits = String(base || '').replace(/\D/g, '').slice(0, 26).padStart(26, '0');
  const check = mod10Recursive(digits);
  return digits + check; // 27 digits
};

const detectBillingType = (claim, tenantConfig) => {
  const inv = claim.invoice || {};
  const tMeta = tenantConfig?.invoice || {};
  const typeRaw = inv.insuranceType || inv.billingType || claim.billingType || tMeta.defaultBillingType || 'KVG';
  const map = { 'KVG':'KVG', 'UVG':'UVG', 'IV':'IV', 'IVG':'IV', 'SELBSTZAHLER':'Selbstzahler', 'SELF':'Selbstzahler' };
  const key = String(typeRaw || '').toUpperCase();
  return map[key] || 'KVG';
};

const labelsDEFR = {
  invoice: 'Rechnung / Facture',
  invoiceNo: 'Rechnungsnummer / Numéro de facture',
  invoiceDate: 'Rechnungsdatum / Date de facture',
  dueDate: 'Fällig bis / Échéance',
  currency: 'Währung / Devise',
  status: 'Status / Statut',
  billingMode: 'Abrechnung / Mode de facturation',
  billTo: 'Rechnung an / Facturer à',
  insurer: 'Versicherer / Assureur',
  patient: 'Patient / Patient',
  amountTitle: 'Rechnungsbetrag / Montant de la facture',
  subtotal: 'Zwischensumme / Sous-total',
  vat: 'MwSt 7.7% / TVA 7.7%',
  total: 'Totalbetrag / Montant total',
  services: 'Leistungen / Prestations',
  pos: 'Pos', code: 'Code', desc: 'Beschreibung / Désignation', qty: 'Menge / Quantité', unit: 'Einzelpreis / Prix unitaire', sum: 'Gesamtpreis / Montant',
  qrTitle: 'Swiss QR Rechnung / Facture QR',
};

const typeStyling = {
  KVG: { primary: '#0076BE' },
  UVG: { primary: '#FF6600' },
  IV:  { primary: '#009966' },
  Selbstzahler: { primary: '#666666' }
};

const buildSwissQrPayload = (claim, tenantConfig) => {
  const inv = claim.invoice || {};
  const prov = claim.provider || {};
  const pat = claim.patient || {};
  const totals = claim.totals || {};
  const billingType = detectBillingType(claim, tenantConfig);
  // Für diese Anforderung: Zahler nach Typ (nicht Modus)

  // creditor IBAN (prefer QR-IBAN when QRR is used)
  const iban = sanitizeIban(prov.iban || '');
  if (!iban || iban.length < 21 || !iban.startsWith('CH')) return null;

  const creditorName = sanitizeLine(prov.organization || prov.contact?.company || '');
  const creditorStreet = sanitizeLine(prov.address?.street || '');
  const creditorHouse = sanitizeLine(prov.address?.houseNo || '');
  const creditorZip = sanitizeLine(prov.address?.zip || '');
  const creditorCity = sanitizeLine(prov.address?.city || '');
  const creditorCountry = sanitizeLine(prov.address?.country || 'CH');

  // Decide debtor: insurance for TP (KVG/UVG/IV), patient for TG or Selbstzahler
  const ins = claim.insurer || {};
  const debtorIsInsurer = (billingType !== 'Selbstzahler');
  const debtorName = debtorIsInsurer
    ? sanitizeLine(ins.name || 'Versicherung')
    : sanitizeLine(`${pat.first_name || ''} ${pat.last_name || ''}`.trim());
  const debtorStreet = debtorIsInsurer
    ? sanitizeLine(ins.address || ins.street || '')
    : sanitizeLine(pat.address?.street || '');
  const debtorHouse = debtorIsInsurer ? '' : sanitizeLine(pat.address?.houseNo || '');
  const debtorZip = debtorIsInsurer
    ? sanitizeLine(ins.zip || '')
    : sanitizeLine(pat.address?.zip || '');
  const debtorCity = debtorIsInsurer
    ? sanitizeLine(ins.city || '')
    : sanitizeLine(pat.address?.city || '');
  const debtorCountry = debtorIsInsurer
    ? sanitizeLine(ins.country || 'CH')
    : sanitizeLine(pat.address?.country || 'CH');

  const amountNum = Number(totals.total_chf || totals.net_chf || 0);
  const amount = amountNum > 0 ? amountNum.toFixed(2) : '';
  const currency = sanitizeLine(inv.currency || 'CHF') || 'CHF';

  let refType = (inv.payment_ref?.type || '').toUpperCase();
  let refValue = sanitizeLine(inv.payment_ref?.value || '');
  if (!['QRR','SCOR','NON'].includes(refType)) refType = 'NON';
  // If we have a QR-IBAN flow (KVG/UVG/IV with TP) and no reference given, generate QRR
  if (debtorIsInsurer && iban.startsWith('CH') && !refValue) {
    refType = 'QRR';
    const base = String(inv.id || '').replace(/\D/g, '') || String(Date.now());
    refValue = buildStructuredQrr(base);
  }
  if (refType !== 'NON') refValue = refValue.replace(/\s+/g, ''); else refValue = '';

  const additionalInfo = sanitizeLine([
    inv.id ? `Rechnung ${inv.id}` : '',
    inv.payment_terms || '',
    inv.case?.type || ''
  ].filter(Boolean).join(' | '));

  const lines = [
    'SPC',
    '0200',
    '1',
    iban,
    'S',
    creditorName,
    creditorStreet,
    creditorHouse,
    creditorZip,
    creditorCity,
    creditorCountry,
    '',
    '',
    '',
    '',
    '',
    '',
    'S',
    debtorName,
    debtorStreet,
    debtorHouse,
    debtorZip,
    debtorCity,
    debtorCountry,
    amount,
    currency,
    refType,
    refValue,
    additionalInfo,
    'EPD',
    ''
  ];
  return lines.join('\n');
};

const buildSwissQrDataUrl = async (claim, tenantConfig) => {
  if (!QRCodeLib) return null;
  const payload = buildSwissQrPayload(claim, tenantConfig);
  if (!payload) return null;
  return await QRCodeLib.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    scale: 8,
    margin: 0
  });
};

const buildInvoiceHtml = async (claim, tenantConfig, appDir) => {
  const inv = claim.invoice || {};
  const prov = claim.provider || {};
  const pat = claim.patient || {};
  const guardian = claim.guardian || null;
  const rec = claim.recipient || {};
  const services = Array.isArray(claim.services) ? claim.services : [];
  const totals = claim.totals || {};
  const insurer = claim.insurer || null;
  const billingType = detectBillingType(claim, tenantConfig);
  const qrDataUrl = await buildSwissQrDataUrl(claim, tenantConfig);
  const logoDataUrl = resolveLogoDataUrl(tenantConfig, appDir);
  const fallbackLogo = logoDataUrl || resolveLogoDataUrl({ branding: {} }, appDir);

  const branding = tenantConfig?.branding || {};
  const typePrimary = typeStyling[billingType]?.primary;
  const primaryColor = typePrimary || branding.primary || '#0F6DF6';
  const accentColor = branding.accent || '#00A2FF';
  const accentSoft = branding.accentSoft || '#E6F1FF';
  const backgroundColor = branding.background || '#F6F8FB';
  const textDark = branding.textDark || '#1B2A4B';
  const textMuted = branding.textMuted || '#4F5D7A';

  const createdLabel = fmtChDate(inv.created_at || Date.now());
  const dueLabel = fmtChDate(inv.due_date);
  const currency = (inv.currency || 'CHF').toUpperCase();
  const totalAmount = fmtChCurrency(totals.total_chf || totals.net_chf || 0);
  const netAmount = fmtChCurrency(totals.net_chf || 0);
  const vatRaw = Number(totals.vat_chf || 0) || 0;
  const vatAmount = fmtChCurrency(vatRaw);
  const paymentTerms = inv.payment_terms || tenantConfig?.invoice?.paymentTerms || 'Zahlbar innert 30 Tagen netto.';
  const billingMode = inv.billing_mode === 'TG' ? 'Tiergarant (Patient zahlt) / Tiers garant' : 'Tiers payant (Versicherung zahlt)';
  const referenceLabelRaw = (inv.payment_ref?.value || '').replace(/\s+/g, '');
  const referenceLabel = referenceLabelRaw ? referenceLabelRaw.replace(/(.{4})/g, '$1 ').trim() : '';
  const ibanSanitized = sanitizeIban(prov.iban || tenantConfig?.invoice?.iban || '');
  const ibanDisplay = ibanSanitized ? ibanSanitized.replace(/(.{4})/g, '$1 ').trim() : 'IBAN fehlt';
  const clinicUid = sanitizeLine(tenantConfig?.clinic?.uid || tenantConfig?.clinic?.vat || '');

  const providerAddressLines = [
    [prov.organization, prov.department].filter(Boolean).join(' – '),
    [prov.address?.street, prov.address?.houseNo].filter(Boolean).join(' '),
    [prov.address?.zip, prov.address?.city].filter(Boolean).join(' '),
    prov.contact?.phone ? `Tel. ${prov.contact.phone}` : '',
    prov.contact?.email ? prov.contact.email : ''
  ].filter(Boolean);
  const providerAddressHtml = providerAddressLines.length
    ? providerAddressLines.map(htmlEscape).join('<br />')
    : 'Adresse nicht hinterlegt';

  const recipientName = rec.relationship
    ? `${rec.name || ''} (${rec.relationship})`.trim()
    : (rec.name || '');
  const recipientAddressLines = [
    recipientName || insurer?.name || 'Empfänger',
    rec.address || '',
    [rec.zip, rec.city].filter(Boolean).join(' ')
  ].filter(Boolean);
  const recipientAddressHtml = recipientAddressLines.length
    ? recipientAddressLines.map(htmlEscape).join('<br />')
    : 'Keine Empfängerdaten hinterlegt.';

  const patientDetailsParts = [
    `${htmlEscape(pat.first_name || '')} ${htmlEscape(pat.last_name || '')}`.trim(),
    pat.birthdate ? `Geburtsdatum: ${htmlEscape(fmtChDate(pat.birthdate))}` : '',
    pat.ahv ? `AHV: ${htmlEscape(pat.ahv)}` : '',
    pat.insured_id ? `Versichertennummer: ${htmlEscape(pat.insured_id)}` : '',
    [pat.address?.street, pat.address?.houseNo].filter(Boolean).map(htmlEscape).join(' '),
    [pat.address?.zip, pat.address?.city].filter(Boolean).map(htmlEscape).join(' ')
  ].filter(Boolean);
  if (guardian) {
    const guardianName = `${guardian.first_name || guardian.firstName || ''} ${guardian.last_name || guardian.lastName || ''}`.trim();
    const relationLine = [guardian.relationship, guardianName].filter(Boolean).join(' – ');
    if (relationLine) patientDetailsParts.push(`Gesetzliche Vertretung: ${htmlEscape(relationLine)}`);
    if (guardian.phone) patientDetailsParts.push(`Tel. Vertretung: ${htmlEscape(guardian.phone)}`);
    const gAddr = guardian.address || {};
    const guardianStreet = [gAddr.street, gAddr.houseNo].filter(Boolean).join(' ');
    const guardianCity = [gAddr.zip, gAddr.city].filter(Boolean).join(' ');
    if (guardianStreet) patientDetailsParts.push(htmlEscape(guardianStreet));
    if (guardianCity) patientDetailsParts.push(htmlEscape(guardianCity));
  }
  const patientDetailsHtml = patientDetailsParts.length
    ? patientDetailsParts.join('<br />')
    : 'Keine Patientendaten hinterlegt.';

  const caseMeta = claim.case || {};
  const caseMetaParts = [
    caseMeta.type ? `<span><strong>Falltyp:</strong> ${htmlEscape(caseMeta.type)}</span>` : '',
    caseMeta.id ? `<span><strong>Fall-ID:</strong> ${htmlEscape(caseMeta.id)}</span>` : '',
    caseMeta.start_date ? `<span><strong>Start:</strong> ${htmlEscape(fmtChDate(caseMeta.start_date))}</span>` : '',
    caseMeta.end_date ? `<span><strong>Ende:</strong> ${htmlEscape(fmtChDate(caseMeta.end_date))}</span>` : '',
    caseMeta.accident_number ? `<span><strong>Unfallnummer:</strong> ${htmlEscape(caseMeta.accident_number)}</span>` : '',
    caseMeta.claim_number ? `<span><strong>Schaden-Nr.:</strong> ${htmlEscape(caseMeta.claim_number)}</span>` : ''
  ].filter(Boolean);
  const caseMetaHtml = caseMetaParts.length ? caseMetaParts.join('<span class="separator">•</span>') : '';

  const tpa = claim.settlement?.point_value_chf ? Number(claim.settlement.point_value_chf) : null;
  const tpaLabel = tpa ? `Tarifgrundlage: TPW Kanton ${htmlEscape(claim.settlement?.canton_bfs || '')} = CHF ${tpa.toFixed(2)}` : '';

  const insurerHtml = insurer ? [
    htmlEscape(insurer.name || ''),
    htmlEscape(insurer.address || ''),
    [insurer.zip, insurer.city].filter(Boolean).map(htmlEscape).join(' ')
  ].filter(Boolean).join('<br />') : '';

  // Recipient block: for Selbstzahler → patient, else insurer
  const recipientLines = rec.type === 'guardian'
    ? [
        htmlEscape(rec.relationship ? `${rec.name || ''} (${rec.relationship})`.trim() : (rec.name || 'Verantwortliche Person')),
        htmlEscape(rec.address || ''),
        htmlEscape([rec.zip, rec.city].filter(Boolean).join(' '))
      ].filter(Boolean)
    : (billingType === 'Selbstzahler'
      ? [
          `${htmlEscape(pat.first_name || '')} ${htmlEscape(pat.last_name || '')}`.trim(),
          htmlEscape([pat.address?.street, pat.address?.houseNo].filter(Boolean).join(' ')),
          htmlEscape([pat.address?.zip, pat.address?.city].filter(Boolean).join(' '))
        ].filter(Boolean)
      : [
          htmlEscape(insurer?.name || rec.name || 'Empfänger'),
          htmlEscape(insurer?.address || rec.address || ''),
          htmlEscape([insurer?.zip || rec.zip, insurer?.city || rec.city].filter(Boolean).join(' '))
        ].filter(Boolean)
    );
  const recipientAddressHtml2 = recipientLines.length ? recipientLines.join('<br />') : 'Empfänger nicht definiert';

  const contactSegments = [
    prov.contact?.phone ? `Tel. ${prov.contact.phone}` : '',
    prov.contact?.email || '',
    prov.contact?.website || ''
  ].filter(Boolean);
  const contactHtml = contactSegments.map(htmlEscape).join(' · ');

  // Footer text: prefer configured recipe.footer; otherwise compose from clinic info
  const configuredFooter = sanitizeLine(tenantConfig?.recipe?.footer || '')
    || sanitizeLine(tenantConfig?.invoice?.footer || '')
    || '';
  const defaultFooterParts = [
    prov.organization || '',
    [prov.address?.street, prov.address?.houseNo].filter(Boolean).join(' '),
    [prov.address?.zip, prov.address?.city].filter(Boolean).join(' '),
    prov.contact?.email || '',
    prov.contact?.phone || ''
  ].filter(Boolean);
  const footerText = configuredFooter || defaultFooterParts.join(' • ');

  const debitLabel = billingMode === 'Tiergarant (Patient zahlt)'
    ? 'Zahlung durch Patient'
    : 'Zahlung durch Versicherung';

  const serviceRows = services.map((svc, idx) => {
    const qty = Number(svc.quantity ?? 0) || 0;
    const amountFromPayload = Number(svc.amount_chf ?? svc.total_amount_chf ?? 0);
    const pv = Number(svc.point_value_chf ?? claim.settlement?.point_value_chf ?? 0) || 0;
    const al = Number(svc.al_points ?? 0) || 0;
    const tl = Number(svc.tl_points ?? 0) || 0;
    const totalValue = Number.isFinite(amountFromPayload) && amountFromPayload !== 0
      ? amountFromPayload
      : (Number.isFinite(qty * pv) ? qty * pv : 0);
    const formattedTotal = fmtChCurrency(totalValue);
    const svcDate = svc.date ? fmtChDate(svc.date) : '';
    return `
        <tr>
          <td class="cell-index">${idx + 1}</td>
          <td class="cell-date">${htmlEscape(svcDate)}</td>
          <td class="cell-code">${htmlEscape(svc.code || '')}</td>
          <td class="cell-desc">
            <div class="svc-title">${htmlEscape(svc.text || svc.title || 'Leistung')}</div>
            ${svc.notes ? `<div class="svc-notes">${htmlEscape(sanitizeLine(svc.notes))}</div>` : ''}
          </td>
          <td class="cell-num">${al ? al.toFixed(2) : ''}</td>
          <td class="cell-num">${tl ? tl.toFixed(2) : ''}</td>
          <td class="cell-num">${qty ? qty.toFixed(2) : ''}</td>
          <td class="cell-num">${pv ? pv.toFixed(2) : ''}</td>
          <td class="cell-amount">${formattedTotal}</td>
        </tr>`;
  }).join('');

  const servicesHtml = serviceRows || `
        <tr>
          <td colspan="9" class="cell-empty">Keine Leistungen erfasst.</td>
        </tr>`;

  // Compose legal/mode text
  const lawText = (
    billingType === 'KVG' ? 'Gemäss Krankenversicherungsgesetz (KVG) / Selon la LAMal' :
    billingType === 'UVG' ? 'Gemäss Unfallversicherungsgesetz (UVG) / Selon la LAA' :
    billingType === 'IV'  ? 'Gemäss Invalidenversicherungsgesetz (IVG) / Selon la LAI' :
    'Privatrechnung – Selbstzahler / Facture privée – Payeur direct'
  );

  return `<!doctype html>
<html lang="de-CH">
<head>
  <meta charset="utf-8" />
  <title>Rechnung ${htmlEscape(inv.id || '')}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
    }
    body {
      margin: 0;
      padding: 24px;
      background: ${backgroundColor};
      color: ${textDark};
    }
    .invoice {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 18px 48px rgba(15, 44, 92, 0.12);
      overflow: hidden;
      border: 1px solid rgba(15, 41, 116, 0.08);
    }
    header {
      padding: 32px 36px 24px;
      background: linear-gradient(120deg, ${accentSoft}, rgba(255,255,255,0.95));
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      border-bottom: 1px solid rgba(15, 41, 116, 0.12);
    }
    .law-text { font-size: 11px; color: ${textMuted}; margin-top: 4px; }
    .clinic-block {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 20px;
      align-items: center;
    }
    .clinic-logo img {
      max-height: 70px;
      width: auto;
    }
    .clinic-info { display: grid; gap: 6px; }
    .clinic-name {
      font-size: 20px;
      font-weight: 600;
      color: ${primaryColor};
      letter-spacing: 0.5px;
    }
    .clinic-subtitle {
      font-size: 13px;
      color: ${textDark};
    }
    .clinic-details { font-size: 11px; color: ${textMuted}; }
    .clinic-address,
    .clinic-contact {
      font-size: 11px;
      color: ${textMuted};
      line-height: 1.5;
    }
    .invoice-meta {
      min-width: 240px;
      border-left: 1px dashed rgba(15, 41, 116, 0.24);
      padding-left: 24px;
      display: grid;
      gap: 10px;
      align-content: start;
    }
    .meta-header {
      font-size: 11px;
      color: ${textMuted};
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    .meta-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid rgba(15, 109, 246, 0.14);
      padding: 14px 16px;
      display: grid;
      gap: 6px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 12px;
    }
    .meta-row strong {
      color: ${textDark};
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 109, 246, 0.15);
      color: ${primaryColor};
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    main {
      padding: 24px 36px 32px;
      display: grid;
      gap: 24px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 18px;
    }
    .card {
      border: 1px solid rgba(15, 41, 116, 0.12);
      border-radius: 14px;
      padding: 18px;
      background: #fff;
      display: grid;
      gap: 12px;
    }
    .card h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      color: ${primaryColor};
      letter-spacing: 0.5px;
    }
    .card-content {
      font-size: 12px;
      color: ${textDark};
      line-height: 18px;
    }
    .card-content strong {
      color: ${textDark};
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(15,109,246,0.12);
      color: ${primaryColor};
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.4px;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(15, 41, 116, 0.12);
    }
    thead {
      background: ${accentSoft};
    }
    thead th {
      font-size: 11px;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: ${textDark};
      padding: 14px 12px;
      text-align: left;
    }
    tbody td {
      padding: 12px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      font-size: 12px;
      color: ${textDark};
      vertical-align: top;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .cell-index { width: 40px; text-align: center; font-weight: 600; }
    .cell-date { width: 80px; color: ${textMuted}; }
    .cell-code { width: 90px; font-family: "Fira Mono", "Roboto Mono", monospace; font-size: 11px; color: ${textDark}; }
    .cell-desc { line-height: 18px; }
    .svc-title { font-weight: 600; color: ${textDark}; }
    .svc-notes { font-size: 11px; color: ${textMuted}; margin-top: 2px; }
    .cell-num { width: 70px; text-align: right; font-variant-numeric: tabular-nums; color: ${textMuted}; }
    .cell-amount { width: 110px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: ${primaryColor}; }
    .cell-empty { text-align: center; color: ${textMuted}; padding: 24px 0; }
    .amount-summary {
      display: flex;
      justify-content: flex-end;
    }
    .amount-box {
      border-radius: 14px;
      border: 1px solid rgba(15, 41, 116, 0.16);
      background: linear-gradient(160deg, rgba(15,109,246,0.08), rgba(87,202,244,0.05));
      padding: 18px 24px;
      min-width: 300px;
      display: grid;
      gap: 8px;
    }
    .amount-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: ${textDark};
    }
    .amount-row.total {
      font-size: 16px;
      font-weight: 700;
      color: ${primaryColor};
      margin-top: 6px;
    }
    .notes {
      border-radius: 12px;
      padding: 16px 18px;
      border: 1px dashed rgba(15, 109, 246, 0.35);
      background: rgba(15,109,246,0.08);
      font-size: 12px;
      color: ${textDark};
    }
    .qr-section {
      border-radius: 16px;
      border: 1px solid rgba(15, 41, 116, 0.12);
      padding: 20px;
      display: grid;
      grid-template-columns: 1fr 220px;
      gap: 24px;
      align-items: center;
      background: rgba(255,255,255,0.92);
    }
    .qr-code {
      width: 200px;
      height: 200px;
      border: 1px solid rgba(15,109,246,0.24);
      border-radius: 12px;
      padding: 12px;
      background: #fff;
    }
    .qr-placeholder {
      width: 200px;
      height: 200px;
      border: 1px dashed rgba(15,109,246,0.4);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${textMuted};
      font-size: 12px;
      text-align: center;
      padding: 12px;
    }
    .qr-text {
      display: grid;
      gap: 8px;
    }
    .qr-text h4 {
      margin: 0;
      font-size: 13px;
      color: ${primaryColor};
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    .qr-text p {
      margin: 0;
      font-size: 12px;
      line-height: 18px;
      color: ${textDark};
    }
    .separator {
      margin: 0 6px;
      color: ${accentColor};
    }
    footer {
      padding: 22px 36px 26px;
      background: linear-gradient(120deg, rgba(15, 109, 246, 0.08), rgba(0, 162, 255, 0.12));
      display: grid;
      justify-items: center;
      gap: 10px;
      color: ${textMuted};
      font-size: 11px;
      letter-spacing: 0.4px;
    }
    .footer-logo img {
      height: 36px;
      width: auto;
      opacity: 0.85;
    }
    .footer-text {
      text-align: center;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .invoice { box-shadow: none; border: none; border-radius: 0; }
      header, main, footer { padding: 18mm 18mm; }
      footer { padding-top: 12mm; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <header>
      <div class="clinic-block">
        <div class="clinic-logo">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Klinik Logo" />` : ''}
        </div>
        <div class="clinic-info">
          <div class="clinic-name">${htmlEscape(prov.organization || '')}</div>
          ${prov.department ? `<div class="clinic-subtitle">${htmlEscape(prov.department)}</div>` : ''}
          <div class="clinic-address">${providerAddressHtml}</div>
          <div class="clinic-details">
            ${clinicUid ? `UID ${htmlEscape(clinicUid)} · ` : ''}QR-IBAN ${htmlEscape(ibanDisplay)}
          </div>
          <div class="law-text">${htmlEscape(lawText)}</div>
        </div>
      </div>
      <div class="invoice-meta">
        <div class="meta-header">${labelsDEFR.invoice}</div>
        <div class="meta-card">
          <div class="meta-row"><span>${labelsDEFR.invoiceNo}</span><strong>${htmlEscape(inv.id || '-')}</strong></div>
          <div class="meta-row"><span>${labelsDEFR.invoiceDate}</span><strong>${htmlEscape(createdLabel || '-')}</strong></div>
          <div class="meta-row"><span>${labelsDEFR.dueDate}</span><strong>${htmlEscape(dueLabel || '-')}</strong></div>
          <div class="meta-row"><span>${labelsDEFR.currency}</span><strong>${htmlEscape(currency)}</strong></div>
          <div class="meta-row"><span>${labelsDEFR.billingMode}</span><strong>${htmlEscape(billingMode)}</strong></div>
        </div>
        
      </div>
    </header>

    <main>
      <section class="summary-grid">
        <article class="card">
          <h3>${labelsDEFR.billTo}</h3>
          <div class="card-content">${recipientAddressHtml2}</div>
          ${caseMetaHtml ? `<div class="card-content">${caseMetaHtml}</div>` : ''}
        </article>

        ${billingType !== 'Selbstzahler' ? `
        <article class="card">
          <h3>${labelsDEFR.insurer}</h3>
          <div class="card-content">
            <div>${insurerHtml || '—'}</div>
          </div>
        </article>` : ''}

        <article class="card">
          <h3>${labelsDEFR.amountTitle}</h3>
          <div class="card-content">
            <div><strong>${labelsDEFR.total}</strong><br />${totalAmount}</div>
            <div><strong>Payment Terms</strong><br />${htmlEscape(paymentTerms)}</div>
            ${referenceLabel ? `<div><strong>Referenz</strong><br />${htmlEscape(referenceLabel)}</div>` : ''}
            <div><strong>Zahlung durch / Paiement par</strong><br />${
              billingType === 'Selbstzahler' ? 'Patient' : (
                billingType === 'KVG' ? 'Versicherung / Assurance maladie' :
                billingType === 'UVG' ? 'Unfallversicherung / Assurance accidents' :
                'Invalidenversicherung / Assurance invalidité'
              )
            }</div>
            ${tpaLabel ? `<div>${tpaLabel}</div>` : ''}
          </div>
        </article>
      </section>

      <section>
        <table>
          <thead>
            <tr>
              <th>${labelsDEFR.pos}</th>
              <th>${labelsDEFR.code}</th>
              <th>${labelsDEFR.desc}</th>
              <th class="cell-num">${labelsDEFR.qty}</th>
              <th class="cell-num">${labelsDEFR.unit}</th>
              <th class="cell-amount">${labelsDEFR.sum} (${htmlEscape(currency)})</th>
            </tr>
          </thead>
          <tbody>
            ${services.map((svc, idx) => {
              const qty = Number(svc.quantity ?? 0) || 0;
              const totalRaw = Number(svc.amount_chf ?? svc.total_amount_chf ?? 0) || 0;
              const pv = Number(svc.point_value_chf ?? claim.settlement?.point_value_chf ?? 0) || 0;
              const computedTotal = totalRaw || (qty && pv ? qty * pv : 0);
              const unitRaw = Number(svc.unit_price_chf ?? 0);
              const unit = unitRaw || (qty > 0 && computedTotal ? computedTotal / qty : pv);
              const descTitle = svc.text || svc.title || 'Leistung / Prestation';
              const codeCol = htmlEscape(svc.code || '');
              const notesPart = svc.notes ? `<div class="svc-notes">${htmlEscape(sanitizeLine(svc.notes))}</div>` : '';
              return `
                <tr>
                  <td class="cell-index">${idx + 1}</td>
                  <td class="cell-code">${codeCol}</td>
                  <td class="cell-desc"><div class="svc-title">${htmlEscape(descTitle)}</div>${notesPart}</td>
                  <td class="cell-num">${qty ? qty.toFixed(2) : ''}</td>
                  <td class="cell-num">${unit ? fmtChCurrency(unit) : ''}</td>
                  <td class="cell-amount">${fmtChCurrency(computedTotal)}</td>
                </tr>`;
            }).join('') || `
              <tr>
                <td colspan="6" class="cell-empty">Keine Leistungen erfasst / Aucune prestation saisie.</td>
              </tr>`}
          </tbody>
        </table>
      </section>

      <section class="amount-summary">
        <div class="amount-box">
          <div class="amount-row"><span>${labelsDEFR.subtotal}</span><span>${netAmount}</span></div>
          ${vatRaw > 0 ? `<div class="amount-row"><span>MwSt 8.1% / TVA 8.1%</span><span>${vatAmount}</span></div>` : `<div class="amount-row"><span>MwSt befreit gemäss MWSTG Art. 21 Abs. 2 Ziff. 3</span><span>0.00</span></div>`}
          <div class="amount-row total"><span>${labelsDEFR.total}</span><span>${totalAmount}</span></div>
        </div>
      </section>

      ${inv.notes ? `<section class="notes">${htmlEscape(inv.notes)}</section>` : ''}

      <section class="qr-section">
        <div class="qr-text">
          <h4>${labelsDEFR.qrTitle}</h4>
          <p>
            Bitte überweisen Sie den Gesamtbetrag / Veuillez verser le montant total
            <strong>${totalAmount}</strong> auf das Konto / sur le compte <strong>${htmlEscape(ibanDisplay)}</strong>.
          </p>
          ${(inv.payment_ref?.type && inv.payment_ref.value)
            ? `<p>Referenz (<strong>${htmlEscape(inv.payment_ref.type)}</strong>): <strong>${htmlEscape(referenceLabel)}</strong></p>`
            : ''
          }
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:8px;">
            <div style="border:1px solid rgba(0,0,0,0.15); border-radius:10px; padding:10px;">
              <div style="font-size:11px; color:${textMuted}; text-transform:uppercase; letter-spacing:0.4px;">Zahlung zugunsten / Paiement en faveur de</div>
              <div style="margin-top:4px; font-size:12px;">
                <div><strong>${htmlEscape(prov.organization || '')}</strong></div>
                <div>${htmlEscape([prov.address?.street, prov.address?.houseNo].filter(Boolean).join(' '))}</div>
                <div>${htmlEscape([prov.address?.zip, prov.address?.city].filter(Boolean).join(' '))}</div>
                <div>${htmlEscape(ibanDisplay)}</div>
              </div>
            </div>
            <div style="border:1px solid rgba(0,0,0,0.15); border-radius:10px; padding:10px;">
              <div style="font-size:11px; color:${textMuted}; text-transform:uppercase; letter-spacing:0.4px;">Zahlung durch / Paiement par</div>
              <div style="margin-top:4px; font-size:12px;">
                ${billingType === 'Selbstzahler' ? `
                  <div><strong>${htmlEscape(pat.first_name || '')} ${htmlEscape(pat.last_name || '')}</strong></div>
                  <div>${htmlEscape([pat.address?.street, pat.address?.houseNo].filter(Boolean).join(' '))}</div>
                  <div>${htmlEscape([pat.address?.zip, pat.address?.city].filter(Boolean).join(' '))}</div>
                ` : `
                  <div><strong>${htmlEscape(insurer?.name || 'Versicherung')}</strong></div>
                  <div>${htmlEscape(insurer?.address || '')}</div>
                  <div>${htmlEscape([insurer?.zip || '', insurer?.city || ''].filter(Boolean).join(' '))}</div>
                `}
              </div>
            </div>
          </div>
          <p style="margin-top:10px;color:${textMuted};font-size:11px;">
            Zahlungsziel: ${htmlEscape(paymentTerms)} · ${htmlEscape(debitLabel)}
          </p>
        </div>
        ${qrDataUrl
          ? `<img class="qr-code" src="${qrDataUrl}" alt="Swiss QR Code" />`
          : `<div class="qr-placeholder">QR-Code nicht verfügbar</div>`}
      </section>
    </main>

    <footer>
      <div class="footer-text">
        ${htmlEscape(prov.organization || '')} • ${htmlEscape(ibanDisplay)}<br/>
        UID ${htmlEscape(clinicUid || 'n/a')} · ZSR ${htmlEscape(prov.zsr || 'n/a')}
      </div>
    </footer>
  </div>
</body>
</html>`;
};

const renderInvoicePdf = async (claim, tenantConfig, appDir) => {
  const html = await buildInvoiceHtml(claim, tenantConfig, appDir);
  const browser = await launchBrowser();
  let buffer = null;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
    });
  } finally {
    await browser.close();
  }
  const checksum = createHash('sha256').update(buffer).digest('hex');
  return {
    buffer,
    checksum,
    size: buffer.length,
    html
  };
};

module.exports = {
  renderInvoicePdf,
  buildSwissQrPayload
};
