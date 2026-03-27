#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 1
# Publish a message to r/sitrep and verify all 11 fields are stored correctly.
#
# Can be run standalone OR sourced by run-all.sh (exports MSG1_ID).
# Requires: $JWT and $AGENT_ID set (run: source scripts/task4/00-setup.sh first)
# Usage:
#   bash scripts/task4/t1-publish-sitrep.sh        # standalone
#   source scripts/task4/t1-publish-sitrep.sh      # from run-all.sh
# ─────────────────────────────────────────────────────────────────────────────

# Guard: don't inherit set -e from parent when sourced — each test manages its own exit
[[ "${BASH_SOURCE[0]}" == "${0}" ]] && set -euo pipefail

_t1_fail() { echo "$1"; return 1 2>/dev/null || exit 1; }

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 1 — Publish to r/sitrep, verify 11 fields"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  _t1_fail "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
fi

# ── Publish the message ────────────────────────────────────────────────────
echo ""
echo "▶ POST /messages — publishing SitRep to r/sitrep ..."

RESPONSE=$(curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "channel":      "r/sitrep",
    "jurisdiction": "06037",
    "incident_id":  "INC-2026-001",
    "phase":        "response",
    "message_type": "sitrep",
    "visibility":   "network",
    "payload": {
      "period":   "2026-03-26T08:00/2026-03-26T20:00",
      "summary":  "Fire at 30% containment. 3 structures threatened.",
      "resources": {"engines": 12, "personnel": 84},
      "next_briefing": "2026-03-26T20:00:00Z"
    }
  }')

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

# ── Extract message ID ─────────────────────────────────────────────────────
export MSG1_ID
MSG1_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['id'])" 2>/dev/null || true)

if [[ -z "${MSG1_ID:-}" || "$MSG1_ID" == "None" ]]; then
  _t1_fail "❌ Publish failed — no message ID returned."
fi

echo ""
echo "✅ Message published. MSG1_ID=$MSG1_ID"

# ── Verify the stored message via GET ─────────────────────────────────────
echo ""
echo "▶ GET /messages/$MSG1_ID — verify all 11 fields ..."

MSG=$(curl -s "$BASE/messages/$MSG1_ID" \
  -H "Authorization: Bearer $JWT")

echo "$MSG" | python3 -m json.tool 2>/dev/null || echo "$MSG"

# ── Field-by-field assertions ──────────────────────────────────────────────
echo ""
echo "── Assertions ──────────────────────────────────"

python3 - <<'PYEOF'
import sys, json, os, subprocess

msg_id = os.environ["MSG1_ID"]
jwt    = os.environ["JWT"]

r = subprocess.run(
    ["curl", "-s", f"http://localhost:3000/api/v1/messages/{msg_id}",
     "-H", f"Authorization: Bearer {jwt}"],
    capture_output=True, text=True
)
data = json.loads(r.stdout)["message"]

checks = [
    ("id present",            bool(data.get("id"))),
    ("agent_id present",      bool(data.get("agent_id"))),
    ("parent_id is null",     data.get("parent_id") is None),
    ("channel = r/sitrep",    data.get("channel") == "r/sitrep"),
    ("jurisdiction = 06037",  data.get("jurisdiction") == "06037"),
    ("incident_id set",       data.get("incident_id") == "INC-2026-001"),
    ("phase = response",      data.get("phase") == "response"),
    ("message_type = sitrep", data.get("message_type") == "sitrep"),
    ("visibility = network",  data.get("visibility") == "network"),
    ("payload is object",     isinstance(data.get("payload"), dict)),
    ("timestamp present",     bool(data.get("timestamp"))),
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
echo "Test 1 PASSED ✅"
echo "MSG1_ID=$MSG1_ID  (exported for t2-threading.sh)"
