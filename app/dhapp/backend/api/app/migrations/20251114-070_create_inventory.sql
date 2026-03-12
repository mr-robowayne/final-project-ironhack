-- 20251114-070_create_inventory.sql
-- Inventory and transactions per tenant with min-stock thresholds

CREATE TABLE IF NOT EXISTS inventory_items (
  id               SERIAL PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  category         TEXT,
  min_stock        INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  current_stock    INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  unit             TEXT,
  last_updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant ON inventory_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_name ON inventory_items (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                 SERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  item_id            INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  change_amount      INTEGER NOT NULL,
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_tx_tenant_item ON inventory_transactions (tenant_id, item_id, created_at DESC);

