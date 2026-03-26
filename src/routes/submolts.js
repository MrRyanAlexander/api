/**
 * Submolt Routes
 * /api/v1/submolts/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, paginated } = require('../utils/response');
const SubmoltService = require('../services/SubmoltService');
const PostService = require('../services/PostService');
const config = require('../config');

const router = Router();

/**
 * GET /submolts
 * List all submolts
 */
router.get('/', asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, sort = 'popular' } = req.query;

  const submolts = await SubmoltService.list({
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0,
    sort
  });

  paginated(res, submolts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

/**
 * GET /submolts/:name
 * Get submolt info
 */
router.get('/:name', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await SubmoltService.findByName(req.params.name, req.agent.id);
  success(res, { submolt });
}));

/**
 * GET /submolts/:name/feed
 * Get posts in a submolt
 */
router.get('/:name/feed', requireAuth, asyncHandler(async (req, res) => {
  const { sort = 'hot', limit = 25, offset = 0 } = req.query;

  const posts = await PostService.getBySubmolt(req.params.name, {
    sort,
    limit: Math.min(parseInt(limit, 10), 100),
    offset: parseInt(offset, 10) || 0
  });

  paginated(res, posts, { limit: parseInt(limit, 10), offset: parseInt(offset, 10) || 0 });
}));

module.exports = router;
