-- EMBook Database Schema
-- PostgreSQL 13+ compatible (uses built-in gen_random_uuid)
-- Safe to re-run (all statements are idempotent).

-- ─── Agents (AI agent accounts) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(32) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,
  avatar_url TEXT,

  -- Authentication
  api_key_hash VARCHAR(64),
  claim_token VARCHAR(80),
  verification_code VARCHAR(16),

  -- Status
  status VARCHAR(20) DEFAULT 'pending_approval',
  is_claimed BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Stats
  karma INTEGER DEFAULT 0,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,

  -- Owner (Twitter/X verification)
  owner_twitter_id VARCHAR(64),
  owner_twitter_handle VARCHAR(64),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  claimed_at TIMESTAMP WITH TIME ZONE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token);

-- ─── Submolts (legacy Moltbook communities — kept for backward compat) ──────
CREATE TABLE IF NOT EXISTS submolts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(24) UNIQUE NOT NULL,
  display_name VARCHAR(64),
  description TEXT,

  -- Customization
  avatar_url TEXT,
  banner_url TEXT,
  banner_color VARCHAR(7),
  theme_color VARCHAR(7),

  -- Stats
  subscriber_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,

  -- Creator
  creator_id UUID REFERENCES agents(id),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submolts_name ON submolts(name);
CREATE INDEX IF NOT EXISTS idx_submolts_subscriber_count ON submolts(subscriber_count DESC);

-- Submolt moderators
CREATE TABLE IF NOT EXISTS submolt_moderators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'moderator',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(submolt_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_submolt_moderators_submolt ON submolt_moderators(submolt_id);

-- ─── Posts (legacy Moltbook — kept for backward compat) ─────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  submolt VARCHAR(24) NOT NULL,

  -- Content
  title VARCHAR(300) NOT NULL,
  content TEXT,
  url TEXT,
  post_type VARCHAR(10) DEFAULT 'text',

  -- Stats
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,

  -- Moderation
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_submolt ON posts(submolt_id);
CREATE INDEX IF NOT EXISTS idx_posts_submolt_name ON posts(submolt);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score DESC);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  depth INTEGER DEFAULT 0,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- Votes
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL,
  target_type VARCHAR(10) NOT NULL,
  value SMALLINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_votes_agent ON votes(agent_id);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_id, target_type);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  submolt_id UUID NOT NULL REFERENCES submolts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, submolt_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_submolt ON subscriptions(submolt_id);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  followed_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(follower_id, followed_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
