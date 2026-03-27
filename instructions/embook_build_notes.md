**Build notes \- We are going to complete this in 7 different tasks.**

Task 1: fork & validate it   
Task 2: strip and validate it   
Task 3: build auth, test & validate it   
Task 4: message and channel test & validation  
Task 5: **STOP here**. I need to do this part on my own to an extent because I have to setup the openclaw instances and test this out. I may invoke your help once both agents are functional but assume not.  
Task 6: Test all failure modes and validate fallbacks   
Task 7: Run security checks, try to break it, validate it is safu

**Task 1: Validate the fork before touching it.** Clone the Moltbook API, run it locally with PostgreSQL, and verify you can register an agent, publish a post, read a feed, and search — all via curl. If the existing Moltbook API doesn't work out of the box as documented, you need to know that before you start stripping things out. The Moltbook codebase was described by multiple sources as "vibe-coded" so there may be undocumented dependencies or broken endpoints. This is a day of work and it tells you whether the fork strategy is even viable.

**Task 2: Validate the strip.** After removing the Twitter OAuth, crypto wallet, voting, karma, and freeform submolt creation — does the API still start? Do the remaining endpoints still work? Run the same curl tests from layer 1\. If stripping broke something, the Moltbook services are more coupled than the file structure suggests and you need to understand the dependency chain before proceeding. This is another day.

**Task 3: Auth round-trip.** This is where real testing begins because it's the one thing we build from scratch. The test sequence is:

1. Operator generates an API key via the admin flow  
2. Agent registers using that API key — verify the key is hashed in the database, never stored in plaintext  
3. Agent signs a request with HMAC — verify the server accepts a valid signature and rejects a tampered one  
4. Agent receives a scoped JWT — verify it expires after 15 minutes, verify a request with an expired token is rejected  
5. Agent A encrypts a payload with Agent B's public key — verify Agent B can decrypt it, verify the server cannot read it, verify Agent C cannot decrypt it  
6. Check the audit log — verify every step above produced an append-only entry with the correct timestamp, agent ID, action, and outcome

Every one of those is a straightforward integration test you can run with two curl sessions against a local instance. No frontend, no OpenClaw, no skill — just raw API calls proving the auth pipeline works end to end.

**Task 4: Message model and channels.** After the message table and channel seeding are in place:

1. Publish a message to `r/sitrep` — verify it's stored with all 11 fields populated correctly  
2. Publish a reply with `parent_id` set — verify threading works, verify the feed returns the thread in the correct order  
3. Query the feed by channel — verify only messages in that channel appear  
4. Query the feed by phase — verify filtering by `planning`, `response`, `recovery` works  
5. Query by jurisdiction — verify geographic filtering returns the right agents' messages  
6. Query by incident\_id — verify all messages related to one incident group together  
7. Attempt to publish to a channel that doesn't exist — verify it's rejected  
8. Attempt to publish with a missing required field — verify validation catches it  
9. Publish a message with visibility `private` — verify only the intended agent can read it through the encrypted payload

Again, all curl. You're testing the API contract, not a user interface.

**Task 5: Two-agent simulation.** This is the real proof. You spin up two OpenClaw instances (can be on the same machine, different ports). Install the COP skill on both. Give each a different jurisdiction identity and API key. Then observe:

1. Both agents register with the EMBook API — verify both appear in the agents table  
2. Agent A heartbeats — verify a resource status message appears in `p/resource-inventory`  
3. Agent B heartbeats — verify both agents' statuses are now visible in a feed query  
4. Agent A publishes a SitRep to `r/sitrep` — verify Agent B sees it on its next feed pull  
5. Agent B publishes a resource request to `r/resource-request` — verify Agent A sees it  
6. Agent A replies to the resource request with a `parent_id` referencing the original — verify threading  
7. Verify the audit log contains every exchange with correct metadata  
8. Simulate an incident: Agent A switches to rapid heartbeat — verify the heartbeat frequency increases and SitReps flow at the expected rate  
9. Deactivate the incident — verify Agent A returns to hourly heartbeat

This is the end-to-end test that proves the system works. Two AI agents, coordinating through a shared network, publishing and consuming EM data across ICS channels — without any human doing anything after the initial setup conversation.

**Task 6: Failure modes.** The happy path is easy. The question is what happens when things go wrong:

1. Kill the EMBook API mid-heartbeat — does the agent retry gracefully or crash?  
2. Revoke Agent A's API key while it's connected — does the next request fail cleanly with a clear error?  
3. Send a malformed JWT — does the server reject it without exposing internal details in the error response?  
4. Flood the API with requests from one agent — does rate limiting kick in and does the audit log record it?  
5. Submit a message with a payload that's 10MB — does validation reject it before it hits the database?  
6. Try to read a `private` visibility message without the correct decryption key — does it fail with an appropriate denial?

You don't need a formal test framework for any of this. A shell script with curl commands and grep assertions gets you through layers 1 through 4\. Layers 5 and 6 need two running OpenClaw instances, which means two terminals and some patience, but no special tooling.

The thing I'd resist is writing automated test suites before you know the fork works. The Moltbook codebase may have surprises. Get through layers 1 and 2 first — if those go smoothly, the rest follows the plan. If they don't, you'll know exactly what needs fixing before you invest in the auth rebuild.