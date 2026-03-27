#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 8
# Attempt to publish with missing required fields — verify validation catches each.
#
# Requires: $JWT
# Usage: bash scripts/task4/t8-missing-field.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"
PASS=0
FAIL=0

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 8 — Missing required fields validation"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# Helper: send a body, expect a 400 with success=false
check_rejected() {
  local label="$1"
  local body="$2"

  RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "$body")

  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY_RAW=$(echo "$RESP" | head -1)

  SUCCESS_VAL=$(echo "$BODY_RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success','?'))" 2>/dev/null || echo "?")

  if [[ "$HTTP_CODE" == "400" && "$SUCCESS_VAL" == "False" ]]; then
    echo "  ✅ Rejected (400) — $label"
    PASS=$((PASS+1))
  else
    echo "  ❌ NOT rejected (HTTP $HTTP_CODE, success=$SUCCESS_VAL) — $label"
    echo "     Body: $BODY_RAW"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "▶ Testing missing fields ..."

# Missing channel
check_rejected "missing channel" '{
  "jurisdiction": "06037",
  "phase": "response",
  "message_type": "sitrep",
  "payload": {"note": "no channel"}
}'

# Missing jurisdiction
check_rejected "missing jurisdiction" '{
  "channel": "r/sitrep",
  "phase": "response",
  "message_type": "sitrep",
  "payload": {"note": "no jurisdiction"}
}'

# Missing phase
check_rejected "missing phase" '{
  "channel": "r/sitrep",
  "jurisdiction": "06037",
  "message_type": "sitrep",
  "payload": {"note": "no phase"}
}'

# Missing message_type
check_rejected "missing message_type" '{
  "channel": "r/sitrep",
  "jurisdiction": "06037",
  "phase": "response",
  "payload": {"note": "no message_type"}
}'

# Missing payload
check_rejected "missing payload" '{
  "channel": "r/sitrep",
  "jurisdiction": "06037",
  "phase": "response",
  "message_type": "sitrep"
}'

# Invalid phase enum
check_rejected "invalid phase value" '{
  "channel": "r/sitrep",
  "jurisdiction": "06037",
  "phase": "firefighting",
  "message_type": "sitrep",
  "payload": {"note": "bad phase"}
}'

# Invalid visibility enum
check_rejected "invalid visibility value" '{
  "channel": "r/sitrep",
  "jurisdiction": "06037",
  "phase": "response",
  "message_type": "sitrep",
  "visibility": "classified",
  "payload": {"note": "bad visibility"}
}'

echo ""
echo "── Summary ──────────────────────────────────"
TOTAL=$((PASS+FAIL))
echo "  Passed: $PASS / $TOTAL"

if [[ $FAIL -gt 0 ]]; then
  echo "  ❌ $FAIL test(s) failed."
  exit 1
fi

echo ""
echo "Test 8 PASSED ✅"
