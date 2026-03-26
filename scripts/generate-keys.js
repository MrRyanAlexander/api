#!/usr/bin/env node
/**
 * scripts/generate-keys.js
 *
 * Generate and persist the RSA key pair used for JWT signing (RS256).
 *
 * Usage:
 *   node scripts/generate-keys.js
 *
 * Creates:
 *   keys/jwt_private.pem   — keep secret, never commit to git
 *   keys/jwt_public.pem    — safe to share, used by external verifiers
 *
 * Run once on first deployment. Running again will overwrite existing keys
 * and invalidate all outstanding session tokens — use with care in production.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const keysDir = path.join(process.cwd(), 'keys');

if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { mode: 0o700 });
  console.log(`Created directory: ${keysDir}`);
}

const privateKeyPath = path.join(keysDir, 'jwt_private.pem');
const publicKeyPath  = path.join(keysDir, 'jwt_public.pem');

if (fs.existsSync(privateKeyPath)) {
  console.warn('⚠️  Key files already exist. Delete them first if you really want to regenerate.');
  console.warn('   Regenerating keys will invalidate all active session tokens.');
  process.exit(1);
}

console.log('Generating RSA-2048 key pair for JWT signing (RS256)...');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength:      2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicKeyPath,  publicKey,  { mode: 0o644 });

console.log(`✅ Private key written to: ${privateKeyPath}  (mode 600 — keep secret)`);
console.log(`✅ Public key written to:  ${publicKeyPath}   (mode 644 — safe to share)`);
console.log('');
console.log('Add keys/ to your .gitignore if not already present.');
console.log('Set JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH in .env if you move these files.');
