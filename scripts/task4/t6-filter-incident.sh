#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 6
# Filter feed by incident_id — all messages related to one incident group together.
#
# Requires: $JWT
# Usage: bash scripts/task4/t6-filter-incident.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"
INCIDENT_A="INC-2026-001"
INCIDENT_B="INC-2026-002"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 6 — Filter feed by incident_id"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Publish messages for two different incidents ───────────────────────────
echo ""
echo "▶ Publishing messages for $INCIDENT_A (3 messages) ..."

for i in 1 2 3; do
  curl -s -X POST "$BASE/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{
      \"channel\":      \"r/sitrep\",
      \"jurisdiction\": \"06037\",
      \"incident_id\":  \"$INCIDENT_A\",
      \"phase\":        \"response\",
      \"message_type\": \"sitrep\",
      \"visibility\":   \"network\",
      \"payload\": {\"sitrep_number\": $i, \"incident\": \"$INCIDENT_A\"}
    }" > /dev/null
  echo "  ✅ SitRep #$i for $INCIDENT_A"
done

echo ""
echo "▶ Publishing 1 message for $INCIDENT_B ..."

curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"channel\":      \"r/alerts\",
    \"jurisdiction\": \"06037\",
    \"incident_id\":  \"$INCIDENT_B\",
    \"phase\":        \"response\",
    \"message_type\": \"alert\",
    \"visibility\":   \"network\",
    \"payload\": {\"alert\": \"Separate incident activation\", \"incident\": \"$INCIDENT_B\"}
  }" > /dev/null
echo "  ✅ Alert for $INCIDENT_B"

# ── Query by incident_id ───────────────────────────────────────────────────
echo ""
echo "▶ GET /feed?incident_id=$INCIDENT_A ..."
curl -s "$BASE/feed?incident_id=$INCIDENT_A" \
  -H "Authorization: Bearer $JWT" | python3 -m json.tool 2>/dev/null

echo ""
echo "▶ GET /feed?incident_id=$INCIDENT_B ..."
curl -s "$BASE/feed?incident_id=$INCIDENT_B" \
  -H "Authorization: Bearer $JWT" | python3 -m json.tool 2>/dev/null

# ── Assertions ────────────────────────────────────────────────────────────
echo ""
echo "── Assertions ──────────────────────────────────"

INC_A="$INCIDENT_A" INC_B="$INCIDENT_B" python3 - <<'PYEOF'
import sys, json, os, subprocess

def fetch(url):
    r = subprocess.run(
        ["curl", "-s", url, "-H", f"Authorization: Bearer {os.environ['JWT']}"],
        capture_output=True, text=True
    )
    return json.loads(r.stdout)

base  = "http://localhost:3000/api/v1"
inc_a = os.environ["INC_A"]
inc_b = os.environ["INC_B"]

data_a = fetch(f"{base}/feed?incident_id={inc_a}")
data_b = fetch(f"{base}/feed?incident_id={inc_b}")

msgs_a = data_a.get("data", data_a.get("messages", []))
msgs_b = data_b.get("data", data_b.get("messages", []))

checks = [
    (f"{inc_a} returns 3 messages",            len(msgs_a) >= 3),
    (f"all {inc_a} msgs have correct incident",all(m.get("incident_id") == inc_a for m in msgs_a)),
    (f"{inc_b} returns 1 message",             len(msgs_b) >= 1),
    (f"all {inc_b} msgs have correct incident",all(m.get("incident_id") == inc_b for m in msgs_b)),
    (f"no {inc_b} msgs in {inc_a} feed",       all(m.get("incident_id") != inc_b for m in msgs_a)),
    (f"no {inc_a} msgs in {inc_b} feed",       all(m.get("incident_id") != inc_a for m in msgs_b)),
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
echo "Test 6 PASSED ✅"
