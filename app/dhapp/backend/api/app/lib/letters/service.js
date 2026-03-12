'use strict';

const fs = require('fs');
const path = require('path');
const { renderLetterPdf } = require('./pdf');
const { describeTenantStorage } = require('../storage');

const fsp = fs.promises;

const sanitize = (s) => String(s || '').replace(/[^\w.\-+]/g, '_');
const yyyymmdd = (d) => {
  const dt = d ? new Date(d) : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2, '0');
  const d2 = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${d2}`;
};

async function listLetters(tenantCtx, patientId) {
  const { rows } = await tenantCtx.db.query(
    `SELECT letter_id, letter_id AS id, patient_id, type, title, status, created_at, updated_at, created_by, pdf_path
       FROM letters
      WHERE patient_id = $1
      ORDER BY created_at DESC, letter_id DESC`,
    [patientId]
  );
  return rows;
}

async function getLetter(tenantCtx, id) {
  const { rows } = await tenantCtx.db.query(
    `SELECT letter_id, letter_id AS id, patient_id, type, title, status, created_at, updated_at, created_by, content, pdf_path, document_path
       FROM letters
      WHERE letter_id = $1
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createLetter(tenantCtx, payload, userId) {
  const { patient_id, type, title, content } = payload || {};
  if (!patient_id) throw new Error('patient_id fehlt');
  if (!type) throw new Error('type fehlt');
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO letters (patient_id, type, title, status, created_by, content)
     VALUES ($1, $2, $3, 'DRAFT', $4, $5)
     RETURNING letter_id, letter_id AS id, patient_id, type, title, status, created_at, updated_at, created_by, content, pdf_path` ,
    [patient_id, String(type), title || null, userId || null, content || {}]
  );
  return rows[0];
}

async function updateLetter(tenantCtx, id, payload) {
  const existing = await getLetter(tenantCtx, id);
  if (!existing) throw new Error('Brief nicht gefunden');
  const fields = [];
  const params = [id];
  let idx = params.length;
  if (payload.title !== undefined) { fields.push(`title = $${++idx}`); params.push(payload.title); }
  if (payload.type !== undefined) { fields.push(`type = $${++idx}`); params.push(payload.type); }
  if (payload.status !== undefined) { fields.push(`status = $${++idx}`); params.push(payload.status); }
  if (payload.content !== undefined) { fields.push(`content = $${++idx}`); params.push(payload.content); }
  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE letters SET ${fields.join(', ')}, updated_at = now()
      WHERE letter_id = $1
      RETURNING letter_id, letter_id AS id, patient_id, type, title, status, created_at, updated_at, created_by, content, pdf_path`,
    params
  );
  return rows[0];
}

async function deleteLetter(tenantCtx, id) {
  const letter = await getLetter(tenantCtx, id);
  if (!letter) throw new Error('Brief nicht gefunden');
  if (String(letter.status).toUpperCase() === 'FINAL') {
    throw new Error('Finalisierte Briefe koennen nicht geloescht werden');
  }
  await tenantCtx.db.query(
    `DELETE FROM letters WHERE letter_id = $1`,
    [id]
  );
  return { ok: true };
}

async function writeLetterPdfToPatientFiles(tenantCtx, patientId, letter, buffer) {
  const baseDir = tenantCtx.paths.patientFilesDir;
  const patientDir = path.join(baseDir, String(patientId));
  const briefeDir = path.join(patientDir, 'briefe');
  await fsp.mkdir(briefeDir, { recursive: true, mode: 0o750 });
  const type = sanitize(letter.type || 'BRIEF');
  const date = yyyymmdd(letter.created_at || Date.now());
  const letterId = letter.letter_id || letter.id;
  const nameStem = `${type}_${date}_${letterId}`;
  const fileName = `${nameStem}.pdf`;
  const absPath = path.join(briefeDir, fileName);
  const tmp = `${absPath}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buffer, { mode: 0o640 });
  await fsp.rename(tmp, absPath);

  const relForClient = path.relative(baseDir, absPath).replace(/\\/g, '/');
  return { absPath, relPath: relForClient };
}

async function finalizeLetter(tenantCtx, letter, appDir) {
  const { getTenantBillingConfig } = require('../invoices/tenantConfig');
  const cfg = await getTenantBillingConfig(tenantCtx);
  const pdf = await renderLetterPdf(letter, cfg, appDir);
  const file = await writeLetterPdfToPatientFiles(tenantCtx, letter.patient_id, letter, pdf.buffer);

  const letterId = letter.letter_id || letter.id;
  const { rows } = await tenantCtx.db.query(
    `UPDATE letters
        SET status = 'FINAL', pdf_path = $2, updated_at = now()
      WHERE letter_id = $1
      RETURNING letter_id, letter_id AS id, patient_id, type, title, status, created_at, updated_at, created_by, pdf_path` ,
    [letterId, file.relPath]
  );
  return { row: rows[0], file };
}

module.exports = {
  listLetters,
  getLetter,
  createLetter,
  updateLetter,
  finalizeLetter,
  deleteLetter,
};
