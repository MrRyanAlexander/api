#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 7
# Attempt to publish to a channel that doesn't exist — verify rejection.
#
# Requires: $JWT
# Usage: bash scripts/task4/t7-invalid-channel.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 7 — Reject publish to nonexistent channel"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Attempt publish to a fake channel ─────────────────────────────────────
echo ""
echo "▶ POST /messages to channel 'r/notreal' (should fail) ..."

RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "channel":      "r/notreal",
    "jurisdiction": "06037",
    "phase":        "response",
    "message_type": "sitrep",
    "visibility":   "network",
    "payload":      {"note": "this should be rejected"}
  }')

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)

echo "HTTP Status: $HTTP_CODE"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

echo ""
echo "── Assertions ──────────────────────────────────"

HTTP_CODE="$HTTP_CODE" BODY_FILE=$(mktemp) python3 - <<'PYEOF'
import sys, json, os, subprocess

jwt  = os.environ["JWT"]
code = os.environ["HTTP_CODE"]

# Re-fetch with subprocess so no shell escaping issues
r = subprocess.run(
    ["curl", "-s", "-X", "POST", "http://localhost:3000/api/v1/messages",
     "-H", "Content-Type: application/json",
     "-H", f"Authorization: Bearer {jwt}",
     "-d", '{"channel":"r/notreal","jurisdiction":"06037","phase":"response","message_type":"sitrep","visibility":"network","payload":{"note":"rejection test"}}'],
    capture_output=True, text=True
)

try:
    body = json.loads(r.stdout)
except Exception:
    body = {}

checks = [
    ("HTTP status is 400",              code == "400"),
    ("success is false",                body.get("success") == False),
    ("error message mentions channel",  "channel" in (body.get("error","") + body.get("message","")).lower()),
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
echo "Test 7 PASSED ✅"
