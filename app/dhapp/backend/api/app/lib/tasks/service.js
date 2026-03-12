'use strict';

// Task service: CRUD + comments + unread count

const VALID_STATUSES = new Set(['open','in_progress','done','archived']);
const VALID_PRIORITIES = new Set(['low','medium','high','urgent']);

// Map legacy uppercase/German values to V5 lowercase
const STATUS_MAP = { OPEN: 'open', IN_PROGRESS: 'in_progress', DONE: 'done', ARCHIVED: 'archived' };
const PRIORITY_MAP = { LOW: 'low', NORMAL: 'medium', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' };

function normalizeStatus(s) {
  if (!s) return null;
  const v = String(s).toLowerCase();
  if (VALID_STATUSES.has(v)) return v;
  return STATUS_MAP[String(s).toUpperCase()] || null;
}
function normalizePriority(p) {
  if (!p) return null;
  const v = String(p).toLowerCase();
  if (VALID_PRIORITIES.has(v)) return v;
  return PRIORITY_MAP[String(p).toUpperCase()] || null;
}

async function listTasks(tenantCtx, filters = {}, currentUser, role) {
  const params = [];
  const conds = [];
  let i = params.length;

  // Filters
  if (filters.assignedToUserId != null) {
    params.push(filters.assignedToUserId);
    conds.push(`t.assigned_to = $${++i}`);
  }
  if (filters.createdByUserId != null) {
    params.push(filters.createdByUserId);
    conds.push(`t.created_by = $${++i}`);
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
    params.push(filters.patientId);
    conds.push(`t.patient_id = $${++i}`);
  }
  if (filters.search) {
    params.push(`%${String(filters.search).toLowerCase()}%`);
    conds.push(`(lower(coalesce(t.title,'')) LIKE $${++i} OR lower(coalesce(t.description,'')) LIKE $${i})`);
  }

  // Role-based restriction: non-admin -> only assigned to me OR created by me
  const roleStr = String(role || '').toLowerCase();
  const isPrivileged = ['admin','arzt','aerztin','doctor'].includes(roleStr);
  if (!isPrivileged && currentUser?.id) {
    const currentUserId = currentUser.id;
    params.push(currentUserId);
    const assignedParam = ++i;
    params.push(currentUserId);
    const createdParam = ++i;
    conds.push(`(t.assigned_to = $${assignedParam} OR t.created_by = $${createdParam})`);
  }

  // Pagination
  let limit = Number(filters.limit || 50);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  limit = Math.min(limit, 200);
  let offset = Number(filters.offset || 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const sql = `
    SELECT
      t.task_id,
      t.task_id AS id,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.type,
      t.created_by,
      t.created_by AS created_by_user_id,
      t.assigned_to,
      t.assigned_to AS assigned_to_user_id,
      t.due_date,
      t.patient_id,
      t.related_appointment_id,
      t.tags,
      t.read_at_assignee,
      t.created_at,
      t.updated_at,
      au.display_name AS assignee_name,
      cu.display_name AS creator_name,
      NULLIF(concat_ws(' ', p.first_name, p.last_name), '') AS patient_name
    FROM tasks t
    LEFT JOIN users au ON au.user_id = t.assigned_to
    LEFT JOIN users cu ON cu.user_id = t.created_by
    LEFT JOIN patients p ON p.patient_id = t.patient_id
    ${whereClause}
    ORDER BY COALESCE(t.due_date, t.created_at) ASC, t.task_id DESC
    LIMIT ${limit} OFFSET ${offset}`;

  const { rows } = await tenantCtx.db.query(sql, params);
  return rows;
}

async function getTask(tenantCtx, id) {
  const taskId = id;
  const tRes = await tenantCtx.db.query(
    `SELECT task_id, task_id AS id, title, description, status, priority, type,
            created_by, created_by AS created_by_user_id,
            assigned_to, assigned_to AS assigned_to_user_id,
            due_date, patient_id, related_appointment_id, tags,
            read_at_assignee, created_at, updated_at
       FROM tasks WHERE task_id = $1 LIMIT 1`,
    [taskId]
  );
  const task = tRes.rows[0] || null;
  if (!task) return null;
  const commentsRes = await tenantCtx.db.query(
    `SELECT c.*, u.display_name AS author_name
       FROM task_comments c
       LEFT JOIN users u ON u.user_id = c.user_id
      WHERE c.task_id = $1
      ORDER BY c.created_at ASC, c.comment_id ASC`,
    [taskId]
  );
  const attachmentsRes = await tenantCtx.db.query(
    `SELECT *
       FROM task_attachments
      WHERE task_id = $1
      ORDER BY created_at DESC, attachment_id DESC`,
    [taskId]
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
    assigned_to = null,
    due_date = null,
    patient_id = null,
    related_appointment_id = null,
    tags = null,
  } = payload || {};
  if (!title || !String(title).trim()) throw new Error('title fehlt');
  const st = normalizeStatus(status) || 'OPEN';
  const pr = normalizePriority(priority) || 'NORMAL';
  const assignedTo = assigned_to || assigned_to_user_id || null;
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO tasks (
       title, description, status, priority, type,
       created_by, assigned_to, due_date, patient_id, related_appointment_id, tags
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11
     )
     RETURNING task_id, task_id AS id, title, description, status, priority, type,
               created_by, created_by AS created_by_user_id,
               assigned_to, assigned_to AS assigned_to_user_id,
               due_date, patient_id, related_appointment_id, tags,
               read_at_assignee, created_at, updated_at`,
    [
      String(title), description, st, pr, type || null,
      userId || null, assignedTo,
      due_date ? new Date(due_date) : null,
      patient_id || null,
      related_appointment_id || null,
      Array.isArray(tags) && tags.length ? tags.map(String) : null,
    ]
  );
  return rows[0];
}

async function updateTask(tenantCtx, id, payload, currentUser) {
  const existingRes = await tenantCtx.db.query(
    `SELECT task_id, task_id AS id, title, description, status, priority, type,
            created_by, created_by AS created_by_user_id,
            assigned_to, assigned_to AS assigned_to_user_id,
            due_date, patient_id, related_appointment_id, tags,
            read_at_assignee, created_at, updated_at
       FROM tasks WHERE task_id = $1 LIMIT 1`,
    [id]
  );
  if (!existingRes.rows.length) throw new Error('Aufgabe nicht gefunden');
  const existing = existingRes.rows[0];

  const fields = [];
  const params = [id];
  let idx = params.length;
  const setField = (col, val) => { fields.push(`${col} = $${++idx}`); params.push(val); };
  if (payload.title !== undefined) setField('title', payload.title);
  if (payload.description !== undefined) setField('description', payload.description);
  if (payload.status !== undefined) setField('status', normalizeStatus(payload.status) || existing.status);
  if (payload.priority !== undefined) setField('priority', normalizePriority(payload.priority) || existing.priority);
  if (payload.type !== undefined) setField('type', payload.type);
  if (payload.assigned_to_user_id !== undefined) setField('assigned_to', payload.assigned_to_user_id || null);
  if (payload.assigned_to !== undefined) setField('assigned_to', payload.assigned_to || null);
  if (payload.due_date !== undefined) setField('due_date', payload.due_date ? new Date(payload.due_date) : null);
  if (payload.patient_id !== undefined) setField('patient_id', payload.patient_id || null);
  if (payload.related_appointment_id !== undefined) setField('related_appointment_id', payload.related_appointment_id || null);
  if (payload.tags !== undefined) setField('tags', Array.isArray(payload.tags) && payload.tags.length ? payload.tags.map(String) : null);

  // Mark as read when assignee opens or explicitly requested
  if (payload.mark_read === true && existing.assigned_to && currentUser?.id === existing.assigned_to && !existing.read_at_assignee) {
    setField('read_at_assignee', new Date());
  }

  if (!fields.length) return existing;
  const { rows } = await tenantCtx.db.query(
    `UPDATE tasks SET ${fields.join(', ')}, updated_at = now()
      WHERE task_id = $1
      RETURNING task_id, task_id AS id, title, description, status, priority, type,
                created_by, created_by AS created_by_user_id,
                assigned_to, assigned_to AS assigned_to_user_id,
                due_date, patient_id, related_appointment_id, tags,
                read_at_assignee, created_at, updated_at`,
    params
  );
  return rows[0];
}

async function addComment(tenantCtx, taskId, text, userId) {
  if (!text || !String(text).trim()) throw new Error('comment_text fehlt');
  const exists = await tenantCtx.db.query(`SELECT 1 FROM tasks WHERE task_id = $1`, [taskId]);
  if (!exists.rowCount) throw new Error('Aufgabe nicht gefunden');
  const { rows } = await tenantCtx.db.query(
    `INSERT INTO task_comments (task_id, user_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [taskId, userId || null, String(text)]
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
      WHERE assigned_to = $1
        AND status = ANY($2)
        AND read_at_assignee IS NULL`,
    [userId, statuses]
  );
  return Number(rows[0]?.cnt || 0);
}

async function markTaskRead(tenantCtx, id, userId) {
  const taskId = id;
  const { rows } = await tenantCtx.db.query(
    `UPDATE tasks
        SET read_at_assignee = COALESCE(read_at_assignee, now())
      WHERE task_id = $1 AND assigned_to = $2
      RETURNING task_id, task_id AS id, title, description, status, priority, type,
                created_by, created_by AS created_by_user_id,
                assigned_to, assigned_to AS assigned_to_user_id,
                due_date, patient_id, related_appointment_id, tags,
                read_at_assignee, created_at, updated_at`,
    [taskId, userId]
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
