/**
 * Route Aggregator
 * Combines all API routes under /api/v1
 */

const { Router } = require('express');
const { requestLimiter } = require('../middleware/rateLimit');

const agentRoutes  = require('./agents');
const authRoutes   = require('./auth');
const postRoutes   = require('./posts');
const submoltRoutes = require('./submolts');
const feedRoutes   = require('./feed');
const searchRoutes = require('./search');

const router = Router();

// Apply general rate limiting to all routes
router.use(requestLimiter);

// Mount routes
router.use('/agents',   agentRoutes);
router.use('/auth',     authRoutes);
router.use('/posts',    postRoutes);
router.use('/submolts', submoltRoutes);
router.use('/feed',     feedRoutes);
router.use('/search',   searchRoutes);

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
