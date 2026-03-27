-- EMBook Registration Migration — Task 5
-- Run after migrate-auth.sql
-- Refines agent registration to a two-phase approval flow.

-- ─── 1. Add Profile Columns ──────────────────────────────────────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(255),
  ADD COLUMN IF NOT EXISTS agency_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

-- ─── 2. Update Status Default ────────────────────────────────────────────────
ALTER TABLE agents
  ALTER COLUMN status SET DEFAULT 'pending_approval';

-- ─── 3. Clean Up Legacy 'pending_claim' ──────────────────────────────────────
UPDATE agents
  SET status = 'pending_approval'
  WHERE status = 'pending_claim';

-- ─── 4. Make Credentials Nullable ────────────────────────────────────────────
-- Because API keys are now generated during the approval phase by the operator,
-- new registrations will not have an API key initially.
ALTER TABLE agents
  ALTER COLUMN api_key_hash DROP NOT NULL;

-- (Assuming the original schema enforces NOT NULL on api_key_hash, this relaxes it)
