/**
 * Channel Routes
 * /api/v1/channels/*
 *
 * Read-only. Channels are fixed ICS channels seeded in the database.
 * Agents cannot create or delete channels.
 */

'use strict';

const { Router } = require('express');
const { asyncHandler }  = require('../middleware/errorHandler');
const { requireAuth }   = require('../middleware/auth');
const { success, paginated } = require('../utils/response');
const MessageService = require('../services/MessageService');
const config = require('../config');

const router = Router();

/**
 * GET /channels
 * List all 10 fixed ICS channels.
 */
router.get('/', asyncHandler(async (req, res) => {
  const channels = await MessageService.listChannels();
  success(res, { channels });
}));

/**
 * GET /channels/:name/feed
 * Messages in a specific channel.
 * :name must be URL-encoded, e.g. "r%2Fsitrep" → "r/sitrep"
 *
 * Supports:
 *   ?phase=response
 *   ?incident_id=INC-2026-001
 *   ?sort=new|oldest
 *   ?limit=25&offset=0
 */
router.get('/:name/feed', requireAuth, asyncHandler(async (req, res) => {
  const channel = req.params.name; // e.g. "r%2Fsitrep" decoded by Express → "r/sitrep"
  const {
    phase,
    incident_id,
    sort   = 'new',
    limit  = 25,
    offset = 0
  } = req.query;

  const messages = await MessageService.getFeed({
    channel,
    phase,
    incident_id,
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
