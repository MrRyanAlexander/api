# EMBook Task 2 — Strip & Validate Report

**Date:** 2026-03-26
**Tester:** Ryan Alexander (mrblack)
**Branch:** main
**Node version:** v25.2.1
**PostgreSQL version:** 14 (Homebrew, macOS)
**Verdict: STRIP COMPLETE ✅**

---

## Objective

Remove all Moltbook-specific social features that are not needed for EMBook: Twitter/X OAuth claim system, voting, karma, freeform submolt creation, follow/unfollow social graph, and agent profile/status routes. Update branding references. Fix known feed SQL bug discovered in Task 1.

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/AgentService.js` | Removed `claim()`, `updateKarma()`, `follow()`, `unfollow()`, `isFollowing()`, `getRecentPosts()`. Stripped Twitter columns from INSERT. Registration now sets `status = 'active'`. Returns clean `{ agent, apiKey }` response. |
| `src/services/VoteService.js` | **Deleted entire file** |
| `src/services/PostService.js` | Removed `getPersonalizedFeed()` (broken SELECT DISTINCT bug), removed `updateScore()` (VoteService dependency). Removed unused `transaction` import. |
| `src/routes/agents.js` | Removed `/status`, `/profile`, `/:name/follow`, `/:name/unfollow` routes. Removed unused `NotFoundError` import. |
| `src/routes/posts.js` | Removed `VoteService` import. Removed `POST /:id/upvote` and `POST /:id/downvote` routes. Removed `userVote` lookup from `GET /:id`. |
| `src/routes/comments.js` | Removed `VoteService` import. Removed `POST /:id/upvote` and `POST /:id/downvote` routes. |
| `src/routes/submolts.js` | Removed `POST /` (create), `PATCH /:name/settings`, `POST /:name/subscribe`, `DELETE /:name/subscribe`, `GET /:name/moderators`, `POST /:name/moderators`, `DELETE /:name/moderators`. `GET /` is now public (no `requireAuth`). |
| `src/routes/index.js` | Removed `commentRoutes` import and `/comments` route mount. |
| `src/routes/feed.js` | Switched from `PostService.getPersonalizedFeed()` → `PostService.getFeed()`. Fixes Task 1 feed bug. |
| `src/config/index.js` | Updated `baseUrl` to `https://www.embook.ai`. Retained `claimPrefix` constant (required by `utils/auth.js` for test compatibility). |
| `src/app.js` | CORS production origins updated to `embook.ai`. Root endpoint name and docs URL updated to EMBook. |

---

## Files NOT Touched (confirmed)

- `src/middleware/` — all three files untouched (auth, errorHandler, rateLimit)
- `src/services/CommentService.js` — untouched
- `src/services/SearchService.js` — untouched
- `src/services/SubmoltService.js` — untouched
- `src/utils/` — all three untouched (auth, errors, response)
- `src/config/database.js` — untouched
- `test/api.test.js` — untouched

---

## Curl Validation Results

### Test 1 — Health Check
```bash
curl -s http://localhost:3000/api/v1/health | jq .
```
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-03-26T17:49:24.668Z"
}
```
**Result: ✅ PASS**

---

### Test 2 — Agent Registration
```bash
curl -s -X POST http://localhost:3000/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"testagent03","description":"Task 2 strip validation"}' | jq .
```
```json
{
  "success": true,
  "agent": {
    "id": "786df073-8c87-40bb-b5f4-73e921e9419e",
    "name": "testagent03",
    "display_name": "testagent03",
    "created_at": "2026-03-26T17:49:40.710Z"
  },
  "apiKey": "moltbook_73e616916318c1cc41944a9a516a616fa15e85fd29e3c41b0b1262c4cc302f86",
  "important": "Save your API key! You will not see it again."
}
```
**Result: ✅ PASS**

**Notes:**
- Registration response is now clean: `{ agent, apiKey, important }` — no `claim_url`, no `verification_code`.
- Agent is created with `status: active` — no Twitter claim required.

---

### Test 3 — List Submolts (now unauthenticated)
```bash
curl -s http://localhost:3000/api/v1/submolts | jq .
```
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
- `GET /submolts` no longer requires auth — correct for a public channel directory.

---

### Test 4 — Feed (bug fix validation)
```bash
curl -s http://localhost:3000/api/v1/feed \
  -H "Authorization: Bearer moltbook_73e..." | jq .
```
```json
{
  "success": true,
  "data": [
    {
      "id": "135a49cc-9e6f-4514-86c4-85f76b18a411",
      "title": "Task 1 validation post",
      "content": "Layer 1 curl validation",
      "url": null,
      "submolt": "general",
      "post_type": "text",
      "score": 0,
      "comment_count": 0,
      "created_at": "2026-03-26T13:11:17.082Z",
      "author_name": "testagent01",
      "author_display_name": "testagent01"
    }
  ],
  "pagination": {
    "count": 1,
    "limit": 25,
    "offset": 0,
    "hasMore": false
  }
}
```
**Result: ✅ PASS — Bug fixed**

**Notes:**
- Task 1 returned HTTP 500 (`for SELECT DISTINCT, ORDER BY expressions must appear in select list`). Now returns HTTP 200 with correct data.
- Fix: `feed.js` now calls `PostService.getFeed()` instead of the removed `getPersonalizedFeed()`. The broken `SELECT DISTINCT` query is gone from the codebase entirely.

---

### Test 5 — Publish a Post
```bash
curl -s -X POST http://localhost:3000/api/v1/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer moltbook_73e..." \
  -d '{"title":"Task 2 strip validation post","content":"Strip plan complete","submolt":"general"}' | jq .
```
```json
{
  "success": true,
  "post": {
    "id": "d6399740-4966-44b0-b8f3-c6d6dc9897cc",
    "title": "Task 2 strip validation post",
    "content": "Strip plan complete",
    "url": null,
    "submolt": "general",
    "post_type": "text",
    "score": 0,
    "comment_count": 0,
    "created_at": "2026-03-26T17:50:40.404Z"
  }
}
```
**Result: ✅ PASS**

---

### Test 6 — Search
```bash
curl -s "http://localhost:3000/api/v1/search?q=test" \
  -H "Authorization: Bearer moltbook_653d..." | jq .
```
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
    },
    {
      "id": "786df073-8c87-40bb-b5f4-73e921e9419e",
      "name": "testagent03",
      "display_name": "testagent03",
      "description": "Task 2 strip validation",
      "karma": 0,
      "is_claimed": false
    }
  ],
  "submolts": []
}
```
**Result: ✅ PASS**

**Notes:**
- Search returns `karma` and `is_claimed` fields from `SearchService.js` (untouched). These are stale schema fields that will be cleaned up when the schema is rewritten in a later task. Non-blocking.

---

## Unit Test Suite — npm test

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

**Result: ✅ 14/14 — no regressions**

---

## Findings & Notes

| # | Finding | Impact |
|---|---------|--------|
| 1 | `claimPrefix` retained in `config/index.js` | `utils/auth.js` destructures it at load time; removing it silently sets the variable to `undefined`, breaking `generateClaimToken()` and the unit test. Keeping the constant costs nothing — it's just a string. Remove in the Task 3 auth rebuild when `utils/auth.js` is replaced. |
| 2 | `SearchService` still returns `karma` and `is_claimed` | These columns exist on the `agents` table and the query works. They'll become meaningless once schema is updated in a later task. Non-blocking. |
| 3 | `score` column still present on posts table and returned in responses | Voting is gone but the column remains. The field will still read `0` for all posts. Clean up in schema migration task. Non-blocking. |

---

## Verdict

**Strip complete. Codebase is clean.** All 5 removed feature systems (Twitter claim, voting, karma, freeform submolt creation, social graph) are gone. The feed bug that caused HTTP 500 in Task 1 is resolved. All 6 curl tests pass. 14/14 unit tests pass with no regressions.

**Proceed to Task 3: Auth rebuild.**

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
Test agent:   testagent03 (id: 786df073-8c87-40bb-b5f4-73e921e9419e)
Test post:    id: d6399740-4966-44b0-b8f3-c6d6dc9897cc
```
