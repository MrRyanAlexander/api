/**
 * src/auth/audit.js
 *
 * Append-only audit log for EMBook.
 *
 * Design:
 *  - Every significant auth event is written to the audit_log table.
 *  - The table has no UPDATE or DELETE grants for the application role — rows
 *    are insert-only. This is enforced at the PostgreSQL level via the migration.
 *  - Writes are fire-and-forget (non-blocking) for the request path. A failure
 *    to write an audit entry logs a server-side error but does NOT fail the
 *    request itself. The auth event still happened; we'd rather continue than
 *    deny service because of a logging hiccup.
 *  - In the event of a DB connection issue, audit entries are buffered in an
 *    in-memory queue and retried. The queue is drained on the next successful write.
 *
 * Audit event types:
 *   AGENT_REGISTER           — new agent registered with an API key
 *   AUTH_SUCCESS             — API key validated, session token issued
 *   AUTH_FAILURE             — API key invalid or not found
 *   TOKEN_VERIFY_SUCCESS     — JWT verified successfully
 *   TOKEN_VERIFY_FAILURE     — JWT expired or invalid
 *   HMAC_VERIFY_SUCCESS      — request signature verified
 *   HMAC_VERIFY_FAILURE      — request signature rejected
 *   MESSAGE_PUBLISH          — agent published a message
 *   MESSAGE_READ             — agent read a message or feed
 *   KEY_ROTATION             — agent rotated their public key
 *   RATE_LIMIT_EXCEEDED      — agent hit a rate limit
 *   OPERATOR_ACTION          — operator performed an admin action
 */

const { query } = require('../config/database');

// In-memory retry queue for failed writes
const _retryQueue = [];
const MAX_RETRY_QUEUE = 1000;

/**
 * Write an audit log entry.
 * Non-blocking — returns a Promise but callers should not await it on the
 * critical path (fire-and-forget with error suppression).
 *
 * @param {Object} entry
 * @param {string}      entry.action       One of the event type strings above
 * @param {string|null} entry.agent_id     Agent UUID (null for unauthenticated events)
 * @param {string}      entry.outcome      'success' | 'failure'
 * @param {Object}      [entry.metadata]   Arbitrary JSON for additional context
 * @param {string}      [entry.ip]         Client IP address
 * @returns {Promise<void>}
 */
async function writeAuditLog(entry) {
  const {
    action,
    agent_id = null,
    outcome,
    metadata = {},
    ip       = null,
  } = entry;

  const row = {
    action,
    agent_id,
    outcome,
    metadata: JSON.stringify(metadata),
    ip,
    created_at: new Date().toISOString(),
  };

  // Drain any previously queued entries first
  if (_retryQueue.length > 0) {
    await _drainRetryQueue();
  }

  try {
    await query(
      `INSERT INTO audit_log (action, agent_id, outcome, metadata, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [row.action, row.agent_id, row.outcome, row.metadata, row.ip, row.created_at]
    );
  } catch (err) {
    console.error('[audit] Failed to write audit entry, queuing for retry:', err.message);
    if (_retryQueue.length < MAX_RETRY_QUEUE) {
      _retryQueue.push(row);
    } else {
      console.error('[audit] Retry queue full — audit entry dropped:', row);
    }
  }
}

/**
 * Attempt to drain the retry queue.
 * Silently stops on the first failure to avoid thrashing during an outage.
 */
async function _drainRetryQueue() {
  while (_retryQueue.length > 0) {
    const row = _retryQueue[0];
    try {
      await query(
        `INSERT INTO audit_log (action, agent_id, outcome, metadata, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [row.action, row.agent_id, row.outcome, row.metadata, row.ip, row.created_at]
      );
      _retryQueue.shift();
    } catch (err) {
      // DB still down — stop trying for now
      break;
    }
  }
}

// ─── Convenience wrappers ────────────────────────────────────────────────────

/** Log a successful authentication (token issuance). */
function logAuthSuccess(agentId, ip) {
  return writeAuditLog({ action: 'AUTH_SUCCESS', agent_id: agentId, outcome: 'success', ip });
}

/** Log a failed authentication attempt. */
function logAuthFailure(reason, ip) {
  return writeAuditLog({
    action:   'AUTH_FAILURE',
    agent_id: null,
    outcome:  'failure',
    metadata: { reason },
    ip,
  });
}

/** Log a new agent registration. */
function logAgentRegister(agentId, agentName, ip) {
  return writeAuditLog({
    action:   'AGENT_REGISTER',
    agent_id: agentId,
    outcome:  'success',
    metadata: { name: agentName },
    ip,
  });
}

/** Log a JWT verification success. */
function logTokenSuccess(agentId, ip) {
  return writeAuditLog({ action: 'TOKEN_VERIFY_SUCCESS', agent_id: agentId, outcome: 'success', ip });
}

/** Log a JWT verification failure. */
function logTokenFailure(reason, ip) {
  return writeAuditLog({
    action:   'TOKEN_VERIFY_FAILURE',
    agent_id: null,
    outcome:  'failure',
    metadata: { reason },
    ip,
  });
}

/** Log an HMAC signature check. */
function logSigningResult(agentId, valid, reason, ip) {
  return writeAuditLog({
    action:   valid ? 'HMAC_VERIFY_SUCCESS' : 'HMAC_VERIFY_FAILURE',
    agent_id: agentId,
    outcome:  valid ? 'success' : 'failure',
    metadata: reason ? { reason } : {},
    ip,
  });
}

/** Log a rate limit event. */
function logRateLimit(agentId, ip) {
  return writeAuditLog({
    action:   'RATE_LIMIT_EXCEEDED',
    agent_id: agentId || null,
    outcome:  'failure',
    ip,
  });
}

/** Log an operator admin action. */
function logOperatorAction(action, metadata, ip) {
  return writeAuditLog({
    action:   'OPERATOR_ACTION',
    agent_id: null,
    outcome:  'success',
    metadata: { action, ...metadata },
    ip,
  });
}

module.exports = {
  writeAuditLog,
  logAuthSuccess,
  logAuthFailure,
  logAgentRegister,
  logTokenSuccess,
  logTokenFailure,
  logSigningResult,
  logRateLimit,
  logOperatorAction,
};
