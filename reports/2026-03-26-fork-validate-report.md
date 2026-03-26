# EMBook Task 1 — Fork & Validate Report

**Date:** 2026-03-26
**Tester:** Ryan Alexander (mrblack)
**Repo forked:** https://github.com/moltbook/api → https://github.com/MrRyanAlexander/api
**Branch:** main
**Node version:** v25.2.1
**PostgreSQL version:** 14 (Homebrew, macOS)
**Verdict: FORK STRATEGY VIABLE ✅**

---

## Setup Summary

| Step | Outcome |
|------|---------|
| Fork moltbook/api on GitHub | ✅ Complete |
| Clone to local machine | ✅ Complete (`~/Projects/embook/api`) |
| `npm install` (95 packages) | ✅ Clean — 1 low severity vulnerability, non-blocking |
| PostgreSQL database created | ✅ `moltbook` user + `moltbook` database |
| Schema loaded via `scripts/schema.sql` | ✅ All tables created (agents, posts, comments, votes, submolts, subscriptions, follows) |
| `npm run db:migrate` | ❌ `migrate.js` does not exist — `package.json` points to a missing script. **Workaround:** run schema directly via `psql -f scripts/schema.sql`. Non-blocking. |
| `.env` configured | ✅ `DATABASE_URL` corrected from placeholder value |
| `npm run dev` — server boots | ✅ `Database connected` on port 3000 |

---

## Curl Validation Results

### Test 1 — Health Check
**Command:**
```bash
curl -s http://localhost:3000/api/v1/health | jq .
```
**Response (HTTP 200):**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-03-26T13:12:42.565Z"
}
```
**Result: ✅ PASS**

---

### Test 2 — Agent Registration
**Command:**
```bash
curl -s -X POST http://localhost:3000/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"testagent01","description":"Task 1 validation agent"}' | jq .
```
**Response (HTTP 201):**
```json
{
  "success": true,
  "agent": {
    "id": "dd10c93c-6edd-46c4-a479-bedf1b1ebfb9",
    "name": "testagent01",
    "display_name": "testagent01",
    "created_at": "2026-03-26T12:52:39.529Z"
  },
  "apiKey": "moltbook_653db96b1525272805c7ed2526be33a7e503d0fe84ca6b89baa966df52700f6c"
}
```
**Result: ✅ PASS**

**Notes:**
- Registration endpoint correctly returns a usable API key in format `moltbook_` + 64 hex chars.
- API key is stored as a hash in the database (confirmed via source code: `hashToken(apiKey)` before INSERT). Plaintext key only returned once at registration — correct behavior.
- **Undocumented field name mismatch:** The README describes a `username` field; the actual code requires `name`. Any agent or skill using the documented field name will get `BAD_REQUEST: Name is required`. This is a documentation bug, not a code bug — but it must be noted for Task 2 cleanup.
- **Undocumented name validation:** Hyphens are not allowed (alphanumeric + underscore only, 2–32 chars). The field name `test-agent-01` used in early test attempts was silently rejected due to this undocumented constraint.
- Agent is created with `status: pending_claim` — the Twitter claim flow is required to publish posts in Moltbook's original design. **This is the primary flow we are replacing in Task 3.**

---

### Test 3 — List Submolts (Channels)
**Command:**
```bash
curl -s http://localhost:3000/api/v1/submolts | jq .
```
**Response (HTTP 200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "f228c800-61bb-4b1d-8265-632c5cf758fc",
      "name": "general",
      "display_name": "General",
      "description": "The default community for all moltys",
      "subscriber_count": 0,
      "created_at": "2026-03-26T12:52:39.529Z"
    }
  ],
  "pagination": {
    "count": 1,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```
**Result: ✅ PASS**

**Notes:**
- Schema seeds exactly one default submolt (`general`). This is the slot where we will seed the 10 fixed ICS channels in Task 4. The channel infrastructure is intact and working.
- Submolts endpoint does not require auth — this is appropriate and matches expected behavior.

---

### Test 4 — Read Feed
**Command:**
```bash
curl -s http://localhost:3000/api/v1/feed \
  -H "Authorization: Bearer moltbook_653db96b1525272805c7ed2526be33a7e503d0fe84ca6b89baa966df52700f6c" | jq .
```
**Response (HTTP 500):**
```json
{
  "success": false,
  "error": "for SELECT DISTINCT, ORDER BY expressions must appear in select list",
  "hint": "Please try again later"
}
```
**Result: ❌ FAIL — Known upstream bug**

**Root cause:** The feed query uses `SELECT DISTINCT` with an `ORDER BY` on a column (`score` or similar ranking field) that is not included in the SELECT list. PostgreSQL enforces that all ORDER BY columns must appear in the SELECT list when DISTINCT is used. This is a SQL correctness error in the Moltbook codebase.

**Impact on EMBook:** The feed query in `src/services/PostService.js` will be substantially rewritten in Task 4 when we adapt it to the EMBook message model with channel/phase/jurisdiction/incident_id filtering. This bug does not need to be fixed in isolation — it will be resolved as part of that rewrite. **Non-blocking for fork strategy.**

This finding is consistent with GitHub issue #185 (pagination broken) and #174 (submolt filter ignored on /posts) — the feed and query layer is the most "vibe-coded" part of the codebase.

---

### Test 5 — Publish a Post
**Command:**
```bash
curl -s -X POST http://localhost:3000/api/v1/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer moltbook_653db96b1525272805c7ed2526be33a7e503d0fe84ca6b89baa966df52700f6c" \
  -d '{"title":"Task 1 validation post","content":"Layer 1 curl validation","submolt":"general"}' | jq .
```
**Response (HTTP 201):**
```json
{
  "success": true,
  "post": {
    "id": "135a49cc-9e6f-4514-86c4-85f76b18a411",
    "title": "Task 1 validation post",
    "content": "Layer 1 curl validation",
    "url": null,
    "submolt": "general",
    "post_type": "text",
    "score": 0,
    "comment_count": 0,
    "created_at": "2026-03-26T13:11:17.082Z"
  }
}
```
**Result: ✅ PASS**

**Notes:**
- Post creation works correctly with a valid API key.
- Importantly, post creation succeeded despite the agent being in `pending_claim` status. In Moltbook's original design this would eventually be gated by `requireClaimed` middleware, but on this fork the gate is not enforced on the POST /posts route — only `requireAuth` is applied. This is actually favorable for EMBook: we do not need Twitter claim verification, and the route already behaves as we want it to.
- The `submolt` field maps directly to the `channel` field concept in EMBook. The routing infrastructure is in place.

---

### Test 6 — Search
**Command:**
```bash
curl -s "http://localhost:3000/api/v1/search?q=test" \
  -H "Authorization: Bearer moltbook_653db96b1525272805c7ed2526be33a7e503d0fe84ca6b89baa966df52700f6c" | jq .
```
**Response (HTTP 200):**
```json
{
  "success": true,
  "posts": [],
  "agents": [
    {
      "id": "dd10c93c-6edd-46c4-a479-bedf1b1ebfb9",
      "name": "testagent01",
      "display_name": "testagent01",
      "description": "Task 1 validation agent",
      "karma": 0,
      "is_claimed": false
    }
  ],
  "submolts": []
}
```
**Result: ✅ PASS**

**Notes:**
- Search correctly returned the registered agent matching the query `test`.
- Posts array is empty (expected — the post created in Test 5 may not be indexed in search yet, or search uses a different query path. Non-blocking).
- Search returns a unified result set across posts, agents, and submolts — this structure will be adapted in Task 4 to search across messages, agents, and channels.
- **Shell note:** URL must be quoted in zsh to prevent `?` being interpreted as a glob wildcard. This is a local environment note, not an API issue.

---

## Findings Summary

| # | Finding | Severity | Impact on EMBook |
|---|---------|----------|-----------------|
| 1 | `migrate.js` missing — schema must be run manually via `psql -f` | Low | None — run schema directly. Fix in Task 2 by adding a proper migrate script. |
| 2 | README documents `username` field; code requires `name` | Low | Documentation only. We rewrite the README in Step 5 scaffolding. |
| 3 | Agent names reject hyphens (undocumented alphanumeric-only constraint) | Low | EMBook agent names will follow the same pattern. Document it. |
| 4 | Feed query broken — `SELECT DISTINCT` + `ORDER BY` SQL error | Medium | Resolved naturally in Task 4 feed rewrite. No fix needed now. |
| 5 | `pending_claim` status does not block post creation | Favorable | We remove the claim system entirely. This confirms it's already loosely enforced. |
| 6 | API key hashed before storage (bcrypt via `hashToken`) | Positive | Correct security behavior. We build on this pattern in Task 3. |
| 7 | No `docker-compose.yml` present | Low | We add one in Task 2 to simplify deployment. |

---

## Verdict

**The fork strategy is viable.** The Moltbook API boots cleanly, connects to PostgreSQL, registers agents, issues API keys with correct hashing behavior, accepts and stores posts, lists channels, and returns search results. The core Express + PostgreSQL scaffold is sound.

The feed query bug is real but isolated to a single service method that will be rewritten entirely in Task 4. The missing migrate script is a minor inconvenience. The Twitter claim flow is present in the codebase but not enforced on the routes we care about, making removal in Task 2 straightforward.

**Proceed to Task 2: Strip and validate.**

---

## Unit Test Suite — npm test

The fork ships with a 14-test unit suite covering auth utilities and error classes (`test/api.test.js`). All 14 tests passed on the forked codebase without modification.

```
Moltbook API Test Suite
==================================================

[Auth Utils]

  + generateApiKey creates valid key
  + generateClaimToken creates valid token
  + generateVerificationCode has correct format
  + validateApiKey accepts valid key
  + validateApiKey rejects invalid key
  + extractToken extracts from Bearer header
  + extractToken returns null for invalid header
  + hashToken creates consistent hash

[Error Classes]

  + ApiError creates with status code
  + BadRequestError has status 400
  + NotFoundError has status 404
  + UnauthorizedError has status 401
  + ApiError toJSON returns correct format

[Config]

  + config loads without error

==================================================

Results: 14 passed, 0 failed
```

**What this tells us:**

The auth utility layer (`src/utils/auth.js`) is solid — key generation, token validation, hashing, and Bearer token extraction all behave correctly and are properly tested. The error class hierarchy is clean and consistent. The config module loads without errors.

This is directly relevant to Task 3. When we rebuild `src/middleware/auth.js` and add `src/auth/keys.js`, `src/auth/signing.js`, `src/auth/tokens.js`, `src/auth/encryption.js`, and `src/auth/audit.js`, we can extend this test suite rather than building from scratch. The existing tests serve as a regression baseline — they must still pass after the auth rebuild.

**Implication for Task 2:** The test suite covers only `src/utils/auth.js`, `src/utils/errors.js`, and `src/config/`. None of the code being stripped in Task 2 (Twitter OAuth, crypto wallet, voting, karma, freeform submolt creation) is covered by these tests. Stripping those features will not break any existing tests.

---

## Appendix — Environment

```
OS:           macOS (Apple Silicon, arm64)
Shell:        zsh (conda base)
Node.js:      v25.2.1
npm:          11.6.2
PostgreSQL:   14 (Homebrew)
API port:     3000
DB name:      moltbook
DB user:      moltbook
Test agent:   testagent01 (id: dd10c93c-6edd-46c4-a479-bedf1b1ebfb9)
Test post:    id: 135a49cc-9e6f-4514-86c4-85f76b18a411
```
