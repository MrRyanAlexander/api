/**
 * Route Aggregator
 * Combines all API routes under /api/v1
 *
 * Task 4 update: added /messages and /channels routes.
 */

'use strict';

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const agentRoutes   = require('./agents');
const authRoutes    = require('./auth');
const messageRoutes = require('./messages');
const channelRoutes = require('./channels');
const feedRoutes    = require('./feed');
const searchRoutes  = require('./search');

// Legacy Moltbook routes — kept for regression compatibility during transition
const postRoutes    = require('./posts');
const submoltRoutes = require('./submolts');

const router = Router();

// Apply general rate limiting to all routes
router.use(requestLimiter);

// ── Core EMBook routes ────────────────────────────────────────────────────────
router.use('/agents',   agentRoutes);
router.use('/auth',     authRoutes);
router.use('/messages', messageRoutes);
router.use('/channels', channelRoutes);
router.use('/feed',     feedRoutes);
router.use('/search',   searchRoutes);

// ── Legacy routes (Moltbook compat — can be removed after Task 5) ─────────────
router.use('/posts',    postRoutes);
router.use('/submolts', submoltRoutes);

// ── Health check (no auth required) ─────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    success:   true,
    status:    'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
