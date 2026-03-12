// server/routes/calendars.js
const express = require('express');
const { withDb } = require('../db/context');

const router = express.Router();

function getCtx(req) {
  // Prefer server-authenticated context
  const tenantFromReq = (req.tenant && (req.tenant.id || req.tenant.tenant_id))
    || (req.user && (req.user.tenant_id || req.user.tenantId))
    || null;
  const userFromReq = req.user && (req.user.id != null ? Number(req.user.id) : null);

  const tenantFromHeader = req.header('x-tenant-id') || req.header('X-Tenant-ID');
  const userFromHeader = req.header('x-user-id') || req.header('X-User-ID');

  const tenantFromAuth = req.auth && (req.auth.tenantId || req.auth.tenant_id);
  const userFromAuth = req.auth && (req.auth.userId != null ? Number(req.auth.userId) : (req.auth.user_id != null ? Number(req.auth.user_id) : null));

  const tenantId = String(tenantFromReq || tenantFromHeader || tenantFromAuth || '').trim();
  const userIdNum = userFromReq != null ? Number(userFromReq)
                  : (userFromHeader != null ? Number(userFromHeader) : null);
  const userId = Number.isFinite(userIdNum) ? userIdNum
                : (Number.isFinite(userFromAuth) ? Number(userFromAuth) : null);

  return { tenantId, userId };
}

// GET /api/calendars (read-only; uses view scoped by GUCs)
router.get('/', async (req, res, next) => {
  const { tenantId, userId } = getCtx(req);
  try {
    const items = await withDb.readonly(tenantId, userId, async (db) => {
      const sql = `
        SELECT c.id,
               c.name,
               c.type,
               c.owner_user_id,
               c.is_default,
               c.updated_at,
               c.created_at
          FROM public.calendars c
         WHERE c.tenant_id = $1
           AND (
                c.type = 'tenant'
             OR ($2::int IS NOT NULL AND c.owner_user_id = $2::int)
             OR ($2::int IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.calendar_members m
                   WHERE m.calendar_id = c.id
                     AND m.user_id = $2::int
               ))
           )
         ORDER BY (c.type='tenant') DESC, lower(c.name)`;
      const { rows } = await db.query(sql, [tenantId, Number.isFinite(userId) ? userId : null]);
      return rows;
    });
    res.json({ items, count: items.length });
  } catch (e) { next(e); }
});

// GET /api/calendars/me (read-only via view; requires GUCs)
router.get('/me', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  if (!tenantId || !Number.isFinite(userId)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing tenant or user context' });
  }
  try {
    const items = await withDb.readonly(tenantId, userId, async (db) => {
      const sql = `
        SELECT c.id,
               c.name,
               c.type,
               c.owner_user_id,
               c.is_default
          FROM public.calendars c
         WHERE c.tenant_id = $1
           AND (
                c.type = 'tenant'
             OR c.owner_user_id = $2::int
             OR EXISTS (
                  SELECT 1 FROM public.calendar_members m
                   WHERE m.calendar_id = c.id
                     AND m.user_id = $2::int
               )
           )
         ORDER BY (c.type='tenant') DESC, lower(c.name)`;
      const { rows } = await db.query(sql, [tenantId, userId]);
      return rows;
    });
    res.json(items);
  } catch (e) {
    console.error('GET /api/calendars/me failed:', e);
    res.status(500).json({ error: 'calendars_me_failed', message: e?.message || String(e) });
  }
});

// GET /api/calendars/tenant – list ALL calendars in current tenant (no membership filter)
router.get('/tenant', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  if (!tenantId) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing tenant context' });
  }
  try {
    const items = await withDb.readonly(tenantId, userId, async (db) => {
      const sql = `
        SELECT c.id,
               c.name,
               c.type,
               c.owner_user_id,
               c.is_default,
               c.updated_at,
               c.created_at
          FROM public.calendars c
         WHERE c.tenant_id = $1
         ORDER BY (c.type='tenant') DESC, lower(c.name)`;
      const { rows } = await db.query(sql, [tenantId]);
      return rows;
    });
    res.json({ items, count: items.length });
  } catch (e) {
    console.error('GET /api/calendars/tenant failed:', e);
    res.status(500).json({ error: 'calendars_tenant_failed', message: e?.message || String(e) });
  }
});

// GET /api/calendars/mine – only the current user's own calendar (type='user', owner_user_id = user)
router.get('/mine', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  if (!tenantId || !Number.isFinite(userId)) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing tenant or user context' });
  }
  try {
    let item = await withDb.readonly(tenantId, userId, async (db) => {
      const sql = `
        SELECT c.id, c.name, c.type, c.owner_user_id, c.is_default
          FROM public.calendars c
         WHERE c.tenant_id = $1
           AND c.type = 'user'
           AND c.owner_user_id = $2::int
         LIMIT 1`;
      const { rows } = await db.query(sql, [tenantId, userId]);
      return rows[0] || null;
    });
    if (!item) {
      // Auto-provision a personal calendar for this user (exactly one per user)
      const created = await withDb(tenantId, userId, async (db) => {
        const display = (req.user?.name || req.user?.username || req.user?.email || 'Mein Kalender').toString().substring(0, 80);
        const { rows } = await db.query(
          `INSERT INTO public.calendars(tenant_id, name, type, owner_user_id, is_default)
           VALUES ($1, $2, 'user', $3::int, false)
           ON CONFLICT (tenant_id, owner_user_id) WHERE (type='user') DO UPDATE SET name = EXCLUDED.name, updated_at = now()
           RETURNING id, name, type, owner_user_id, is_default`,
          [tenantId, display, userId]
        );
        return rows[0] || null;
      }, { transaction: 'auto' });
      item = created;
    }
    if (!item) return res.status(404).json({ message: 'No personal calendar' });
    res.json(item);
  } catch (e) {
    console.error('GET /api/calendars/mine failed:', e);
    res.status(500).json({ error: 'calendars_mine_failed', message: e?.message || String(e) });
  }
});

// GET /api/calendars/:id (read-only)
router.get('/:id', async (req, res, next) => {
  const { tenantId, userId } = getCtx(req);
  const calId = Number(req.params.id);
  try {
    const row = await withDb(tenantId, userId, async (db) => {
      const sql = `
        SELECT c.id, c.name, c.type, c.owner_user_id, c.is_default, c.created_at, c.updated_at
        FROM public.calendars c
        WHERE c.id = $1
          AND c.tenant_id = $2
          AND (
               c.type = 'tenant'
            OR ($3::int IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.calendar_members m
                 WHERE m.calendar_id = c.id
                   AND m.user_id = $3::int
            ))
          )`;
      const { rows } = await db.query(sql, [calId, tenantId, Number.isFinite(userId) ? userId : null]);
      return rows[0] || null;
    }, { transaction: 'none' });
    if (!row) return res.status(404).json({ message: 'Calendar not found' });
    res.json(row);
  } catch (e) { next(e); }
});

// POST /api/calendars (create)
router.post('/', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  const { name, type = 'user' } = req.body || {};
  if (!tenantId) return res.status(400).json({ message: 'Missing tenant' });
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'name is required' });
  }
  if (!['user', 'tenant'].includes(type)) {
    return res.status(400).json({ message: 'type must be "user" or "tenant"' });
  }
  if (type === 'user' && !Number.isFinite(userId)) {
    return res.status(400).json({ message: 'userId required for user calendar' });
  }

  try {
    const created = await withDb(tenantId, userId, async (db) => {
      const params = [name.trim()];
      // For user calendars, set owner_user_id; for tenant, NULL
      const sql = type === 'user'
        ? `
          INSERT INTO public.calendars(tenant_id, name, type, owner_user_id, is_default)
          VALUES ($1, $2, 'user', $3::int, false)
          RETURNING id, name, type, owner_user_id, is_default, created_at, updated_at`
        : `
          INSERT INTO public.calendars(tenant_id, name, type, is_default)
          VALUES ($1, $2, 'tenant', false)
          RETURNING id, name, type, owner_user_id, is_default, created_at, updated_at`;
      const params2 = type === 'user' ? [tenantId, name.trim(), userId] : [tenantId, name.trim()];
      const { rows } = await db.query(sql, params2);
      return rows[0];
    }, { transaction: 'auto' });
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /api/calendars failed:', e);
    if (e && e.code === '23505') {
      return res.status(409).json({ message: 'Calendar already exists' });
    }
    res.status(500).json({ message: 'Failed to create calendar' });
  }
});

// PUT /api/calendars/:id (update name)
router.put('/:id', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  const calId = Number(req.params.id);
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'name is required' });
  }
  try {
    const updated = await withDb(tenantId, userId, async (db) => {
      const sql = `
        UPDATE public.calendars c
           SET name = $1,
               updated_at = now()
         WHERE c.id = $2
           AND c.tenant_id = $3
           AND (
                 (c.type='user' AND $4::int IS NOT NULL AND c.owner_user_id = $4::int)
              OR (c.type='tenant' AND $4::int IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.calendar_members m
                   WHERE m.calendar_id=c.id AND m.user_id = $4::int
                     AND m.role IN ('owner','editor')
                 ))
           )
        RETURNING id, name, type, owner_user_id, is_default, created_at, updated_at`;
      const { rows } = await db.query(sql, [name.trim(), calId, tenantId, Number.isFinite(userId) ? userId : null]);
      return rows[0] || null;
    }, { transaction: 'auto' });
    if (!updated) return res.status(404).json({ message: 'Calendar not found or not allowed' });
    res.json(updated);
  } catch (e) {
    console.error('PUT /api/calendars/:id failed:', e);
    res.status(500).json({ message: 'Failed to update calendar' });
  }
});

// DELETE /api/calendars/:id
router.delete('/:id', async (req, res) => {
  const { tenantId, userId } = getCtx(req);
  const calId = Number(req.params.id);
  try {
    const deleted = await withDb(tenantId, userId, async (db) => {
      const sql = `
        DELETE FROM public.calendars c
         WHERE c.id = $1
           AND c.tenant_id = $2
           AND (
                 (c.type='user' AND $3::int IS NOT NULL AND c.owner_user_id = $3::int)
              OR (c.type='tenant' AND $3::int IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.calendar_members m
                   WHERE m.calendar_id=c.id AND m.user_id = $3::int
                     AND m.role IN ('owner','editor')
                 ))
           )`;
      const { rowCount } = await db.query(sql, [calId, tenantId, Number.isFinite(userId) ? userId : null]);
      return rowCount > 0;
    }, { transaction: 'auto' });
    if (!deleted) return res.status(404).json({ message: 'Calendar not found or not allowed' });
    res.status(204).send();
  } catch (e) {
    console.error('DELETE /api/calendars/:id failed:', e);
    res.status(500).json({ message: 'Failed to delete calendar' });
  }
});

// GET /api/calendars/:id/members (read-only)
router.get('/:id/members', async (req, res, next) => {
  const { tenantId, userId } = getCtx(req);
  const calId = Number(req.params.id);
  try {
    const items = await withDb(tenantId, userId, async (db) => {
      const sql = `
        SELECT m.user_id, u.name, u.email, m.role, m.created_at
        FROM public.calendar_members m
        JOIN public.calendars c ON c.id=m.calendar_id
        JOIN public.users u     ON u.id=m.user_id
        WHERE m.calendar_id=$1
          AND c.tenant_id = $2
        ORDER BY m.role, u.name`;
      const { rows } = await db.query(sql, [calId, tenantId]);
      return rows;
    }, { transaction: 'none' });
    res.json({ items, count: items.length });
  } catch (e) { next(e); }
});

module.exports = { calendarsRouter: router };
