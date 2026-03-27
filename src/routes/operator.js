/**
 * Operator Routes
 * /api/v1/operator/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const { UnauthorizedError } = require('../utils/errors');
const AgentService = require('../services/AgentService');

const router = Router();

// Middleware to protect operator routes
const requireOperatorPassword = (req, res, next) => {
  const secret = process.env.OPERATOR_SECRET;
  if (!secret) {
    throw new Error('OPERATOR_SECRET is not configured on the server');
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Operator authorization required', 'Provide OPERATOR_SECRET as a Bearer token');
  }

  const token = authHeader.split(' ')[1];
  if (token !== secret) {
    throw new UnauthorizedError('Invalid operator secret');
  }

  next();
};

/**
 * POST /operator/agents/:id/approve
 * Approve an agent registration and generate their API key.
 */
router.post('/agents/:id/approve', requireOperatorPassword, asyncHandler(async (req, res) => {
  const result = await AgentService.approve(req.params.id);
  success(res, result);
}));

module.exports = router;
