// server/routes/appointments.js
const express = require('express');
const { withDb, toBigintArrayParam } = require('../db/context');

const router = express.Router();

// GET /api/appointments
// Supports additive loading by calendar IDs: ?calendarIds=1,5,7&from=...&to=...
router.get('/', async (req, res, next) => {
  const tenantId = String(req.header('x-tenant-id') || (req.auth && req.auth.tenantId) || '');
  const userId = Number(req.header('x-user-id') || (req.auth && req.auth.userId));

  // accept either repeated calendarId[] or a single comma-joined calendarIds
  const idsParam = req.query.calendarIds || req.query.calendarId || req.query.calendar_id;
  let calendarIds = [];
  if (Array.isArray(idsParam)) calendarIds = idsParam;
  else if (typeof idsParam === 'string') calendarIds = idsParam.split(',').map((s)=>s.trim()).filter(Boolean);
  const calendars = toBigintArrayParam(calendarIds);

  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  const limit = Math.min(Number(req.query.limit || 100), 200);
  const offset = Number(req.query.offset || 0);

  try {
    const rows = await withDb(tenantId, Number.isFinite(userId) ? userId : null, async (db) => {
      const sql = `
        SELECT a.*
        FROM public.appointments a
        JOIN public.calendars c ON c.id = a.calendar_id
        WHERE a.tenant_id = $1
          AND ($2::bigint[] IS NULL OR a.calendar_id = ANY($2))
          AND ($3::timestamptz IS NULL OR a.starts_at >= $3)
          AND ($4::timestamptz IS NULL OR a.starts_at <  $4)
          AND (
            c.type = 'tenant' OR (
              $5::int IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.calendar_members m
                WHERE m.calendar_id = a.calendar_id
                  AND m.user_id = $5::int
              )
            )
          )
        ORDER BY a.starts_at ASC
        LIMIT $6 OFFSET $7`;
      const params = [
        tenantId,
        calendars,
        from,
        to,
        Number.isFinite(userId) ? userId : null,
        limit,
        offset,
      ];
      const { rows } = await db.query(sql, params);
      return rows;
    }, { transaction: 'none' });
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/appointments
router.post('/', async (req, res, next) => {
  const tenantId = String(req.header('x-tenant-id') || (req.auth && req.auth.tenantId) || '');
  const userId = Number(req.header('x-user-id') || (req.auth && req.auth.userId));

  const b = req.body || {};
  const payload = {
    tenant_id: tenantId,
    patient_id: b.patient_id,
    doctor_id: b.doctor_id ?? null,
    starts_at: b.starts_at,
    duration_minutes: b.duration_minutes ?? 30,
    reason: b.reason ?? null,
    status: b.status ?? 'scheduled',
    calendar_id: b.calendar_id ?? null,
    user_id: Number.isFinite(userId) ? userId : null,
    source: b.source ?? (b.calendar_id ? 'user' : 'general'),
  };

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

module.exports = { appointmentsRouter: router };
