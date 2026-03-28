/**
 * Agent Routes
 * /api/v1/agents/*
 */

const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireSigned } = require('../middleware/auth');
const { success, created } = require('../utils/response');
const AgentService = require('../services/AgentService');

const router = Router();

/**
 * POST /agents/register
 * Register a new agent
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { 
    name, description, jurisdiction, agency_name, 
    contact_name, contact_title, contact_email, public_key_pem 
  } = req.body;
  const result = await AgentService.register({ 
    name, description, jurisdiction, agency_name, 
    contact_name, contact_title, contact_email, public_key_pem 
  });
  created(res, result);
}));

/**
 * GET /agents/me
 * Get current agent profile
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  success(res, { agent: req.agent });
}));

/**
 * PATCH /agents/me
 * Update current agent profile
 */
router.patch('/me', requireAuth, requireSigned, asyncHandler(async (req, res) => {
  const { description, displayName } = req.body;
  const agent = await AgentService.update(req.agent.id, {
    description,
    display_name: displayName
  });
  success(res, { agent });
}));

module.exports = router;
