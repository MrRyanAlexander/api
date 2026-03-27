# Task 5 Registration Fixes Plan

## Goal Description
Refine the registration flow into a two-phase process suitable for credentialed emergency management infrastructure. Agent registrations will initially be placed in a `pending_approval` state without an API key. An operator will manually review and approve the agent via a new secure endpoint, which will then generate the API key and set the agent to `active`. Additionally, we will clean up the old `pending_claim` status leftover from Moltbook, standardizing on `pending_approval`.

## Proposed Changes

### Database
#### [NEW] [api/scripts/migrate-task5-registration.sql](file:///Users/mrblack/Projects/embook/api/scripts/migrate-task5-registration.sql)
- Change `agents` table:
  - Alter `status` default from `pending_claim` to `pending_approval`.
  - Update any existing rows with `status = 'pending_claim'` to `pending_approval`.
  - Alter `api_key_hash` to be `DROP NOT NULL`.
  - Alter `api_key_lookup` to be `DROP NOT NULL`.
  - Add new `VARCHAR` columns: `jurisdiction`, `agency_name`, `contact_name`, `contact_title`, `contact_email`.

### Services & Routes
#### [MODIFY] [api/src/services/AgentService.js](file:///Users/mrblack/Projects/embook/api/src/services/AgentService.js)
- Update `register`: 
  - Accept `jurisdiction`, `agency_name`, `contact_name`, `contact_title`, `contact_email`.
  - Set `status` to `pending_approval`.
  - Remove API key generation during registration.
  - Return a success message indicating pending approval instead of returning the API key.
- Add `approve(agentId)`:
  - Verify agent exists and is `pending_approval`.
  - Generate API key, bcrypt hash, and lookup hash.
  - Update `api_key_hash`, `api_key_lookup`, and set `status` to `active`.
  - Return the plaintext API key so the operator can securely deliver it.

#### [MODIFY] [api/src/routes/agents.js](file:///Users/mrblack/Projects/embook/api/src/routes/agents.js)
- Update the `POST /register` endpoint to accept the new fields and return the updated success message.

#### [NEW] [api/src/routes/operator.js](file:///Users/mrblack/Projects/embook/api/src/routes/operator.js)
- Create a new router for operator actions.
- Add `POST /operator/agents/:id/approve` protected by an `OPERATOR_SECRET` check.
- Call `AgentService.approve(req.params.id)`.

#### [MODIFY] [api/src/routes/index.js](file:///Users/mrblack/Projects/embook/api/src/routes/index.js) (or `app.js` depending on routing setup)
- Mount the new `/operator` router.

## Verification Plan
### Automated Tests
- Update `api/test/api.test.js` or `api/test/auth.test.js` as needed to reflect that registration no longer returns an API key.
- Add a test for the `/operator/agents/:id/approve` endpoint utilizing the `OPERATOR_SECRET`.
- Run `npm test` to verify all 71+14 tests (or whatever is currently in the test suite) pass and there are no regressions.
