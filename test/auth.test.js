/**
 * test/auth.test.js
 *
 * EMBook Task 3 — Auth unit test suite.
 *
 * Tests all auth modules in isolation (no database required).
 * Run with: node test/auth.test.js
 *
 * Test coverage:
 *   [keys.js]       API key generation, hashing, verification, format validation
 *   [tokens.js]     JWT issuance, verification, expiry, invalid token rejection
 *   [signing.js]    HMAC signing, verification, timestamp validation, replay prevention
 *   [encryption.js] E2E encrypt/decrypt, wrong key rejection, format validation
 */

const { generateApiKey, generateOperatorKey, hashApiKey, verifyApiKey,
        keyLookupHash, isValidKeyFormat, isOperatorKey }
      = require('../src/auth/keys');

const { issueToken, verifyToken, decodeToken, TOKEN_EXPIRY_SECONDS }
      = require('../src/auth/tokens');

const { signBody, verifySignature, verifyTimestamp, canonicalBody,
        SIGNATURE_MAX_AGE_SECONDS }
      = require('../src/auth/signing');

const { encryptPayload, decryptPayload, isValidPublicKeyPem, generateKeyPair }
      = require('../src/auth/encryption');

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  + ' + label);
    passed++;
  } else {
    console.error('  - FAIL: ' + label);
    failed++;
  }
}

async function assertThrows(fn, code, label) {
  try {
    await fn();
    console.error('  - FAIL (no throw): ' + label);
    failed++;
  } catch (e) {
    if (code && e.code !== code) {
      console.error(`  - FAIL (wrong code: ${e.code} expected ${code}): ${label}`);
      failed++;
    } else {
      console.log('  + ' + label);
      passed++;
    }
  }
}

// ─── keys.js tests ───────────────────────────────────────────────────────────

async function testKeys() {
  console.log('\n[keys.js]');

  const key = generateApiKey();
  assert(typeof key === 'string', 'generateApiKey returns a string');
  assert(key.startsWith('embook_'), "generateApiKey starts with 'embook_'");
  assert(key.length === 71, 'generateApiKey is 71 chars (7 prefix + 64 hex)');
  assert(isValidKeyFormat(key), 'isValidKeyFormat accepts generated key');

  const key2 = generateApiKey();
  assert(key !== key2, 'generateApiKey produces unique keys');

  const opKey = generateOperatorKey();
  assert(opKey.startsWith('embook_op_'), "generateOperatorKey starts with 'embook_op_'");
  assert(isOperatorKey(opKey), 'isOperatorKey identifies operator keys');
  assert(!isOperatorKey(key), 'isOperatorKey rejects agent keys');

  assert(!isValidKeyFormat(''), 'isValidKeyFormat rejects empty string');
  assert(!isValidKeyFormat(null), 'isValidKeyFormat rejects null');
  assert(!isValidKeyFormat('moltbook_' + 'a'.repeat(64)), 'isValidKeyFormat rejects wrong prefix');
  assert(!isValidKeyFormat('embook_short'), 'isValidKeyFormat rejects short body');
  assert(!isValidKeyFormat('embook_' + 'z'.repeat(64)), 'isValidKeyFormat rejects non-hex body');

  const hash = await hashApiKey(key);
  assert(typeof hash === 'string', 'hashApiKey returns string');
  assert(hash.startsWith('$2b$'), 'hashApiKey produces bcrypt output');
  assert(hash !== key, 'hashApiKey does not return plaintext');

  assert(await verifyApiKey(key, hash), 'verifyApiKey accepts correct key');
  assert(!await verifyApiKey(key2, hash), 'verifyApiKey rejects wrong key');
  assert(!await verifyApiKey('', hash), 'verifyApiKey rejects empty key');
  assert(!await verifyApiKey(null, hash), 'verifyApiKey rejects null key');

  const lookup1 = keyLookupHash(key);
  const lookup2 = keyLookupHash(key);
  assert(lookup1 === lookup2, 'keyLookupHash is deterministic');
  assert(lookup1.length === 64, 'keyLookupHash produces 64-char SHA-256');
  assert(lookup1 !== keyLookupHash(key2), 'keyLookupHash differs for different keys');
}

// ─── tokens.js tests ─────────────────────────────────────────────────────────

async function testTokens() {
  console.log('\n[tokens.js]');

  const agent = { id: 'agent-uuid-0001', name: 'testagent' };
  const token = issueToken(agent);

  assert(typeof token === 'string', 'issueToken returns a string');
  assert(token.split('.').length === 3, 'issueToken produces a 3-part JWT');

  const decoded = verifyToken(token);
  assert(decoded.sub === agent.id, 'verifyToken: sub matches agent.id');
  assert(decoded.name === agent.name, 'verifyToken: name claim present');
  assert(decoded.iss === 'embook-api', 'verifyToken: issuer is embook-api');
  assert(decoded.scope === 'api:read api:write', 'verifyToken: default scope correct');
  assert(typeof decoded.jti === 'string', 'verifyToken: jti (nonce) present');
  assert(decoded.exp - decoded.iat === TOKEN_EXPIRY_SECONDS,
    `verifyToken: expiry is exactly ${TOKEN_EXPIRY_SECONDS}s (15 min)`);

  // Custom scope
  const narrowToken = issueToken(agent, 'api:read');
  const narrowDecoded = verifyToken(narrowToken);
  assert(narrowDecoded.scope === 'api:read', 'issueToken: custom scope respected');

  // Two tokens for same agent should have different jtis
  const token2 = issueToken(agent);
  const decoded2 = verifyToken(token2);
  assert(decoded.jti !== decoded2.jti, 'issueToken: each token has unique jti');

  // Invalid token
  await assertThrows(
    () => { verifyToken('not.a.valid.jwt'); },
    'TOKEN_INVALID',
    'verifyToken rejects malformed token with TOKEN_INVALID'
  );

  // Tampered token
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'hacker', exp: 9999999999 })).toString('base64');
  const tampered = parts.join('.');
  await assertThrows(
    () => { verifyToken(tampered); },
    'TOKEN_INVALID',
    'verifyToken rejects tampered payload with TOKEN_INVALID'
  );

  // decodeToken (no verification)
  const decoded3 = decodeToken(token);
  assert(decoded3.sub === agent.id, 'decodeToken returns payload without verification');
  assert(decodeToken('bad') === null, 'decodeToken returns null for garbage input');
}

// ─── signing.js tests ────────────────────────────────────────────────────────

async function testSigning() {
  console.log('\n[signing.js]');

  const secret = 'embook_' + 'b3c4d5'.repeat(10) + 'aa';
  const body   = JSON.stringify({ channel: 'r/sitrep', content: 'test SitRep' });

  const sig = signBody(body, secret);
  assert(sig.startsWith('sha256='), "signBody output starts with 'sha256='");
  assert(sig.length === 71, 'signBody output is 71 chars (7 prefix + 64 hex)');

  // Deterministic
  assert(sig === signBody(body, secret), 'signBody is deterministic');

  // Different body or secret → different sig
  assert(sig !== signBody(body + ' x', secret), 'signBody differs with different body');
  assert(sig !== signBody(body, secret + 'x'), 'signBody differs with different secret');

  // verifySignature
  let result = verifySignature(body, secret, sig);
  assert(result.valid, 'verifySignature accepts correct signature');

  result = verifySignature(body + ' tampered', secret, sig);
  assert(!result.valid, 'verifySignature rejects tampered body');

  result = verifySignature(body, secret, 'sha256=' + 'f'.repeat(64));
  assert(!result.valid, 'verifySignature rejects wrong signature value');

  result = verifySignature(body, secret, 'bad_format');
  assert(!result.valid, 'verifySignature rejects bad signature format');

  result = verifySignature(body, secret, null);
  assert(!result.valid, 'verifySignature rejects missing signature');

  // verifyTimestamp
  const now = Math.floor(Date.now() / 1000);
  assert(verifyTimestamp(String(now)).valid, 'verifyTimestamp accepts current timestamp');
  assert(verifyTimestamp(String(now - 60)).valid, 'verifyTimestamp accepts 1-minute-old timestamp');
  assert(!verifyTimestamp(String(now - (SIGNATURE_MAX_AGE_SECONDS + 1))).valid,
    'verifyTimestamp rejects timestamp older than max age');
  assert(!verifyTimestamp(String(now + 60)).valid,
    'verifyTimestamp rejects timestamp >30s in the future');
  assert(!verifyTimestamp('not-a-number').valid, 'verifyTimestamp rejects non-numeric value');
  assert(!verifyTimestamp(null).valid, 'verifyTimestamp rejects null');

  // canonicalBody
  const obj = { z: 1, a: 2, m: 3 };
  const canonical = canonicalBody(obj);
  const reordered = canonicalBody({ a: 2, m: 3, z: 1 });
  assert(canonical === reordered, 'canonicalBody produces same output regardless of key order');
  assert(canonicalBody('') === '', 'canonicalBody handles empty string');
  assert(canonicalBody(null) === '', 'canonicalBody handles null');
}

// ─── encryption.js tests ─────────────────────────────────────────────────────

async function testEncryption() {
  console.log('\n[encryption.js]');

  // Generate two agent key pairs
  const agentA = generateKeyPair();
  const agentB = generateKeyPair();

  assert(isValidPublicKeyPem(agentA.publicKey), 'generateKeyPair produces valid PEM public key');
  assert(!isValidPublicKeyPem('not pem'), 'isValidPublicKeyPem rejects garbage');
  assert(!isValidPublicKeyPem(null), 'isValidPublicKeyPem rejects null');

  // Agent A encrypts a message for Agent B
  const plaintext = JSON.stringify({
    incident_id: 'INC-2026-001',
    phase:       'response',
    summary:     'Fire perimeter 2,500 acres. Containment 30%.',
    resources:   { engines: 12, personnel: 85 }
  });

  const envelope = encryptPayload(plaintext, agentB.publicKey);

  assert(envelope.encrypted === true, 'encryptPayload: encrypted flag set');
  assert(envelope.algorithm === 'AES-256-GCM+RSA-OAEP-SHA256', 'encryptPayload: correct algorithm label');
  assert(typeof envelope.encrypted_key === 'string', 'encryptPayload: encrypted_key present');
  assert(typeof envelope.ciphertext === 'string', 'encryptPayload: ciphertext present');
  assert(typeof envelope.iv === 'string', 'encryptPayload: IV present');
  assert(typeof envelope.auth_tag === 'string', 'encryptPayload: auth_tag present');
  assert(!envelope.ciphertext.includes('perimeter'), 'encryptPayload: plaintext not in ciphertext');
  assert(!JSON.stringify(envelope).includes('containment'), 'encryptPayload: content fully encrypted');

  // Agent B decrypts successfully
  const decrypted = decryptPayload(envelope, agentB.privateKey);
  assert(decrypted === plaintext, 'decryptPayload: Agent B decrypts correctly');
  assert(JSON.parse(decrypted).incident_id === 'INC-2026-001',
    'decryptPayload: decrypted payload is valid JSON with correct content');

  // Agent A (wrong key) cannot decrypt
  let caughtC = false;
  try { decryptPayload(envelope, agentA.privateKey); }
  catch { caughtC = true; }
  assert(caughtC, 'decryptPayload: Agent A (non-recipient) cannot decrypt');

  // Server cannot decrypt (it only has the envelope)
  // (same test — server has no private keys)

  // Envelope integrity: tampering with ciphertext detected by GCM auth tag
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.split('').reverse().join('') };
  let caughtTamper = false;
  try { decryptPayload(tampered, agentB.privateKey); }
  catch { caughtTamper = true; }
  assert(caughtTamper, 'decryptPayload: tampered ciphertext rejected by GCM auth tag');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('EMBook Auth Test Suite');
  console.log('='.repeat(50));

  await testKeys();
  await testTokens();
  await testSigning();
  await testEncryption();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
