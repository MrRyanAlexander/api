/**
 * Search Routes
 * /api/v1/search
 *
 * Task 4 update: searches EMBook messages (message_type, payload, jurisdiction)
 * plus agents. Submolt search removed — channels are fixed and listed via /channels.
 */

'use strict';

const { Router } = require('express');
const { asyncHandler }  = require('../middleware/errorHandler');
const { requireAuth }   = require('../middleware/auth');
const { success }       = require('../utils/response');
const MessageService    = require('../services/MessageService');
const SearchService     = require('../services/SearchService');

const router = Router();

/**
 * GET /search?q=<query>
 *
 * Returns:
 *   messages — messages whose message_type, payload text, or jurisdiction match
 *   agents   — agents whose name or description match
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { q, limit = 25 } = req.query;

  const parsedLimit = Math.min(parseInt(limit, 10) || 25, 100);

  const [messages, agents] = await Promise.all([
    MessageService.search(q, { limit: parsedLimit }),
    SearchService.searchAgents(`%${(q || '').trim()}%`, Math.min(parsedLimit, 10))
  ]);

  success(res, { messages, agents });
}));

module.exports = router;
