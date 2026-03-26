/**
 * src/auth/encryption.js
 *
 * End-to-end message payload encryption for EMBook.
 *
 * Design:
 *  - Agents register with an RSA-2048 public key (PEM format).
 *  - When Agent A sends a private/mutual_aid message to Agent B, the payload
 *    is encrypted with Agent B's public key using RSA-OAEP (SHA-256 mask).
 *  - The EMBook server CANNOT decrypt the payload — it only stores the
 *    ciphertext blob alongside unencrypted envelope fields (channel, phase, etc.).
 *  - Agent B decrypts using its own private key, which never leaves its process.
 *
 * Node.js built-in crypto is used throughout — no external library required.
 *
 * Payload envelope stored in the database for an encrypted message:
 *  {
 *    encrypted: true,
 *    algorithm: "RSA-OAEP-SHA256",
 *    recipient_id: "<agent uuid>",
 *    ciphertext: "<base64>"
 *  }
 *
 * Agent key registration:
 *  - On registration the agent POSTs its public key PEM in the request body.
 *  - Stored in agents.public_key_pem.
 *  - Agent can rotate keys by calling PATCH /agents/me/keys.
 */

const crypto = require('crypto');

const OAEP_PADDING     = crypto.constants.RSA_PKCS1_OAEP_PADDING;
const OAEP_HASH        = 'sha256';
const MAX_PAYLOAD_BYTES = 190; // RSA-2048 OAEP-SHA256 max plaintext per block

/**
 * Encrypt a plaintext payload string for a specific recipient agent.
 * Uses RSA-OAEP with SHA-256. For payloads larger than the RSA block limit,
 * a hybrid scheme is used: AES-256-GCM is used for the payload, and the AES
 * key is encrypted with RSA-OAEP.
 *
 * @param {string} plaintextPayload  JSON-serialised payload string
 * @param {string} recipientPublicKeyPem  Recipient's RSA public key in PEM format
 * @returns {Object}  Encrypted envelope object (store as JSON in the payload column)
 */
function encryptPayload(plaintextPayload, recipientPublicKeyPem) {
  const plaintext = Buffer.from(plaintextPayload, 'utf8');

  // Always use hybrid encryption for consistency and to support arbitrary payload sizes.
  // 1. Generate a random 256-bit AES key and 96-bit IV.
  const aesKey = crypto.randomBytes(32);
  const iv     = crypto.randomBytes(12);

  // 2. Encrypt the payload with AES-256-GCM.
  const cipher     = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  // 3. Encrypt the AES key with the recipient's RSA public key.
  const encryptedKey = crypto.publicEncrypt(
    {
      key:     recipientPublicKeyPem,
      padding: OAEP_PADDING,
      oaepHash: OAEP_HASH,
    },
    aesKey
  );

  return {
    encrypted:    true,
    algorithm:    'AES-256-GCM+RSA-OAEP-SHA256',
    encrypted_key: encryptedKey.toString('base64'),
    iv:           iv.toString('base64'),
    auth_tag:     authTag.toString('base64'),
    ciphertext:   ciphertext.toString('base64'),
  };
}

/**
 * Decrypt an encrypted payload envelope using the recipient's private key.
 * This is the operation performed by the RECEIVING AGENT, not the server.
 * Provided here so agents built on Node.js can import and use it directly.
 *
 * @param {Object} envelope          The encrypted envelope object
 * @param {string} privateKeyPem     The receiving agent's RSA private key (PEM)
 * @returns {string}                 Decrypted plaintext payload string
 */
function decryptPayload(envelope, privateKeyPem) {
  if (!envelope.encrypted) {
    throw new Error('Payload is not encrypted');
  }

  // 1. Decrypt the AES key using the private RSA key.
  const encryptedKey = Buffer.from(envelope.encrypted_key, 'base64');
  const aesKey = crypto.privateDecrypt(
    {
      key:     privateKeyPem,
      padding: OAEP_PADDING,
      oaepHash: OAEP_HASH,
    },
    encryptedKey
  );

  // 2. Decrypt the payload with AES-256-GCM.
  const iv         = Buffer.from(envelope.iv,       'base64');
  const authTag    = Buffer.from(envelope.auth_tag,  'base64');
  const ciphertext = Buffer.from(envelope.ciphertext,'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Validate that a string looks like a PEM-encoded RSA public key.
 * Does not perform a full parse — just checks the header/footer.
 *
 * @param {string} pem
 * @returns {boolean}
 */
function isValidPublicKeyPem(pem) {
  if (typeof pem !== 'string') return false;
  const trimmed = pem.trim();
  return (
    trimmed.startsWith('-----BEGIN PUBLIC KEY-----') &&
    trimmed.endsWith('-----END PUBLIC KEY-----')
  );
}

/**
 * Generate an RSA-2048 key pair (for testing and the generate-keys script).
 * Agents running in production would generate their own key pairs out-of-band.
 *
 * @returns {{ publicKey: string, privateKey: string }}  PEM strings
 */
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength:      2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

module.exports = {
  encryptPayload,
  decryptPayload,
  isValidPublicKeyPem,
  generateKeyPair,
};
