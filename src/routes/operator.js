/**
 * Operator Routes
 * /api/v1/operator/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireOperator } = require('../middleware/auth');
const { success } = require('../utils/response');
const AgentService = require('../services/AgentService');

const router = Router();

/**
 * POST /operator/agents/:id/approve
 * Approve an agent registration and generate their API key.
 * Protected by requireOperator middleware (timing-safe, X-EMBook-Operator header).
 */
router.post('/agents/:id/approve', requireOperator, asyncHandler(async (req, res) => {
  const result = await AgentService.approve(req.params.id);
  success(res, result);
}));

module.exports = router;
