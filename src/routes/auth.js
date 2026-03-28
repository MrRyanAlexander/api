/**
 * src/routes/auth.js
 *
 * Authentication endpoints.
 *
 *   POST /auth/token   — Exchange API key for a 15-minute RS256 JWT
 *   GET  /auth/jwks    — Return the server's public key (for external verifiers)
 */

const express    = require('express');
const router     = express.Router();

const AgentService            = require('../services/AgentService');
const { issueToken, getPublicKey, TOKEN_EXPIRY_SECONDS }
                              = require('../auth/tokens');
const { verifySignature, verifyTimestamp, canonicalBody, SIGNATURE_HEADER, TIMESTAMP_HEADER }
                              = require('../auth/signing');
const { logAuthSuccess, logAuthFailure } = require('../auth/audit');
const { isValidKeyFormat }    = require('../auth/keys');
const { UnauthorizedError, BadRequestError } = require('../utils/errors');
// response helpers available if needed: success, created, paginated, noContent
// const { success } = require('../utils/response');

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * POST /auth/token
 *
 * Exchange an API key + HMAC signature for a session JWT.
 *
 * Request body:
 *   { "api_key": "embook_..." }
 *
 * Required headers:
 *   X-EMBook-Signature: sha256=<hmac of request body using api_key as secret>
 *   X-EMBook-Timestamp: <unix timestamp in seconds>
 *
 * Response:
 *   {
 *     "token": "<jwt>",
 *     "expires_in": 900,
 *     "token_type": "Bearer"
 *   }
 */
router.post('/token', async (req, res, next) => {
  const ip = clientIp(req);

  try {
    const { api_key } = req.body;

    if (!api_key) {
      logAuthFailure('Missing api_key in request body', ip);
      throw new BadRequestError('api_key is required in the request body');
    }

    if (!isValidKeyFormat(api_key)) {
      logAuthFailure('Invalid api_key format', ip);
      throw new UnauthorizedError(
        'Invalid API key format',
        'Key must start with embook_ followed by 64 hex characters'
      );
    }

    // Validate timestamp (replay protection)
    const tsResult = verifyTimestamp(req.headers[TIMESTAMP_HEADER]);
    if (!tsResult.valid) {
      logAuthFailure(tsResult.reason, ip);
      throw new UnauthorizedError(
        tsResult.reason,
        'Include X-EMBook-Timestamp: <unix_seconds> in the request headers'
      );
    }

    // Verify HMAC signature of the request body using the api_key as secret
    const body      = canonicalBody(req.body);
    const sigResult = verifySignature(body, api_key, req.headers[SIGNATURE_HEADER]);
    if (!sigResult.valid) {
      logAuthFailure(`HMAC verification failed: ${sigResult.reason}`, ip);
      throw new UnauthorizedError(
        'Request signature verification failed',
        'Sign the request body with HMAC-SHA256 using your API key and include it in X-EMBook-Signature'
      );
    }

    // Look up the agent by API key (uses bcrypt for verification)
    const agent = await AgentService.findByApiKey(api_key);
    if (!agent) {
      logAuthFailure('API key not found or invalid', ip);
      throw new UnauthorizedError(
        'Invalid API key',
        'Check your API key or contact the network operator'
      );
    }

    // Issue session token
    const token = issueToken(agent);
    logAuthSuccess(agent.id, ip);

    return res.status(200).json({
      success:    true,
      token,
      expires_in: TOKEN_EXPIRY_SECONDS,
      token_type: 'Bearer',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/jwks
 *
 * Returns the server's RSA public key in PEM format.
 * External services can use this to verify EMBook-issued JWTs without contacting
 * the API on every request.
 */
router.get('/jwks', (req, res) => {
  res.json({
    success:     true,
    public_key:  getPublicKey(),
    algorithm:   'RS256',
    description: 'Use this public key to verify EMBook session tokens (JWTs).',
  });
});

module.exports = router;
