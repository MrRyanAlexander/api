#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 9
# Publish a private visibility message with an encrypted payload.
# Verify: (a) the message is stored, (b) the payload is opaque ciphertext,
#         (c) querying with visibility=private returns it.
#
# This test uses the Node.js E2E encryption module directly since the API
# does not auto-encrypt — the agent is responsible for encrypting before publish.
# The test mirrors what a real agent would do.
#
# Requires: $JWT, $AGENT_ID
# Usage: bash scripts/task4/t9-private-visibility.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 9 — Private visibility + encrypted payload"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" || -z "${AGENT_ID:-}" ]]; then
  echo "❌ JWT or AGENT_ID not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Step 1: Generate a key pair and encrypt a payload (node script) ─────────
echo ""
echo "▶ Encrypting payload with E2E module ..."

ENCRYPT_RESULT=$(node -e "
const { generateKeyPair, encryptPayload } = require('./src/auth/encryption');
const pair = generateKeyPair();
const plaintext = JSON.stringify({
  sensitive: true,
  mutual_aid_request: 'Need 4 type-1 engines for INC-2026-001',
  recipient_agency: 'Riverside County OES'
});
const envelope = encryptPayload(plaintext, pair.publicKey);
// Print as JSON: { envelope, publicKey, privateKey }
console.log(JSON.stringify({ envelope, publicKey: pair.publicKey, privateKey: pair.privateKey }));
")

ENVELOPE=$(echo "$ENCRYPT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['envelope']))")
PRIV_KEY=$(echo "$ENCRYPT_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['privateKey'])")

echo "✅ Payload encrypted. Envelope (truncated):"
echo "$ENVELOPE" | python3 -c "import sys; print(sys.stdin.read()[:120] + '...')"

# ── Step 2: Publish private message with encrypted payload ───────────────────
echo ""
echo "▶ Publishing private message to r/resource-request ..."

# Escape the envelope for embedding in JSON body
ESCAPED_ENVELOPE=$(echo "$ENVELOPE" | python3 -c "import sys,json; print(json.dumps(json.loads(sys.stdin.read())))")

PUBLISH_RESP=$(curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"channel\":      \"r/resource-request\",
    \"jurisdiction\": \"06037\",
    \"incident_id\":  \"INC-2026-001\",
    \"phase\":        \"response\",
    \"message_type\": \"resource_request\",
    \"visibility\":   \"private\",
    \"payload\":      $ESCAPED_ENVELOPE
  }")

echo "$PUBLISH_RESP" | python3 -m json.tool 2>/dev/null || echo "$PUBLISH_RESP"

export PRIV_MSG_ID=$(echo "$PUBLISH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['id'])")

if [[ -z "$PRIV_MSG_ID" || "$PRIV_MSG_ID" == "None" ]]; then
  echo "❌ Private message publish failed."
  exit 1
fi
echo "✅ Private message published. PRIV_MSG_ID=$PRIV_MSG_ID"

# ── Step 3: Retrieve the stored message and verify payload is ciphertext ─────
echo ""
echo "▶ Fetching stored message — verifying payload is opaque ciphertext ..."

STORED=$(curl -s "$BASE/messages/$PRIV_MSG_ID" \
  -H "Authorization: Bearer $JWT")

echo "$STORED" | python3 -m json.tool 2>/dev/null || echo "$STORED"

# ── Step 4: Decrypt with private key — verify we get plaintext back ──────────
echo ""
echo "▶ Decrypting payload with agent private key ..."

export STORED_JSON=$(curl -s "$BASE/messages/$PRIV_MSG_ID" -H "Authorization: Bearer $JWT")
export PRIV_KEY

node -e "
const { decryptPayload } = require('./src/auth/encryption');
const stored  = JSON.parse(process.env.STORED_JSON);
const privKey = process.env.PRIV_KEY;
const envelope = stored.message.payload;
console.log('Stored payload encrypted flag:', envelope.encrypted);
console.log('Algorithm:', envelope.algorithm);
try {
  const decrypted = decryptPayload(envelope, privKey);
  const parsed    = JSON.parse(decrypted);
  if (parsed.sensitive === true && parsed.mutual_aid_request) {
    console.log('');
    console.log('Decryption result: PASS — plaintext recovered');
    console.log('Plaintext:', JSON.stringify(parsed, null, 2));
  } else {
    console.error('Decryption result: FAIL — unexpected content');
    process.exit(1);
  }
} catch(e) {
  console.error('Decryption result: FAIL —', e.message);
  process.exit(1);
}
" 2>&1

# ── Step 5: Confirm visibility filter works ───────────────────────────────────
echo ""
echo "▶ GET /feed?visibility=private — should include our private message ..."

VIS_FEED=$(curl -s "$BASE/feed?visibility=private" \
  -H "Authorization: Bearer $JWT")

echo "$VIS_FEED" | python3 -m json.tool 2>/dev/null || echo "$VIS_FEED"

echo ""
echo "── Assertions ──────────────────────────────────"

PRIV_MSG_ID_VAL="$PRIV_MSG_ID" python3 - <<'PYEOF'
import sys, json, os, subprocess

priv_id = os.environ["PRIV_MSG_ID_VAL"]
jwt     = os.environ["JWT"]

r1 = subprocess.run(
    ["curl", "-s", f"http://localhost:3000/api/v1/messages/{priv_id}",
     "-H", f"Authorization: Bearer {jwt}"],
    capture_output=True, text=True
)
r2 = subprocess.run(
    ["curl", "-s", "http://localhost:3000/api/v1/feed?visibility=private",
     "-H", f"Authorization: Bearer {jwt}"],
    capture_output=True, text=True
)

stored_msg = json.loads(r1.stdout)["message"]
feed_data  = json.loads(r2.stdout)
feed_msgs  = feed_data.get("data", feed_data.get("messages", []))

payload   = stored_msg["payload"]
plaintext = "mutual_aid_request"

checks = [
    ("visibility is 'private'",               stored_msg.get("visibility") == "private"),
    ("payload.encrypted is True",             payload.get("encrypted") == True),
    ("payload has no plaintext fields",       plaintext not in json.dumps(payload)),
    ("payload has ciphertext field",          "ciphertext" in payload),
    ("visibility feed contains our message",  any(m["id"] == priv_id for m in feed_msgs)),
]

passed = 0
for label, result in checks:
    icon = "✅" if result else "❌"
    print(f"  {icon} {label}")
    if result: passed += 1

print(f"\nResult: {passed}/{len(checks)} assertions passed")
if passed < len(checks):
    sys.exit(1)
PYEOF

echo ""
echo "Test 9 PASSED ✅"
