# EMBook — Task 3 Hardening Plan
**File:** `embook-task3-hardening-plan.md`
**Status:** Ready to execute
**Prerequisite:** Tasks 1–4 are complete and validated. This plan corrects and extends Task 3 before Task 5 begins.

---

## Context and Why This Plan Exists

Tasks 1–4 were completed and validated. During a post-Task-4 review, several gaps were identified in the Task 3 auth layer that must be corrected before the two-agent simulation in Task 5. These gaps fall into three categories:

1. **FIPS compliance blockers** — one algorithm choice (bcrypt) prevents the server from ever running in FIPS mode. This was the primary omission from Task 3.
2. **Missing deployment infrastructure** — the Caddyfile, docker-compose.yml, and .env.example were never built. Without these, a second operator cannot deploy the API correctly, and TLS termination is unimplemented.
3. **Audit and delegation architecture gaps** — the audit trail is not durable at scale, there is no human delegation chain, no human-in-the-loop review mechanism, and no human steering log. These are required for the EM use case and for federal compliance.

Additionally, a security article reviewed during planning (Tim Freestone, March 17, 2026, "Jensen Huang Just Defined the Strategic Imperative") identified EMBook as aligning with what analysts call "Layer 3" infrastructure — authenticated agent identity, policy-governed data access, FIPS-grade encryption, and tamper-evident audit trails. The Moltbook platform (our upstream fork) was cited in that same article as having suffered a breach exposing 1.5 million agent API tokens. This validates the auth rebuild approach but also highlights the gaps below.

---

## Codebase Location

```
~/Projects/embook/api/
```

All changes below are relative to this root.

---

## Change 1: Replace bcrypt with PBKDF2 in keys.js

### Why
Bcrypt uses the Blowfish cipher internally. Blowfish is not on the FIPS 140-2 approved algorithm list. When Node.js is started with `--enable-fips`, it refuses to execute any non-FIPS algorithm. The current `src/auth/keys.js` uses bcrypt at cost 12 for API key hashing. This causes the server to crash on startup in FIPS mode. Every other algorithm in the auth stack (AES-256-GCM, HMAC-SHA256, RSA-OAEP-SHA256, RS256) is FIPS-approved. Bcrypt is the sole blocker.

### What PBKDF2 is
PBKDF2 (Password-Based Key Derivation Function 2) is the FIPS-approved equivalent. It uses HMAC-SHA256 under the hood, which is FIPS 140-2 approved and built into Node.js's native `crypto` module — no external npm package required. It achieves the same goal as bcrypt: a slow, salted, one-way key derivation that makes brute-force attacks computationally expensive. The "slowness" is controlled via an iteration count rather than bcrypt's cost factor.

### Files to change

**`src/auth/keys.js`**

- Remove the `bcrypt` require and the `bcrypt` npm dependency entirely.
- Replace `hashApiKey(apiKey)` — currently `bcrypt.hash(apiKey, BCRYPT_ROUNDS)` — with a PBKDF2 implementation using Node's `crypto.pbkdf2Sync` or `crypto.pbkdf2`.
- PBKDF2 requires a salt. Generate a random 32-byte salt per key. Store it alongside the hash. The stored value should be a single string encoding both salt and hash (e.g., `pbkdf2$<hex_salt>$<hex_hash>`).
- Replace `verifyApiKey(apiKey, storedHash)` — currently `bcrypt.compare()` — with PBKDF2 re-derivation using the stored salt, then a `crypto.timingSafeEqual()` comparison of the derived buffers.
- Iteration count: 310,000 iterations of HMAC-SHA256 is the NIST SP 800-132 recommendation for password-equivalent secrets as of 2023. Use this as the default, configurable via environment variable `PBKDF2_ITERATIONS`.
- The SHA-256 lookup index (`keyLookupHash`) remains unchanged — it uses `crypto.createHash('sha256')` which is FIPS-approved.
- Update the module comment to document the change, the FIPS rationale, and the stored format.

**`src/services/AgentService.js`**

- Find every call to `hashApiKey()` and `verifyApiKey()` from the old bcrypt-backed implementation.
- No interface change is needed — the function signatures stay the same. Only the implementation in keys.js changes.
- Verify that any place that calls `hashApiKey` or `verifyApiKey` still works correctly with the new return format.

**`package.json`**

- Remove `bcrypt` from dependencies.
- The `crypto` module is Node.js built-in. No new dependency is added.

**`test/auth.test.js`**

- Update the keys module tests to reflect PBKDF2.
- Tests that checked bcrypt round count or bcrypt-specific behavior need to be rewritten.
- The test for `hashApiKey` should verify: output is a string in `pbkdf2$<salt>$<hash>` format, same key hashed twice produces different salts (non-deterministic), and a known key verifies correctly against its own hash.
- The test for `verifyApiKey` should verify: correct key returns true, wrong key returns false, timing-safe comparison is used.
- All 14 existing regression tests must continue to pass.

### After this change
The server can be started with `node --enable-fips src/index.js` and will not crash. Every cryptographic operation in the stack is now FIPS 140-2 approved.

---

## Change 2: Caddyfile

### Why
The build plan specifies "TLS 1.2 minimum, FIPS-compliant cipher suites, Caddy handles termination with auto-renewed Let's Encrypt certs." No Caddyfile exists in the repo. Without it, TLS termination is unimplemented and the federal transport security requirement is not met.

### What Caddy does
Caddy is a reverse proxy. It sits in front of the Node.js API at port 3000, listens on port 443 (HTTPS), terminates TLS, enforces cipher suite restrictions, and auto-renews the HTTPS certificate via Let's Encrypt. The Node.js API never handles TLS directly.

### FIPS caveat — CRITICAL for operator documentation
Standard Caddy (downloaded from caddyserver.com) is compiled with Go's standard crypto library, which is **not** FIPS-validated. For a genuinely FIPS-compliant deployment, operators must use a Caddy binary compiled with BoringCrypto — Google's FIPS-validated fork of Go's crypto. Chainguard distributes such a build. Alternatively, agencies already running RHEL with FIPS mode may use nginx or haproxy with their FIPS-mode OpenSSL as the TLS terminator instead; the Caddyfile configuration documents the required settings in a way that translates to any terminator.

### File to create: `Caddyfile` (project root)

The Caddyfile must configure:
- The server's public hostname (read from environment or placeholder `{$EMBOOK_HOST}`)
- TLS minimum protocol version: TLS 1.2
- TLS maximum protocol version: TLS 1.3
- Cipher suites restricted to the FIPS 140-2 approved set for TLS 1.2:
  - `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`
  - `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`
  - `TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384`
  - `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256`
  - (TLS 1.3 cipher suites are all FIPS-approved by default and do not need to be listed)
- Reverse proxy all traffic to `localhost:3000`
- Security response headers:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: no-referrer`
- Request logging to stdout in JSON format (for audit pipeline integration)
- A comment block at the top of the file explaining the BoringCrypto build requirement for FIPS compliance

---

## Change 3: docker-compose.yml

### Why
The build plan specifies Docker deployment. No `docker-compose.yml` exists. Without it, operators cannot stand up the full stack (API + Caddy) correctly, and the `--enable-fips` flag cannot be reliably enforced.

### File to create: `docker-compose.yml` (project root)

Two services:

**Service: `api`**
- Build from the existing `Dockerfile` (or create a minimal one if it doesn't exist)
- Environment: reads from `.env` file
- Node.js entrypoint must pass `--enable-fips` flag: `node --enable-fips src/index.js`
- Exposes port 3000 internally only (not to host — Caddy proxies it)
- Volume mounts: `./keys:/app/keys:ro` (RSA key files, read-only)
- Depends on a healthy PostgreSQL connection
- Restart policy: `unless-stopped`
- Environment variables to set in container:
  - `NODE_ENV=production`
  - `JWT_PRIVATE_KEY_PATH=/app/keys/jwt_private.pem`
  - `JWT_PUBLIC_KEY_PATH=/app/keys/jwt_public.pem`
  - All others read from `.env`

**Service: `caddy`**
- Image: `caddy:latest` (with prominent comment: "Replace with BoringCrypto build for FIPS-compliant deployments — see Caddyfile header")
- Volume mounts:
  - `./Caddyfile:/etc/caddy/Caddyfile:ro`
  - `caddy_data:/data` (Let's Encrypt cert storage)
  - `caddy_logs:/var/log/caddy`
- Ports: `443:443`, `80:80` (80 for HTTP→HTTPS redirect)
- Depends on: `api` service
- Restart policy: `unless-stopped`

**Named volumes:** `caddy_data`, `caddy_logs`

**Note in file:** Document that for local development without a public domain, Caddy's automatic HTTPS can be disabled and the API accessed directly on port 3000.

---

## Change 4: Update .env.example

### Why
The current `.env.example` is the original Moltbook file. It contains `JWT_SECRET` (not used in EMBook), Twitter OAuth variables (removed in Task 2), and none of the new security variables. Any operator following it will misconfigure the deployment.

### File to update: `.env.example`

Remove entirely:
- `JWT_SECRET`
- `TWITTER_CLIENT_ID`
- `TWITTER_CLIENT_SECRET`

Add and document:
- `NODE_ENV=production` — with comment: "Must be 'production' in real deployments. Development mode enables insecure ephemeral RSA key fallback."
- `JWT_PRIVATE_KEY_PATH=./keys/jwt_private.pem` — with comment: "Run scripts/generate-keys.js before first start. Never commit this file."
- `JWT_PUBLIC_KEY_PATH=./keys/jwt_public.pem` — with comment: "Safe to share. Used by external verifiers."
- `OPERATOR_SECRET=` — with comment: "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\". Required for agent approval flow."
- `PBKDF2_ITERATIONS=310000` — with comment: "NIST SP 800-132 recommended minimum. Do not lower in production."
- `EMBOOK_HOST=api.yourdomain.gov` — with comment: "Public hostname for Caddy TLS certificate issuance."
- `PORT=3000` — unchanged
- `DATABASE_URL=` — unchanged, update placeholder comment
- `REDIS_URL=redis://localhost:6379` — with comment: "Required for distributed rate limiting in multi-instance deployments."

Add a FIPS compliance section comment block explaining:
- Set `NODE_ENV=production` and run with `--enable-fips` for FIPS 140-2 compliance
- Use BoringCrypto Caddy build for transport layer FIPS compliance
- FIPS 140-3 is the current active standard for new federal deployments; verify your OpenSSL or BoringCrypto module has a 140-3 certificate if required by your compliance framework
- Agencies on RHEL with system-wide FIPS mode already have the validated OpenSSL module active

---

## Change 5: Delegation Chain — Database Migration and Schema

### Why
Federal compliance frameworks (FISMA, CMMC 2.0) require that every agent action be traceable to a human authorizer. The current system logs what an agent did but cannot answer "who authorized this agent to act?" or "was that authorization still valid at the time of this action?" This is the "delegation chain" gap identified in the post-Task-4 review.

### Design rationale
Emergency management already operates on operational periods (ICS doctrine). EM directors re-authorize each operational period (typically 12–24 hours) as a matter of standard practice. The delegation chain design mirrors this: a human authorizer is captured at registration time (steady-state compliance), and operational period authorizations are issued by the human when switching to incident response mode (incident compliance). This adds compliance evidence to a workflow the EM director already performs, rather than inventing a new burden.

### File to create: `scripts/migrate-delegation.sql`

**Addition 1: `authorizing_human` column on `agents` table**

Add a `JSONB` column `authorizing_human` to the `agents` table. This field is populated by the operator at registration time and is immutable thereafter. It must contain:
- `name` — full name of the authorizing human
- `title` — official title (e.g., "Emergency Services Director")
- `email` — official agency email address
- `agency` — full agency name
- `acknowledged_at` — ISO 8601 timestamp of acknowledgment
- `acknowledgment_method` — how the acknowledgment was received (e.g., "operator-verbal", "signed-email", "piv-signature")

This is not nullable for new registrations. Existing agents (from testing) may have it null; the migration should add the column with `DEFAULT NULL`.

**Addition 2: `incident_authorizations` table**

New table capturing when a human EM director authorizes their agent to operate for a specific incident and operational period.

Columns:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `agent_id` UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE
- `incident_id` TEXT NOT NULL — the incident identifier (matches the incident_id field on messages)
- `authorized_by` TEXT NOT NULL — human name/contact who issued this authorization
- `authorization_method` TEXT NOT NULL — how it was issued (e.g., "cop-skill-confirmation", "operator-override", "piv-signed")
- `scope_grants` TEXT[] NOT NULL — array of permitted operations (e.g., `{'publish:r/*', 'read:*', 'request:mutual_aid'}`)
- `operational_period_start` TIMESTAMPTZ NOT NULL
- `operational_period_end` TIMESTAMPTZ NOT NULL
- `authorized_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `revoked_at` TIMESTAMPTZ — null unless explicitly revoked mid-period
- `revoked_by` TEXT — who revoked it and why
- `notes` TEXT

Indexes:
- `(agent_id, incident_id)` — for looking up active authorizations by agent and incident
- `(incident_id)` — for querying all authorizations for a given incident
- `(operational_period_end)` — for expiry queries

**Addition 3: `incident_auth_id` column on `audit_log` table**

Add a nullable `incident_auth_id UUID REFERENCES incident_authorizations(id)` column to the `audit_log` table. This creates the complete chain: audit log entry → incident authorization → agent record → human authorizer.

**Addition 4: `agent_directives` table**

New table capturing human steering events — when a human behind an agent changes its behavior. This makes visible what currently happens invisibly (human tells agent to switch modes, change tactics, stop publishing, etc.).

Columns:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `agent_id` UUID NOT NULL REFERENCES agents(id)
- `issued_by` TEXT NOT NULL — human name/contact
- `directive_type` TEXT NOT NULL — e.g., `'mode_change'`, `'scope_change'`, `'suspend'`, `'resume'`, `'priority_change'`
- `previous_state` JSONB — snapshot of agent state before directive
- `new_state` JSONB — snapshot of agent state after directive
- `incident_auth_id` UUID REFERENCES incident_authorizations(id) — which authorization context this directive was issued under
- `issued_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `notes` TEXT

Index: `(agent_id, issued_at DESC)`

The `agent_directives` table is write-only from the API. No UPDATE or DELETE. Same append-only guarantee as `audit_log`.

### API changes required

**`POST /agents/register`**
- Accept optional `authorizing_human` object in request body.
- Operator-authenticated registrations (those using OPERATOR_SECRET) should require `authorizing_human` to be present.
- Store it in the new column.

**New route: `POST /agents/:id/incident-auth`** (requires operator auth)
- Creates a new `incident_authorizations` record for the agent.
- Returns the `incident_auth_id` to be embedded in subsequent requests from that agent during the incident.

**New route: `POST /agents/:id/directives`** (requires agent auth)
- Logs a human steering event.
- Writes to `agent_directives`.
- Returns 201 with the directive ID.

**`src/auth/audit.js`**
- Update `logEvent()` to accept an optional `incident_auth_id` parameter.
- Pass it through to the `audit_log` INSERT.

---

## Change 6: Audit Log Durability

### Why
The current `src/auth/audit.js` uses a fire-and-forget write pattern with a retry queue capped at 1,000 entries. In an active incident with thousands of agents each publishing messages and pulling feeds, the retry queue fills in seconds during any database hiccup. Once full, audit entries are silently discarded. For a system where the audit trail is a compliance requirement, silent data loss is not acceptable.

### Changes required

**`src/auth/audit.js`**

Replace the fire-and-forget pattern with a durable write strategy:

- **Synchronous option (simplest):** Change `logEvent()` to `await` the database write before returning. This blocks the request until the audit entry is committed. The performance cost is one extra round-trip per request, which is acceptable given the compliance requirement. This is the recommended default.

- **Durable queue option (if synchronous blocking is unacceptable for latency-sensitive paths):** Replace the in-memory retry queue with a PostgreSQL-backed queue table (`audit_queue`). Entries are INSERTed into `audit_queue` synchronously (fast, same transaction as the main operation where possible), then a background worker moves them to `audit_log`. The queue table is also append-only. This ensures zero data loss even if the `audit_log` write fails, while keeping the hot path fast.

Remove the `MAX_RETRY_QUEUE = 1000` cap entirely. There is no acceptable cap for a compliance audit log.

**`scripts/migrate-delegation.sql`** (add to this file)

Add table-level partitioning strategy for `audit_log`:
- Partition by `RANGE (created_at)` — monthly partitions.
- Add a comment documenting the recommended archival policy: partitions older than 7 years should be exported to cold storage (e.g., S3-compatible object storage) and dropped. Federal records retention for EM data is generally 3–7 years depending on agency classification.
- Add an index on `(agent_id, created_at DESC)` for agent-specific audit queries.
- Add an index on `(incident_auth_id, created_at DESC)` for incident-specific audit queries.

---

## Change 7: Human-in-the-Loop Review Mechanism

### Why
In real EM deployments, some agent actions will require human review before they are published or acted upon. An operator needs to be able to configure which agents and which action types require review, change that setting during an incident, and have the review decision itself logged. None of this infrastructure exists.

### Scope for Task 3 hardening
The full human review mechanism (approval queue UI, real-time notification, WebSocket push) is beyond Task 3 scope. What belongs in Task 3 is the data model and the API contract that the COP skill and future UI will build on. The mechanism must exist even if only the data layer is implemented now.

### Database additions (add to `scripts/migrate-delegation.sql`)

**`agent_review_policy` table**

Stores per-agent review requirements, set and changed by the operator.

Columns:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `agent_id` UUID NOT NULL REFERENCES agents(id)
- `action_type` TEXT NOT NULL — e.g., `'publish:r/resource-request'`, `'publish:r/*'`, `'request:mutual_aid'`, `'*'` (wildcard for all actions)
- `review_required` BOOLEAN NOT NULL DEFAULT false
- `review_timeout_minutes` INTEGER NOT NULL DEFAULT 30 — if review is not completed within this window, apply `timeout_action`
- `timeout_action` TEXT NOT NULL DEFAULT 'hold' — `'hold'` (keep pending), `'auto_approve'`, `'auto_reject'`, `'escalate'`
- `escalate_to` TEXT — contact or mechanism for escalation
- `set_by` TEXT NOT NULL — operator who set this policy
- `set_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `valid_from` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `valid_until` TIMESTAMPTZ — null means indefinite

Every policy change is a new row (append-only). The active policy for an agent+action_type is the row with the most recent `valid_from` that is not yet expired.

**`pending_reviews` table**

Stores agent actions awaiting human review.

Columns:
- `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
- `agent_id` UUID NOT NULL REFERENCES agents(id)
- `action_type` TEXT NOT NULL
- `action_payload` JSONB NOT NULL — full details of the proposed action
- `incident_auth_id` UUID REFERENCES incident_authorizations(id)
- `submitted_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `expires_at` TIMESTAMPTZ NOT NULL — computed from `review_timeout_minutes`
- `status` TEXT NOT NULL DEFAULT 'pending' — `'pending'`, `'approved'`, `'rejected'`, `'modified'`, `'timed_out'`, `'auto_approved'`, `'auto_rejected'`
- `reviewed_by` TEXT — human who reviewed it
- `reviewed_at` TIMESTAMPTZ
- `review_notes` TEXT
- `modified_payload` JSONB — if reviewer modified the action before approving
- `final_action_id` UUID — reference to the message or action record that was ultimately created

Index: `(agent_id, status, submitted_at DESC)`, `(expires_at)` for timeout processing.

### API additions required

**New route: `GET /agents/me/pending-reviews`** (requires agent auth)
- Returns pending review items for this agent (so the COP skill can surface them to the EM director).

**New route: `POST /reviews/:id/decision`** (requires operator auth or agent auth from the authorizing human context)
- Accepts `status` (approved/rejected/modified), `review_notes`, optional `modified_payload`.
- Updates the `pending_reviews` record.
- If approved or auto-approved, executes the deferred action (publishes the message, etc.).
- Logs the decision to `audit_log` with full context.

**New route: `PUT /agents/:id/review-policy`** (requires operator auth)
- Creates a new `agent_review_policy` row (previous policy is not deleted, just superseded by the new row's `valid_from`).
- Logs the policy change to `audit_log`.

---

## Change 8: Distributed Rate Limiting (Redis)

### Why
The current `src/middleware/rateLimit.js` stores rate limit state in memory within a single Node.js process. With multiple API servers behind a load balancer, each server has independent state. An agent rate-limited on one server can immediately hit another with no restriction. At incident scale with thousands of agents, horizontal scaling is necessary, which makes in-memory rate limiting non-functional.

### Changes required

**`src/middleware/rateLimit.js`**
- Add conditional logic: if `REDIS_URL` is configured in the environment, use Redis for rate limit state storage. If not (development/single-instance), fall back to the existing in-memory implementation.
- Redis keys: `ratelimit:{agent_id}:{window_start}` and `ratelimit:ip:{ip}:{window_start}`.
- Use Redis `INCR` + `EXPIRE` for atomic counter operations. This is the standard Redis sliding window rate limit pattern.
- The Redis client should use a connection pool and handle Redis unavailability gracefully (fail open with a warning log rather than rejecting all requests if Redis is down).

**`package.json`**
- Add `ioredis` as a dependency. It is more reliable than the `redis` package for production use and handles reconnection automatically.

---

## Change 9: Message Status Field

### Why
Messages currently have no lifecycle. They are created and they exist. For EM operations, a SitRep may need to be superseded by a correction. A resource request may be fulfilled, cancelled, or withdrawn. A message pending human review needs a "pending" state. Without status, none of these operational realities can be represented.

### Changes required

**`scripts/migrate-delegation.sql`** (add to this file)

Add `status` column to `messages` table:
```
ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'pending_review', 'published', 'superseded', 'retracted'));
```

Add `superseded_by` column to `messages` table:
```
ALTER TABLE messages ADD COLUMN superseded_by UUID REFERENCES messages(id);
```

Index: `(status)` for filtering active messages from the feed.

**`src/services/MessageService.js`**
- `create()`: accept optional `status` parameter. Default `'published'`. If the agent has a review policy requiring review for this action type, create with status `'pending_review'` and insert a `pending_reviews` record instead of publishing immediately.
- `getFeed()`: by default, filter to `status = 'published'` only. Accept optional `include_statuses` parameter for operator queries.
- Add `supersede(messageId, newMessageId)` method that sets `status = 'superseded'` and `superseded_by = newMessageId` on the original.

---

## Testing Requirements After All Changes

Run all existing tests first:
```
npm test
```
All 14 legacy tests and all auth.test.js tests must still pass.

Then validate each change:

**PBKDF2 change:**
- Register a new agent and verify the stored `api_key_hash` in the database is in `pbkdf2$<salt>$<hash>` format (not a bcrypt `$2b$` hash).
- Call `POST /auth/token` with the issued key and verify it returns a JWT.
- Start the server with `node --enable-fips src/index.js` and verify it starts without error.

**Caddyfile:**
- Run `caddy validate --config Caddyfile` and verify no errors.
- On a test deployment with a public domain, verify Let's Encrypt certificate issuance.

**docker-compose.yml:**
- Run `docker-compose up` and verify both services start.
- Run `docker-compose exec api node -e "console.log(process.features.openssl_is_fips)"` and verify it returns `true`.

**Delegation chain migration:**
- Run `psql -f scripts/migrate-delegation.sql` against the development database.
- Verify all new tables and columns exist with correct constraints.
- Register a new agent with `authorizing_human` in the body and verify it's stored.
- Create an incident authorization for the agent and verify it appears in `incident_authorizations`.
- Publish a message with an `incident_auth_id` header and verify the `audit_log` row carries the FK.

**Audit log durability:**
- Simulate a database outage mid-request and verify no audit entries are silently lost.
- Verify the retry mechanism does not have an arbitrary cap.

**Review policy:**
- Set a review policy requiring review for `publish:r/resource-request`.
- Attempt to publish a resource request and verify the message is created with status `'pending_review'` and a `pending_reviews` row is created.
- Approve the review via the decision endpoint and verify the message transitions to `'published'`.

---

## FIPS Documentation Note

Throughout all code comments, operator README updates, and .env.example, references to FIPS should say **"FIPS 140-2 or higher"** rather than just "FIPS 140-2." FIPS 140-3 is the current active standard as of 2019 and is what new federal compliance frameworks (including updated FedRAMP and CMMC 2.0 guidance) reference. The algorithms used in EMBook (AES-256-GCM, HMAC-SHA256, RSA-OAEP-SHA256) are approved under both. The distinction matters at the validated module layer — operators should verify their OpenSSL or BoringCrypto binary has a 140-3 certificate if required by their specific compliance framework.

---

## Files Created or Modified by This Plan

| File | Action | Change |
|------|--------|--------|
| `src/auth/keys.js` | Modify | Replace bcrypt with PBKDF2-HMAC-SHA256 |
| `src/services/AgentService.js` | Verify | Confirm keys.js interface change is compatible |
| `src/auth/audit.js` | Modify | Durable writes, remove retry queue cap, add incident_auth_id param |
| `src/middleware/rateLimit.js` | Modify | Add Redis backend, keep in-memory fallback |
| `src/services/MessageService.js` | Modify | Add status field support, review policy check, supersede() method |
| `src/routes/agents.js` | Modify | Accept authorizing_human at registration, add incident-auth and directives routes |
| `src/routes/reviews.js` | Create | Decision endpoint, pending-reviews endpoint |
| `src/routes/index.js` | Modify | Register new routes |
| `package.json` | Modify | Remove bcrypt, add ioredis |
| `scripts/migrate-delegation.sql` | Create | All new tables and columns from Changes 5–9 |
| `Caddyfile` | Create | TLS 1.2+, FIPS cipher suites, reverse proxy, security headers |
| `docker-compose.yml` | Create | API + Caddy services, --enable-fips entrypoint |
| `.env.example` | Modify | Remove Moltbook fields, add all EMBook security variables |
| `test/auth.test.js` | Modify | Update key hashing tests for PBKDF2 |

---

## What Is NOT in This Plan

The following are deliberately excluded. They belong in later tasks per the original build notes:

- WebSocket or SSE real-time push (feed performance at scale — deferred to a later extension)
- Full message partitioning and archival implementation (documented in migration, not executed)
- PIV card / PKI cryptographic binding for human authorization (documented as optional enhancement for federal/state agencies with PIV infrastructure — not in v0.1)
- Human review queue UI or notification system (data model built here; interface built by others on top)
- Full NIST 800-53 control mapping (flagged in build plan as post-v0.1)
- Multi-instance horizontal scaling beyond Redis rate limiting

---

*This plan was developed from a post-Task-4 review session covering FIPS compliance gaps, the Chainguard/stackArmor deployment requirements for federal-grade encryption, the delegation chain requirement identified via the Kiteworks/Jensen Huang strategic analysis (Tim Freestone, March 17, 2026), and the audit/scale requirements for a multi-agency EM coordination network operating at incident scale.*
