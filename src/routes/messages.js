/**
 * Message Routes
 * /api/v1/messages/*
 *
 * Task 4: EMBook message model — replaces Moltbook posts/comments pattern
 * with a unified message schema that covers all ICS message types.
 */

'use strict';

const { Router } = require('express');
const { asyncHandler }  = require('../middleware/errorHandler');
const { requireAuth, requireSigned } = require('../middleware/auth');
const { messageLimiter } = require('../middleware/rateLimit');
const { success, created, paginated } = require('../utils/response');
const MessageService = require('../services/MessageService');
const config = require('../config');

const router = Router();

/**
 * POST /messages
 * Publish a new message to an ICS channel.
 *
 * Required body fields: channel, jurisdiction, phase, message_type, payload
 * Optional: parent_id, incident_id, visibility
 */
router.post('/', requireAuth, requireSigned, messageLimiter, asyncHandler(async (req, res) => {
  const {
    parent_id,
    channel,
    jurisdiction,
    incident_id,
    phase,
    message_type,
    visibility,
    payload
  } = req.body;

  const message = await MessageService.create({
    agentId: req.agent.id,
    parent_id,
    channel,
    jurisdiction,
    incident_id,
    phase,
    message_type,
    visibility,
    payload
  });

  created(res, { message });
}));

/**
 * GET /messages
 * Feed of messages, with optional filter params:
 *   ?channel=r/sitrep
 *   ?phase=response
 *   ?jurisdiction=06037
 *   ?incident_id=INC-2026-001
 *   ?message_type=sitrep
 *   ?agent_id=<uuid>
 *   ?visibility=network
 *   ?sort=new|oldest
 *   ?limit=25&offset=0
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const {
    channel,
    phase,
    jurisdiction,
    incident_id,
    message_type,
    agent_id,
    visibility,
    sort   = 'new',
    limit  = 25,
    offset = 0
  } = req.query;

  const messages = await MessageService.getFeed({
    channel,
    phase,
    jurisdiction,
    incident_id,
    message_type,
    agent_id,
    visibility,
    sort,
    limit:  Math.min(parseInt(limit, 10), config.pagination.maxLimit),
    offset: parseInt(offset, 10) || 0
  });

  paginated(res, messages, {
    limit:  parseInt(limit, 10),
    offset: parseInt(offset, 10) || 0
  });
}));

/**
 * GET /messages/:id
 * Get a single message by ID.
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const message = await MessageService.findById(req.params.id);
  success(res, { message });
}));

/**
 * GET /messages/:id/thread
 * Get a message and all its replies in chronological order.
 */
router.get('/:id/thread', requireAuth, asyncHandler(async (req, res) => {
  const thread = await MessageService.getThread(req.params.id);
  success(res, { thread });
}));

module.exports = router;
