#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 4
# Filter feed by phase — planning, response, recovery each return only
# messages with that phase value.
#
# Requires: $JWT
# Usage: bash scripts/task4/t4-filter-phase.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 4 — Filter feed by phase"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Publish one message per phase ──────────────────────────────────────────
echo ""
echo "▶ Publishing one message in each phase ..."

for PHASE in planning response recovery; do
  curl -s -X POST "$BASE/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT" \
    -d "{
      \"channel\":      \"x/general\",
      \"jurisdiction\": \"06037\",
      \"phase\":        \"$PHASE\",
      \"message_type\": \"phase_test\",
      \"visibility\":   \"network\",
      \"payload\": {\"test_phase\": \"$PHASE\", \"note\": \"Task 4 phase filter test\"}
    }" > /dev/null
  echo "  ✅ Published phase=$PHASE"
done

# ── Query each phase ───────────────────────────────────────────────────────
echo ""

for PHASE in planning response recovery; do
  echo "▶ GET /feed?phase=$PHASE ..."
  curl -s "$BASE/feed?phase=$PHASE" \
    -H "Authorization: Bearer $JWT" | python3 -m json.tool 2>/dev/null
  echo ""
done

# ── Assertions ────────────────────────────────────────────────────────────
echo "── Assertions ──────────────────────────────────"

python3 - <<'PYEOF'
import sys, json, os, subprocess

def fetch(url):
    r = subprocess.run(
        ["curl", "-s", url, "-H", f"Authorization: Bearer {os.environ['JWT']}"],
        capture_output=True, text=True
    )
    return json.loads(r.stdout)

base = "http://localhost:3000/api/v1"
phases = ["planning", "response", "recovery"]
results = {p: fetch(f"{base}/feed?phase={p}") for p in phases}

checks = []
for phase in phases:
    msgs = results[phase].get("data", results[phase].get("messages", []))
    checks.append((f"{phase}: returns messages", len(msgs) > 0))
    wrong = [m for m in msgs if m.get("phase") != phase]
    checks.append((f"{phase}: no messages from other phases", len(wrong) == 0))

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
echo "Test 4 PASSED ✅"
