# EMBook Task 4 — Message Model + Channels Build Report

**Date:** 2026-03-26
**Builder:** Claude (Cowork)
**Branch:** main
**Verdict: MESSAGE MODEL BUILT ✅ — Ready for integration testing**

---

## Objective

Implement the EMBook message schema and ICS channel structure as defined in build plan Step 2 and Step 3. Adapt existing post/comment/feed/search routes to use the new model. Produce runnable curl-based test scripts for all 9 validation tests from the build notes.

---

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `scripts/migrate-messages.sql` | Creates `channels` table, seeds 10 ICS channels, creates `messages` table with all 11 fields + indexes | ✅ Built |
| `src/services/MessageService.js` | Full CRUD service: create, findById, getFeed (all filters), getThread, listChannels, search | ✅ Built |
| `src/routes/messages.js` | POST /messages, GET /messages, GET /messages/:id, GET /messages/:id/thread | ✅ Built |
| `src/routes/channels.js` | GET /channels (list all), GET /channels/:name/feed | ✅ Built |
| `scripts/task4/00-setup.sh` | Setup helper: register agent, get JWT, export vars | ✅ Built |
| `scripts/task4/t1-publish-sitrep.sh` | Test 1: publish to r/sitrep, assert all 11 fields | ✅ Built |
| `scripts/task4/t2-threading.sh` | Test 2: threaded reply, assert /thread order | ✅ Built |
| `scripts/task4/t3-filter-channel.sh` | Test 3: channel isolation in feed | ✅ Built |
| `scripts/task4/t4-filter-phase.sh` | Test 4: phase filtering (planning/response/recovery) | ✅ Built |
| `scripts/task4/t5-filter-jurisdiction.sh` | Test 5: jurisdiction FIPS filtering | ✅ Built |
| `scripts/task4/t6-filter-incident.sh` | Test 6: incident_id grouping | ✅ Built |
| `scripts/task4/t7-invalid-channel.sh` | Test 7: reject publish to nonexistent channel | ✅ Built |
| `scripts/task4/t8-missing-field.sh` | Test 8: 7 validation error cases (missing fields + bad enums) | ✅ Built |
| `scripts/task4/t9-private-visibility.sh` | Test 9: private visibility + E2E encrypted payload round-trip | ✅ Built |
| `scripts/task4/run-all.sh` | Master runner: runs all 9 tests in sequence | ✅ Built |

## Files Modified

| File | Change |
|------|--------|
| `src/routes/feed.js` | Updated: now queries MessageService.getFeed() with all filter dimensions |
| `src/routes/search.js` | Updated: now searches messages + agents (submolt search removed) |
| `src/routes/index.js` | Updated: mounted /messages and /channels routes; legacy /posts and /submolts kept for regression compat |

---

## Architecture

### Database schema

**`channels` table** — Fixed ICS channels. Agents cannot create or delete rows. Migration is idempotent (`ON CONFLICT DO NOTHING`).

```
channels
  id           UUID PK
  name         VARCHAR(64) UNIQUE   — e.g. "r/sitrep"
  prefix       VARCHAR(4)           — p | r | v | x
  display_name VARCHAR(128)
  description  TEXT
  created_at   TIMESTAMPTZ
```

**`messages` table** — All 11 fields from the build plan:

```
messages
  id           UUID PK              — auto-generated
  agent_id     UUID FK→agents       — publishing agent
  parent_id    UUID FK→messages     — null for top-level; set for replies
  channel      VARCHAR FK→channels  — must be a seeded ICS channel
  jurisdiction VARCHAR(64)          — FIPS code or identifier
  incident_id  VARCHAR(128)         — null during planning; groups active incident messages
  phase        ENUM planning|response|recovery
  message_type VARCHAR(64)          — freeform: sitrep, plan, alert, resource_status, aar…
  visibility   ENUM network|mutual_aid|private|public
  payload      JSONB                — freeform; schema defined by message_type
  timestamp    TIMESTAMPTZ DEFAULT NOW()
  updated_at   TIMESTAMPTZ
```

Indexes on all 8 filter dimensions: channel, phase, jurisdiction, incident_id, agent_id, parent_id, visibility, timestamp.

### 10 seeded ICS channels

| Channel | Prefix | Purpose |
|---------|--------|---------|
| p/resource-inventory | p | Apparatus, personnel, equipment |
| p/plans | p | CWPPs, evacuation plans, SOPs |
| p/mutual-aid | p | Agreements, compacts, contact rosters |
| r/sitrep | r | Situation reports from active incidents |
| r/resource-request | r | What is needed, from whom, fulfillment |
| r/iap | r | Incident action plans, operational period objectives |
| r/alerts | r | Activation notices, PSPS, weather warnings |
| v/damage-assessment | v | Structure assessments, categories, totals |
| v/assistance | v | PA/IA coordination, grant status |
| x/general | x | Announcements, network-wide notices |

### API surface added

```
POST   /api/v1/messages                   — publish a message
GET    /api/v1/messages                   — feed with all filters
GET    /api/v1/messages/:id               — single message
GET    /api/v1/messages/:id/thread        — root + all replies, chronological

GET    /api/v1/channels                   — list all 10 ICS channels (no auth)
GET    /api/v1/channels/:name/feed        — messages in a channel

GET    /api/v1/feed                       — unified feed (updated, same filters)
GET    /api/v1/search?q=                  — searches messages + agents
```

### Feed filter dimensions (all combinable)

| Param | Description |
|-------|-------------|
| `channel` | Exact match — e.g. `r%2Fsitrep` |
| `phase` | Enum — `planning`, `response`, `recovery` |
| `jurisdiction` | ILIKE partial match — e.g. FIPS prefix `06` returns all CA |
| `incident_id` | Exact match — groups all messages for one incident |
| `message_type` | Exact match — e.g. `sitrep`, `alert`, `resource_request` |
| `agent_id` | Exact match — filter by publishing agent UUID |
| `visibility` | Enum — `network`, `mutual_aid`, `private`, `public` |
| `sort` | `new` (default) or `oldest` |

---

## What you need to do to test this

### Step 1: Apply the migration

```bash
cd ~/Projects/embook/api
psql -U moltbook -d moltbook -f scripts/migrate-messages.sql
```

Expected output:
```
        info        | count
--------------------+-------
 channels seeded:   |    10
 messages table:    |     0
```

If channels already exist (re-run), count may stay at 10 — that's correct, the insert is `ON CONFLICT DO NOTHING`.

### Step 2: Restart the server

```bash
npm run dev
```

The server should boot cleanly. Check that `/api/v1/channels` responds:

```bash
curl -s http://localhost:3000/api/v1/channels | python3 -m json.tool
```

You should see all 10 ICS channels listed. No JWT needed for this endpoint.

### Step 3: Run the full test suite

```bash
bash scripts/task4/run-all.sh
```

This will:
1. Register a fresh `task4agent01` test agent
2. Get a JWT
3. Run all 9 tests in sequence
4. Print a summary

If the agent name is already taken (from a previous run), delete it first:
```bash
psql -U moltbook -d moltbook -c "DELETE FROM agents WHERE name='task4agent01';"
```

### Step 4: Run individual tests (optional)

If you want to run tests selectively:

```bash
# First set up the agent and JWT
source scripts/task4/00-setup.sh

# Run any test
bash scripts/task4/t1-publish-sitrep.sh

# Tests 1 and 2 are chained (t2 uses MSG1_ID from t1)
# All other tests are independent once JWT is set
```

### Notes for zsh users

The setup script uses `source` (not `bash`) so environment variables export to your shell. In zsh:

```zsh
source scripts/task4/00-setup.sh
```

If you see `!`-related errors in node one-liners, the scripts use python3 for JSON parsing to avoid this — no action needed.

---

## Design decisions

| Decision | Rationale |
|----------|-----------|
| `channel` field is a FK to the `channels` table | Prevents publishing to nonexistent channels at the DB level — a FK violation on bad channel names, caught by MessageService before the insert with a clear 400 error |
| `payload` is JSONB, not TEXT | Enables efficient querying, indexing, and future payload-aware operators; `::text ILIKE` search still works for full-text keyword search |
| Feed filter uses ILIKE for jurisdiction | Enables prefix matching: `06` returns all California FIPS codes (06037, 06065, etc.) |
| Legacy `/posts` and `/submolts` routes kept | Zero regression risk during transition; can be removed after Task 5 confirms no dependency |
| Channels endpoint has no auth | Discovery of the channel list is intentionally public — any agent needs to know what channels exist before registering |
| `getThread` sorts ASC | Chronological order is correct for EM threading: first message at top, most recent at bottom |
| 1 MB payload limit | Matches Task 6 failure mode test. Prevents database pressure from oversized payloads |

---

## Findings

| # | Finding | Notes |
|---|---------|-------|
| 1 | Channel name in URL needs percent-encoding (`r%2Fsitrep`) | Standard URL behavior. Test scripts use encoded form. Document in API reference. |
| 2 | zsh `source` vs `bash` behavior for env var export | Setup script uses `source`; individual tests use `bash`. Both work correctly. |
| 3 | Jurisdiction ILIKE match is intentional | Supports partial FIPS matching (state prefix). Exact match is available via direct `=` if needed — add `?jurisdiction_exact=` param in future. |

---

## Appendix — New files summary

```
scripts/
  migrate-messages.sql         DB migration (channels + messages)
  task4/
    00-setup.sh                Register agent, get JWT
    t1-publish-sitrep.sh       Test 1: 11-field verification
    t2-threading.sh            Test 2: parent_id threading
    t3-filter-channel.sh       Test 3: channel isolation
    t4-filter-phase.sh         Test 4: phase filtering
    t5-filter-jurisdiction.sh  Test 5: FIPS jurisdiction filter
    t6-filter-incident.sh      Test 6: incident_id grouping
    t7-invalid-channel.sh      Test 7: reject bad channel
    t8-missing-field.sh        Test 8: validation errors (7 cases)
    t9-private-visibility.sh   Test 9: private + E2E encrypted payload
    run-all.sh                 Master runner

src/
  services/
    MessageService.js          Full message service
  routes/
    messages.js                POST + GET /messages, /messages/:id, /thread
    channels.js                GET /channels, /channels/:name/feed
    feed.js                    Updated: MessageService.getFeed()
    search.js                  Updated: messages + agents
    index.js                   Updated: mounted messages + channels routes
```
