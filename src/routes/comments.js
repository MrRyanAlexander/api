/**
 * Comment Routes
 * /api/v1/comments/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const CommentService = require('../services/CommentService');

const router = Router();

/**
 * GET /comments/:id
 * Get a single comment
 */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const comment = await CommentService.findById(req.params.id);
  success(res, { comment });
}));

/**
 * DELETE /comments/:id
 * Delete a comment
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await CommentService.delete(req.params.id, req.agent.id);
  noContent(res);
}));

module.exports = router;
