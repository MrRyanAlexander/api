# Registration Test Suite — Security Audit Report

**Date:** 2026-03-27
**Auditor:** Claude Opus 4.6 (acting as security reviewer)
**Scope:** `test/registration.test.js` — adversarial coverage against `AgentService.js`, `keys.js`, `encryption.js`, `operator.js`, `agents.js` routes, and `schema.sql` constraints
**Trigger:** User requested expert-level security review of test coverage before proceeding to Task 5

---

## Methodology

Reviewed every public method on `AgentService` (`register`, `approve`, `findByApiKey`, `verifyAgentKey`, `findById`, `findByName`, `rotatePublicKey`, `update`) plus the route handlers in `agents.js` and `operator.js`, the auth middleware chain, the error classes, and the database schema (both `schema.sql` and `migrate-task4-registration.sql`). Compared each code path and attack surface against the test assertions in Sections 1–12.

---

## Assessment of Existing Sections 1–12

The original 12 sections are strong. Specific strengths:

- **Name validation (S2)** is thorough: boundary lengths, 13 illegal character patterns including Unicode/Cyrillic/emoji, case normalization, whitespace handling.
- **Adversarial inputs (S7)** covers SQL injection (4 patterns), type confusion (number, object, array, boolean), null bytes, extreme length, and XSS.
- **Approval error states (S9)** covers non-existent UUID, re-approval, malformed input, null.
- **Auth flow (S11)** covers valid key, wrong key, truncated, altered, empty/null/undefined, pending agent, and both `findByApiKey` and `verifyAgentKey`.
- **Key integrity (S10)** proves uniqueness across agents and validates the full round-trip from approval through lookup.

No test in Sections 1–12 needed to be modified. They are correct and complete for what they cover.

---

## Gaps Found — 4 New Sections Added

### Section 13: Mass Assignment / Privilege Escalation

**Risk:** An attacker sends extra fields in the registration JSON body (`status: 'active'`, `api_key_hash: '<known hash>'`, `id: '<chosen UUID>'`) attempting to bypass the two-phase approval gate or pre-set credentials.

**Why it matters:** The service uses JavaScript destructuring to extract only named parameters, and the INSERT query uses an explicit column list — so extra fields are silently discarded. But this defense is implicit. If anyone refactors `register()` to use a spread operator or dynamic column builder, the protection vanishes with no test to catch the regression.

**Tests added (11 assertions):**
- `status: 'active'` in registration → DB row still `pending_approval`
- `api_key_hash` injected → DB column still NULL
- `api_key_lookup` injected → DB column still NULL
- `id` injected → server generates its own UUID
- Legacy Moltbook fields (`is_active`, `is_claimed`, `karma`) → all retain defaults
- `update()` with `status: 'active'` → status unchanged
- `update()` with `api_key_hash` → credential column unchanged
- `update()` with `name` → name unchanged (not in `allowedFields`)

### Section 14: Profile Field Injection

**Risk:** SQL injection in profile fields (description, contact_email, agency_name) that bypass name validation because they have no character restrictions. Also: prototype pollution strings as values, and VARCHAR(255) overflow on constrained columns.

**Why it matters:** The name field has strict validation (alphanumeric + underscore), but the five profile fields are stored as-is via parameterized queries. The parameterized queries are the defense, but no test previously verified that SQL metacharacters in these fields are stored literally rather than executed. Additionally, the migration creates `jurisdiction`, `agency_name`, `contact_name`, `contact_title`, and `contact_email` as VARCHAR(255), but the service performs no length validation — overlong values hit the DB constraint and produce a raw PostgreSQL error rather than a clean BadRequestError.

**Tests added (12 assertions):**
- SQL injection in `description` → stored literally
- SQL injection in `contact_email` → stored literally
- SQL injection in `agency_name` → stored literally
- Prototype pollution strings (`__proto__`, `constructor`, `toString`, `prototype`, `__defineGetter__`) as field values → no crash
- VARCHAR(255) overflow on `jurisdiction` → error thrown
- VARCHAR(255) overflow on `agency_name` → error thrown
- VARCHAR(255) overflow on `contact_email` → error thrown
- 100K-character `description` (TEXT column) → accepted
- Null bytes in profile fields → no crash

**Finding (non-blocking):** The VARCHAR overflow errors are raw PostgreSQL exceptions, not BadRequestErrors. The service should add length validation before the INSERT to provide clean error messages. This is noted for the hardening plan but does not block Task 5.

### Section 15: Concurrent Approval Race Condition

**Risk:** Two simultaneous `approve()` calls on the same pending agent. Both read `status = 'pending_approval'`, both pass the guard, both generate different API keys, both UPDATE the same row. The last UPDATE wins — the first caller's key is orphaned (its lookup hash is overwritten).

**Why it matters:** This is a classic TOCTOU (time-of-check-to-time-of-use) vulnerability. In production, the operator UI might double-submit, or two operators might both click approve. The operator who received the first key would find it doesn't work.

**Tests added (3–4 assertions depending on race outcome):**
- Two `Promise.allSettled` approve() calls on the same agent
- If one succeeds and one rejects → safe behavior, winning key verified
- If both succeed → TOCTOU race documented, verifies only one key works, the other is orphaned
- Final DB state is `active` regardless

**Finding (non-blocking):** The fix is to use `UPDATE agents SET ... WHERE id = $1 AND status = 'pending_approval' RETURNING ...` and check the row count. If zero rows affected, throw ConflictError. This is an atomic check-and-update that eliminates the race. Documented for hardening plan.

### Section 16: Return Value Sanitization

**Risk:** Service methods return objects that include internal-only fields (bcrypt hashes, lookup hashes, claim tokens) to callers. If a route handler passes these through to the HTTP response, credentials leak.

**Why it matters:** The `requireAuth` middleware correctly strips `api_key_hash` when constructing `req.agent` (line 102 of `auth.js`). But `findByApiKey()` itself returns the hash in its result set (it needs it for the internal bcrypt compare). If any future route calls `findByApiKey` directly and returns the result, the hash leaks. Testing the return shapes of `register()` and `approve()` ensures they stay clean.

**Tests added (10 assertions):**
- `register()` result: no `api_key_hash`, `api_key_lookup`, `claim_token`, `public_key_pem`, `is_active`
- `register()` result contains exactly `[created_at, display_name, id, name, status]`
- `approve()` agent: no `api_key_hash`, `api_key_lookup`
- `approve()` agent contains exactly `[display_name, id, name, status]`
- `approve()` top-level has `apiKey` and `important`
- `findByApiKey()` internal return shape documented (includes `api_key_hash` — acceptable because middleware strips it)

---

## Summary

| Category | Sections 1–12 | Sections 13–16 | Total |
|----------|---------------|-----------------|-------|
| Assertions (approx) | ~124 | ~36 | ~160 |
| Attack surfaces covered | Input validation, auth flow, lifecycle | Privilege escalation, field injection, race conditions, data leakage | All registration-phase surfaces |

**Verdict:** The original 12 sections covered input validation and auth flow well. The 4 new sections close the remaining gaps for this stage of development: mass assignment, injection in unstested fields, concurrency, and return value hygiene. The test suite now exercises every public method on `AgentService` that participates in the registration/approval lifecycle, and does so from an attacker's perspective.

**Non-blocking findings for hardening plan:**
1. VARCHAR(255) overflow produces raw DB errors (add service-level length validation)
2. Concurrent approval race condition (fix with atomic UPDATE...WHERE status check)
3. `findByApiKey` returns `api_key_hash` internally (acceptable while middleware strips it, but fragile)
