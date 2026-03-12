'use strict';

// Notes service: CRUD + list + lock + attachments

const VALID_VISIBILITY = new Set(['PERSONAL','PRACTICE','PATIENT']);

function normVis(v) {
  if (!v) return null;
  const s = String(v).toUpperCase();
  return VALID_VISIBILITY.has(s) ? s : null;
}

function canEdit(note, currentUser) {
  if (!note || !currentUser) return false;
  if (note.visibility_type === 'PERSONAL') return Number(note.owner_user_id) === Number(currentUser.id);
  // PRACTICE/PATIENT -> allow clinic staff in tenant; route should already be protected
  return true;
}

async function listNotes(tenantCtx, filters = {}, currentUser) {
  const params = [tenantCtx.id];
  const conds = ['n.tenant_id = $1', 'n.deleted_at IS NULL'];
  let i = params.length;

  // Visibility
  const vis = normVis(filters.visibilityType || filters.visibility || filters.type);
  if (vis) {
    params.push(vis);
    conds.push(`n.visibility_type = $${++i}`);
    if (vis === 'PERSONAL') {
      // Personal notes only for current user
      params.push(Number(currentUser?.id) || 0);
      conds.push(`n.owner_user_id = $${++i}`);
    }
  }

  // Patient scoped
  if (filters.patientId != null) {
    params.push(Number(filters.patientId));
    conds.push(`n.patient_id = $${++i}`);
  }

  // Tag filter (single tag string)
  if (filters.tag) {
    params.push([String(filters.tag)]);
    conds.push(`n.tags @> $${++i}::text[]`);
  }

  // Search
  if (filters.search || filters.q) {
    const q = `%${String(filters.search || filters.q).toLowerCase()}%`;
    params.push(q);
    conds.push(`(lower(coalesce(n.title,'')) LIKE $${++i} OR lower(coalesce(n.content,'')) LIKE $${i})`);
  }

  // Pagination
  let limit = Number(filters.limit || 100);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  limit = Math.min(limit, 500);
  let offset = Number(filters.offset || 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const sql = `
    SELECT n.*
      FROM notes n
     WHERE ${conds.join(' AND ')}
     ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC
     LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await tenantCtx.db.query(sql, params);
  return rows;
}

async function getNote(tenantCtx, id) {
  const noteId = Number(id);
  const { rows } = await tenantCtx.db.query(
    `SELECT * FROM notes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantCtx.id, noteId]
  );
  const note = rows[0] || null;
  if (!note) return null;
  const att = await tenantCtx.db.query(
    `SELECT * FROM note_attachments WHERE tenant_id = $1 AND note_id = $2 ORDER BY created_at DESC, id DESC`,
    [tenantCtx.id, noteId]
  );
  return { note, attachments: att.rows };
}

async function createNote(tenantCtx, payload, currentUser) {
  const {
    title = null,
    content = null,
    visibility_type: v1,
    visibilityType: v2,
    patient_id: p1,
    patientId: p2,
    tags = null,
    color = null,
    pinned = false,
  } = payload || {};
  const vis = normVis(v1 || v2 || 'PERSONAL') || 'PERSONAL';
  const patientId = p1 != null ? Number(p1) : (p2 != null ? Number(p2) : null);
  const ownerId = Number(currentUser?.id) || null;
  const tagArray = Array.isArray(tags) && tags.length ? tags.map(String) : null;

  const { rows } = await tenantCtx.db.query(
    `INSERT INTO notes (
       tenant_id, owner_user_id, visibility_type, patient_id,
       title, content, tags, color, pinned
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [tenantCtx.id, ownerId, vis, patientId || null, title, content, tagArray, color || null, Boolean(pinned)]
  );
  return rows[0];
}

async function updateNote(tenantCtx, id, patch, currentUser) {
  const noteId = Number(id);
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT * FROM notes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantCtx.id, noteId]
  );
  if (!exRows.length) throw new Error('Notiz nicht gefunden');
  const existing = exRows[0];

  // Respect lock: only allow pin/unpin when locked
  const isLocked = existing.locked === true;
  const fields = [];
  const params = [tenantCtx.id, noteId];
  let i = params.length;
  const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };

  if (isLocked) {
    if (patch.pinned !== undefined) set('pinned', Boolean(patch.pinned));
    // deny other changes
  } else {
    if (!canEdit(existing, currentUser)) throw new Error('Keine Berechtigung zum Bearbeiten');
    if (patch.title !== undefined) set('title', patch.title);
    if (patch.content !== undefined) set('content', patch.content);
    if (patch.tags !== undefined) set('tags', Array.isArray(patch.tags) && patch.tags.length ? patch.tags.map(String) : null);
    if (patch.color !== undefined) set('color', patch.color || null);
    if (patch.pinned !== undefined) set('pinned', Boolean(patch.pinned));
    if (patch.visibilityType !== undefined || patch.visibility_type !== undefined) {
      const vis = normVis(patch.visibilityType || patch.visibility_type);
      if (vis) set('visibility_type', vis);
    }
    if (patch.patientId !== undefined || patch.patient_id !== undefined) {
      const pid = patch.patient_id != null ? Number(patch.patient_id) : (patch.patientId != null ? Number(patch.patientId) : null);
      set('patient_id', pid || null);
    }
  }

  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE notes SET ${fields.join(', ')}, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
    params
  );
  return rows[0];
}

async function lockNote(tenantCtx, id, currentUser) {
  const noteId = Number(id);
  // Only owner of PERSONAL or any clinic staff for PRACTICE/PATIENT
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT * FROM notes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantCtx.id, noteId]
  );
  if (!exRows.length) throw new Error('Notiz nicht gefunden');
  const existing = exRows[0];
  if (!canEdit(existing, currentUser)) throw new Error('Keine Berechtigung');
  const { rows } = await tenantCtx.db.query(
    `UPDATE notes SET locked = true, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantCtx.id, noteId]
  );
  return rows[0];
}

async function softDeleteNote(tenantCtx, id, currentUser) {
  const noteId = Number(id);
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT * FROM notes WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantCtx.id, noteId]
  );
  if (!exRows.length) return false;
  const existing = exRows[0];
  if (!canEdit(existing, currentUser)) throw new Error('Keine Berechtigung');
  const { rowCount } = await tenantCtx.db.query(
    `UPDATE notes SET deleted_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantCtx.id, noteId]
  );
  return rowCount > 0;
}

async function addAttachment(tenantCtx, noteId, filePath, userId) {
  const id = Number(noteId);
  const { rows: exists } = await tenantCtx.db.query(`SELECT 1 FROM notes WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
  if (!exists.length) throw new Error('Notiz nicht gefunden');
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO note_attachments (tenant_id, note_id, file_path, uploaded_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantCtx.id, id, String(filePath), Number(userId) || null]
  );
  return rows[0];
}

async function listAttachments(tenantCtx, noteId) {
  const id = Number(noteId);
  const { rows } = await tenantCtx.db.query(
    `SELECT * FROM note_attachments WHERE tenant_id = $1 AND note_id = $2 ORDER BY created_at DESC, id DESC`,
    [tenantCtx.id, id]
  );
  return rows;
}

module.exports = {
  listNotes,
  getNote,
  createNote,
  updateNote,
  lockNote,
  softDeleteNote,
  addAttachment,
  listAttachments,
};

