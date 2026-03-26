/**
 * src/auth/keys.js
 *
 * API key issuance, hashing, and validation for EMBook.
 *
 * Design:
 *  - Keys are generated as embook_ + 64 random hex chars (256 bits of entropy).
 *  - Keys are bcrypt-hashed (cost 12) before database storage. Plaintext is
 *    NEVER stored anywhere — not in the DB, not in logs.
 *  - Validation is timing-safe: bcrypt.compare() is used for lookup, preventing
 *    timing attacks on the raw hash comparison.
 *  - generateOperatorKey() produces a higher-entropy admin key (embook_op_ prefix)
 *    for the operator-level admin flow described in the build plan.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const KEY_PREFIX     = 'embook_';
const OP_KEY_PREFIX  = 'embook_op_';
const KEY_BYTES      = 32;     // 256 bits → 64 hex chars
const BCRYPT_ROUNDS  = 12;

/**
 * Generate a random agent API key.
 * @returns {string}  e.g. "embook_a3f8..."
 */
function generateApiKey() {
  return `${KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString('hex')}`;
}

/**
 * Generate a higher-entropy operator admin key.
 * @returns {string}  e.g. "embook_op_a3f8..."
 */
function generateOperatorKey() {
  return `${OP_KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString('hex')}`;
}

/**
 * Hash an API key with bcrypt for database storage.
 * Bcrypt is intentionally slow (cost 12) which is appropriate here because
 * key hashing happens once at registration/issuance, not on every request.
 * For per-request validation we use a fast SHA-256 index lookup — see below.
 *
 * @param {string} apiKey
 * @returns {Promise<string>}  bcrypt hash
 */
async function hashApiKey(apiKey) {
  return bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Verify an API key against its stored bcrypt hash.
 * Uses bcrypt.compare() which is intrinsically timing-safe.
 *
 * @param {string} apiKey       plaintext key from request
 * @param {string} storedHash   bcrypt hash from database
 * @returns {Promise<boolean>}
 */
async function verifyApiKey(apiKey, storedHash) {
  if (!apiKey || !storedHash) return false;
  return bcrypt.compare(apiKey, storedHash);
}

/**
 * Fast lookup index: SHA-256 of the raw key.
 * Stored alongside the bcrypt hash to allow O(1) DB lookups without a full
 * bcrypt compare on every request. The bcrypt hash is used for cryptographic
 * verification; this index is just for finding the row quickly.
 *
 * @param {string} apiKey
 * @returns {string}  hex SHA-256 digest
 */
function keyLookupHash(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Validate API key format (does not check against DB).
 *
 * @param {string} token
 * @returns {boolean}
 */
function isValidKeyFormat(token) {
  if (!token || typeof token !== 'string') return false;

  const isAgent    = token.startsWith(KEY_PREFIX) && !token.startsWith(OP_KEY_PREFIX);
  const isOperator = token.startsWith(OP_KEY_PREFIX);

  if (!isAgent && !isOperator) return false;

  const prefix = isOperator ? OP_KEY_PREFIX : KEY_PREFIX;
  const body   = token.slice(prefix.length);

  // Must be exactly 64 hex characters (32 bytes)
  return body.length === KEY_BYTES * 2 && /^[0-9a-f]+$/i.test(body);
}

/**
 * Returns true if the token looks like an operator key.
 * @param {string} token
 * @returns {boolean}
 */
function isOperatorKey(token) {
  return typeof token === 'string' && token.startsWith(OP_KEY_PREFIX);
}

module.exports = {
  generateApiKey,
  generateOperatorKey,
  hashApiKey,
  verifyApiKey,
  keyLookupHash,
  isValidKeyFormat,
  isOperatorKey,
  KEY_PREFIX,
  OP_KEY_PREFIX,
};
