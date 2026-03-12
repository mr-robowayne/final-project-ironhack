'use strict';

const path = require('path');
const { launchBrowser } = require('../pdf/browser');

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function formatDate(d) {
  try {
    const dt = d ? new Date(d) : new Date();
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return `${dd}.${mm}.${yy}`;
  } catch { return ''; }
}

function renderLetterHtml(letter, tenantConfig = {}) {
  const branding = tenantConfig.branding || {};
  const clinic = tenantConfig.clinic || {};
  const content = letter.content || {};
  const typeLabel = {
    ARZTBRIEF: 'Arztbrief',
    OP_BERICHT: 'OP-Bericht',
    AUSTRITTSBERICHT: 'Austrittsbericht',
    ZUWEISUNG: 'Zuweisung',
    VERSICHERUNGSBRIEF: 'Versicherungsbericht',
    SONSTIGER_BRIEF: 'Sonstiger Brief'
  }[letter.type] || 'Brief';

  const title = letter.title || `${typeLabel} vom ${formatDate(letter.created_at)}`;
  const recipient = content.recipient || {};
  const patient = content.patient || {};
  const sections = content.sections || {};

  const style = `
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1b2a4b; }
    .header { display: flex; align-items: flex-start; gap: 16px; border-bottom: 2px solid ${branding.primary || '#0F6DF6'}; padding-bottom: 8px; }
    .clinic h1 { margin: 0; font-size: 18px; color: ${branding.textDark || '#1B2A4B'}; }
    .clinic p { margin: 0; font-size: 12px; color: ${branding.textMuted || '#4F5D7A'}; }
    .meta { display: flex; justify-content: space-between; margin-top: 12px; font-size: 12px; color: #4f5d7a; }
    h2 { font-size: 16px; margin: 18px 0 6px; color: ${branding.textDark || '#1B2A4B'}; }
    h3 { font-size: 14px; margin: 14px 0 4px; color: ${branding.textDark || '#1B2A4B'}; }
    p, li, td, th { font-size: 12px; line-height: 1.5; }
    .section { margin-bottom: 10px; }
    .recipient { margin-top: 10px; font-size: 12px; }
    .title { margin-top: 16px; font-size: 18px; font-weight: 700; }
    .table { border-collapse: collapse; width: 100%; }
    .table th, .table td { border: 1px solid #e5e7eb; padding: 6px 8px; }
  `;

  const patientBlock = `
    <div class="section">
      <h3>Patient</h3>
      <p>
        <strong>${esc(patient.name || '')}</strong><br/>
        ${patient.birthdate ? `Geburtsdatum: ${esc(patient.birthdate)}` : ''} ${patient.gender ? `– Geschlecht: ${esc(patient.gender)}` : ''}<br/>
        ${patient.address ? esc(patient.address) : ''}${patient.insurance_number ? `<br/>Versicherungsnummer: ${esc(patient.insurance_number)}` : ''}
      </p>
    </div>
  `;

  function section(label, text) {
    if (!text) return '';
    return `<div class="section"><h3>${esc(label)}</h3><div>${esc(text).replace(/\n/g,'<br/>')}</div></div>`;
  }

  // Map known sections based on type
  const common = [
    section('Grund der Konsultation / Hospitalisation', sections.reason),
    section('Relevante Anamnese', sections.history),
    section('Status / klinische Befunde', sections.findings),
    section('Diagnostik / Untersuchungen', sections.diagnostics),
    section('Diagnosen', sections.diagnoses),
    section('Verlauf / Therapie', sections.course),
    section('Medikation', sections.medication),
    section('Empfehlungen / weiteres Vorgehen', sections.recommendations),
    section('Arbeitsfähigkeit', sections.workCapacity),
    section('Bemerkungen', sections.notes),
  ].join('');

  const opSpecific = [
    section('Datum der Operation', sections.opDate),
    section('Operateur / Assistenz / Anästhesieform', sections.opTeam),
    section('Diagnose präoperativ', sections.preDiag),
    section('Diagnose postoperativ', sections.postDiag),
    section('Eingriff / Operation', sections.opTitle),
    section('Indikation zur Operation', sections.indication),
    section('Präoperativer Status', sections.preStatus),
    section('Operationsverlauf', sections.opCourse),
    section('Intraoperative Befunde', sections.intraFindings),
    section('Verwendetes Material / Implantate', sections.materials),
    section('Blutverlust / Besonderes', sections.bloodLoss),
    section('Komplikationen', sections.complications || 'keine Komplikationen'),
    section('Postoperatives Regime / Anordnungen', sections.postRegime),
    section('Abschluss / Besonderheiten', sections.conclusion),
  ].join('');

  const zuweisungSpecific = [
    section('Grund der Zuweisung', sections.reason),
    section('Relevante Vorbefunde', sections.priorFindings),
    section('Fragestellung', sections.question),
  ].join('');

  const versicherungSpecific = [
    section('Diagnosen', sections.diagnoses),
    section('Kurze Anamnese', sections.history),
    section('Verlauf / aktuelle Situation', sections.course),
    section('Arbeitsfähigkeit', sections.workCapacity),
    section('Prognose (keine juristischen Bewertungen)', sections.prognosis),
  ].join('');

  const sonstigerSpecific = [
    section('Betreff', sections.subject),
    section('Anrede', sections.salutation),
    section('Text', sections.text),
    section('Schlussformel', sections.closing),
  ].join('');

  let bodySections = '';
  switch (letter.type) {
    case 'OP_BERICHT':
      bodySections = opSpecific; break;
    case 'ZUWEISUNG':
      bodySections = zuweisungSpecific; break;
    case 'VERSICHERUNGSBRIEF':
      bodySections = versicherungSpecific; break;
    case 'SONSTIGER_BRIEF':
      bodySections = sonstigerSpecific; break;
    case 'AUSTRITTSBERICHT':
    case 'ARZTBRIEF':
    default:
      bodySections = common; break;
  }

  return `<!doctype html>
  <html lang="de-CH">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${esc(title)}</title>
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
      </div>
      <div class="meta">
        <div class="recipient">
          ${recipient.name ? esc(recipient.name) + '<br/>' : ''}
          ${recipient.address ? esc(recipient.address).replace(/\n/g,'<br/>') : ''}
        </div>
        <div>${esc(clinic.address?.city || '')}, ${formatDate(letter.created_at || Date.now())}</div>
      </div>
      <div class="title">${esc(title)}</div>
      ${patientBlock}
      ${bodySections}
    </body>
  </html>`;
}

async function renderLetterPdf(letter, tenantConfig, appDir) {
  const html = renderLetterHtml(letter, tenantConfig);
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
  renderLetterPdf,
  renderLetterHtml,
};

