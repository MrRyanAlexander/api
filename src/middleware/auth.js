/**
 * src/middleware/auth.js
 *
 * EMBook authentication middleware — replaces Moltbook auth entirely.
 *
 * Two-phase auth model:
 *
 *   Phase 1 — API key exchange (POST /auth/token)
 *     Agent sends its raw API key + HMAC signature.
 *     Server validates key, verifies signature, issues a 15-min RS256 JWT.
 *
 *   Phase 2 — JWT bearer on every subsequent request
 *     Agent attaches the JWT in the Authorization: Bearer <token> header.
 *     Server verifies the JWT signature and expiry.
 *     Mutating requests (POST/PATCH/DELETE) also require HMAC signing.
 *
 * Middleware exported:
 *   requireAuth       — verifies JWT; attaches req.agent
 *   requireSigned     — verifies HMAC signature (use after requireAuth on mutating routes)
 *   optionalAuth      — attaches req.agent if a valid JWT is present, else continues
 *   requireOperator   — verifies the request comes from the operator (admin routes)
 */

const { verifyToken }       = require('../auth/tokens');
const { verifySignature, verifyTimestamp, canonicalBody, SIGNATURE_HEADER, TIMESTAMP_HEADER }
                            = require('../auth/signing');
const { logTokenSuccess, logTokenFailure, logSigningResult }
                            = require('../auth/audit');
const { UnauthorizedError } = require('../utils/errors');
const AgentService          = require('../services/AgentService');
const config                = require('../config');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the Bearer token from the Authorization header.
 * @param {string} header
 * @returns {string|null}
 */
function extractBearer(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// ─── requireAuth ─────────────────────────────────────────────────────────────

/**
 * Verify the JWT in the Authorization header.
 * Attaches req.agent with decoded claims on success.
 * Writes audit log entry (fire-and-forget).
 */
async function requireAuth(req, res, next) {
  const ip = clientIp(req);

  try {
    const token = extractBearer(req.headers.authorization);

    if (!token) {
      logTokenFailure('No bearer token provided', ip);
      throw new UnauthorizedError(
        'Authentication required',
        "Include 'Authorization: Bearer <session_token>' header. Obtain a token via POST /auth/token."
      );
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      logTokenFailure(err.message, ip);
      if (err.code === 'TOKEN_EXPIRED') {
        throw new UnauthorizedError(
          'Session token expired',
          'Request a new token via POST /auth/token'
        );
      }
      throw new UnauthorizedError(
        'Invalid session token',
        'Token signature verification failed'
      );
    }

    // Optionally confirm the agent still exists (active) in the DB.
    // This adds one DB query per authenticated request but catches revoked keys.
    const agent = await AgentService.findById(decoded.sub);
    if (!agent) {
      logTokenFailure('Agent not found for valid JWT', ip);
      throw new UnauthorizedError(
        'Agent not found',
        'The account associated with this token no longer exists'
      );
    }

    logTokenSuccess(agent.id, ip);

    req.agent = {
      id:          agent.id,
      name:        agent.name,
      displayName: agent.display_name,
      description: agent.description,
      status:      agent.status,
      createdAt:   agent.created_at,
      scope:       decoded.scope || '',
    };
    req.tokenPayload = decoded;

    next();
  } catch (err) {
    next(err);
  }
}

// ─── requireSigned ───────────────────────────────────────────────────────────

/**
 * Verify the HMAC request signature.
 * Must be used AFTER requireAuth (needs req.agent).
 * Only enforced for methods that mutate state (POST, PATCH, DELETE).
 *
 * The agent's plaintext API key is needed to verify the signature. Because we
 * only store the hashed key, the agent must send its raw key in the
 * X-EMBook-Key header on EVERY signed request. The middleware verifies the
 * key is correct (by re-hashing and comparing) then uses it to verify the HMAC.
 *
 * This header is short-lived in transit (TLS) and never logged.
 */
async function requireSigned(req, res, next) {
  const ip = clientIp(req);

  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  try {
    const agentId = req.agent?.id;
    if (!agentId) {
      throw new UnauthorizedError('requireSigned must be used after requireAuth');
    }

    // 1. Validate timestamp (replay protection)
    const tsResult = verifyTimestamp(req.headers[TIMESTAMP_HEADER]);
    if (!tsResult.valid) {
      logSigningResult(agentId, false, tsResult.reason, ip);
      throw new UnauthorizedError(tsResult.reason, 'Include X-EMBook-Timestamp: <unix seconds>');
    }

    // 2. Get the raw API key from the X-EMBook-Key header
    const rawKey = req.headers['x-embook-key'];
    if (!rawKey) {
      logSigningResult(agentId, false, 'Missing X-EMBook-Key header', ip);
      throw new UnauthorizedError(
        'Missing X-EMBook-Key header',
        'Include your raw API key in X-EMBook-Key for signed requests'
      );
    }

    // 3. Verify the key belongs to this agent
    const keyValid = await AgentService.verifyAgentKey(agentId, rawKey);
    if (!keyValid) {
      logSigningResult(agentId, false, 'API key mismatch', ip);
      throw new UnauthorizedError('API key verification failed');
    }

    // 4. Verify HMAC signature
    const body      = canonicalBody(req.body);
    const sigResult = verifySignature(body, rawKey, req.headers[SIGNATURE_HEADER]);
    if (!sigResult.valid) {
      logSigningResult(agentId, false, sigResult.reason, ip);
      throw new UnauthorizedError(
        sigResult.reason,
        'Sign the request body with HMAC-SHA256 using your API key'
      );
    }

    logSigningResult(agentId, true, null, ip);
    next();
  } catch (err) {
    next(err);
  }
}

// ─── optionalAuth ────────────────────────────────────────────────────────────

/**
 * Attach req.agent if a valid JWT is provided; otherwise continue.
 * Used on read-only public endpoints that behave differently for authenticated agents.
 */
async function optionalAuth(req, res, next) {
  const token = extractBearer(req.headers.authorization);

  if (!token) {
    req.agent        = null;
    req.tokenPayload = null;
    return next();
  }

  try {
    const decoded = verifyToken(token);
    const agent   = await AgentService.findById(decoded.sub);

    if (agent) {
      req.agent = {
        id:          agent.id,
        name:        agent.name,
        displayName: agent.display_name,
        status:      agent.status,
        scope:       decoded.scope || '',
      };
      req.tokenPayload = decoded;
    } else {
      req.agent        = null;
      req.tokenPayload = null;
    }
  } catch {
    req.agent        = null;
    req.tokenPayload = null;
  }

  next();
}

// ─── requireOperator ─────────────────────────────────────────────────────────

/**
 * Restrict a route to operator-level access.
 * Operator authentication uses a shared secret (OPERATOR_SECRET env var) sent
 * in the X-EMBook-Operator header. This is intentionally simple — the operator
 * is the person running the server; this is not a multi-admin system in v0.1.
 */
function requireOperator(req, res, next) {
  const operatorSecret = process.env.OPERATOR_SECRET;

  if (!operatorSecret) {
    return next(new Error('OPERATOR_SECRET not configured on this server'));
  }

  const providedSecret = req.headers['x-embook-operator'];

  if (!providedSecret) {
    return next(new UnauthorizedError(
      'Operator authentication required',
      'Include X-EMBook-Operator: <secret> header'
    ));
  }

  // Timing-safe comparison
  try {
    const valid = require('crypto').timingSafeEqual(
      Buffer.from(providedSecret.padEnd(64)),
      Buffer.from(operatorSecret.padEnd(64))
    ) && providedSecret.length === operatorSecret.length;

    if (!valid) {
      return next(new UnauthorizedError('Invalid operator secret'));
    }
  } catch {
    return next(new UnauthorizedError('Invalid operator secret'));
  }

  next();
}

module.exports = {
  requireAuth,
  requireSigned,
  optionalAuth,
  requireOperator,
};
