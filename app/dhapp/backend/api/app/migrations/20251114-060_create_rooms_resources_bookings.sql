-- 20251114-060_create_rooms_resources_bookings.sql
-- Räume, Ressourcen, und Belegungen pro Tenant

CREATE TABLE IF NOT EXISTS rooms (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('BEHANDLUNG','OP','LABOR','SONSTIGES')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rooms_tenant_active ON rooms (tenant_id, active);

CREATE TABLE IF NOT EXISTS resources (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('GERAET','SONSTIGES')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resources_tenant ON resources (tenant_id);
CREATE INDEX IF NOT EXISTS idx_resources_tenant_active ON resources (tenant_id, active);

CREATE TABLE IF NOT EXISTS room_bookings (
  id             SERIAL PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  room_id        INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_time     TIMESTAMPTZ NOT NULL,
  end_time       TIMESTAMPTZ NOT NULL,
  patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_bookings_tenant_room_time
  ON room_bookings (tenant_id, room_id, start_time, end_time);

-- auto-update updated_at
DROP TRIGGER IF EXISTS trg_rooms_set_updated ON rooms;
CREATE TRIGGER trg_rooms_set_updated BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_resources_set_updated ON resources;
CREATE TRIGGER trg_resources_set_updated BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

DROP TRIGGER IF EXISTS trg_room_bookings_set_updated ON room_bookings;
CREATE TRIGGER trg_room_bookings_set_updated BEFORE UPDATE ON room_bookings FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

