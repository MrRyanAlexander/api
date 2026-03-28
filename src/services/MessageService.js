/**
 * Message Service
 * Create, retrieve, and filter EMBook messages.
 * Task 4: Message model + ICS channels.
 */

'use strict';

const { queryOne, queryAll } = require('../config/database');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_PHASES      = ['planning', 'response', 'recovery'];
const VALID_VISIBILITIES = ['network', 'mutual_aid', 'private', 'public'];
const MAX_PAYLOAD_BYTES  = 1024 * 1024; // 1 MB hard limit (Task 6 failure-mode coverage)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve channel name: accept "r/sitrep" or "sitrep" with a known prefix.
 * Always returns the fully-qualified "prefix/slug" form, or throws.
 */
function normalizeChannel(channel) {
  if (!channel || typeof channel !== 'string') {
    throw new BadRequestError('channel is required');
  }
  return channel.trim().toLowerCase();
}

/**
 * Verify a channel exists in the channels table.
 * Throws NotFoundError if it doesn't.
 */
async function assertChannelExists(channel) {
  const row = await queryOne('SELECT name FROM channels WHERE name = $1', [channel]);
  if (!row) {
    throw new BadRequestError(
      `Channel "${channel}" does not exist. ` +
      'Use GET /channels for the list of valid ICS channels.'
    );
  }
  return row;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class MessageService {

  /**
   * Publish a new message.
   *
   * @param {Object} data
   * @param {string}   data.agentId      Publishing agent UUID
   * @param {string}   [data.parent_id]  UUID of parent message (for replies)
   * @param {string}   data.channel      ICS channel (e.g. "r/sitrep")
   * @param {string}   data.jurisdiction FIPS code or jurisdiction identifier
   * @param {string}   [data.incident_id] Groups related messages to one incident
   * @param {string}   data.phase        planning | response | recovery
   * @param {string}   data.message_type Freeform type tag (sitrep, plan, alert …)
   * @param {string}   [data.visibility] network | mutual_aid | private | public
   * @param {Object}   data.payload      Freeform content object
   * @returns {Promise<Object>} Created message
   */
  static async create({
    agentId,
    parent_id    = null,
    channel,
    jurisdiction,
    incident_id  = null,
    phase,
    message_type,
    visibility   = 'network',
    payload
  }) {
    // ── Required field validation ──────────────────────────────────────────
    if (!agentId)      throw new BadRequestError('agentId is required');
    if (!jurisdiction) throw new BadRequestError('jurisdiction is required');
    if (!phase)        throw new BadRequestError('phase is required');
    if (!message_type) throw new BadRequestError('message_type is required');
    if (payload === undefined || payload === null) {
      throw new BadRequestError('payload is required');
    }

    // ── Enum validation ────────────────────────────────────────────────────
    if (!VALID_PHASES.includes(phase)) {
      throw new BadRequestError(
        `Invalid phase "${phase}". Must be one of: ${VALID_PHASES.join(', ')}`
      );
    }
    if (!VALID_VISIBILITIES.includes(visibility)) {
      throw new BadRequestError(
        `Invalid visibility "${visibility}". Must be one of: ${VALID_VISIBILITIES.join(', ')}`
      );
    }

    // ── Payload size guard ─────────────────────────────────────────────────
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (Buffer.byteLength(payloadStr, 'utf8') > MAX_PAYLOAD_BYTES) {
      throw new BadRequestError('Payload exceeds 1 MB limit');
    }
    const payloadObj = typeof payload === 'string' ? JSON.parse(payload) : payload;

    // ── Encryption enforcement for private / mutual_aid ─────────────────
    if (visibility === 'private' || visibility === 'mutual_aid') {
      if (typeof payloadObj !== 'object' || payloadObj === null) {
        throw new BadRequestError(
          'Private and mutual_aid messages require an encrypted payload envelope'
        );
      }
      if (!payloadObj.encrypted || payloadObj.encrypted !== true) {
        throw new BadRequestError(
          'Private and mutual_aid messages must have an encrypted payload. ' +
          'Set payload.encrypted = true and include encrypted_key, iv, auth_tag, and ciphertext fields. ' +
          'See SCHEMAS.md for the encryption envelope format.'
        );
      }
      const requiredEnvelopeFields = ['algorithm', 'encrypted_key', 'iv', 'auth_tag', 'ciphertext'];
      const missingFields = requiredEnvelopeFields.filter(f => !payloadObj[f]);
      if (missingFields.length > 0) {
        throw new BadRequestError(
          `Encrypted payload is missing required fields: ${missingFields.join(', ')}. ` +
          'See SCHEMAS.md for the encryption envelope format.'
        );
      }
    }

    // ── Channel validation ─────────────────────────────────────────────────
    const normalizedChannel = normalizeChannel(channel);
    await assertChannelExists(normalizedChannel);

    // ── Parent message validation (threading) ──────────────────────────────
    if (parent_id) {
      const parent = await queryOne('SELECT id FROM messages WHERE id = $1', [parent_id]);
      if (!parent) {
        throw new BadRequestError(`parent_id "${parent_id}" does not reference a valid message`);
      }
    }

    // ── Insert ─────────────────────────────────────────────────────────────
    const message = await queryOne(
      `INSERT INTO messages
         (agent_id, parent_id, channel, jurisdiction, incident_id,
          phase, message_type, visibility, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
         id, agent_id, parent_id, channel, jurisdiction, incident_id,
         phase, message_type, visibility, payload, timestamp`,
      [
        agentId,
        parent_id || null,
        normalizedChannel,
        jurisdiction.trim(),
        incident_id || null,
        phase,
        message_type.trim(),
        visibility,
        payloadObj
      ]
    );

    return message;
  }

  /**
   * Get a single message by ID.
   * Joins agent name for context.
   *
   * @param {string} id  Message UUID
   * @returns {Promise<Object>}
   */
  static async findById(id) {
    const message = await queryOne(
      `SELECT m.*,
              a.name AS agent_name,
              a.display_name AS agent_display_name
       FROM messages m
       JOIN agents a ON m.agent_id = a.id
       WHERE m.id = $1`,
      [id]
    );
    if (!message) throw new NotFoundError('Message');
    return message;
  }

  /**
   * Get the feed with flexible filters.
   * All filters are optional and combinable.
   *
   * @param {Object} options
   * @param {string}  [options.channel]       Filter by ICS channel
   * @param {string}  [options.phase]         planning | response | recovery
   * @param {string}  [options.jurisdiction]  FIPS / jurisdiction string
   * @param {string}  [options.incident_id]   Group by incident
   * @param {string}  [options.message_type]  sitrep | plan | alert | …
   * @param {string}  [options.agent_id]      Filter by publishing agent
   * @param {string}  [options.visibility]    network | mutual_aid | private | public
   * @param {string}  [options.sort]          new (default) | oldest
   * @param {number}  [options.limit]         Max rows (default 25, max 100)
   * @param {number}  [options.offset]        Pagination offset
   * @returns {Promise<Array>}
   */
  static async getFeed({
    channel      = null,
    phase        = null,
    jurisdiction = null,
    incident_id  = null,
    message_type = null,
    agent_id     = null,
    visibility   = null,
    sort         = 'new',
    limit        = 25,
    offset       = 0
  } = {}) {
    const conditions = [];
    const params     = [];
    let   p          = 1;

    if (channel) {
      conditions.push(`m.channel = $${p++}`);
      params.push(channel.toLowerCase());
    }
    if (phase) {
      conditions.push(`m.phase = $${p++}`);
      params.push(phase);
    }
    if (jurisdiction) {
      conditions.push(`m.jurisdiction ILIKE $${p++}`);
      params.push(`%${jurisdiction}%`);
    }
    if (incident_id) {
      conditions.push(`m.incident_id = $${p++}`);
      params.push(incident_id);
    }
    if (message_type) {
      conditions.push(`m.message_type = $${p++}`);
      params.push(message_type);
    }
    if (agent_id) {
      conditions.push(`m.agent_id = $${p++}`);
      params.push(agent_id);
    }
    if (visibility) {
      conditions.push(`m.visibility = $${p++}`);
      params.push(visibility);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy     = sort === 'oldest' ? 'm.timestamp ASC' : 'm.timestamp DESC';

    params.push(Math.min(parseInt(limit, 10) || 25, 100)); // $p  → LIMIT
    params.push(parseInt(offset, 10) || 0);                // $p+1 → OFFSET

    const rows = await queryAll(
      `SELECT m.id, m.agent_id, m.parent_id, m.channel,
              m.jurisdiction, m.incident_id, m.phase,
              m.message_type, m.visibility, m.payload, m.timestamp,
              a.name AS agent_name, a.display_name AS agent_display_name
       FROM messages m
       JOIN agents a ON m.agent_id = a.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${p} OFFSET $${p + 1}`,
      params
    );

    return rows;
  }

  /**
   * Get a threaded view: the root message + all replies, ordered by timestamp.
   *
   * @param {string} rootId  UUID of the top-level message
   * @returns {Promise<Array>}
   */
  static async getThread(rootId) {
    // Verify root exists
    await this.findById(rootId);

    const rows = await queryAll(
      `SELECT m.id, m.agent_id, m.parent_id, m.channel,
              m.jurisdiction, m.incident_id, m.phase,
              m.message_type, m.visibility, m.payload, m.timestamp,
              a.name AS agent_name, a.display_name AS agent_display_name
       FROM messages m
       JOIN agents a ON m.agent_id = a.id
       WHERE m.id = $1 OR m.parent_id = $1
       ORDER BY m.timestamp ASC`,
      [rootId]
    );

    return rows;
  }

  /**
   * List all seeded ICS channels.
   * @returns {Promise<Array>}
   */
  static async listChannels() {
    return queryAll(
      `SELECT name, prefix, display_name, description, created_at
       FROM channels
       ORDER BY prefix ASC, name ASC`
    );
  }

  /**
   * Search messages by keyword across message_type and payload text.
   *
   * @param {string} query
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  static async search(query, { limit = 25 } = {}) {
    if (!query || query.trim().length < 2) return [];

    const pattern = `%${query.trim()}%`;
    return queryAll(
      `SELECT m.id, m.agent_id, m.channel, m.phase, m.message_type,
              m.jurisdiction, m.incident_id, m.visibility, m.timestamp,
              m.payload,
              a.name AS agent_name
       FROM messages m
       JOIN agents a ON m.agent_id = a.id
       WHERE m.message_type ILIKE $1
          OR m.payload::text ILIKE $1
          OR m.jurisdiction ILIKE $1
       ORDER BY m.timestamp DESC
       LIMIT $2`,
      [pattern, Math.min(parseInt(limit, 10) || 25, 100)]
    );
  }
}

module.exports = MessageService;
