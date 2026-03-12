'use strict';

const { launchBrowser } = require('../pdf/browser');

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
const fmtDate = (val) => {
  if (!val) return '';
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-CH');
};

function renderSickNoteHtml(note, tenantConfig) {
  const clinic = tenantConfig?.clinic || {};
  const patient = note?.patient || {};
  const receiver = note?.receiver || {};

  const style = `
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #111; margin: 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .clinic h1 { font-size: 16pt; margin: 0 0 6px 0; }
    .clinic p { margin: 0; }
    .meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 10pt; color: #333; }
    .title { font-size: 16pt; margin: 16px 0 12px; font-weight: bold; }
    .section { margin-top: 12px; }
    .signature { margin-top: 48px; }
    .small { font-size: 10pt; color: #555; }
  `;

  const city = clinic?.address?.city || '';
  const issuedAt = fmtDate(note?.created_at || new Date());
  const start = fmtDate(note?.start_date);
  const end = note?.open_end ? 'bis auf Weiteres' : fmtDate(note?.end_date);
  const degree = `${Number(note?.degree_percent ?? 100)}%`;

  const receiverBlock = receiver?.type && receiver?.type !== 'PATIENT'
    ? `<div class="small">Empfänger: ${esc(receiver?.name || receiver?.type)}${receiver?.address ? '<br/>' + esc(receiver.address).replace(/\n/g,'<br/>') : ''}</div>`
    : '';

  const diagnosisLine = note?.diagnosis_short ? `<div>Hinweis: ${esc(note.diagnosis_short)}</div>` : '';
  const remarkLine = note?.remark ? `<div class="small">Bemerkung: ${esc(note.remark)}</div>` : '';

  return `<!doctype html>
  <html lang="de-CH">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Arbeitsunfähigkeitszeugnis</title>
      <style>${style}</style>
    </head>
    <body>
      <div class="header">
        <div class="clinic">
          <h1>${esc(clinic.name || 'Praxis/Klinik')}</h1>
          <p>${esc([clinic?.address?.street, clinic?.address?.houseNo].filter(Boolean).join(' '))}</p>
          <p>${esc([clinic?.address?.zip, clinic?.address?.city].filter(Boolean).join(' '))}</p>
          ${clinic.contact?.phone ? `<p>Tel: ${esc(clinic.contact.phone)}</p>` : ''}
          ${clinic.contact?.email ? `<p>Email: ${esc(clinic.contact.email)}</p>` : ''}
        </div>
        <div class="small">${esc(city)}, ${issuedAt}</div>
      </div>
      <div class="title">Arbeitsunfähigkeitszeugnis</div>
      <div class="section">
        <div><strong>Patient/in:</strong> ${esc([patient?.name || `${patient?.vorname||''} ${patient?.nachname||''}`.trim(), patient?.birthdate ? `geb. ${fmtDate(patient.birthdate)}` : ''].filter(Boolean).join(', '))}</div>
        ${patient?.insurance_number ? `<div class="small">Versichertennummer: ${esc(patient.insurance_number)}</div>` : ''}
      </div>
      ${receiverBlock}
      <div class="section">
        Hiermit wird bestätigt, dass ${patient?.gender==='weiblich'?'Frau':'Herr'} ${esc(patient?.name || `${patient?.vorname||''} ${patient?.nachname||''}`.trim())}
        seit ${esc(start)} ${end ? `bis voraussichtlich ${esc(end)} ` : ''}zu ${esc(degree)} arbeitsunfähig ist.
      </div>
      ${note?.open_end ? '<div class="section">Die Arbeitsunfähigkeit dauert bis auf Weiteres an.</div>' : ''}
      ${diagnosisLine}
      ${remarkLine}
      <div class="signature">
        <div>${esc(city)}, ${issuedAt}</div>
        <div style="height: 48px"></div>
        <div>____________________________</div>
        <div>${esc(clinic?.doctor?.name || clinic?.contact?.doctor || clinic?.name || 'Behandelnde/r Arzt/Ärztin')}</div>
      </div>
    </body>
  </html>`;
}

async function renderSickNotePdf(note, tenantConfig) {
  const html = renderSickNoteHtml(note, tenantConfig);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({ format: 'A4', printBackground: true });
    return { buffer };
  } finally {
    try { await browser.close(); } catch {}
  }
}

module.exports = {
  renderSickNoteHtml,
  renderSickNotePdf,
};

