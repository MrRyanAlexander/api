-- EMBook Auth Migration — Task 3
-- Run after the base schema.sql.
-- Adds the audit_log table, agent public key column, and bcrypt hash column.

-- ─── 1. Add EMBook auth columns to agents ────────────────────────────────────

-- bcrypt hash of the API key (replaces the SHA-256 hash used by Moltbook).
-- The old api_key_hash column is repurposed: we keep the column name but change
-- the stored value from SHA-256 to bcrypt on new registrations.
-- A separate lookup index column (api_key_lookup) holds the SHA-256 for fast
-- row retrieval before the bcrypt comparison.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS api_key_lookup  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS public_key_pem  TEXT,
  ADD COLUMN IF NOT EXISTS public_key_updated_at TIMESTAMP WITH TIME ZONE;

-- Index on the fast lookup hash
CREATE INDEX IF NOT EXISTS idx_agents_api_key_lookup ON agents(api_key_lookup);

-- ─── 2. audit_log table ───────────────────────────────────────────────────────
-- Append-only. The application role is granted INSERT only (see note below).
-- No UPDATE or DELETE is ever issued against this table from application code.

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  action     VARCHAR(40) NOT NULL,
  agent_id   UUID REFERENCES agents(id) ON DELETE SET NULL,
  outcome    VARCHAR(10) NOT NULL CHECK (outcome IN ('success', 'failure')),
  metadata   JSONB DEFAULT '{}'::JSONB,
  ip         INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common query patterns (export, monitoring)
CREATE INDEX IF NOT EXISTS idx_audit_log_created    ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_agent_id   ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_outcome    ON audit_log(outcome);

-- NOTE: In a production PostgreSQL setup, revoke UPDATE and DELETE on audit_log
-- from the application role with:
--
--   REVOKE UPDATE, DELETE ON TABLE audit_log FROM embook_app;
--
-- This makes the table truly append-only at the database level. The application
-- role must be a non-superuser for this to be effective.

-- ─── 3. token_exchange table (for /auth/token endpoint) ──────────────────────
-- Tracks issued session tokens for potential future revocation.
-- v0.1 does not implement revocation, but the table is here for Task 7 hardening.

CREATE TABLE IF NOT EXISTS token_issuances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  jti         VARCHAR(32) UNIQUE NOT NULL,  -- JWT ID claim
  issued_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked     BOOLEAN DEFAULT false,
  revoked_at  TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_token_issuances_agent   ON token_issuances(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_issuances_jti     ON token_issuances(jti);
CREATE INDEX IF NOT EXISTS idx_token_issuances_expires ON token_issuances(expires_at);
