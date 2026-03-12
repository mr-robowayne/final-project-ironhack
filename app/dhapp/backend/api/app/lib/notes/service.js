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
  if (note.visibility_type === 'PERSONAL') return note.owner_user_id === currentUser.id;
  // PRACTICE/PATIENT -> allow clinic staff in tenant; route should already be protected
  return true;
}

async function listNotes(tenantCtx, filters = {}, currentUser) {
  const params = [];
  const conds = ['n.deleted_at IS NULL'];
  let i = params.length;

  // Visibility
  const vis = normVis(filters.visibilityType || filters.visibility || filters.type);
  if (vis) {
    params.push(vis);
    conds.push(`n.visibility_type = $${++i}`);
    if (vis === 'PERSONAL') {
      // Personal notes only for current user
      params.push(currentUser?.id || null);
      conds.push(`n.owner_user_id = $${++i}`);
    }
  }

  // Patient scoped
  if (filters.patientId != null) {
    params.push(filters.patientId);
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
    SELECT n.note_id, n.note_id AS id,
           n.owner_user_id, n.visibility_type, n.patient_id,
           n.title, n.content, n.tags, n.color, n.pinned, n.locked,
           n.created_at, n.updated_at, n.deleted_at
      FROM notes n
     WHERE ${conds.join(' AND ')}
     ORDER BY n.pinned DESC, n.updated_at DESC, n.note_id DESC
     LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await tenantCtx.db.query(sql, params);
  return rows;
}

async function getNote(tenantCtx, id) {
  const noteId = id;
  const { rows } = await tenantCtx.db.query(
    `SELECT note_id, note_id AS id,
            owner_user_id, visibility_type, patient_id,
            title, content, tags, color, pinned, locked,
            created_at, updated_at, deleted_at
       FROM notes WHERE note_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [noteId]
  );
  const note = rows[0] || null;
  if (!note) return null;
  const att = await tenantCtx.db.query(
    `SELECT * FROM note_attachments WHERE note_id = $1 ORDER BY created_at DESC, attachment_id DESC`,
    [noteId]
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
  const patientId = p1 != null ? p1 : (p2 != null ? p2 : null);
  const ownerId = currentUser?.id || null;
  const tagArray = Array.isArray(tags) && tags.length ? tags.map(String) : null;

  const { rows } = await tenantCtx.db.query(
    `INSERT INTO notes (
       owner_user_id, visibility_type, patient_id,
       title, content, tags, color, pinned
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING note_id, note_id AS id,
               owner_user_id, visibility_type, patient_id,
               title, content, tags, color, pinned, locked,
               created_at, updated_at`,
    [ownerId, vis, patientId || null, title, content, tagArray, color || null, Boolean(pinned)]
  );
  return rows[0];
}

async function updateNote(tenantCtx, id, patch, currentUser) {
  const noteId = id;
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT note_id, note_id AS id,
            owner_user_id, visibility_type, patient_id,
            title, content, tags, color, pinned, locked,
            created_at, updated_at, deleted_at
       FROM notes WHERE note_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [noteId]
  );
  if (!exRows.length) throw new Error('Notiz nicht gefunden');
  const existing = exRows[0];

  // Respect lock: only allow pin/unpin when locked
  const isLocked = existing.locked === true;
  const fields = [];
  const params = [noteId];
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
      const pid = patch.patient_id != null ? patch.patient_id : (patch.patientId != null ? patch.patientId : null);
      set('patient_id', pid || null);
    }
  }

  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE notes SET ${fields.join(', ')}, updated_at = now()
      WHERE note_id = $1
      RETURNING note_id, note_id AS id,
                owner_user_id, visibility_type, patient_id,
                title, content, tags, color, pinned, locked,
                created_at, updated_at`,
    params
  );
  return rows[0];
}

async function lockNote(tenantCtx, id, currentUser) {
  const noteId = id;
  // Only owner of PERSONAL or any clinic staff for PRACTICE/PATIENT
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT note_id, note_id AS id,
            owner_user_id, visibility_type, patient_id,
            title, content, tags, color, pinned, locked,
            created_at, updated_at, deleted_at
       FROM notes WHERE note_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [noteId]
  );
  if (!exRows.length) throw new Error('Notiz nicht gefunden');
  const existing = exRows[0];
  if (!canEdit(existing, currentUser)) throw new Error('Keine Berechtigung');
  const { rows } = await tenantCtx.db.query(
    `UPDATE notes SET locked = true, updated_at = now() WHERE note_id = $1 RETURNING note_id, note_id AS id,
                owner_user_id, visibility_type, patient_id,
                title, content, tags, color, pinned, locked,
                created_at, updated_at`,
    [noteId]
  );
  return rows[0];
}

async function softDeleteNote(tenantCtx, id, currentUser) {
  const noteId = id;
  const { rows: exRows } = await tenantCtx.db.query(
    `SELECT note_id, note_id AS id,
            owner_user_id, visibility_type, patient_id,
            title, content, tags, color, pinned, locked,
            created_at, updated_at, deleted_at
       FROM notes WHERE note_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [noteId]
  );
  if (!exRows.length) return false;
  const existing = exRows[0];
  if (!canEdit(existing, currentUser)) throw new Error('Keine Berechtigung');
  const { rowCount } = await tenantCtx.db.query(
    `UPDATE notes SET deleted_at = now() WHERE note_id = $1`,
    [noteId]
  );
  return rowCount > 0;
}

async function addAttachment(tenantCtx, noteId, filePath, userId) {
  const { rows: exists } = await tenantCtx.db.query(`SELECT 1 FROM notes WHERE note_id = $1`, [noteId]);
  if (!exists.length) throw new Error('Notiz nicht gefunden');
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO note_attachments (note_id, file_path, uploaded_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [noteId, String(filePath), userId || null]
  );
  return rows[0];
}

async function listAttachments(tenantCtx, noteId) {
  const { rows } = await tenantCtx.db.query(
    `SELECT * FROM note_attachments WHERE note_id = $1 ORDER BY created_at DESC, attachment_id DESC`,
    [noteId]
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
