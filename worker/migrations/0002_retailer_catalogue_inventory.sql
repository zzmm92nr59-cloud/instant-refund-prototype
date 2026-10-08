-- Relay retailer catalogue and location-level stock snapshots.
CREATE TABLE IF NOT EXISTS retailer_catalog_items (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 external_item_id TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider, external_item_id)
);
CREATE TABLE IF NOT EXISTS retailer_catalog_variants (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES retailer_catalog_items(id),
 external_variant_id TEXT NOT NULL,
 title TEXT NOT NULL,
 sku TEXT,
 price_minor INTEGER,
 currency TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(item_id, external_variant_id)
);
CREATE TABLE IF NOT EXISTS retailer_inventory_snapshots (
 variant_id TEXT NOT NULL REFERENCES retailer_catalog_variants(id),
 connection_id TEXT NOT NULL REFERENCES retailer_connections(id),
 quantity REAL,
 inventory_state TEXT NOT NULL DEFAULT 'unknown',
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (variant_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_retailer_variants_sku ON retailer_catalog_variants(sku);
