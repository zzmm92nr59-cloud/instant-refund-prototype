-- Relay D1 schema v1. Apply only after creating/binding a D1 database.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS consumers (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deleted'))
);
CREATE TABLE IF NOT EXISTS bank_connections (
 id TEXT PRIMARY KEY, consumer_id TEXT NOT NULL REFERENCES consumers(id),
 provider TEXT NOT NULL, provider_item_id TEXT NOT NULL,
 consent_status TEXT NOT NULL DEFAULT 'active',
 connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider,provider_item_id)
);
CREATE TABLE IF NOT EXISTS bank_transactions (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES bank_connections(id),
 provider_transaction_id TEXT NOT NULL, merchant_name TEXT,
 merchant_id TEXT, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
 booking_date TEXT NOT NULL, value_date TEXT, pending INTEGER NOT NULL DEFAULT 0,
 card_brand TEXT, card_last4 TEXT, payment_reference TEXT,
 raw_identifier_keys TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(connection_id,provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(booking_date);
CREATE TABLE IF NOT EXISTS retailer_connections (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, merchant_external_id TEXT NOT NULL,
 consent_status TEXT NOT NULL DEFAULT 'active',
 connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(provider,merchant_external_id)
);
CREATE TABLE IF NOT EXISTS retailer_orders (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES retailer_connections(id),
 external_order_id TEXT NOT NULL, external_customer_id TEXT,
 ordered_at TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
 payment_processor TEXT, processor_payment_id TEXT, payment_reference TEXT,
 card_brand TEXT, card_last4 TEXT, status TEXT NOT NULL DEFAULT 'open',
 raw_identifier_keys TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(connection_id,external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_retailer_orders_date ON retailer_orders(ordered_at);
CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES retailer_orders(id),
 external_line_item_id TEXT NOT NULL, product_id TEXT, variant_id TEXT,
 title TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 price_minor INTEGER NOT NULL, currency TEXT NOT NULL,
 return_deadline TEXT, return_status TEXT NOT NULL DEFAULT 'unknown',
 UNIQUE(order_id,external_line_item_id)
);
CREATE TABLE IF NOT EXISTS match_candidates (
 id TEXT PRIMARY KEY, consumer_id TEXT NOT NULL REFERENCES consumers(id),
 bank_transaction_id TEXT NOT NULL REFERENCES bank_transactions(id),
 retailer_order_id TEXT NOT NULL REFERENCES retailer_orders(id),
 score INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('potential','strong_candidate','conflict','verified','rejected')),
 evidence_json TEXT NOT NULL DEFAULT '[]', conflicts_json TEXT NOT NULL DEFAULT '[]',
 reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(consumer_id,bank_transaction_id,retailer_order_id)
);
CREATE TABLE IF NOT EXISTS identity_evidence (
 id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES match_candidates(id),
 evidence_type TEXT NOT NULL, verification_method TEXT NOT NULL,
 verified_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS verification_challenges (
 id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES match_candidates(id),
 challenge_type TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT,
 event_type TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
 metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidates_consumer ON match_candidates(consumer_id,status);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_events(subject_type,subject_id,created_at);
