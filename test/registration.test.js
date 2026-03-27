/**
 * test/registration.test.js
 *
 * Test suite for the two-phase registration flow (Task 5).
 * Tests AgentService register and approve logic, demonstrating different scenarios.
 * Note: This executes against the development Postgres database configured via .env.
 */
require('dotenv').config();

const AgentService = require('../src/services/AgentService');
const { ConflictError, NotFoundError } = require('../src/utils/errors');
const { query } = require('../src/config/database');

// ─── Test runner ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  + ' + label);
    passed++;
  } else {
    console.error('  - FAIL: ' + label);
    failed++;
  }
}

async function assertThrows(fn, type, label) {
  try {
    await fn();
    console.error('  - FAIL (no throw): ' + label);
    failed++;
  } catch (e) {
    if (type && !(e instanceof type)) {
      console.error(`  - FAIL (wrong error type: ${e.constructor.name} expected ${type.name}): ${label}`);
      failed++;
    } else {
      console.log('  + ' + label);
      passed++;
    }
  }
}

// Helper to generate a unique random agent name for each test run to avoid collisions
const r = Math.floor(Math.random() * 1000000);
const agentName = `test_agent_${r}`;

async function testRegistrationFlow() {
  console.log('\\n[AgentService Two-Phase Registration]');

  // Scenario 1: Successful Registration
  const regResult = await AgentService.register({
    name: agentName,
    description: 'Test Agent for Registration Flow',
    jurisdiction: 'Test County',
    agency_name: 'Test Agency',
    contact_name: 'John Doe',
    contact_title: 'Director',
    contact_email: 'john.doe@example.com'
  });

  assert(regResult.agent.status === 'pending_approval', 'register: sets status to pending_approval');
  assert(regResult.apiKey === undefined, 'register: does not return API key');
  assert(regResult.message.includes('pending operator approval'), 'register: returns pending message');
  
  const createdAgentId = regResult.agent.id;

  // Scenario 2: Prevent Duplicate Registration (Name Collision)
  await assertThrows(
    async () => {
      await AgentService.register({ name: agentName });
    },
    ConflictError,
    'register: throws ConflictError for already taken name'
  );

  // Scenario 3: Agent Approval
  const approveResult = await AgentService.approve(createdAgentId);
  assert(approveResult.agent.status === 'active', 'approve: transitions agent to active');
  assert(typeof approveResult.apiKey === 'string', 'approve: returns generated API key');
  assert(approveResult.apiKey.startsWith('embook_'), 'approve: generates valid embook key');

  // Verify database state by fetching agent again
  const fetchedAgent = await AgentService.findById(createdAgentId);
  assert(fetchedAgent.status === 'active', 'approve: database status is definitely active');

  // Scenario 4: Prevent Re-Approval
  await assertThrows(
    async () => {
      await AgentService.approve(createdAgentId);
    },
    ConflictError,
    'approve: throws ConflictError if agent is already active'
  );

  // Scenario 5: Handle Approving Non-Existent Agent
  await assertThrows(
    async () => {
      // Create a random valid UUID
      await AgentService.approve('00000000-0000-0000-0000-000000000000');
    },
    NotFoundError,
    'approve: throws NotFoundError for fake UUID'
  );

}

// ─── Run all tests ────────────────────────────────────────────────────────────
async function main() {
  console.log('EMBook Registration Test Suite');
  console.log('='.repeat(50));

  await testRegistrationFlow();

  console.log('\\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  // Force close pool or exit
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
