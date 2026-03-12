'use strict';

// Task service: CRUD + comments + unread count

const VALID_STATUSES = new Set(['OPEN','IN_PROGRESS','DONE','ARCHIVED']);
const VALID_PRIORITIES = new Set(['LOW','NORMAL','HIGH','URGENT']);

function normalizeStatus(s) {
  if (!s) return null;
  const v = String(s).toUpperCase();
  return VALID_STATUSES.has(v) ? v : null;
}
function normalizePriority(p) {
  if (!p) return null;
  const v = String(p).toUpperCase();
  return VALID_PRIORITIES.has(v) ? v : null;
}

async function listTasks(tenantCtx, filters = {}, currentUser, role) {
  const params = [tenantCtx.id];
  const conds = ['t.tenant_id = $1'];
  let i = params.length;

  // Filters
  if (filters.assignedToUserId != null) {
    params.push(Number(filters.assignedToUserId));
    conds.push(`t.assigned_to_user_id = $${++i}`);
  }
  if (filters.createdByUserId != null) {
    params.push(Number(filters.createdByUserId));
    conds.push(`t.created_by_user_id = $${++i}`);
  }
  if (filters.status) {
    const list = Array.isArray(filters.status) ? filters.status : [filters.status];
    const normalized = list.map((s) => normalizeStatus(s)).filter(Boolean);
    if (normalized.length) {
      params.push(normalized);
      conds.push(`t.status = ANY($${++i})`);
    }
  }
  if (filters.priority) {
    const list = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    const normalized = list.map((p) => normalizePriority(p)).filter(Boolean);
    if (normalized.length) {
      params.push(normalized);
      conds.push(`t.priority = ANY($${++i})`);
    }
  }
  if (filters.type) {
    params.push(String(filters.type));
    conds.push(`t.type = $${++i}`);
  }
  if (filters.patientId != null) {
    params.push(Number(filters.patientId));
    conds.push(`t.patient_id = $${++i}`);
  }
  if (filters.search) {
    params.push(`%${String(filters.search).toLowerCase()}%`);
    conds.push(`(lower(coalesce(t.title,'')) LIKE $${++i} OR lower(coalesce(t.description,'')) LIKE $${i})`);
  }

  // Role-based restriction: non-admin -> only assigned to me OR created by me
  const roleStr = String(role || '').toLowerCase();
  const isPrivileged = ['admin','arzt','ärztin','doctor'].includes(roleStr);
  if (!isPrivileged && currentUser?.id) {
    params.push(Number(currentUser.id));
    params.push(Number(currentUser.id));
    conds.push(`(t.assigned_to_user_id = $${++i - 1} OR t.created_by_user_id = $${i})`);
  }

  // Pagination
  let limit = Number(filters.limit || 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  limit = Math.min(limit, 200);
  let offset = Number(filters.offset || 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const sql = `
    SELECT
      t.*,
      au.name AS assignee_name,
      cu.name AS creator_name,
      COALESCE(p.name, NULLIF(concat_ws(' ', p.vorname, p.nachname), '')) AS patient_name
    FROM tasks t
    LEFT JOIN users au ON au.id = t.assigned_to_user_id AND au.tenant_id = t.tenant_id
    LEFT JOIN users cu ON cu.id = t.created_by_user_id AND cu.tenant_id = t.tenant_id
    LEFT JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
    WHERE ${conds.join(' AND ')}
    ORDER BY COALESCE(t.due_date, t.created_at) ASC, t.id DESC
    LIMIT ${limit} OFFSET ${offset}`;

  const { rows } = await tenantCtx.db.query(sql, params);
  return rows;
}

async function getTask(tenantCtx, id) {
  const taskId = Number(id);
  const tRes = await tenantCtx.db.query(
    `SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantCtx.id, taskId]
  );
  const task = tRes.rows[0] || null;
  if (!task) return null;
  const commentsRes = await tenantCtx.db.query(
    `SELECT c.*, u.name AS author_name
       FROM task_comments c
       LEFT JOIN users u ON u.id = c.author_user_id AND u.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.task_id = $2
      ORDER BY c.created_at ASC, c.id ASC`,
    [tenantCtx.id, taskId]
  );
  const attachmentsRes = await tenantCtx.db.query(
    `SELECT *
       FROM task_attachments
      WHERE tenant_id = $1 AND task_id = $2
      ORDER BY uploaded_at DESC, id DESC`,
    [tenantCtx.id, taskId]
  );
  return { task, comments: commentsRes.rows, attachments: attachmentsRes.rows };
}

async function createTask(tenantCtx, payload, userId) {
  const {
    title,
    description = null,
    status = 'OPEN',
    priority = 'NORMAL',
    type = null,
    assigned_to_user_id = null,
    due_date = null,
    patient_id = null,
    related_appointment_id = null,
    tags = null,
  } = payload || {};
  if (!title || !String(title).trim()) throw new Error('title fehlt');
  const st = normalizeStatus(status) || 'OPEN';
  const pr = normalizePriority(priority) || 'NORMAL';
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO tasks (
       tenant_id, title, description, status, priority, type,
       created_by_user_id, assigned_to_user_id, due_date, patient_id, related_appointment_id, tags
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12
     )
     RETURNING *`,
    [
      tenantCtx.id,
      String(title), description, st, pr, type || null,
      Number(userId) || null, assigned_to_user_id ? Number(assigned_to_user_id) : null,
      due_date ? new Date(due_date) : null,
      patient_id ? Number(patient_id) : null,
      related_appointment_id ? Number(related_appointment_id) : null,
      Array.isArray(tags) && tags.length ? tags.map(String) : null,
    ]
  );
  return rows[0];
}

async function updateTask(tenantCtx, id, payload, currentUser) {
  const existingRes = await tenantCtx.db.query(`SELECT * FROM tasks WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantCtx.id, Number(id)]);
  if (!existingRes.rows.length) throw new Error('Aufgabe nicht gefunden');
  const existing = existingRes.rows[0];

  const fields = [];
  const params = [tenantCtx.id, Number(id)];
  let idx = params.length;
  const setField = (col, val) => { fields.push(`${col} = $${++idx}`); params.push(val); };
  if (payload.title !== undefined) setField('title', payload.title);
  if (payload.description !== undefined) setField('description', payload.description);
  if (payload.status !== undefined) setField('status', normalizeStatus(payload.status) || existing.status);
  if (payload.priority !== undefined) setField('priority', normalizePriority(payload.priority) || existing.priority);
  if (payload.type !== undefined) setField('type', payload.type);
  if (payload.assigned_to_user_id !== undefined) setField('assigned_to_user_id', payload.assigned_to_user_id ? Number(payload.assigned_to_user_id) : null);
  if (payload.due_date !== undefined) setField('due_date', payload.due_date ? new Date(payload.due_date) : null);
  if (payload.patient_id !== undefined) setField('patient_id', payload.patient_id ? Number(payload.patient_id) : null);
  if (payload.related_appointment_id !== undefined) setField('related_appointment_id', payload.related_appointment_id ? Number(payload.related_appointment_id) : null);
  if (payload.tags !== undefined) setField('tags', Array.isArray(payload.tags) && payload.tags.length ? payload.tags.map(String) : null);

  // Mark as read when assignee opens or explicitly requested
  if (payload.mark_read === true && existing.assigned_to_user_id && currentUser?.id === existing.assigned_to_user_id && !existing.read_at_assignee) {
    setField('read_at_assignee', new Date());
  }

  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE tasks SET ${fields.join(', ')}, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
    params
  );
  return rows[0];
}

async function addComment(tenantCtx, taskId, text, userId) {
  if (!text || !String(text).trim()) throw new Error('comment_text fehlt');
  const tId = Number(taskId);
  const exists = await tenantCtx.db.query(`SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, tId]);
  if (!exists.rowCount) throw new Error('Aufgabe nicht gefunden');
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO task_comments (tenant_id, task_id, author_user_id, comment_text)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantCtx.id, tId, Number(userId) || null, String(text)]
  );
  return rows[0];
}

async function unreadCount(tenantCtx, userId, allowedStatuses = ['OPEN','IN_PROGRESS']) {
  const statuses = (Array.isArray(allowedStatuses) ? allowedStatuses : [allowedStatuses])
    .map((s) => normalizeStatus(s))
    .filter(Boolean);
  if (!statuses.length) return 0;
  const { rows } = await tenantCtx.db.query(
    `SELECT COUNT(1) AS cnt
       FROM tasks
      WHERE tenant_id = $1
        AND assigned_to_user_id = $2
        AND status = ANY($3)
        AND read_at_assignee IS NULL`,
    [tenantCtx.id, Number(userId), statuses]
  );
  return Number(rows[0]?.cnt || 0);
}

async function markTaskRead(tenantCtx, id, userId) {
  const taskId = Number(id);
  const { rows } = await tenantCtx.db.query(
    `UPDATE tasks
        SET read_at_assignee = COALESCE(read_at_assignee, now())
      WHERE tenant_id = $1 AND id = $2 AND assigned_to_user_id = $3
      RETURNING *`,
    [tenantCtx.id, taskId, Number(userId)]
  );
  return rows[0] || null;
}

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  addComment,
  unreadCount,
  markTaskRead,
};
