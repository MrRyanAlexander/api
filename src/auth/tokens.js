/**
 * src/auth/tokens.js
 *
 * JWT session token issuance and verification for EMBook.
 *
 * Design:
 *  - RS256 asymmetric signing: private key signs tokens, public key verifies.
 *    This means the public key can be distributed to third-party services that
 *    need to verify tokens without ever seeing the signing key.
 *  - 15-minute expiry as specified in the build plan.
 *  - Tokens are scoped: the `scope` claim restricts which operations the token
 *    authorises (e.g. "api:read api:write" vs a narrower "api:read").
 *  - The `jti` (JWT ID) claim is a random nonce — useful for future revocation.
 *
 * Key management:
 *  - Keys are loaded from PEM files whose paths are set via environment variables:
 *      JWT_PRIVATE_KEY_PATH   (default: keys/jwt_private.pem)
 *      JWT_PUBLIC_KEY_PATH    (default: keys/jwt_public.pem)
 *  - The generate-keys.js script (scripts/) creates these files on first deploy.
 *  - In development, if no key files are found, ephemeral in-process keys are
 *    generated automatically so the server starts cleanly without manual setup.
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');

const TOKEN_EXPIRY_SECONDS = 15 * 60;   // 15 minutes
const ALGORITHM            = 'RS256';
const ISSUER               = 'embook-api';

// ─── Key loading ─────────────────────────────────────────────────────────────

let _privateKey = null;
let _publicKey  = null;

/**
 * Load RSA key pair from disk (or environment variables).
 * Called lazily on first use so the module can be imported without side-effects.
 */
function loadKeys() {
  if (_privateKey && _publicKey) return;

  // Support injecting key material directly via env (useful in containers)
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY) {
    _privateKey = process.env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
    _publicKey  = process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
    return;
  }

  const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH
    || path.join(process.cwd(), 'keys', 'jwt_private.pem');
  const publicKeyPath  = process.env.JWT_PUBLIC_KEY_PATH
    || path.join(process.cwd(), 'keys', 'jwt_public.pem');

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    _privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    _publicKey  = fs.readFileSync(publicKeyPath,  'utf8');
    return;
  }

  // Development fallback: generate an ephemeral key pair in memory.
  // This is NOT safe for production — the operator README documents why.
  if (process.env.NODE_ENV !== 'production') {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength:    2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    _privateKey = privateKey;
    _publicKey  = publicKey;
    console.warn('[tokens] WARNING: using ephemeral RSA key pair. Run scripts/generate-keys.js to persist keys.');
    return;
  }

  throw new Error(
    'JWT key files not found. Set JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH or ' +
    'run scripts/generate-keys.js to create them.'
  );
}

// ─── Token issuance ──────────────────────────────────────────────────────────

/**
 * Issue a scoped session token for a verified agent.
 *
 * @param {Object} agent               Agent record from the database
 * @param {string} agent.id            Agent UUID
 * @param {string} agent.name          Agent name
 * @param {string} [scope='api:read api:write']  Space-separated scope string
 * @returns {string}  Signed JWT
 */
function issueToken(agent, scope = 'api:read api:write') {
  loadKeys();

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    sub:   agent.id,
    name:  agent.name,
    scope,
    iss:   ISSUER,
    iat:   now,
    exp:   now + TOKEN_EXPIRY_SECONDS,
    jti:   crypto.randomBytes(16).toString('hex'),
  };

  return jwt.sign(payload, _privateKey, { algorithm: ALGORITHM });
}

/**
 * Verify a JWT and return the decoded payload.
 * Throws if the token is expired, malformed, or has a bad signature.
 *
 * @param {string} token  Raw JWT string
 * @returns {Object}      Decoded payload
 * @throws {Error}        With a `code` property:
 *                          TOKEN_EXPIRED     — past expiry
 *                          TOKEN_INVALID     — bad signature / malformed
 */
function verifyToken(token) {
  loadKeys();

  try {
    return jwt.verify(token, _publicKey, {
      algorithms: [ALGORITHM],
      issuer:     ISSUER,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('Session token expired');
      e.code  = 'TOKEN_EXPIRED';
      throw e;
    }
    const e = new Error('Invalid session token');
    e.code  = 'TOKEN_INVALID';
    throw e;
  }
}

/**
 * Decode a JWT without verifying the signature.
 * Safe to use for logging/debugging only — never for authorisation.
 *
 * @param {string} token
 * @returns {Object|null}
 */
function decodeToken(token) {
  return jwt.decode(token);
}

/**
 * Return the public key PEM — used by external verifiers.
 * @returns {string}
 */
function getPublicKey() {
  loadKeys();
  return _publicKey;
}

module.exports = {
  issueToken,
  verifyToken,
  decodeToken,
  getPublicKey,
  TOKEN_EXPIRY_SECONDS,
};
