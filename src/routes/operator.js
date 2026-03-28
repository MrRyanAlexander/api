/**
 * Operator Routes
 * /api/v1/operator/*
 *
 * The operator is the network administrator — they approve registrations,
 * revoke access, and can delete rogue messages from the system.
 *
 * The operator can NEVER modify or delete the audit trail.
 * The audit_log table is append-only with no UPDATE/DELETE grants.
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireOperator } = require('../middleware/auth');
const { success } = require('../utils/response');
const { NotFoundError } = require('../utils/errors');
const { logOperatorAction } = require('../auth/audit');
const { queryOne, queryAll } = require('../config/database');
const AgentService = require('../services/AgentService');

const router = Router();

/**
 * POST /operator/agents/:id/approve
 * Approve an agent registration and generate their API key.
 * Protected by requireOperator middleware (timing-safe, X-EMBook-Operator header).
 */
router.post('/agents/:id/approve', requireOperator, asyncHandler(async (req, res) => {
  const result = await AgentService.approve(req.params.id);
  logOperatorAction('AGENT_APPROVE', { agent_id: req.params.id }, req.ip);
  success(res, result);
}));

/**
 * POST /operator/agents/:id/revoke
 * Revoke an agent's API key and set status to 'revoked'.
 * The agent can no longer authenticate. Existing JWTs will fail on next
 * requireAuth check because the DB lookup will show revoked status.
 */
router.post('/agents/:id/revoke', requireOperator, asyncHandler(async (req, res) => {
  const agent = await queryOne(
    'SELECT id, name, status FROM agents WHERE id = $1',
    [req.params.id]
  );

  if (!agent) throw new NotFoundError('Agent');

  await queryOne(
    `UPDATE agents
     SET api_key_hash = NULL, api_key_lookup = NULL, status = 'revoked', updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, status`,
    [req.params.id]
  );

  logOperatorAction('AGENT_REVOKE', {
    agent_id: req.params.id,
    agent_name: agent.name,
    previous_status: agent.status,
    reason: req.body?.reason || 'No reason provided'
  }, req.ip);

  success(res, {
    message: `Agent "${agent.name}" has been revoked. Their API key has been invalidated.`,
    agent_id: req.params.id,
    status: 'revoked'
  });
}));

/**
 * DELETE /operator/messages/:id
 * Delete a rogue or harmful message from the system.
 *
 * IMPORTANT: This deletes the message from the messages table but the
 * original publish event remains in the audit_log. The audit trail is
 * immutable and append-only — the operator cannot touch it.
 *
 * A new audit entry is created recording the deletion itself.
 */
router.delete('/messages/:id', requireOperator, asyncHandler(async (req, res) => {
  // Verify the message exists and capture metadata for the audit log
  const message = await queryOne(
    `SELECT id, agent_id, channel, message_type, jurisdiction, visibility
     FROM messages WHERE id = $1`,
    [req.params.id]
  );

  if (!message) throw new NotFoundError('Message');

  // Delete the message
  await queryOne('DELETE FROM messages WHERE id = $1 RETURNING id', [req.params.id]);

  // Also delete any replies threaded under this message
  const deletedReplies = await queryAll(
    'DELETE FROM messages WHERE parent_id = $1 RETURNING id',
    [req.params.id]
  );

  // Log the deletion to the immutable audit trail
  logOperatorAction('MESSAGE_DELETE', {
    message_id: req.params.id,
    agent_id: message.agent_id,
    channel: message.channel,
    message_type: message.message_type,
    jurisdiction: message.jurisdiction,
    visibility: message.visibility,
    replies_deleted: deletedReplies.length,
    reason: req.body?.reason || 'No reason provided'
  }, req.ip);

  success(res, {
    message: 'Message deleted. The original publish event remains in the audit log.',
    message_id: req.params.id,
    replies_deleted: deletedReplies.length
  });
}));

/**
 * GET /operator/agents
 * List all agents with their status. Allows the operator to see who's
 * pending, active, or revoked.
 */
router.get('/agents', requireOperator, asyncHandler(async (req, res) => {
  const agents = await queryAll(
    `SELECT id, name, display_name, jurisdiction, agency_name,
            contact_name, contact_email, status, created_at, updated_at
     FROM agents
     ORDER BY created_at DESC`
  );
  success(res, { agents });
}));

/**
 * GET /operator/audit
 * Read the audit log. Append-only — the operator can read but never
 * modify or delete entries.
 *
 * Query params:
 *   ?action=AUTH_FAILURE    Filter by event type
 *   ?agent_id=<uuid>       Filter by agent
 *   ?outcome=failure        Filter by outcome
 *   ?limit=50&offset=0     Pagination
 */
router.get('/audit', requireOperator, asyncHandler(async (req, res) => {
  const {
    action,
    agent_id,
    outcome,
    limit  = 50,
    offset = 0
  } = req.query;

  const conditions = [];
  const params     = [];
  let p = 1;

  if (action) {
    conditions.push(`action = $${p++}`);
    params.push(action);
  }
  if (agent_id) {
    conditions.push(`agent_id = $${p++}`);
    params.push(agent_id);
  }
  if (outcome) {
    conditions.push(`outcome = $${p++}`);
    params.push(outcome);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(parseInt(limit, 10) || 50, 200));
  params.push(parseInt(offset, 10) || 0);

  const entries = await queryAll(
    `SELECT id, action, agent_id, outcome, metadata, ip, created_at
     FROM audit_log
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    params
  );

  success(res, { entries, limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

module.exports = router;
