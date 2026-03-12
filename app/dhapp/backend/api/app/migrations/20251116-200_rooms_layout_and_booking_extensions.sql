-- 20251116-200_rooms_layout_and_booking_extensions.sql
-- Erweiterung: Room-Layouts (Objekte) + zusätzliche Felder für Räume und Buchungen

-- Räume erweitern um optionale Metadaten und Grid-Größe
ALTER TABLE IF EXISTS rooms
  ADD COLUMN IF NOT EXISTS floor TEXT,
  ADD COLUMN IF NOT EXISTS building TEXT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS color TEXT;

-- Raumtyp-Constraint erweitern um zusätzliche Typen
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.constraint_column_usage ccu
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = ccu.constraint_name
     WHERE tc.table_name = 'rooms' AND tc.constraint_type = 'CHECK'
  ) THEN
    BEGIN
      ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_type_check;
    EXCEPTION WHEN undefined_object THEN
      -- ignore
    END;
  END IF;
END$$;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_type_check
  CHECK (type IN ('BEHANDLUNG','OP','LABOR','SONSTIGES','AUFWACHRAUM','SPRECHZIMMER','LAGER','WARTEZIMMER','BÜRO'));

-- Layout-Objekte je Raum
CREATE TABLE IF NOT EXISTS room_layout_objects (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('BED','OP_TABLE','MONITOR','MACHINE','CABINET','CHAIR','DESK','WALL','OTHER')),
  x          INTEGER NOT NULL DEFAULT 0,
  y          INTEGER NOT NULL DEFAULT 0,
  width      INTEGER NOT NULL DEFAULT 1,
  height     INTEGER NOT NULL DEFAULT 1,
  rotation   INTEGER NOT NULL DEFAULT 0,
  z_index    INTEGER,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_layout_objects_tenant_room ON room_layout_objects (tenant_id, room_id);

DROP TRIGGER IF EXISTS trg_room_layout_objects_set_updated ON room_layout_objects;
CREATE TRIGGER trg_room_layout_objects_set_updated BEFORE UPDATE ON room_layout_objects FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- Buchungen erweitern für Arzt/Team/Status/Farbe/Prozedurtyp
ALTER TABLE IF EXISTS room_bookings
  ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
  ADD COLUMN IF NOT EXISTS staff_ids INTEGER[],
  ADD COLUMN IF NOT EXISTS procedure_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'GEPLANT' CHECK (status IN ('GEPLANT','LAUFEND','ABGESCHLOSSEN','ABGESAGT')),
  ADD COLUMN IF NOT EXISTS color TEXT;

CREATE INDEX IF NOT EXISTS idx_room_bookings_tenant_doctor_time
  ON room_bookings (tenant_id, doctor_id, start_time, end_time);
