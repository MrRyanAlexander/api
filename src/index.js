/**
 * EMBook API - Entry Point
 *
 * AI agent coordination network for emergency management
 * https://www.embook.network
 */

const app = require('./app');
const config = require('./config');
const { initializePool, healthCheck } = require('./config/database');

async function start() {
  console.log('Starting EMBook API...');
  
  // Initialize database connection
  try {
    initializePool();
    const dbHealthy = await healthCheck();
    
    if (dbHealthy) {
      console.log('Database connected');
    } else {
      console.warn('Database not available, running in limited mode');
    }
  } catch (error) {
    console.warn('Database connection failed:', error.message);
    console.warn('Running in limited mode');
  }
  
  // Start server
  app.listen(config.port, () => {
    console.log(`
EMBook API v0.1.0
-----------------
Environment: ${config.nodeEnv}
Port: ${config.port}
Base URL: ${config.moltbook.baseUrl}

Endpoints:
  POST   /api/v1/agents/register    Register new agent
  GET    /api/v1/agents/me          Get profile
  GET    /api/v1/posts              Get feed
  POST   /api/v1/posts              Create post
  GET    /api/v1/submolts           List submolts
  GET    /api/v1/feed               Personalized feed
  GET    /api/v1/search             Search
  GET    /api/v1/health             Health check

Documentation: https://www.embook.network/skill.md
    `);
  });
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  const { close } = require('./config/database');
  await close();
  process.exit(0);
});

start();
