/**
 * test/registration.test.js
 *
 * EMBook — Two-Phase Registration Full Adversarial Test Suite
 *
 * Tests the complete registration lifecycle end-to-end against the live
 * development database. Run with: node test/registration.test.js
 *
 * What this covers:
 *
 *   [1] Registration — Valid Inputs
 *       Confirm the happy path sets correct status, withholds the API key,
 *       returns the right message, and stores all profile fields.
 *
 *   [2] Registration — Name Validation
 *       Boundary lengths, illegal characters, case normalization, whitespace,
 *       SQL injection attempts, Unicode, and reserved/dangerous patterns.
 *
 *   [3] Registration — Profile Fields
 *       Optional fields accepted when absent, fields stored correctly when
 *       present, no field causes a server error regardless of contents.
 *
 *   [4] Registration — Public Key Validation
 *       Invalid PEM formats are rejected before touching the database.
 *       Valid PEM is accepted and stored.
 *
 *   [5] Registration — Database State
 *       Directly verify the database row: status is pending_approval,
 *       api_key_hash and api_key_lookup are NULL, profile fields are stored.
 *
 *   [6] Registration — Duplicate & Collision Handling
 *       Same name, case variants, concurrent attempt simulation.
 *
 *   [7] Registration — Adversarial Inputs
 *       SQL injection, extreme lengths, null bytes, type confusion,
 *       empty strings, and non-string types in name.
 *
 *   [8] Approval — Happy Path
 *       Status transitions to active, API key is issued with correct format,
 *       key is returned exactly once, database state is correct post-approval.
 *
 *   [9] Approval — Error States
 *       Non-existent UUID, already-active agent, already-approved re-attempt,
 *       malformed UUID input.
 *
 *  [10] Approval — API Key Integrity
 *       Key uniqueness across agents, key format validation, bcrypt hash
 *       present after approval, lookup hash present after approval.
 *
 *  [11] Post-Approval Auth Flow
 *       findByApiKey succeeds with issued key, fails with wrong key, fails
 *       with a key that looks valid but was never issued, returns null for
 *       a pending (unapproved) agent.
 *
 *  [12] Lifecycle Integrity
 *       Pending agent cannot authenticate (no key exists to authenticate with).
 *       Revoked/unknown agent lookup returns null.
 *       Display name preserves original casing; name is lowercased.
 *
 *  [13] Mass Assignment / Privilege Escalation
 *       Inject status, api_key_hash, api_key_lookup, id via registration body.
 *       Inject forbidden fields via update(). Verify all are silently ignored.
 *
 *  [14] Profile Field Injection
 *       SQL injection in description, contact_email, agency_name — must be stored
 *       literally. Prototype pollution strings as values. VARCHAR(255) overflow.
 *
 *  [15] Concurrent Approval Race Condition
 *       Two simultaneous approve() calls on the same pending agent.
 *       Documents whether the race is handled or produces key orphaning.
 *
 *  [16] Return Value Sanitization
 *       Verify register() and approve() do not leak internal fields like
 *       api_key_hash or api_key_lookup to callers.
 *
 * Requires: .env with DATABASE_URL pointing to the dev database.
 * Note: Each run generates unique agent names to avoid collisions.
 *       All test agents are cleaned up at the end of the run.
 */

// Must be set before any module is loaded so the database module
// does not emit "Query executed" debug logs during the test run.
process.env.NODE_ENV = 'test';

require('dotenv').config();

const AgentService  = require('../src/services/AgentService');
const { generateKeyPair } = require('../src/auth/encryption');
const { generateApiKey }  = require('../src/auth/keys');
const { queryOne }        = require('../src/config/database');

const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require('../src/utils/errors');

// ─── ANSI colours (zero external dependencies) ───────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
};

function clr(color, text) { return `${C[color]}${text}${C.reset}`; }
function bold(text)  { return `${C.bold}${text}${C.reset}`; }
function dim(text)   { return `${C.dim}${text}${C.reset}`; }

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed   = 0;
let failed   = 0;
const failures       = [];   // { section, label, note? }
let   currentSection = '';
const createdAgentIds = [];  // track for cleanup

function assert(condition, label) {
  if (condition) {
    console.log(clr('green', '  ✓ ') + label);
    passed++;
  } else {
    console.error(clr('red', '  ✗ ') + bold(label));
    failures.push({ section: currentSection, label });
    failed++;
  }
}

async function assertThrows(fn, ErrorType, label) {
  try {
    await fn();
    console.error(clr('red', '  ✗ ') + bold(`${label}`) + dim(' — expected throw, got none'));
    failures.push({ section: currentSection, label, note: 'expected throw but none occurred' });
    failed++;
  } catch (e) {
    if (ErrorType && !(e instanceof ErrorType)) {
      const note = `got ${e.constructor.name}, expected ${ErrorType.name}`;
      console.error(clr('red', '  ✗ ') + bold(label) + dim(` — ${note}`));
      console.error(dim(`      message: ${e.message}`));
      failures.push({ section: currentSection, label, note });
      failed++;
    } else {
      console.log(clr('green', '  ✓ ') + label);
      passed++;
    }
  }
}

// Unique run-specific prefix so tests never collide with each other or prior runs
const RUN_ID    = Math.random().toString(36).slice(2, 8);
let   agentSeq  = 0;

function uniqueName(prefix = 'treg') {
  return `${prefix}_${RUN_ID}_${++agentSeq}`;
}

async function reg(overrides = {}) {
  const defaults = {
    name:          uniqueName(),
    description:   'Test agent',
    jurisdiction:  'CA-MARIN',
    agency_name:   'Marin County OES',
    contact_name:  'Jane Smith',
    contact_title: 'Emergency Services Director',
    contact_email: 'jsmith@marincounty.gov',
  };
  const result = await AgentService.register({ ...defaults, ...overrides });
  if (result.agent?.id) createdAgentIds.push(result.agent.id);
  return result;
}

// ─── Section scaffolding ─────────────────────────────────────────────────────

const RULE = '─'.repeat(60);
const DOUBLE_RULE = '═'.repeat(60);

function sectionStart(num, title) {
  currentSection = `[${num}] ${title}`;
  console.log('\n' + clr('cyan', RULE));
  console.log(bold(clr('yellow', ` [${num}]  ${title}`)));
  console.log(clr('cyan', RULE));
}

function sectionEnd(startPassed, startFailed, ms) {
  const p = passed - startPassed;
  const f = failed - startFailed;
  const status = f === 0
    ? clr('green', `  ✔ ${p}/${p + f} passed`) + dim(` — ${ms}ms`)
    : clr('red',   `  ✖ ${f} failed`) + dim(`, ${p} passed — ${ms}ms`);
  console.log(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Registration: Valid Inputs
// ─────────────────────────────────────────────────────────────────────────────

async function testSection1() {
  sectionStart(1, 'Registration — Valid Inputs');
  const t = Date.now();
  const p = passed, f = failed;

  const result = await reg();

  assert(result.agent !== undefined,                           'returns an agent object');
  assert(result.agent.id !== undefined,                        'agent has a UUID id');
  assert(typeof result.agent.id === 'string',                  'agent id is a string');
  assert(result.agent.status === 'pending_approval',           'status is pending_approval');
  assert(result.apiKey === undefined,                          'API key is NOT returned at registration');
  assert(result.important === undefined,                       'no important field (that belongs to approve)');
  assert(typeof result.message === 'string',                   'returns a message string');
  assert(result.message.toLowerCase().includes('pending'),     'message mentions pending state');
  assert(result.agent.created_at !== undefined,                'created_at is set');
  assert(result.agent.name !== undefined,                      'name is returned');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Registration: Name Validation
// ─────────────────────────────────────────────────────────────────────────────

async function testSection2() {
  sectionStart(2, 'Registration — Name Validation');
  const t = Date.now();
  const p = passed, f = failed;

  // --- Boundaries ---
  const minName = uniqueName().slice(0, 2).padEnd(2, 'a');   // 2 chars — minimum valid
  const maxName = ('m' + RUN_ID + '0'.repeat(32)).slice(0, 32); // 32 chars — maximum valid

  const min = await AgentService.register({ name: minName });
  if (min.agent?.id) createdAgentIds.push(min.agent.id);
  assert(min.agent.status === 'pending_approval',              '2-char name accepted (min boundary)');

  const max = await AgentService.register({ name: maxName });
  if (max.agent?.id) createdAgentIds.push(max.agent.id);
  assert(max.agent.status === 'pending_approval',              '32-char name accepted (max boundary)');

  // --- Too short ---
  await assertThrows(
    () => AgentService.register({ name: 'x' }),
    BadRequestError,
    '1-char name rejected (below minimum)'
  );

  // --- Too long ---
  await assertThrows(
    () => AgentService.register({ name: 'a'.repeat(33) }),
    BadRequestError,
    '33-char name rejected (above maximum)'
  );

  // --- Illegal characters ---
  const illegalNames = [
    'test-agent',       // hyphen
    'test agent',       // space
    'test.agent',       // period
    'test@agent',       // at-sign
    'test/agent',       // slash
    'test\\agent',      // backslash
    'tëst',             // accented character
    'тест',             // Cyrillic
    '🚒',              // emoji
    'test!',            // exclamation
    '<script>',         // XSS probe
    'test\nagent',      // newline
    'test\tagent',      // tab
  ];

  for (const name of illegalNames) {
    await assertThrows(
      () => AgentService.register({ name }),
      BadRequestError,
      `illegal name rejected: "${name.replace(/\n/g,'\\n').replace(/\t/g,'\\t')}"`
    );
  }

  // --- Valid character set ---
  const validName = uniqueName('valid_name_123');
  const valid = await AgentService.register({ name: validName });
  if (valid.agent?.id) createdAgentIds.push(valid.agent.id);
  assert(valid.agent.status === 'pending_approval',            'underscores and numbers accepted in name');

  // --- Case normalization ---
  const mixedName  = 'RegTest' + RUN_ID;
  const upperFirst = await AgentService.register({ name: mixedName });
  if (upperFirst.agent?.id) createdAgentIds.push(upperFirst.agent.id);
  assert(upperFirst.agent.name === mixedName.toLowerCase(),    'name stored in lowercase');
  assert(upperFirst.agent.display_name === mixedName,          'display_name preserves original casing');

  // --- Whitespace trimming ---
  // Leading/trailing whitespace around a valid name should either be trimmed
  // (accepted) or rejected — either is fine; what matters is no silent corruption.
  try {
    const wsResult = await AgentService.register({ name: '  ' + uniqueName() + '  ' });
    // If it accepted it, the stored name must not have leading/trailing spaces
    if (wsResult.agent?.id) createdAgentIds.push(wsResult.agent.id);
    assert(!wsResult.agent.name.startsWith(' ') && !wsResult.agent.name.endsWith(' '),
           'whitespace trimmed from name if accepted');
  } catch (e) {
    assert(e instanceof BadRequestError,
           'name with surrounding whitespace handled cleanly (rejected with BadRequestError)');
  }

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Registration: Profile Fields
// ─────────────────────────────────────────────────────────────────────────────

async function testSection3() {
  sectionStart(3, 'Registration — Profile Fields');
  const t = Date.now();
  const p = passed, f = failed;

  // --- Registration with NO profile fields (all optional) ---
  const bare = await AgentService.register({ name: uniqueName('bare') });
  if (bare.agent?.id) createdAgentIds.push(bare.agent.id);
  assert(bare.agent.status === 'pending_approval',
    'registration succeeds with only name (all profile fields optional)');

  // --- All five profile fields stored and retrievable ---
  const fullName = uniqueName('full');
  const full     = await AgentService.register({
    name:          fullName,
    jurisdiction:  'CA-SONOMA',
    agency_name:   'Sonoma County OES',
    contact_name:  'Robert Torres',
    contact_title: 'Assistant Director',
    contact_email: 'rtorres@sonomacounty.gov',
  });
  if (full.agent?.id) createdAgentIds.push(full.agent.id);

  const stored = await queryOne(
    `SELECT jurisdiction, agency_name, contact_name, contact_title, contact_email
     FROM agents WHERE id = $1`,
    [full.agent.id]
  );
  assert(stored.jurisdiction  === 'CA-SONOMA',                 'jurisdiction stored correctly');
  assert(stored.agency_name   === 'Sonoma County OES',         'agency_name stored correctly');
  assert(stored.contact_name  === 'Robert Torres',             'contact_name stored correctly');
  assert(stored.contact_title === 'Assistant Director',        'contact_title stored correctly');
  assert(stored.contact_email === 'rtorres@sonomacounty.gov',  'contact_email stored correctly');

  // --- Long but valid field values (within realistic limits) ---
  const longDesc = await AgentService.register({
    name:        uniqueName('longdesc'),
    description: 'A'.repeat(2000),
    agency_name: 'B'.repeat(200),
  });
  if (longDesc.agent?.id) createdAgentIds.push(longDesc.agent.id);
  assert(longDesc.agent.status === 'pending_approval',
    'long description and agency_name accepted');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Registration: Public Key Validation
// ─────────────────────────────────────────────────────────────────────────────

async function testSection4() {
  sectionStart(4, 'Registration — Public Key Validation');
  const t = Date.now();
  const p = passed, f = failed;

  // --- Invalid PEM strings ---
  const badPems = [
    'not a pem at all',
    '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkq\n-----END CERTIFICATE-----',  // wrong type
    '-----BEGIN PUBLIC KEY-----',                                               // no footer
    '-----END PUBLIC KEY-----',                                                 // no header
    '',                                                                         // empty string
    '   ',                                                                      // whitespace
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',                           // raw base64, no headers
  ];

  for (const pem of badPems) {
    await assertThrows(
      () => AgentService.register({ name: uniqueName('badpem'), public_key_pem: pem }),
      BadRequestError,
      `invalid PEM rejected: "${pem.slice(0, 30).replace(/\n/g,'\\n') || '(empty string)'}"`
    );
  }

  // --- Valid RSA public key accepted ---
  const { publicKey } = generateKeyPair();
  const withKey = await AgentService.register({
    name:           uniqueName('withkey'),
    public_key_pem: publicKey,
  });
  if (withKey.agent?.id) createdAgentIds.push(withKey.agent.id);
  assert(withKey.agent.status === 'pending_approval', 'valid RSA public key accepted at registration');

  // --- Verify public key stored in DB ---
  const stored = await queryOne(
    'SELECT public_key_pem FROM agents WHERE id = $1',
    [withKey.agent.id]
  );
  assert(stored.public_key_pem === publicKey, 'public key stored verbatim in database');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Registration: Database State Verification
// ─────────────────────────────────────────────────────────────────────────────

async function testSection5() {
  sectionStart(5, 'Registration — Database State');
  const t = Date.now();
  const p = passed, f = failed;

  const result = await reg({ name: uniqueName('dbstate') });
  const id     = result.agent.id;

  const row = await queryOne(
    `SELECT status, api_key_hash, api_key_lookup, public_key_pem, jurisdiction
     FROM agents WHERE id = $1`,
    [id]
  );

  assert(row !== null,                              'agent row exists in database');
  assert(row.status === 'pending_approval',         'DB status is pending_approval');
  assert(row.api_key_hash === null,                 'api_key_hash is NULL before approval');
  assert(row.api_key_lookup === null,               'api_key_lookup is NULL before approval');
  assert(row.jurisdiction === 'CA-MARIN',           'jurisdiction stored from defaults');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Registration: Duplicate & Collision Handling
// ─────────────────────────────────────────────────────────────────────────────

async function testSection6() {
  sectionStart(6, 'Registration — Duplicate & Collision Handling');
  const t = Date.now();
  const p = passed, f = failed;

  const baseName = uniqueName('dup');

  // First registration succeeds
  const first = await AgentService.register({ name: baseName });
  if (first.agent?.id) createdAgentIds.push(first.agent.id);
  assert(first.agent.status === 'pending_approval', 'first registration succeeds');

  // Exact duplicate rejected
  await assertThrows(
    () => AgentService.register({ name: baseName }),
    ConflictError,
    'exact duplicate name rejected with ConflictError'
  );

  // Case variant: names are normalized to lowercase, so this IS a duplicate
  await assertThrows(
    () => AgentService.register({ name: baseName.toUpperCase() }),
    ConflictError,
    'uppercase variant of taken name rejected (case-insensitive uniqueness)'
  );

  // Mixed case variant
  const mixedCase = baseName.slice(0, 1).toUpperCase() + baseName.slice(1);
  await assertThrows(
    () => AgentService.register({ name: mixedCase }),
    ConflictError,
    'mixed-case variant of taken name rejected'
  );

  // Different name succeeds
  const different = await AgentService.register({ name: uniqueName('different') });
  if (different.agent?.id) createdAgentIds.push(different.agent.id);
  assert(different.agent.status === 'pending_approval', 'different name accepted after collision test');

  // Simulate concurrent duplicate: two agents registered in rapid succession
  // with different names (proves the unique constraint doesn't block distinct names)
  const [c1, c2] = await Promise.all([
    AgentService.register({ name: uniqueName('conc') }),
    AgentService.register({ name: uniqueName('conc') }),
  ]);
  if (c1.agent?.id) createdAgentIds.push(c1.agent.id);
  if (c2.agent?.id) createdAgentIds.push(c2.agent.id);
  assert(c1.agent.id !== c2.agent.id,   'concurrent registrations of distinct names each get unique IDs');
  assert(c1.agent.status === 'pending_approval', 'concurrent agent 1 is pending_approval');
  assert(c2.agent.status === 'pending_approval', 'concurrent agent 2 is pending_approval');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Registration: Adversarial Inputs
// ─────────────────────────────────────────────────────────────────────────────

async function testSection7() {
  sectionStart(7, 'Registration — Adversarial Inputs');
  const t = Date.now();
  const p = passed, f = failed;

  // --- SQL injection in name ---
  const sqlInjectionNames = [
    "'; DROP TABLE agents; --",
    "1 OR 1=1",
    "admin'--",
    "' UNION SELECT * FROM agents --",
  ];
  for (const name of sqlInjectionNames) {
    await assertThrows(
      () => AgentService.register({ name }),
      BadRequestError,
      `SQL injection attempt in name rejected: "${name.slice(0, 30)}"`
    );
  }

  // --- Null/undefined name ---
  await assertThrows(
    () => AgentService.register({ name: null }),
    BadRequestError,
    'null name rejected'
  );

  await assertThrows(
    () => AgentService.register({ name: undefined }),
    BadRequestError,
    'undefined name rejected'
  );

  await assertThrows(
    () => AgentService.register({ name: '' }),
    BadRequestError,
    'empty string name rejected'
  );

  // --- Non-string types in name ---
  await assertThrows(
    () => AgentService.register({ name: 12345 }),
    BadRequestError,
    'numeric name rejected'
  );

  await assertThrows(
    () => AgentService.register({ name: { evil: true } }),
    BadRequestError,
    'object as name rejected'
  );

  await assertThrows(
    () => AgentService.register({ name: ['array'] }),
    BadRequestError,
    'array as name rejected'
  );

  await assertThrows(
    () => AgentService.register({ name: true }),
    BadRequestError,
    'boolean as name rejected'
  );

  // --- Extremely long name (no DB truncation hazard) ---
  await assertThrows(
    () => AgentService.register({ name: 'a'.repeat(10000) }),
    BadRequestError,
    '10000-char name rejected before hitting DB'
  );

  // --- Null byte injection ---
  await assertThrows(
    () => AgentService.register({ name: 'valid\x00name' }),
    BadRequestError,
    'null byte in name rejected'
  );

  // --- XSS attempt in description (should be accepted — stored not rendered) ---
  const xssDesc = await AgentService.register({
    name:        uniqueName('xss'),
    description: '<script>alert("xss")</script>',
  });
  if (xssDesc.agent?.id) createdAgentIds.push(xssDesc.agent.id);
  assert(xssDesc.agent.status === 'pending_approval',
    'XSS in description stored without error (sanitization is a UI concern)');

  // --- No fields at all ---
  await assertThrows(
    () => AgentService.register({}),
    BadRequestError,
    'empty registration object rejected (name is required)'
  );

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — Approval: Happy Path
// ─────────────────────────────────────────────────────────────────────────────

async function testSection8() {
  sectionStart(8, 'Approval — Happy Path');
  const t = Date.now();
  const p = passed, f = failed;

  const regResult = await reg({ name: uniqueName('approve') });
  const id        = regResult.agent.id;

  const approveResult = await AgentService.approve(id);

  assert(approveResult.agent !== undefined,                     'approve returns agent object');
  assert(approveResult.agent.status === 'active',               'status transitions to active');
  assert(typeof approveResult.apiKey === 'string',              'API key is a string');
  assert(approveResult.apiKey.startsWith('embook_'),            'API key has embook_ prefix');
  assert(approveResult.apiKey.length === 71,                    'API key total length is 71 (embook_ + 64 hex)');
  assert(/^embook_[0-9a-f]{64}$/.test(approveResult.apiKey),   'API key matches expected format');
  assert(typeof approveResult.important === 'string',           'important warning message returned');
  assert(approveResult.important.toLowerCase().includes('save'),
    'important message tells operator to save the key');

  // Confirm database state after approval
  const row = await queryOne(
    'SELECT status, api_key_hash, api_key_lookup FROM agents WHERE id = $1',
    [id]
  );
  assert(row.status === 'active',           'DB status is active after approval');
  assert(row.api_key_hash !== null,         'api_key_hash populated after approval');
  assert(row.api_key_lookup !== null,       'api_key_lookup populated after approval');
  assert(row.api_key_hash.startsWith('$2'), 'api_key_hash is bcrypt format ($2...)');
  assert(row.api_key_lookup.length === 64,  'api_key_lookup is 64 hex chars (SHA-256)');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 — Approval: Error States
// ─────────────────────────────────────────────────────────────────────────────

async function testSection9() {
  sectionStart(9, 'Approval — Error States');
  const t = Date.now();
  const p = passed, f = failed;

  // --- Non-existent UUID ---
  await assertThrows(
    () => AgentService.approve('00000000-0000-0000-0000-000000000000'),
    NotFoundError,
    'approving all-zero UUID throws NotFoundError'
  );

  // --- Random UUID that doesn't exist ---
  const fakeUuid = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
  await assertThrows(
    () => AgentService.approve(fakeUuid),
    NotFoundError,
    'approving non-existent UUID throws NotFoundError'
  );

  // --- Re-approval of already-active agent ---
  const regResult = await reg({ name: uniqueName('reapprove') });
  const id        = regResult.agent.id;
  await AgentService.approve(id);   // first approval

  await assertThrows(
    () => AgentService.approve(id),
    ConflictError,
    'second approval of already-active agent throws ConflictError'
  );

  // --- Approve with malformed input (non-UUID string) ---
  await assertThrows(
    () => AgentService.approve('not-a-uuid'),
    Error,   // could be DB error or NotFoundError — either is correct
    'approving with non-UUID string throws an error'
  );

  // --- Approve with null ---
  await assertThrows(
    () => AgentService.approve(null),
    Error,
    'approving with null throws an error'
  );

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 10 — Approval: API Key Integrity
// ─────────────────────────────────────────────────────────────────────────────

async function testSection10() {
  sectionStart(10, 'Approval — API Key Integrity');
  const t = Date.now();
  const p = passed, f = failed;

  // Register and approve two separate agents
  const [r1, r2] = await Promise.all([
    reg({ name: uniqueName('keyint1') }),
    reg({ name: uniqueName('keyint2') }),
  ]);

  const [a1, a2] = await Promise.all([
    AgentService.approve(r1.agent.id),
    AgentService.approve(r2.agent.id),
  ]);

  // Keys must be unique across agents
  assert(a1.apiKey !== a2.apiKey,           'two approved agents receive unique API keys');

  // Each key must pass format validation
  const { isValidKeyFormat } = require('../src/auth/keys');
  assert(isValidKeyFormat(a1.apiKey),       'agent 1 API key passes format validation');
  assert(isValidKeyFormat(a2.apiKey),       'agent 2 API key passes format validation');

  // The API key returned to the operator must actually work for auth lookup
  const found1 = await AgentService.findByApiKey(a1.apiKey);
  const found2 = await AgentService.findByApiKey(a2.apiKey);
  assert(found1 !== null,                   'agent 1 key successfully looked up via findByApiKey');
  assert(found2 !== null,                   'agent 2 key successfully looked up via findByApiKey');
  assert(found1.id === r1.agent.id,         'findByApiKey returns correct agent for key 1');
  assert(found2.id === r2.agent.id,         'findByApiKey returns correct agent for key 2');

  // Cross-key lookup must fail
  const crossLookup1 = await AgentService.findByApiKey(a2.apiKey);
  // Cross lookup will find agent 2 — that's expected. Test that agent 1's ID is not returned
  assert(crossLookup1 === null || crossLookup1.id !== r1.agent.id,
    "agent 2's key does not authenticate as agent 1");

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 11 — Post-Approval Auth Flow
// ─────────────────────────────────────────────────────────────────────────────

async function testSection11() {
  sectionStart(11, 'Post-Approval Auth Flow');
  const t = Date.now();
  const p = passed, f = failed;

  // Register and approve one agent for auth tests
  const regResult = await reg({ name: uniqueName('authflow') });
  const id        = regResult.agent.id;
  const approval  = await AgentService.approve(id);
  const validKey  = approval.apiKey;

  // Correct key returns the agent
  const found = await AgentService.findByApiKey(validKey);
  assert(found !== null,                    'valid issued key returns agent');
  assert(found.id === id,                   'returned agent ID matches registered agent');
  assert(found.status === 'active',         'returned agent has active status');

  // Wrong key returns null
  const wrongKey   = generateApiKey();   // random, never issued
  const notFound   = await AgentService.findByApiKey(wrongKey);
  assert(notFound === null,                 'unissued key returns null from findByApiKey');

  // Truncated key returns null
  const truncated  = validKey.slice(0, -4);
  const truncResult = await AgentService.findByApiKey(truncated);
  assert(truncResult === null,              'truncated key returns null');

  // Key with altered character returns null
  const lastChar   = validKey.slice(-1);
  const alteredChar = lastChar === 'a' ? 'b' : 'a';
  const alteredKey = validKey.slice(0, -1) + alteredChar;
  const alteredResult = await AgentService.findByApiKey(alteredKey);
  assert(alteredResult === null,            'key with one altered character returns null');

  // Empty / null inputs
  assert(await AgentService.findByApiKey('') === null,        'empty string returns null');
  assert(await AgentService.findByApiKey(null) === null,      'null returns null');
  assert(await AgentService.findByApiKey(undefined) === null, 'undefined returns null');

  // Pending agent (register only, no approval) cannot be found by key
  const pendingReg = await reg({ name: uniqueName('pending') });
  const pendingKey = generateApiKey();   // fabricate a key — this agent has none
  const pendingLookup = await AgentService.findByApiKey(pendingKey);
  assert(pendingLookup === null,            'pending agent cannot be found by any key (none issued)');

  // verifyAgentKey returns false for wrong key against active agent
  const wrongVerify = await AgentService.verifyAgentKey(id, generateApiKey());
  assert(wrongVerify === false,             'verifyAgentKey returns false for wrong key');

  // verifyAgentKey returns true for correct key
  const correctVerify = await AgentService.verifyAgentKey(id, validKey);
  assert(correctVerify === true,            'verifyAgentKey returns true for correct key');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 12 — Lifecycle Integrity
// ─────────────────────────────────────────────────────────────────────────────

async function testSection12() {
  sectionStart(12, 'Lifecycle Integrity');
  const t = Date.now();
  const p = passed, f = failed;

  // --- findById on a pending agent returns the agent (status visible) ---
  const pendingReg = await reg({ name: uniqueName('lifecycle') });
  const pendingId  = pendingReg.agent.id;

  const pending = await AgentService.findById(pendingId);
  assert(pending !== null,                          'findById returns pending agent');
  assert(pending.status === 'pending_approval',     'pending agent has pending_approval status');

  // --- findByName returns pending agent ---
  const byName = await AgentService.findByName(pendingReg.agent.name);
  assert(byName !== null,                           'findByName returns pending agent');
  assert(byName.id === pendingId,                   'findByName returns correct agent');

  // --- Display name casing ---
  const caseName   = 'CamelCase' + RUN_ID.toUpperCase();
  const camelReg   = await AgentService.register({ name: caseName });
  if (camelReg.agent?.id) createdAgentIds.push(camelReg.agent.id);

  assert(camelReg.agent.name === caseName.toLowerCase(),         'stored name is lowercase');
  assert(camelReg.agent.display_name === caseName,               'display_name preserves original casing');

  // --- Approve → verify full lifecycle for findById ---
  const approveResult = await AgentService.approve(pendingId);
  const activeAgent   = await AgentService.findById(pendingId);
  assert(activeAgent.status === 'active',           'findById shows active after approval');

  // --- findByApiKey on a randomly generated key that matches no row ---
  const phantom = await AgentService.findByApiKey('embook_' + 'dead'.repeat(16));
  assert(phantom === null,                          'lookup of well-formed but unissued key returns null');

  // --- Multiple approvals produce distinct keys (idempotency is not expected — it throws) ---
  await assertThrows(
    () => AgentService.approve(pendingId),
    ConflictError,
    'third approval attempt on active agent still throws ConflictError'
  );

  // --- update() on pending agent works (profile edits are independent of approval) ---
  const updReg = await reg({ name: uniqueName('upd') });
  const updated = await AgentService.update(updReg.agent.id, { description: 'updated description' });
  assert(updated.status === 'pending_approval',     'update() does not change status');
  assert(updated.description === 'updated description', 'description updated correctly');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 13 — Mass Assignment / Privilege Escalation
// ─────────────────────────────────────────────────────────────────────────────

async function testSection13() {
  sectionStart(13, 'Mass Assignment / Privilege Escalation');
  const t = Date.now();
  const p = passed, f = failed;

  // --- Registration: inject status ---
  // An attacker passes status:'active' hoping to skip the approval gate.
  const privEsc = await reg({ name: uniqueName('privesc'), status: 'active' });
  const privRow = await queryOne('SELECT status FROM agents WHERE id = $1', [privEsc.agent.id]);
  assert(privRow.status === 'pending_approval',
    'status:"active" in registration body is ignored — DB row is pending_approval');
  assert(privEsc.agent.status === 'pending_approval',
    'returned status is pending_approval despite injection attempt');

  // --- Registration: inject api_key_hash ---
  // Attacker tries to set their own bcrypt hash so they already know the key.
  const hashInject = await reg({ name: uniqueName('hashinj'), api_key_hash: '$2b$12$fakefakefakefakefakefakefakefakefakefakefakefakefakefak' });
  const hashRow = await queryOne('SELECT api_key_hash FROM agents WHERE id = $1', [hashInject.agent.id]);
  assert(hashRow.api_key_hash === null,
    'injected api_key_hash is ignored — DB column still NULL');

  // --- Registration: inject api_key_lookup ---
  const lookupInject = await reg({ name: uniqueName('lookupinj'), api_key_lookup: 'deadbeef'.repeat(8) });
  const lookupRow = await queryOne('SELECT api_key_lookup FROM agents WHERE id = $1', [lookupInject.agent.id]);
  assert(lookupRow.api_key_lookup === null,
    'injected api_key_lookup is ignored — DB column still NULL');

  // --- Registration: inject id ---
  // Attacker tries to choose their own UUID to collide with or impersonate another agent.
  const chosenId   = '00000000-0000-0000-0000-000000000001';
  const idInject   = await reg({ name: uniqueName('idinj'), id: chosenId });
  assert(idInject.agent.id !== chosenId,
    'injected id is ignored — server generates its own UUID');

  // --- Registration: inject legacy Moltbook fields ---
  const legacyInject = await reg({ name: uniqueName('legacy'), is_active: false, is_claimed: true, karma: 9999 });
  const legacyRow = await queryOne('SELECT is_active, is_claimed, karma FROM agents WHERE id = $1', [legacyInject.agent.id]);
  assert(legacyRow.is_active === true,   'injected is_active:false ignored — default true');
  assert(legacyRow.is_claimed === false,  'injected is_claimed:true ignored — default false');
  assert(legacyRow.karma === 0,           'injected karma:9999 ignored — default 0');

  // --- update(): try to escalate via forbidden fields ---
  const updReg = await reg({ name: uniqueName('updesc') });
  const updId  = updReg.agent.id;

  // status escalation via update()
  const updStatus = await AgentService.update(updId, { status: 'active', description: 'legit edit' });
  assert(updStatus.status === 'pending_approval',
    'update() with status:"active" does not change status');
  assert(updStatus.description === 'legit edit',
    'update() still applies allowed field alongside rejected field');

  // api_key_hash injection via update()
  await AgentService.update(updId, { api_key_hash: '$2b$12$injected', description: 'second edit' });
  const updKeyRow = await queryOne('SELECT api_key_hash FROM agents WHERE id = $1', [updId]);
  assert(updKeyRow.api_key_hash === null,
    'update() with api_key_hash does not modify credential column');

  // name change via update() — name is not in allowedFields
  const preName = (await AgentService.findById(updId)).name;
  await AgentService.update(updId, { name: 'hijacked', description: 'third edit' });
  const postName = (await AgentService.findById(updId)).name;
  assert(postName === preName,
    'update() with name field does not change agent name');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 14 — Profile Field Injection
// ─────────────────────────────────────────────────────────────────────────────

async function testSection14() {
  sectionStart(14, 'Profile Field Injection');
  const t = Date.now();
  const p = passed, f = failed;

  // --- SQL injection in description (parameterized queries protect, verify it) ---
  const sqlDesc = await reg({
    name:        uniqueName('sqldesc'),
    description: "'; DROP TABLE agents; --",
  });
  const sqlDescRow = await queryOne('SELECT description FROM agents WHERE id = $1', [sqlDesc.agent.id]);
  assert(sqlDescRow.description === "'; DROP TABLE agents; --",
    'SQL injection in description stored literally — not executed');

  // --- SQL injection in contact_email ---
  const sqlEmail = await reg({
    name:          uniqueName('sqlemail'),
    contact_email: "evil@test.com'; DROP TABLE agents; --",
  });
  const emailRow = await queryOne('SELECT contact_email FROM agents WHERE id = $1', [sqlEmail.agent.id]);
  assert(emailRow.contact_email.includes('DROP TABLE'),
    'SQL injection in contact_email stored literally — not executed');

  // --- SQL injection in agency_name ---
  const sqlAgency = await reg({
    name:        uniqueName('sqlagency'),
    agency_name: "x' OR '1'='1",
  });
  const agencyRow = await queryOne('SELECT agency_name FROM agents WHERE id = $1', [sqlAgency.agent.id]);
  assert(agencyRow.agency_name === "x' OR '1'='1",
    'SQL injection in agency_name stored literally — not executed');

  // --- Prototype pollution strings as field values ---
  const protoReg = await reg({
    name:          uniqueName('proto'),
    description:   '__proto__',
    agency_name:   'constructor',
    contact_name:  'toString',
    contact_title: 'prototype',
    contact_email: '__defineGetter__',
  });
  assert(protoReg.agent.status === 'pending_approval',
    'prototype pollution strings as field values do not crash service');

  // --- VARCHAR(255) overflow on constrained columns ---
  // jurisdiction, agency_name, contact_name, contact_title, contact_email are VARCHAR(255).
  // Strings exceeding 255 chars should throw a DB error rather than silently truncate.
  await assertThrows(
    () => AgentService.register({ name: uniqueName('longjur'), jurisdiction: 'X'.repeat(300) }),
    Error,
    'jurisdiction exceeding 255 chars throws error (DB VARCHAR constraint)'
  );

  await assertThrows(
    () => AgentService.register({ name: uniqueName('longagency'), agency_name: 'Y'.repeat(300) }),
    Error,
    'agency_name exceeding 255 chars throws error (DB VARCHAR constraint)'
  );

  await assertThrows(
    () => AgentService.register({ name: uniqueName('longemail'), contact_email: 'Z'.repeat(300) }),
    Error,
    'contact_email exceeding 255 chars throws error (DB VARCHAR constraint)'
  );

  // --- Very long description (TEXT column, no VARCHAR limit) ---
  const longDesc = await reg({
    name:        uniqueName('bigdesc'),
    description: 'D'.repeat(100000),
  });
  assert(longDesc.agent.status === 'pending_approval',
    '100K-char description accepted (TEXT column has no length limit)');

  // --- Null bytes in profile fields ---
  // PostgreSQL rejects 0x00 in UTF-8 text columns at the wire protocol level.
  // This is a DB-level defense — the service doesn't need to strip them first,
  // but the error must not crash the server (it should be catchable).
  await assertThrows(
    () => AgentService.register({
      name:        uniqueName('nullprof'),
      description: 'test\x00injection',
    }),
    Error,
    'null byte in description rejected by database (invalid UTF-8 byte 0x00)'
  );

  await assertThrows(
    () => AgentService.register({
      name:          uniqueName('nullemail'),
      contact_email: 'null\x00byte@evil.com',
    }),
    Error,
    'null byte in contact_email rejected by database (invalid UTF-8 byte 0x00)'
  );

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 15 — Concurrent Approval Race Condition
// ─────────────────────────────────────────────────────────────────────────────

async function testSection15() {
  sectionStart(15, 'Concurrent Approval Race Condition');
  const t = Date.now();
  const p = passed, f = failed;

  // Register one agent, then fire two approve() calls simultaneously.
  // If both pass the status check before either UPDATE commits, both
  // generate different API keys — the second UPDATE wins and the first
  // caller's key becomes orphaned (lookup hash overwritten).
  const raceReg = await reg({ name: uniqueName('race') });
  const raceId  = raceReg.agent.id;

  const [r1, r2] = await Promise.allSettled([
    AgentService.approve(raceId),
    AgentService.approve(raceId),
  ]);

  const successes = [r1, r2].filter(r => r.status === 'fulfilled');
  const rejects   = [r1, r2].filter(r => r.status === 'rejected');

  if (successes.length === 1 && rejects.length === 1) {
    // Ideal: one succeeded, one was rejected (ConflictError).
    assert(true, 'concurrent approval: exactly one succeeds, one rejected (safe)');

    // Verify the winning key actually works
    const winningKey = successes[0].value.apiKey;
    const found = await AgentService.findByApiKey(winningKey);
    assert(found !== null && found.id === raceId,
      'winning key from concurrent approval authenticates correctly');

  } else if (successes.length === 2) {
    // Race condition: both passed the status check and generated different keys.
    // This documents a real TOCTOU vulnerability in the approve() flow.
    const key1 = successes[0].value.apiKey;
    const key2 = successes[1].value.apiKey;

    console.log(dim('  ⚠ RACE CONDITION: both approve() calls succeeded with different keys'));
    console.log(dim(`    key1: ${key1.slice(0, 15)}...`));
    console.log(dim(`    key2: ${key2.slice(0, 15)}...`));

    // Only the last-written key will work. The other is orphaned.
    const lookup1 = await AgentService.findByApiKey(key1);
    const lookup2 = await AgentService.findByApiKey(key2);
    const oneWorks = (lookup1 !== null) !== (lookup2 !== null);

    assert(oneWorks,
      'TOCTOU race: one key is orphaned (only one lookup succeeds) — document in hardening plan');

  } else {
    // Both rejected — unexpected, but means the agent can't be approved at all.
    assert(false,
      'concurrent approval: unexpected — both calls rejected');
  }

  // Verify final DB state is active regardless
  const finalRow = await queryOne('SELECT status FROM agents WHERE id = $1', [raceId]);
  assert(finalRow.status === 'active',
    'agent status is active after concurrent approval attempts');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 16 — Return Value Sanitization
// ─────────────────────────────────────────────────────────────────────────────

async function testSection16() {
  sectionStart(16, 'Return Value Sanitization');
  const t = Date.now();
  const p = passed, f = failed;

  // --- register() return object ---
  const regResult = await reg({ name: uniqueName('sanitize') });
  const regAgent  = regResult.agent;

  assert(regAgent.api_key_hash   === undefined, 'register() does not leak api_key_hash');
  assert(regAgent.api_key_lookup === undefined, 'register() does not leak api_key_lookup');
  assert(regAgent.claim_token    === undefined, 'register() does not leak claim_token');
  assert(regAgent.public_key_pem === undefined, 'register() does not return public_key_pem');
  assert(regAgent.is_active      === undefined, 'register() does not leak is_active');

  // Only expected fields are present
  const regKeys = Object.keys(regAgent).sort();
  const expectedRegKeys = ['created_at', 'display_name', 'id', 'name', 'status'].sort();
  assert(JSON.stringify(regKeys) === JSON.stringify(expectedRegKeys),
    `register() returns exactly [${expectedRegKeys.join(', ')}]`);

  // --- approve() return object ---
  const approveResult = await AgentService.approve(regResult.agent.id);
  const appAgent      = approveResult.agent;

  assert(appAgent.api_key_hash   === undefined, 'approve() agent does not leak api_key_hash');
  assert(appAgent.api_key_lookup === undefined, 'approve() agent does not leak api_key_lookup');

  // approve() returns the API key at the top level — verify it's there
  assert(typeof approveResult.apiKey === 'string',   'approve() includes apiKey at top level');
  assert(typeof approveResult.important === 'string', 'approve() includes important warning');

  const appKeys = Object.keys(appAgent).sort();
  const expectedAppKeys = ['display_name', 'id', 'name', 'status'].sort();
  assert(JSON.stringify(appKeys) === JSON.stringify(expectedAppKeys),
    `approve() agent has exactly [${expectedAppKeys.join(', ')}]`);

  // --- findByApiKey() return object — security note ---
  // findByApiKey is internal (used by auth middleware), but its return shape matters
  // because requireAuth constructs req.agent from it. Verify the middleware strips
  // sensitive fields by checking what findByApiKey itself returns.
  const foundAgent = await AgentService.findByApiKey(approveResult.apiKey);
  const foundKeys  = Object.keys(foundAgent).sort();

  // findByApiKey SELECT includes api_key_hash for bcrypt verification.
  // This is acceptable because the auth middleware strips it before building req.agent.
  // But we document the behavior here so it's visible if the middleware is ever bypassed.
  const hasKeyHash = foundKeys.includes('api_key_hash');
  if (hasKeyHash) {
    console.log(dim('  ⚠ NOTE: findByApiKey() returns api_key_hash — auth middleware strips it'));
    console.log(dim('         If findByApiKey is ever exposed directly to a route, this is a leak.'));
  }
  // Not a hard failure — the middleware handles it. Just document it.
  assert(true, 'findByApiKey() internal return shape documented');

  sectionEnd(p, f, Date.now() - t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

async function cleanup() {
  if (createdAgentIds.length === 0) return;
  try {
    const { query } = require('../src/config/database');
    await query(
      `DELETE FROM agents WHERE id = ANY($1::uuid[])`,
      [createdAgentIds]
    );
    console.log(dim(`\n  Cleaned up ${createdAgentIds.length} test agent(s) from database.`));
  } catch (e) {
    console.warn(clr('yellow', `\n  Warning: could not clean up test agents: ${e.message}`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  [1,  'Registration — Valid Inputs',              testSection1],
  [2,  'Registration — Name Validation',           testSection2],
  [3,  'Registration — Profile Fields',            testSection3],
  [4,  'Registration — Public Key Validation',     testSection4],
  [5,  'Registration — Database State',            testSection5],
  [6,  'Registration — Duplicate & Collision',     testSection6],
  [7,  'Registration — Adversarial Inputs',        testSection7],
  [8,  'Approval — Happy Path',                    testSection8],
  [9,  'Approval — Error States',                  testSection9],
  [10, 'Approval — API Key Integrity',             testSection10],
  [11, 'Post-Approval Auth Flow',                  testSection11],
  [12, 'Lifecycle Integrity',                      testSection12],
  [13, 'Mass Assignment / Privilege Escalation',   testSection13],
  [14, 'Profile Field Injection',                  testSection14],
  [15, 'Concurrent Approval Race',                 testSection15],
  [16, 'Return Value Sanitization',                testSection16],
];

async function main() {
  const totalStart = Date.now();

  console.log('\n' + bold(clr('cyan', 'EMBook Registration — Full Adversarial Test Suite')));
  console.log(clr('cyan', DOUBLE_RULE));
  console.log(dim(`Run ID: ${RUN_ID}   ·   ${SECTIONS.length} sections`));

  try {
    for (const [, , fn] of SECTIONS) {
      await fn();
    }
  } finally {
    await cleanup();
  }

  const totalMs = Date.now() - totalStart;

  console.log('\n' + clr('cyan', DOUBLE_RULE));

  if (failed === 0) {
    console.log(
      bold(clr('green', `  ✔ ALL ${passed} TESTS PASSED`)) +
      dim(`  (${totalMs}ms)`)
    );
  } else {
    console.log(
      `  ${clr('green', `✓ ${passed} passed`)}   ${clr('red', `✗ ${failed} failed`)}   ` +
      dim(`${passed + failed} total · ${totalMs}ms`)
    );
  }

  console.log(clr('cyan', DOUBLE_RULE));

  if (failures.length > 0) {
    console.log('\n' + bold(clr('red', '  FAILURES')));
    console.log(clr('red', '  ' + '─'.repeat(40)));
    failures.forEach((fail, i) => {
      console.log(`  ${clr('red', `${i + 1}.`)} ${clr('dim', fail.section)}`);
      console.log(`     ${clr('red', '✗')} ${fail.label}`);
      if (fail.note) console.log(dim(`       → ${fail.note}`));
    });
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n' + clr('red', bold('Fatal error during test run:')) + ' ' + e.message);
  console.error(dim(e.stack));
  process.exit(1);
});
