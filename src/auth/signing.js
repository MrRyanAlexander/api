/**
 * src/auth/signing.js
 *
 * HMAC request signing and verification for EMBook.
 *
 * Design:
 *  - Every mutating API call (POST/PATCH/DELETE) must include an HMAC-SHA256
 *    digest of the request body, signed with the agent's raw API key.
 *  - The digest is sent in the X-EMBook-Signature header as:
 *        sha256=<hex-digest>
 *  - The server recomputes the digest and compares using a timing-safe equality
 *    check, preventing timing attacks.
 *  - A replay-protection timestamp header (X-EMBook-Timestamp) is also required.
 *    Requests older than SIGNATURE_MAX_AGE_SECONDS are rejected.
 *
 * Agent signing flow (how agents call the API):
 *  1. Serialise the request body to JSON (canonical, stable key order).
 *  2. HMAC-SHA256 the JSON string with the raw API key.
 *  3. Add headers:
 *       X-EMBook-Signature: sha256=<hex>
 *       X-EMBook-Timestamp: <unix seconds as string>
 *  4. Send the request with those headers alongside the JWT in Authorization.
 */

const crypto = require('crypto');

const SIGNATURE_HEADER    = 'x-embook-signature';
const TIMESTAMP_HEADER    = 'x-embook-timestamp';
const SIGNATURE_PREFIX    = 'sha256=';
const SIGNATURE_MAX_AGE_SECONDS = 300; // 5 minutes replay window

/**
 * Compute an HMAC-SHA256 signature over a body string.
 *
 * @param {string} bodyString  Raw JSON string of the request body
 * @param {string} secret      Agent's plaintext API key
 * @returns {string}           Header value, e.g. "sha256=a3b9..."
 */
function signBody(bodyString, secret) {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(bodyString || '')
    .digest('hex');
  return `${SIGNATURE_PREFIX}${mac}`;
}

/**
 * Verify the HMAC signature on an incoming request.
 *
 * @param {string} bodyString        Raw body string (from req.body before JSON parse,
 *                                   or re-serialised from req.body)
 * @param {string} secret            Agent's plaintext API key
 * @param {string} signatureHeader   Value of X-EMBook-Signature header
 * @returns {{ valid: boolean, reason: string|null }}
 */
function verifySignature(bodyString, secret, signatureHeader) {
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing X-EMBook-Signature header' };
  }

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { valid: false, reason: 'Signature header must start with sha256=' };
  }

  const expected = signBody(bodyString, secret);

  // Timing-safe comparison
  if (expected.length !== signatureHeader.length) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  const safeEqual = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );

  if (!safeEqual) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true, reason: null };
}

/**
 * Validate the X-EMBook-Timestamp header.
 * Rejects requests that are too old or have a timestamp in the future
 * (with a small 30-second clock-skew allowance).
 *
 * @param {string|number} timestampHeader  Value of X-EMBook-Timestamp
 * @returns {{ valid: boolean, reason: string|null }}
 */
function verifyTimestamp(timestampHeader) {
  if (!timestampHeader) {
    return { valid: false, reason: 'Missing X-EMBook-Timestamp header' };
  }

  const ts  = parseInt(timestampHeader, 10);
  if (isNaN(ts)) {
    return { valid: false, reason: 'X-EMBook-Timestamp must be a unix timestamp in seconds' };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - ts;

  // Allow 30s of future skew (clock drift)
  if (age < -30) {
    return { valid: false, reason: 'Request timestamp is too far in the future' };
  }

  if (age > SIGNATURE_MAX_AGE_SECONDS) {
    return { valid: false, reason: `Request timestamp is too old (max age: ${SIGNATURE_MAX_AGE_SECONDS}s)` };
  }

  return { valid: true, reason: null };
}

/**
 * Re-serialise a parsed body object to a canonical JSON string for signing.
 * Recursively sorts keys at every level of nesting to ensure agents produce
 * the same string regardless of the order they build the object.
 *
 * IMPORTANT: Uses a replacer *function* (not an array). A replacer array
 * filters keys at ALL nesting levels against the same list, which strips
 * nested object keys that aren't in the top-level key set. The function
 * approach sorts each object's own keys independently, preserving all data.
 *
 * @param {Object|string} body
 * @returns {string}
 */
function canonicalBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return JSON.stringify(body, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

module.exports = {
  signBody,
  verifySignature,
  verifyTimestamp,
  canonicalBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  SIGNATURE_MAX_AGE_SECONDS,
};
