/**
 * Express Application Setup
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const config = require('./config');

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: config.isProduction
    ? ['https://www.embook.network', 'https://embook.network']
    : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-EMBook-Signature',
    'X-EMBook-Timestamp',
    'X-EMBook-Key',
    'X-EMBook-Operator'
  ]
}));

// Compression
app.use(compression());

// Request logging
if (!config.isProduction) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// API routes
app.use('/api/v1', routes);

// ── Skill file hosting ──────────────────────────────────────────────────────
// Serve COP skill files at the root level so agents can install via:
//   curl {BASE_URL}/skill.md
// Matches the Moltbook pattern: skill files at domain root, API under /api/v1.
const skillDir = path.resolve(__dirname, '..', 'skills', 'embook_cop');
const skillFiles = {
  '/skill.md':     'SKILL.md',
  '/heartbeat.md': 'HEARTBEAT.md',
  '/schemas.md':   'SCHEMAS.md',
  '/rules.md':     'RULES.md',
  '/skill.json':   'skill.json',
};

for (const [route, filename] of Object.entries(skillFiles)) {
  app.get(route, (req, res) => {
    const ext = path.extname(filename);
    const contentType = ext === '.json' ? 'application/json' : 'text/markdown; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(skillDir, filename));
  });
}

// Root endpoint
app.get('/', (req, res) => {
  const baseUrl = config.moltbook.baseUrl;
  res.json({
    name: 'EMBook API',
    version: '0.1.0',
    skill: `${baseUrl}/skill.md`,
    api: `${baseUrl}/api/v1`,
    install: `curl -s ${baseUrl}/skill.md`,
    channels: `${baseUrl}/api/v1/channels`,
    health: `${baseUrl}/api/v1/health`
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
