// server/routes/appointments.ts
import { Router } from 'express';
import { withDb, toBigintArrayParam } from '../db/context';

export const appointmentsRouter = Router();

/**
 * GET /api/appointments?calendarId=1&calendarId=2&from=...&to=...&limit=50&offset=0
 */
appointmentsRouter.get('/', async (req, res, next) => {
  const tenantId = String((req as any).auth?.tenantId || req.header('x-tenant-id') || '');
  const userId   = (req as any).auth?.userId ?? Number(req.header('x-user-id') || NaN);

  const cals = toBigintArrayParam(Array.isArray(req.query.calendarId) ? (req.query.calendarId as string[]) :
                                   req.query.calendarId ? [String(req.query.calendarId)] : []);
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to   = req.query.to   ? new Date(String(req.query.to))   : null;
  const limit  = Math.min(Number(req.query.limit ?? 100), 200);
  const offset = Number(req.query.offset ?? 0);

  try {
    const rows = await withDb(tenantId, Number.isFinite(userId) ? Number(userId) : null, async (db) => {
      const sql = `
        SELECT a.*
        FROM public.appointments a
        WHERE ($1::bigint[] IS NULL OR a.calendar_id = ANY($1))
          AND ($2::timestamptz IS NULL OR a.starts_at >= $2)
          AND ($3::timestamptz IS NULL OR a.starts_at <  $3)
        ORDER BY a.starts_at
        LIMIT $4 OFFSET $5
      `;
      const { rows } = await db.query(sql, [cals, from, to, limit, offset]);
      return rows;
    });
    res.json({ items: rows, count: rows.length });
  } catch (e) { next(e); }
});

/**
 * POST /api/appointments
 * Body may include calendar_id; if missing, falls back to resolve_target_calendar_id(tenant,user,source)
 */
appointmentsRouter.post('/', async (req, res, next) => {
  const tenantId = String((req as any).auth?.tenantId || req.header('x-tenant-id') || '');
  const userId   = (req as any).auth?.userId ?? Number(req.header('x-user-id') || NaN);

  const b = req.body ?? {};
  const payload = {
    tenant_id: tenantId,
    patient_id: b.patient_id,
    doctor_id: b.doctor_id ?? null,
    starts_at: b.starts_at,
    duration_minutes: b.duration_minutes ?? 30,
    reason: b.reason ?? null,
    status: b.status ?? 'scheduled',
    calendar_id: b.calendar_id ?? null,
    user_id: Number.isFinite(userId) ? Number(userId) : null,
    source: b.source ?? (b.calendar_id ? 'user' : 'general'),
  } as const;

  try {
    const created = await withDb(tenantId, payload.user_id, async (db) => {
      const sql = payload.calendar_id
        ? `
          INSERT INTO public.appointments
            (tenant_id, patient_id, doctor_id, starts_at, duration_minutes, reason, status, calendar_id, user_id, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          RETURNING *`
        : `
          INSERT INTO public.appointments
            (tenant_id, patient_id, doctor_id, starts_at, duration_minutes, reason, status, calendar_id, user_id, source)
          SELECT $1,$2,$3,$4,$5,$6,$7,
                 public.resolve_target_calendar_id($1, $9, $10),
                 $9, $10
          RETURNING *`;
      const params = [
        payload.tenant_id, payload.patient_id, payload.doctor_id, payload.starts_at,
        payload.duration_minutes, payload.reason, payload.status,
        payload.calendar_id, payload.user_id, payload.source,
      ];
      const { rows } = await db.query(sql, params);
      return rows[0];
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

