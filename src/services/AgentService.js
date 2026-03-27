/**
 * Agent Service
 * Handles agent registration, authentication, and profile management.
 * Updated for Task 3: EMBook auth layer (bcrypt keys, public key storage).
 */

const { queryOne, queryAll, query } = require('../config/database');
const { generateApiKey, hashApiKey, verifyApiKey, keyLookupHash, isValidKeyFormat }
                                    = require('../auth/keys');
const { isValidPublicKeyPem }       = require('../auth/encryption');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

class AgentService {
  /**
   * Register a new agent (Phase 1 of two-phase onboarding).
   *
   * Captures agency identity and contact details, creates the agent record in
   * 'pending_approval' status, and returns a confirmation. No API key is issued
   * here — key generation happens in approve() after the operator manually vets
   * the agency out-of-band and calls POST /operator/agents/:id/approve.
   *
   * @param {Object} data
   * @param {string} data.name             Agent name (alphanumeric + underscore, 2-32 chars)
   * @param {string} [data.description]    Optional description
   * @param {string} [data.jurisdiction]   FIPS code or jurisdiction identifier
   * @param {string} [data.agency_name]    Full official agency name
   * @param {string} [data.contact_name]   Name of the authorizing human at the agency
   * @param {string} [data.contact_title]  Their official title
   * @param {string} [data.contact_email]  Official agency email address
   * @param {string} [data.public_key_pem] Optional RSA public key for E2E encryption
   * @returns {Promise<Object>} { agent, message }
   */
  static async register({ 
    name, 
    description = '', 
    jurisdiction = '', 
    agency_name = '', 
    contact_name = '', 
    contact_title = '', 
    contact_email = '', 
    public_key_pem = null 
  }) {
    // Validate name
    if (!name || typeof name !== 'string') {
      throw new BadRequestError('Name is required');
    }

    const normalizedName = name.toLowerCase().trim();

    if (normalizedName.length < 2 || normalizedName.length > 32) {
      throw new BadRequestError('Name must be 2-32 characters');
    }

    if (!/^[a-z0-9_]+$/i.test(normalizedName)) {
      throw new BadRequestError(
        'Name can only contain letters, numbers, and underscores'
      );
    }

    // Validate public key if provided (empty string is an invalid key, not "no key")
    if (public_key_pem != null && !isValidPublicKeyPem(public_key_pem)) {
      throw new BadRequestError(
        'Invalid public_key_pem: must be a PEM-encoded RSA public key ' +
        'beginning with -----BEGIN PUBLIC KEY-----'
      );
    }

    // Check for name collision
    const existing = await queryOne(
      'SELECT id FROM agents WHERE name = $1',
      [normalizedName]
    );

    if (existing) {
      throw new ConflictError('Name already taken', 'Try a different name');
    }

    // Create agent
    const agent = await queryOne(
      `INSERT INTO agents
         (name, display_name, description, jurisdiction, agency_name, contact_name, contact_title, contact_email, public_key_pem, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_approval')
       RETURNING id, name, display_name, created_at`,
      [normalizedName, name.trim(), description, jurisdiction, agency_name, contact_name, contact_title, contact_email, public_key_pem]
    );

    return {
      agent: {
        id:           agent.id,
        name:         agent.name,
        display_name: agent.display_name,
        created_at:   agent.created_at,
        status:       'pending_approval'
      },
      message: 'Registration successful. Your account is pending operator approval. An API key will be issued upon approval.',
    };
  }

  /**
   * Approve an agent and issue their API key.
   * @param {string} id Agent UUID
   * @returns {Promise<Object>}
   */
  static async approve(id) {
    const existing = await queryOne(
      'SELECT id, status FROM agents WHERE id = $1',
      [id]
    );

    if (!existing) {
      throw new NotFoundError('Agent not found');
    }
    
    if (existing.status !== 'pending_approval') {
      throw new ConflictError('Agent is not in a pending state');
    }

    // Generate credentials
    const apiKey       = generateApiKey();
    const apiKeyBcrypt = await hashApiKey(apiKey);
    const apiKeyLookup = keyLookupHash(apiKey);

    const agent = await queryOne(
      `UPDATE agents
       SET api_key_hash = $1, api_key_lookup = $2, status = 'active', updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, display_name, status`,
      [apiKeyBcrypt, apiKeyLookup, id]
    );

    return {
      agent,
      apiKey,
      important: 'Save this API key and deliver it securely to the agency. It will not be shown again.'
    };
  }

  /**
   * Find an agent by its raw API key (for the /auth/token flow).
   * Uses the fast SHA-256 lookup index to find the row, then bcrypt to verify.
   *
   * @param {string} apiKey  Plaintext API key from the request
   * @returns {Promise<Object|null>}
   */
  static async findByApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return null;
    const lookupHash = keyLookupHash(apiKey);

    const agent = await queryOne(
      `SELECT id, name, display_name, description, status, api_key_hash, created_at, updated_at
       FROM agents WHERE api_key_lookup = $1`,
      [lookupHash]
    );

    if (!agent) return null;

    // bcrypt verify to confirm the raw key matches
    const valid = await verifyApiKey(apiKey, agent.api_key_hash);
    if (!valid) return null;

    return agent;
  }

  /**
   * Verify that a raw API key belongs to the given agent ID.
   * Used by requireSigned middleware to validate the X-EMBook-Key header.
   *
   * @param {string} agentId
   * @param {string} rawKey
   * @returns {Promise<boolean>}
   */
  static async verifyAgentKey(agentId, rawKey) {
    const agent = await queryOne(
      'SELECT api_key_hash FROM agents WHERE id = $1',
      [agentId]
    );

    if (!agent) return false;
    return verifyApiKey(rawKey, agent.api_key_hash);
  }

  /**
   * Find agent by ID.
   * @param {string} id  Agent UUID
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    return queryOne(
      `SELECT id, name, display_name, description, status, public_key_pem, created_at
       FROM agents WHERE id = $1`,
      [id]
    );
  }

  /**
   * Find agent by name.
   * @param {string} name
   * @returns {Promise<Object|null>}
   */
  static async findByName(name) {
    const normalizedName = name.toLowerCase().trim();
    return queryOne(
      `SELECT id, name, display_name, description, status, public_key_pem, created_at
       FROM agents WHERE name = $1`,
      [normalizedName]
    );
  }

  /**
   * Update agent's RSA public key (key rotation).
   * @param {string} id           Agent UUID
   * @param {string} publicKeyPem New public key PEM
   * @returns {Promise<Object>}
   */
  static async rotatePublicKey(id, publicKeyPem) {
    if (!isValidPublicKeyPem(publicKeyPem)) {
      throw new BadRequestError('Invalid public key PEM format');
    }

    const agent = await queryOne(
      `UPDATE agents
       SET public_key_pem = $1, public_key_updated_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, public_key_updated_at`,
      [publicKeyPem, id]
    );

    if (!agent) throw new NotFoundError('Agent');
    return agent;
  }

  /**
   * Update agent profile fields.
   * @param {string} id
   * @param {Object} updates  Fields: description, display_name
   * @returns {Promise<Object>}
   */
  static async update(id, updates) {
    const allowedFields = ['description', 'display_name'];
    const setClause     = [];
    const values        = [];
    let paramIndex      = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClause.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      throw new BadRequestError('No valid fields to update');
    }

    setClause.push(`updated_at = NOW()`);
    values.push(id);

    const agent = await queryOne(
      `UPDATE agents SET ${setClause.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, display_name, description, status, updated_at`,
      values
    );

    if (!agent) throw new NotFoundError('Agent');
    return agent;
  }
}

module.exports = AgentService;
