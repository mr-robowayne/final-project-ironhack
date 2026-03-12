'use strict';

const fs = require('fs');
const path = require('path');
const fsp = fs.promises;
const { describeTenantStorage } = require('../storage');
const { renderSickNotePdf } = require('./pdf');

const sanitize = (s) => String(s || '').replace(/[^\w.\-+]/g, '_');
const yyyymmdd = (d) => {
  const dt = d ? new Date(d) : new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d2 = String(dt.getDate()).padStart(2,'0');
  return `${y}${m}${d2}`;
};

async function listSickNotes(tenantCtx, patientId) {
  const { rows } = await tenantCtx.db.query(
    `SELECT sick_note_id, sick_note_id AS id, patient_id, start_date, end_date, open_end, degree_percent, receiver_type, status, created_at, updated_at, pdf_path
       FROM sick_notes
      WHERE patient_id = $1
      ORDER BY created_at DESC, sick_note_id DESC`,
    [patientId]
  );
  return rows;
}

async function getSickNote(tenantCtx, id) {
  const { rows } = await tenantCtx.db.query(
    `SELECT sick_note_id, sick_note_id AS id, patient_id, created_at, updated_at, created_by,
            start_date, end_date, open_end, degree_percent,
            diagnosis_short, remark,
            receiver_type, receiver_name, receiver_address,
            status, pdf_path, document_path
       FROM sick_notes
      WHERE sick_note_id = $1
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createSickNote(tenantCtx, payload, userId) {
  const {
    patient_id,
    start_date,
    end_date,
    open_end = false,
    degree_percent = 100,
    diagnosis_short = null,
    remark = null,
    receiver_type = 'PATIENT',
    receiver_name = null,
    receiver_address = null,
  } = payload || {};

  if (!patient_id) throw new Error('patient_id fehlt');

  const { rows } = await tenantCtx.db.query(
    `INSERT INTO sick_notes (
       patient_id, created_by,
       start_date, end_date, open_end, degree_percent,
       diagnosis_short, remark, receiver_type, receiver_name, receiver_address,
       status
     ) VALUES (
       $1, $2,
       COALESCE($3, CURRENT_DATE), $4, COALESCE($5,false), COALESCE($6, 100),
       $7, $8, COALESCE($9,'PATIENT'), $10, $11,
       'DRAFT'
     )
     RETURNING sick_note_id, sick_note_id AS id, patient_id, start_date, end_date, open_end, degree_percent,
               diagnosis_short, remark, receiver_type, receiver_name, receiver_address,
               status, created_at, updated_at, pdf_path`,
    [
      patient_id, userId || null,
      start_date || null, end_date || null, Boolean(open_end), Number(degree_percent),
      diagnosis_short, remark, receiver_type, receiver_name, receiver_address,
    ]
  );
  return rows[0];
}

async function updateSickNote(tenantCtx, id, payload) {
  const existing = await getSickNote(tenantCtx, id);
  if (!existing) throw new Error('Krankmeldung nicht gefunden');
  if (existing.status === 'FINAL') {
    // Allow only remark updates? For now, block all edits on FINAL
    return existing;
  }
  const fields = [];
  const params = [id];
  let idx = params.length;
  const mapping = {
    start_date: 'start_date', end_date: 'end_date', open_end: 'open_end', degree_percent: 'degree_percent',
    diagnosis_short: 'diagnosis_short', remark: 'remark',
    receiver_type: 'receiver_type', receiver_name: 'receiver_name', receiver_address: 'receiver_address',
    status: 'status'
  };
  for (const [k, col] of Object.entries(mapping)) {
    if (payload[k] !== undefined) { fields.push(`${col} = $${++idx}`); params.push(payload[k]); }
  }
  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE sick_notes SET ${fields.join(', ')}, updated_at = now()
      WHERE sick_note_id = $1
      RETURNING sick_note_id, sick_note_id AS id, patient_id, created_at, updated_at, created_by,
                start_date, end_date, open_end, degree_percent, diagnosis_short, remark,
                receiver_type, receiver_name, receiver_address, status, pdf_path, document_path`,
    params
  );
  return rows[0];
}

async function writeSickNotePdfToPatientFiles(tenantCtx, patientId, note, buffer) {
  const baseDir = tenantCtx.paths.patientFilesDir;
  const patientDir = path.join(baseDir, String(patientId));
  const targetDir = path.join(patientDir, 'krankmeldungen');
  await fsp.mkdir(targetDir, { recursive: true, mode: 0o750 });
  const date = yyyymmdd(note.created_at || Date.now());
  const noteId = note.sick_note_id || note.id;
  const stem = `AU_${date}_${noteId}_${sanitize(String(note.degree_percent||100))}pct`;
  const fileName = `${stem}.pdf`;
  const absPath = path.join(targetDir, fileName);
  const tmp = `${absPath}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, buffer, { mode: 0o640 });
  await fsp.rename(tmp, absPath);
  const relForClient = path.relative(baseDir, absPath).replace(/\\/g, '/');
  return { absPath, relPath: relForClient };
}

async function finalizeSickNote(tenantCtx, note, appDir) {
  // assemble presentation payload for PDF
  const patientRow = await tenantCtx.db.query(
    `SELECT COALESCE(first_name || ' ' || last_name, '') AS name,
            first_name,
            first_name AS vorname,
            last_name,
            last_name AS nachname,
            birth_date,
            birth_date AS geburtsdatum,
            ahv_number AS insurance_number,
            ahv_number AS versichertennummer
       FROM patients WHERE patient_id = $1 LIMIT 1`,
    [note.patient_id]
  );
  const patient = patientRow.rows[0] || {};
  const receiver = { type: note.receiver_type, name: note.receiver_name, address: note.receiver_address };
  const { getTenantBillingConfig } = require('../invoices/tenantConfig');
  const cfg = await getTenantBillingConfig(tenantCtx);
  const pdfPayload = { ...note, patient, receiver };
  const pdf = await renderSickNotePdf(pdfPayload, cfg, appDir);
  const file = await writeSickNotePdfToPatientFiles(tenantCtx, note.patient_id, note, pdf.buffer);

  const noteId = note.sick_note_id || note.id;
  const { rows } = await tenantCtx.db.query(
    `UPDATE sick_notes
        SET status = 'FINAL', pdf_path = $2, updated_at = now()
      WHERE sick_note_id = $1
      RETURNING sick_note_id, sick_note_id AS id, patient_id, created_at, updated_at, created_by,
                start_date, end_date, open_end, degree_percent, diagnosis_short, remark,
                receiver_type, receiver_name, receiver_address, status, pdf_path, document_path`,
    [noteId, file.relPath]
  );
  return { row: rows[0], file };
}

module.exports = {
  listSickNotes,
  getSickNote,
  createSickNote,
  updateSickNote,
  finalizeSickNote,
};
