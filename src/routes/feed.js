/**
 * Feed Routes
 * /api/v1/feed
 *
 * Task 4 update: now returns EMBook messages instead of Moltbook posts.
 * Supports all message filter dimensions.
 */

'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth }  = require('../middleware/auth');
const { paginated }    = require('../utils/response');
const MessageService   = require('../services/MessageService');
const config           = require('../config');

const router = Router();

/**
 * GET /feed
 * Unified message feed with optional filters.
 *
 * Query params (all optional, all combinable):
 *   ?channel=r/sitrep
 *   ?phase=response
 *   ?jurisdiction=06037
 *   ?incident_id=INC-2026-001
 *   ?message_type=sitrep
 *   ?agent_id=<uuid>
 *   ?visibility=network
 *   ?sort=new|oldest   (default: new)
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

module.exports = router;
