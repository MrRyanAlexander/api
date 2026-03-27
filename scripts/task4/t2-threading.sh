#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 2
# Publish a reply with parent_id set; verify threading via /thread endpoint.
#
# Can be run standalone OR sourced by run-all.sh.
# Requires: $JWT, $AGENT_ID, $MSG1_ID (exported by t1-publish-sitrep.sh)
# Usage:
#   source scripts/task4/00-setup.sh && source scripts/task4/t1-publish-sitrep.sh
#   bash scripts/task4/t2-threading.sh        # standalone
#   source scripts/task4/t2-threading.sh      # from run-all.sh
# ─────────────────────────────────────────────────────────────────────────────

[[ "${BASH_SOURCE[0]}" == "${0}" ]] && set -euo pipefail

_t2_fail() { echo "$1"; return 1 2>/dev/null || exit 1; }

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 2 — Threaded reply (parent_id)"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" || -z "${MSG1_ID:-}" ]]; then
  _t2_fail "❌ JWT or MSG1_ID not set. Run: source scripts/task4/00-setup.sh && source scripts/task4/t1-publish-sitrep.sh"
fi

# ── Publish reply ──────────────────────────────────────────────────────────
echo ""
echo "▶ Publishing reply to MSG1_ID=$MSG1_ID ..."

REPLY=$(curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"parent_id\":   \"$MSG1_ID\",
    \"channel\":     \"r/sitrep\",
    \"jurisdiction\":\"06037\",
    \"incident_id\": \"INC-2026-001\",
    \"phase\":       \"response\",
    \"message_type\":\"sitrep_update\",
    \"visibility\":  \"network\",
    \"payload\": {
      \"update\": \"Containment improved to 45%. Air tanker released.\",
      \"updated_at\": \"2026-03-26T12:00:00Z\"
    }
  }")

echo "$REPLY" | python3 -m json.tool 2>/dev/null || echo "$REPLY"

export REPLY_ID
REPLY_ID=$(echo "$REPLY" | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['id'])" 2>/dev/null || true)

if [[ -z "${REPLY_ID:-}" || "$REPLY_ID" == "None" ]]; then
  _t2_fail "❌ Reply publish failed."
fi

echo ""
echo "✅ Reply published. REPLY_ID=$REPLY_ID"

# ── Verify thread ──────────────────────────────────────────────────────────
echo ""
echo "▶ GET /messages/$MSG1_ID/thread ..."

THREAD=$(curl -s "$BASE/messages/$MSG1_ID/thread" \
  -H "Authorization: Bearer $JWT")

echo "$THREAD" | python3 -m json.tool 2>/dev/null || echo "$THREAD"

echo ""
echo "── Assertions ──────────────────────────────────"

python3 - <<'PYEOF'
import sys, json, os, subprocess

msg1_id  = os.environ["MSG1_ID"]
reply_id = os.environ["REPLY_ID"]
jwt      = os.environ["JWT"]

r = subprocess.run(
    ["curl", "-s", f"http://localhost:3000/api/v1/messages/{msg1_id}/thread",
     "-H", f"Authorization: Bearer {jwt}"],
    capture_output=True, text=True
)
data   = json.loads(r.stdout)
thread = data["thread"]

root  = next((m for m in thread if m["id"] == msg1_id),  None)
reply = next((m for m in thread if m["id"] == reply_id), None)

checks = [
    ("thread has 2 messages",         len(thread) == 2),
    ("root message present",          root is not None),
    ("reply message present",         reply is not None),
    ("reply.parent_id = root.id",     reply["parent_id"] == msg1_id if reply else False),
    ("root comes before reply (asc)", thread[0]["id"] == msg1_id if len(thread) == 2 else False),
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
echo "Test 2 PASSED ✅"
echo "REPLY_ID=$REPLY_ID  (exported)"
