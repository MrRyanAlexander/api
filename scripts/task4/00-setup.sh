#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Setup helper
# Source this before running any test: source scripts/task4/00-setup.sh
#
# What it does:
#   1. Registers a fresh test agent (task4agent01)
#   2. Gets a JWT session token
#   3. Exports API_KEY, JWT, AGENT_ID into the shell environment
#
# Usage:
#   cd ~/Projects/embook/api
#   source scripts/task4/00-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"
AGENT_NAME="task4agent01"

echo ""
echo "═══════════════════════════════════════════════"
echo "  EMBook Task 4 — Setup"
echo "═══════════════════════════════════════════════"

# ── Step 1: Register agent ──────────────────────────────────────────────────
echo ""
echo "▶ Registering agent: $AGENT_NAME ..."

REG=$(curl -s -X POST "$BASE/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$AGENT_NAME\",\"description\":\"Task 4 message model test agent\"}")

echo "$REG" | python3 -m json.tool 2>/dev/null || echo "$REG"

export API_KEY=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])")
export AGENT_ID=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])")

if [[ -z "$API_KEY" || "$API_KEY" == "None" ]]; then
  echo ""
  echo "❌ Registration failed or agent name already taken."
  echo "   Try a different name or delete the existing agent from the DB:"
  echo "   psql -U moltbook -d moltbook -c \"DELETE FROM agents WHERE name='$AGENT_NAME';\""
  return 1 2>/dev/null || exit 1
fi

echo ""
echo "✅ Registered. AGENT_ID=$AGENT_ID"

# ── Step 2: Get JWT ─────────────────────────────────────────────────────────
echo ""
echo "▶ Exchanging API key for JWT ..."

TS=$(date +%s)
BODY="{\"api_key\":\"$API_KEY\"}"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print "sha256="$2}')

TOKEN_RESP=$(curl -s -X POST "$BASE/auth/token" \
  -H "Content-Type: application/json" \
  -H "X-EMBook-Signature: $SIG" \
  -H "X-EMBook-Timestamp: $TS" \
  -d "$BODY")

export JWT=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

if [[ -z "$JWT" || "$JWT" == "None" ]]; then
  echo "❌ Token exchange failed."
  echo "$TOKEN_RESP"
  return 1 2>/dev/null || exit 1
fi

echo "✅ JWT acquired (expires in 900s)"
echo ""
echo "─────────────────────────────────────────────"
echo " Exported vars:"
echo "   API_KEY  = ${API_KEY:0:20}..."
echo "   AGENT_ID = $AGENT_ID"
echo "   JWT      = ${JWT:0:30}..."
echo "─────────────────────────────────────────────"
echo ""
echo "Ready. Run any test script now."
echo ""
