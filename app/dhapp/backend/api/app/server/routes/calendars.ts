// server/routes/calendars.ts
import { Router } from 'express';
import { withDb } from '../db/context';

export const calendarsRouter = Router();

calendarsRouter.get('/', async (req, res, next) => {
  const tenantId = String((req as any).auth?.tenantId || req.header('x-tenant-id') || '');
  const userId   = (req as any).auth?.userId ?? Number(req.header('x-user-id') || NaN);

  try {
    const data = await withDb(tenantId, Number.isFinite(userId) ? Number(userId) : null, async (db) => {
      const sql = `
        SELECT c.id, c.name, c.type, c.owner_user_id, c.is_default, c.created_at, c.updated_at
        FROM public.v_my_calendars c
        ORDER BY c.type, c.name`;
      const { rows } = await db.query(sql);
      return rows;
    });
    res.json({ items: data, count: data.length });
  } catch (e) { next(e); }
});

calendarsRouter.get('/:id/members', async (req, res, next) => {
  const tenantId = String((req as any).auth?.tenantId || req.header('x-tenant-id') || '');
  const userId   = (req as any).auth?.userId ?? Number(req.header('x-user-id') || NaN);
  const calId    = Number(req.params.id);

  try {
    const members = await withDb(tenantId, Number.isFinite(userId) ? Number(userId) : null, async (db) => {
      const sql = `
        SELECT m.user_id, u.name, u.email, m.role, m.created_at
        FROM public.calendar_members m
        JOIN public.calendars c ON c.id=m.calendar_id
        JOIN public.users u     ON u.id=m.user_id
        WHERE m.calendar_id=$1 AND c.tenant_id=NULLIF(current_setting('app.tenant_id', true), '')
        ORDER BY m.role, u.name`;
      const { rows } = await db.query(sql, [calId]);
      return rows;
    });
    res.json({ items: members, count: members.length });
  } catch (e) { next(e); }
});

