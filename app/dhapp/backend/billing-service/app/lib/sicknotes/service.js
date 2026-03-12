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
    `SELECT id, tenant_id, patient_id, start_date, end_date, open_end, degree_percent, receiver_type, status, created_at, updated_at, pdf_path
       FROM sick_notes
      WHERE tenant_id = $1 AND patient_id = $2
      ORDER BY created_at DESC, id DESC`,
    [tenantCtx.id, Number(patientId)]
  );
  return rows;
}

async function getSickNote(tenantCtx, id) {
  const { rows } = await tenantCtx.db.query(
    `SELECT id, tenant_id, patient_id, created_at, updated_at, created_by_user_id,
            start_date, end_date, open_end, degree_percent,
            diagnosis_short, remark,
            receiver_type, receiver_name, receiver_address,
            status, pdf_path, document_path
       FROM sick_notes
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantCtx.id, Number(id)]
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
       tenant_id, patient_id, created_by_user_id,
       start_date, end_date, open_end, degree_percent,
       diagnosis_short, remark, receiver_type, receiver_name, receiver_address,
       status
     ) VALUES (
       $1, $2, $3,
       COALESCE($4, CURRENT_DATE), $5, COALESCE($6,false), COALESCE($7, 100),
       $8, $9, COALESCE($10,'PATIENT'), $11, $12,
       'DRAFT'
     )
     RETURNING id, tenant_id, patient_id, start_date, end_date, open_end, degree_percent,
               diagnosis_short, remark, receiver_type, receiver_name, receiver_address,
               status, created_at, updated_at, pdf_path`,
    [
      tenantCtx.id, Number(patient_id), Number(userId) || null,
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
  const params = [tenantCtx.id, Number(id)];
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
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id, patient_id, created_at, updated_at, created_by_user_id,
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
  const stem = `AU_${date}_${note.id}_${sanitize(String(note.degree_percent||100))}pct`;
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
    `SELECT name, vorname, nachname, geburtsdatum, versichertennummer AS insurance_number, geschlecht
       FROM patients WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantCtx.id, Number(note.patient_id)]
  );
  const patient = patientRow.rows[0] || {};
  const receiver = { type: note.receiver_type, name: note.receiver_name, address: note.receiver_address };
  const { getTenantBillingConfig } = require('../invoices/tenantConfig');
  const cfg = await getTenantBillingConfig(tenantCtx);
  const pdfPayload = { ...note, patient, receiver };
  const pdf = await renderSickNotePdf(pdfPayload, cfg, appDir);
  const file = await writeSickNotePdfToPatientFiles(tenantCtx, note.patient_id, note, pdf.buffer);

  const { rows } = await tenantCtx.db.query(
    `UPDATE sick_notes
        SET status = 'FINAL', pdf_path = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id, patient_id, created_at, updated_at, created_by_user_id,
                start_date, end_date, open_end, degree_percent, diagnosis_short, remark,
                receiver_type, receiver_name, receiver_address, status, pdf_path, document_path`,
    [tenantCtx.id, Number(note.id), file.relPath]
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

