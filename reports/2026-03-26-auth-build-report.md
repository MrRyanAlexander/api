# EMBook Task 3 — Auth Build Report

**Date:** 2026-03-26
**Builder:** Claude (Cowork)
**Branch:** main
**Node version:** v25.2.1 (Linux VM)
**Verdict: AUTH LAYER BUILT ✅ — 71/71 unit tests passing, 0 regressions**

---

## Objective

Build the EMBook authentication layer from scratch, as described in the build plan Step 1b. Replace all Moltbook auth with federal-grade components: bcrypt API keys, RS256 JWT session tokens, HMAC request signing, E2E message encryption, and an append-only audit log.

---

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `src/auth/keys.js` | API key generation (bcrypt + SHA-256 lookup index) | ✅ Built |
| `src/auth/tokens.js` | RS256 JWT issuance and verification, 15-min expiry | ✅ Built |
| `src/auth/signing.js` | HMAC-SHA256 request signing + replay prevention | ✅ Built |
| `src/auth/encryption.js` | E2E AES-256-GCM + RSA-OAEP payload encryption | ✅ Built |
| `src/auth/audit.js` | Append-only audit log with retry queue | ✅ Built |
| `src/routes/auth.js` | POST /auth/token, GET /auth/jwks endpoints | ✅ Built |
| `scripts/migrate-auth.sql` | DB migration: audit_log, token_issuances, agent columns | ✅ Built |
| `scripts/generate-keys.js` | One-time RSA key pair generation script | ✅ Built |
| `test/auth.test.js` | 71-test unit suite for all auth modules | ✅ Built |

## Files Modified

| File | Change |
|------|--------|
| `src/middleware/auth.js` | Fully replaced — two-phase JWT+HMAC auth, operator middleware |
| `src/services/AgentService.js` | Updated to use bcrypt key storage, public key column, key verification |
| `src/routes/index.js` | Mounted new `/auth` route |

---

## Architecture Summary

### Two-phase auth model

**Phase 1 — Token exchange (once per 15 minutes):**
Agent sends `POST /auth/token` with its raw API key in the body, signed with HMAC-SHA256 using that same key, plus a timestamp header for replay prevention. The server:
1. Validates the key format
2. Rejects requests with timestamps older than 5 minutes (replay protection)
3. Verifies the HMAC signature over the request body
4. Looks up the agent by SHA-256 lookup index, then bcrypt-verifies the key
5. Issues a 15-minute RS256 JWT scoped to `api:read api:write`
6. Writes an `AUTH_SUCCESS` or `AUTH_FAILURE` audit entry

**Phase 2 — Bearer JWT on every request:**
Agent attaches `Authorization: Bearer <jwt>` to every API call. For mutating requests (POST/PATCH/DELETE), the agent also includes:
- `X-EMBook-Key: <raw_api_key>` — for HMAC verification
- `X-EMBook-Signature: sha256=<hmac>` — HMAC of the request body
- `X-EMBook-Timestamp: <unix_seconds>` — for replay prevention

### Key storage design

Two columns on the `agents` table:
- `api_key_hash` — bcrypt hash (cost 12). Used for cryptographic verification during `/auth/token`. Never compared on the hot path.
- `api_key_lookup` — SHA-256 hash. Used as a fast index for O(1) row lookup before the bcrypt comparison.

This avoids a full table scan on every auth request while maintaining cryptographic integrity.

### E2E encryption design

Agent B registers with its RSA-2048 public key. When Agent A sends a `private` or `mutual_aid` visibility message:
1. A random 256-bit AES key and 96-bit IV are generated.
2. The message payload is encrypted with AES-256-GCM.
3. The AES key is encrypted with Agent B's RSA public key (OAEP-SHA256).
4. The server stores the envelope object — it contains only ciphertext.

The EMBook server **cannot decrypt the payload**. Only Agent B, holding its private key, can decrypt. GCM authentication tags prevent ciphertext tampering.

---

## Test Results

### New auth unit suite (test/auth.test.js)

```
EMBook Auth Test Suite
==================================================

[keys.js]
  + generateApiKey returns a string
  + generateApiKey starts with 'embook_'
  + generateApiKey is 71 chars (7 prefix + 64 hex)
  + isValidKeyFormat accepts generated key
  + generateApiKey produces unique keys
  + generateOperatorKey starts with 'embook_op_'
  + isOperatorKey identifies operator keys
  + isOperatorKey rejects agent keys
  + isValidKeyFormat rejects empty string
  + isValidKeyFormat rejects null
  + isValidKeyFormat rejects wrong prefix
  + isValidKeyFormat rejects short body
  + isValidKeyFormat rejects non-hex body
  + hashApiKey returns string
  + hashApiKey produces bcrypt output
  + hashApiKey does not return plaintext
  + verifyApiKey accepts correct key
  + verifyApiKey rejects wrong key
  + verifyApiKey rejects empty key
  + verifyApiKey rejects null key
  + keyLookupHash is deterministic
  + keyLookupHash produces 64-char SHA-256
  + keyLookupHash differs for different keys

[tokens.js]
  + issueToken returns a string
  + issueToken produces a 3-part JWT
  + verifyToken: sub matches agent.id
  + verifyToken: name claim present
  + verifyToken: issuer is embook-api
  + verifyToken: default scope correct
  + verifyToken: jti (nonce) present
  + verifyToken: expiry is exactly 900s (15 min)
  + issueToken: custom scope respected
  + issueToken: each token has unique jti
  + verifyToken rejects malformed token with TOKEN_INVALID
  + verifyToken rejects tampered payload with TOKEN_INVALID
  + decodeToken returns payload without verification
  + decodeToken returns null for garbage input

[signing.js]
  + signBody output starts with 'sha256='
  + signBody output is 71 chars (7 prefix + 64 hex)
  + signBody is deterministic
  + signBody differs with different body
  + signBody differs with different secret
  + verifySignature accepts correct signature
  + verifySignature rejects tampered body
  + verifySignature rejects wrong signature value
  + verifySignature rejects bad signature format
  + verifySignature rejects missing signature
  + verifyTimestamp accepts current timestamp
  + verifyTimestamp accepts 1-minute-old timestamp
  + verifyTimestamp rejects timestamp older than max age
  + verifyTimestamp rejects timestamp >30s in the future
  + verifyTimestamp rejects non-numeric value
  + verifyTimestamp rejects null
  + canonicalBody produces same output regardless of key order
  + canonicalBody handles empty string
  + canonicalBody handles null

[encryption.js]
  + generateKeyPair produces valid PEM public key
  + isValidPublicKeyPem rejects garbage
  + isValidPublicKeyPem rejects null
  + encryptPayload: encrypted flag set
  + encryptPayload: correct algorithm label
  + encryptPayload: encrypted_key present
  + encryptPayload: ciphertext present
  + encryptPayload: IV present
  + encryptPayload: auth_tag present
  + encryptPayload: plaintext not in ciphertext
  + encryptPayload: content fully encrypted
  + decryptPayload: Agent B decrypts correctly
  + decryptPayload: decrypted payload is valid JSON with correct content
  + decryptPayload: Agent A (non-recipient) cannot decrypt
  + decryptPayload: tampered ciphertext rejected by GCM auth tag

==================================================
Results: 71 passed, 0 failed
```

### Existing Moltbook regression suite (test/api.test.js)

```
Results: 14 passed, 0 failed
```

**Zero regressions.**

---

## What you need to do next (your part)

The auth layer code is complete and all unit tests pass in isolation. But it requires a running PostgreSQL instance to complete the integration round-trip tests described in the build notes. Here is exactly what you need to do:

### Step 1: Apply the database migration

```bash
cd ~/Projects/embook/api
psql -U moltbook -d moltbook -f scripts/migrate-auth.sql
```

This adds three things to the database:
- `api_key_lookup` and `public_key_pem` columns to the `agents` table
- The `audit_log` table (append-only)
- The `token_issuances` table (for future revocation)

If you get an error about the `agents` table not having the column yet, the migration is idempotent — all ALTER TABLE statements use `ADD COLUMN IF NOT EXISTS`.

### Step 2: Generate RSA keys

```bash
node scripts/generate-keys.js
```

This creates `keys/jwt_private.pem` and `keys/jwt_public.pem`. The `keys/` directory is already in `.gitignore`. If `keys/` is not in your `.gitignore`, add it now.

### Step 3: Set OPERATOR_SECRET in .env

```
OPERATOR_SECRET=<any long random string>
```

This protects the operator-only admin routes. Generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Restart the server

```bash
npm run dev
```

The server should boot cleanly. You'll see the RSA key loading message only if the ephemeral fallback is used — after `generate-keys.js` runs, you'll see nothing (silent = correct).

### Step 5: Run the auth round-trip tests

The build notes describe 6 integration tests. Here are the exact curl commands for each one.

#### Test 1 — Register an agent and verify the key is hashed

```bash
# Register
curl -s -X POST http://localhost:3000/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name":"authtest01","description":"Task 3 auth round-trip test"}' | jq .

# Verify the api_key_hash in the database starts with $2b$ (bcrypt)
psql -U moltbook -d moltbook -c "SELECT name, LEFT(api_key_hash, 7) AS hash_prefix FROM agents WHERE name='authtest01';"
# Expected: $2b$12$
```

#### Test 2 — Exchange API key for a JWT

Save your API key from registration as `API_KEY`, then:

```bash
# Set your key
API_KEY="embook_<your-key-here>"
TS=$(date +%s)
BODY="{\"api_key\":\"$API_KEY\"}"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print "sha256="$2}')

curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -H "X-EMBook-Signature: $SIG" \
  -H "X-EMBook-Timestamp: $TS" \
  -d "$BODY" | jq .
```

Expected response:
```json
{
  "success": true,
  "token": "<jwt>",
  "expires_in": 900,
  "token_type": "Bearer"
}
```

Save the token: `JWT="<token>"`

#### Test 3 — Use the JWT to make an authenticated request, then verify it expires

```bash
# Should work immediately
curl -s http://localhost:3000/api/v1/feed \
  -H "Authorization: Bearer $JWT" | jq .success

# Wait 15 minutes (or use a manually expired token — see note below)
# Then the same request should return 401 with "Session token expired"
```

**Shortcut to test expiry without waiting:** Generate a token with a past exp:
```bash
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const priv = fs.readFileSync('keys/jwt_private.pem', 'utf8');
// Token expired 1 second ago
const tok = jwt.sign({ sub: 'test', scope: 'api:read', iss: 'embook-api' }, priv, { algorithm: 'RS256', expiresIn: -1 });
console.log(tok);
"
# Then use that token in a request — should get 401 TOKEN_EXPIRED
```

#### Test 4 — HMAC signature verification

```bash
# Valid signed request (POST to agents/register with a new agent)
TS=$(date +%s)
BODY='{"name":"signedtest01","description":"HMAC test"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print "sha256="$2}')

# (The registration endpoint doesn't require signing in v0.1 — use a signed POST to a route that does)
# For now, test rejection of a tampered request:
BAD_BODY='{"name":"signedtest01","description":"TAMPERED"}'
BAD_SIG=$(echo -n "$BAD_BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print "sha256="$2}')

# Send original body with tampered body's sig — should be rejected
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -H "X-EMBook-Signature: $BAD_SIG" \
  -H "X-EMBook-Timestamp: $TS" \
  -d "$BODY" | jq .
# Expected: 401 "Request signature verification failed"
```

#### Test 5 — E2E encryption (Agent A encrypts for Agent B, Agent C cannot decrypt)

```bash
node -e "
const { generateKeyPair, encryptPayload, decryptPayload } = require('./src/auth/encryption');

const agentB = generateKeyPair();
const agentC = generateKeyPair();

const plaintext = JSON.stringify({ incident: 'INC-2026-001', summary: 'Sensitive mutual aid request' });
const envelope = encryptPayload(plaintext, agentB.publicKey);

console.log('Encrypted:', JSON.stringify(envelope).slice(0, 80), '...');

// Agent B decrypts OK
const decrypted = decryptPayload(envelope, agentB.privateKey);
console.log('Agent B decrypted:', decrypted === plaintext ? '✅ PASS' : '❌ FAIL');

// Agent C cannot decrypt
try {
  decryptPayload(envelope, agentC.privateKey);
  console.log('Agent C blocked: ❌ FAIL (should have thrown)');
} catch (e) {
  console.log('Agent C blocked: ✅ PASS (decryption failed as expected)');
}

// Server cannot read the payload field (it's an opaque base64 blob)
console.log('Server sees ciphertext (not plaintext):', !JSON.stringify(envelope).includes('Sensitive') ? '✅ PASS' : '❌ FAIL');
"
```

#### Test 6 — Verify audit log entries

After running tests 1–5, query the audit log:

```bash
psql -U moltbook -d moltbook -c \
  "SELECT action, agent_id, outcome, created_at FROM audit_log ORDER BY created_at DESC LIMIT 20;"
```

You should see rows for `AGENT_REGISTER`, `AUTH_SUCCESS`, `AUTH_FAILURE`, `TOKEN_VERIFY_SUCCESS`, `HMAC_VERIFY_FAILURE`, and so on. Each row has a timestamp, agent ID (where applicable), and outcome.

To confirm it's append-only at the application level:
```bash
psql -U moltbook -d moltbook -c "DELETE FROM audit_log LIMIT 1;"
# This will succeed unless you've revoked DELETE on the table from the app role.
# The REVOKE step is documented in migrate-auth.sql as a manual hardening step.
```

---

## Findings and Notes

| # | Finding | Severity | Notes |
|---|---------|----------|-------|
| 1 | bcrypt hash/verify on every `/auth/token` call adds ~100ms latency | Expected | This is the cost of bcrypt. Acceptable because tokens are requested infrequently (every 15 minutes). |
| 2 | `requireSigned` middleware requires the raw API key in `X-EMBook-Key` on every mutating request | Design decision | This is required for HMAC verification since only the hashed key is stored. Alternative: derive a signing key from the JWT secret. Noted for future review. |
| 3 | `migrate-auth.sql` uses `ADD COLUMN IF NOT EXISTS` — safe to run multiple times | Positive | Idempotent migration. |
| 4 | Ephemeral RSA key fallback in development mode | Acceptable | Prints a console warning. Keys are stable within a process restart but do not persist across restarts. Run `generate-keys.js` to fix. |
| 5 | `audit_log` DELETE is only prevented at the application level in v0.1 | Low | The `REVOKE` step documented in the migration SQL should be applied before production deployment. Task 7 hardening covers this. |
| 6 | `token_issuances` table exists but revocation is not implemented | Deferred | Table is in place for Task 7. |

---

## Verdict

**Auth layer is built.** All 71 unit tests pass. 14/14 Moltbook regression tests pass. The code is complete and ready for live integration testing against your local PostgreSQL instance. Follow the "What you need to do next" section above to run the six round-trip tests from the build notes.

**Proceed to integration testing, then Task 4: Message model and channels.**

---

## Appendix — New files summary

```
src/auth/
  keys.js          API key generation (bcrypt + SHA-256 index)
  tokens.js        RS256 JWT issuance / verification
  signing.js       HMAC request signing / verification
  encryption.js    E2E AES-256-GCM + RSA-OAEP payload encryption
  audit.js         Append-only audit log

src/routes/
  auth.js          POST /auth/token, GET /auth/jwks

src/middleware/
  auth.js          requireAuth, requireSigned, optionalAuth, requireOperator (REPLACED)

src/services/
  AgentService.js  Updated: bcrypt key storage, public key column, verifyAgentKey()

scripts/
  migrate-auth.sql DB migration: audit_log, token_issuances, agent columns
  generate-keys.js One-time RSA key pair generation

test/
  auth.test.js     71-test auth unit suite (all passing)
```
