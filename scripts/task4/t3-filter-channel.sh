#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 3
# Filter feed by channel — only messages in that channel should appear.
#
# Requires: $JWT (run source scripts/task4/00-setup.sh first)
# Usage: bash scripts/task4/t3-filter-channel.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 3 — Filter feed by channel"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Publish a message to a different channel ───────────────────────────────
echo ""
echo "▶ Publishing a message to p/resource-inventory ..."

curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "channel":      "p/resource-inventory",
    "jurisdiction": "06037",
    "phase":        "planning",
    "message_type": "resource_status",
    "visibility":   "network",
    "payload": {"engines": 5, "tenders": 2, "personnel": 20, "status": "available"}
  }' > /dev/null

echo "✅ resource_status published to p/resource-inventory"

# ── Query r/sitrep feed ────────────────────────────────────────────────────
echo ""
echo "▶ GET /feed?channel=r%2Fsitrep ..."

SITREP_FEED=$(curl -s "$BASE/feed?channel=r%2Fsitrep" \
  -H "Authorization: Bearer $JWT")

echo "$SITREP_FEED" | python3 -m json.tool 2>/dev/null || echo "$SITREP_FEED"

echo ""
echo "▶ GET /feed?channel=p%2Fresource-inventory ..."

RESOURCE_FEED=$(curl -s "$BASE/feed?channel=p%2Fresource-inventory" \
  -H "Authorization: Bearer $JWT")

echo "$RESOURCE_FEED" | python3 -m json.tool 2>/dev/null || echo "$RESOURCE_FEED"

echo ""
echo "── Assertions ──────────────────────────────────"

python3 - <<'PYEOF'
import sys, json, os
import urllib.parse

def fetch(url):
    import subprocess
    r = subprocess.run(
        ["curl", "-s", url, "-H", f"Authorization: Bearer {os.environ['JWT']}"],
        capture_output=True, text=True
    )
    return json.loads(r.stdout)

sitrep_data   = fetch("http://localhost:3000/api/v1/feed?channel=r%2Fsitrep")
resource_data = fetch("http://localhost:3000/api/v1/feed?channel=p%2Fresource-inventory")

sitrep_msgs   = sitrep_data.get("data", sitrep_data.get("messages", []))
resource_msgs = resource_data.get("data", resource_data.get("messages", []))

sitrep_wrong   = [m for m in sitrep_msgs   if m.get("channel") != "r/sitrep"]
resource_wrong = [m for m in resource_msgs if m.get("channel") != "p/resource-inventory"]

checks = [
    ("r/sitrep feed has messages",              len(sitrep_msgs) > 0),
    ("all r/sitrep messages are in r/sitrep",   len(sitrep_wrong) == 0),
    ("p/resource-inventory feed has messages",  len(resource_msgs) > 0),
    ("all resource msgs in right channel",      len(resource_wrong) == 0),
    ("cross-channel isolation: r/sitrep feed has no resource msgs",
        all(m.get("channel") != "p/resource-inventory" for m in sitrep_msgs)),
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
echo "Test 3 PASSED ✅"
