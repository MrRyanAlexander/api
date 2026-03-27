# Registration Fixes — Post-Implementation Review
**Date:** 2026-03-27
**Reviewer:** Claude (post-implementation audit)
**Scope:** Review of task-5-registration-fixes-report.md changes and correction of four issues found

---

## Review Verdict

The core implementation in `task-5-registration-fixes-report.md` was correct and complete — two-phase registration, agency profile capture, operator approval endpoint, and key deferral all landed as designed. Four issues were identified during review and corrected in this session.

---

## What Was Verified as Correct

| Item | Status | Notes |
|------|--------|-------|
| `AgentService.register()` no longer issues API keys | ✅ | Returns pending_approval status and message only |
| Five agency profile fields added to registration | ✅ | jurisdiction, agency_name, contact_name, contact_title, contact_email |
| `POST /operator/agents/:id/approve` endpoint exists | ✅ | Requires operator auth, generates key, returns plaintext once |
| `AgentService.approve()` generates key and sets status to active | ✅ | Correct flow |
| `/operator` route registered in `routes/index.js` | ✅ | Properly mounted |
| Migration adds profile columns and makes api_key_hash nullable | ✅ | `migrate-task4-registration.sql` (see naming note below) |
| Migration converts legacy pending_claim rows to pending_approval | ✅ | Idempotent UPDATE covers existing test data |
| `api_key_lookup` already nullable from migrate-auth.sql | ✅ | No action needed — added without NOT NULL constraint in Task 3 |

---

## Issues Found and Fixed

### Issue 1 — Security: Duplicate operator middleware using plain string comparison
**File:** `src/routes/operator.js`
**Severity:** Security regression

The file defined its own `requireOperatorPassword` function inline rather than using the existing `requireOperator` from `src/middleware/auth.js`. The inline version compared the token with `token !== secret` — a plain JavaScript equality check that is vulnerable to timing attacks. The `requireOperator` in middleware/auth.js uses `crypto.timingSafeEqual()` which is the correct, timing-safe implementation.

**Fix:** Removed the inline middleware. `operator.js` now imports and uses `requireOperator` from `middleware/auth.js`. Also removed the now-unused import of `UnauthorizedError` from `operator.js`.

---

### Issue 2 — Schema: `schema.sql` still defaulted to `pending_claim`
**File:** `scripts/schema.sql` line 21
**Severity:** Correctness — breaks fresh installs

The migration correctly changed the column default to `pending_approval` for existing databases, but `schema.sql` itself still read `DEFAULT 'pending_claim'`. Any fresh deployment that runs `schema.sql` without the migration would start with the old Moltbook default. The two files were out of sync.

**Fix:** Updated `schema.sql` line 21 from `DEFAULT 'pending_claim'` to `DEFAULT 'pending_approval'`. Schema and migration now agree.

---

### Issue 3 — Cleanup: `AgentService.approve()` still accepted `pending_claim`
**File:** `src/services/AgentService.js` line 109
**Severity:** Minor — contradicts stated cleanup goal

The approval guard read:
```js
if (existing.status !== 'pending_approval' && existing.status !== 'pending_claim') {
```
This kept `pending_claim` as an accepted input state despite the report stating it was fully removed. After the migration runs, no rows will have `pending_claim` status, making this branch dead code that also muddies the intent.

**Fix:** Simplified to:
```js
if (existing.status !== 'pending_approval') {
```

---

### Issue 4 — Stale JSDoc on `AgentService.register()`
**File:** `src/services/AgentService.js` lines 13–26
**Severity:** Minor — misleads future developers

The JSDoc comment said "The API key is generated here, hashed with bcrypt, and the plaintext is returned exactly once." Both statements are now wrong — key generation was moved to `approve()`, not `register()`, as the entire point of this change. The comment also omitted the five new profile parameters from its `@param` list.

**Fix:** Rewrote the JSDoc to accurately describe the two-phase flow, updated `@returns`, and documented all five new parameters.

---

## Naming Note (No Fix Required)

The report `task-5-registration-fixes-report.md` references the migration as `migrate-task5-registration.sql`. The actual file on disk is `migrate-task4-registration.sql`. The content is correct and the migration runs fine. This is a cosmetic discrepancy between the report and the filesystem — no code impact.

---

## Final State After This Review

```
src/routes/operator.js          — uses requireOperator from middleware/auth.js (timing-safe)
src/services/AgentService.js    — register() JSDoc accurate; approve() accepts pending_approval only
scripts/schema.sql              — DEFAULT 'pending_approval' on status column
scripts/migrate-task4-registration.sql — unchanged, correct
```

Zero remaining references to `pending_claim` in any source file. Verified with full codebase grep.

---

## Ready for Task 5

Registration flow is now: agency submits profile → `pending_approval` status, no key → operator vets out-of-band → operator calls `/operator/agents/:id/approve` → key generated and returned once → agent receives key via secure channel → agent can now authenticate and join the network.

This mirrors the credentialing gatekeeping model used in existing government EM systems and produces an audit trail with a human approval event at the root of every agent's lifecycle.
