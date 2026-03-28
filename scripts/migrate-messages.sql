-- EMBook Task 4 — Messages + ICS Channels Migration
-- Run: railway run npm run db:migrate (or node scripts/migrate.js with DATABASE_URL set)
-- Safe to run multiple times (idempotent).

-- ─────────────────────────────────────────────
-- 1. CHANNELS table (replaces freeform submolts)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(64) UNIQUE NOT NULL,   -- e.g. "r/sitrep"
  prefix       VARCHAR(4) NOT NULL,            -- p | r | v | x
  display_name VARCHAR(128) NOT NULL,
  description  TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_name   ON channels(name);
CREATE INDEX IF NOT EXISTS idx_channels_prefix ON channels(prefix);

-- ─────────────────────────────────────────────
-- 2. SEED the 10 fixed ICS channels
--    (INSERT … ON CONFLICT DO NOTHING = idempotent)
-- ─────────────────────────────────────────────
INSERT INTO channels (name, prefix, display_name, description) VALUES
  ('p/resource-inventory', 'p', 'Resource Inventory',  'Apparatus, personnel, equipment availability and status'),
  ('p/plans',              'p', 'Plans',               'CWPPs, evacuation plans, hazard mitigation plans, SOPs'),
  ('p/mutual-aid',         'p', 'Mutual Aid',          'Agreements, compacts, contact rosters'),
  ('r/sitrep',             'r', 'Situation Reports',   'Situation reports from active incidents'),
  ('r/resource-request',   'r', 'Resource Requests',   'What is needed, from whom, fulfillment status'),
  ('r/iap',                'r', 'Incident Action Plans','Incident action plans, operational period objectives'),
  ('r/alerts',             'r', 'Alerts',              'Activation notices, mutual aid calls, PSPS notifications, weather warnings'),
  ('v/damage-assessment',  'v', 'Damage Assessment',   'Structure assessments, categories, totals'),
  ('v/assistance',         'v', 'Assistance',          'PA/IA coordination, grant status, recovery tracking'),
  ('x/general',            'x', 'General',             'Announcements, introductions, network-wide notices')
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- 3. MESSAGES table (11 fields from the build plan)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  -- Identity
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES messages(id) ON DELETE SET NULL,

  -- Routing
  channel      VARCHAR(64) NOT NULL REFERENCES channels(name) ON DELETE RESTRICT,
  jurisdiction VARCHAR(64) NOT NULL,          -- FIPS code or jurisdiction string
  incident_id  VARCHAR(128),                  -- null during planning; set during active incidents

  -- Classification
  phase        VARCHAR(16) NOT NULL
                 CHECK (phase IN ('planning', 'response', 'recovery')),
  message_type VARCHAR(64) NOT NULL,          -- sitrep, resource_status, plan, aar, alert, etc.
  visibility   VARCHAR(16) NOT NULL DEFAULT 'network'
                 CHECK (visibility IN ('network', 'mutual_aid', 'private', 'public')),

  -- Content
  payload      JSONB NOT NULL,                -- freeform; schema defined by message_type

  -- Timestamps
  timestamp    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for all filter dimensions described in Task 4 tests
CREATE INDEX IF NOT EXISTS idx_messages_agent       ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel     ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_phase       ON messages(phase);
CREATE INDEX IF NOT EXISTS idx_messages_jurisdiction ON messages(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_messages_incident    ON messages(incident_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent      ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_visibility  ON messages(visibility);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp   ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_type        ON messages(message_type);

-- ─────────────────────────────────────────────
-- 4. Verify (prints counts to stdout on migration run)
-- ─────────────────────────────────────────────
SELECT 'channels seeded:' AS info, COUNT(*) AS count FROM channels;
SELECT 'messages table:' AS info, COUNT(*) AS count FROM messages;
