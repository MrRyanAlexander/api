#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Test 5
# Filter feed by jurisdiction — returns only that jurisdiction's messages.
#
# Requires: $JWT
# Usage: bash scripts/task4/t5-filter-jurisdiction.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="http://localhost:3000/api/v1"
JURIS_A="06037"   # LA County
JURIS_B="06065"   # Riverside County

echo ""
echo "═══════════════════════════════════════════════"
echo "  Test 5 — Filter feed by jurisdiction"
echo "═══════════════════════════════════════════════"

if [[ -z "${JWT:-}" ]]; then
  echo "❌ JWT not set. Run: source scripts/task4/00-setup.sh"
  exit 1
fi

# ── Publish messages from two jurisdictions ────────────────────────────────
echo ""
echo "▶ Publishing messages for jurisdiction $JURIS_A and $JURIS_B ..."

curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"channel\":      \"r/sitrep\",
    \"jurisdiction\": \"$JURIS_A\",
    \"phase\":        \"response\",
    \"message_type\": \"sitrep\",
    \"visibility\":   \"network\",
    \"payload\": {\"jurisdiction_note\": \"This is from $JURIS_A\"}
  }" > /dev/null
echo "  ✅ Published jurisdiction=$JURIS_A"

curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"channel\":      \"r/sitrep\",
    \"jurisdiction\": \"$JURIS_B\",
    \"phase\":        \"response\",
    \"message_type\": \"sitrep\",
    \"visibility\":   \"network\",
    \"payload\": {\"jurisdiction_note\": \"This is from $JURIS_B\"}
  }" > /dev/null
echo "  ✅ Published jurisdiction=$JURIS_B"

# ── Query each jurisdiction ────────────────────────────────────────────────
echo ""
echo "▶ GET /feed?jurisdiction=$JURIS_A ..."
curl -s "$BASE/feed?jurisdiction=$JURIS_A" \
  -H "Authorization: Bearer $JWT" | python3 -m json.tool 2>/dev/null

echo ""
echo "▶ GET /feed?jurisdiction=$JURIS_B ..."
curl -s "$BASE/feed?jurisdiction=$JURIS_B" \
  -H "Authorization: Bearer $JWT" | python3 -m json.tool 2>/dev/null

# ── Assertions ────────────────────────────────────────────────────────────
echo ""
echo "── Assertions ──────────────────────────────────"

JURIS_A_VAL="$JURIS_A" JURIS_B_VAL="$JURIS_B" python3 - <<'PYEOF'
import sys, json, os, subprocess

def fetch(url):
    r = subprocess.run(
        ["curl", "-s", url, "-H", f"Authorization: Bearer {os.environ['JWT']}"],
        capture_output=True, text=True
    )
    return json.loads(r.stdout)

base = "http://localhost:3000/api/v1"
ja   = os.environ["JURIS_A_VAL"]
jb   = os.environ["JURIS_B_VAL"]

data_a = fetch(f"{base}/feed?jurisdiction={ja}")
data_b = fetch(f"{base}/feed?jurisdiction={jb}")

msgs_a = data_a.get("data", data_a.get("messages", []))
msgs_b = data_b.get("data", data_b.get("messages", []))

# ILIKE filter means the jurisdiction contains the search string
wrong_a = [m for m in msgs_a if ja not in m.get("jurisdiction", "")]
wrong_b = [m for m in msgs_b if jb not in m.get("jurisdiction", "")]

checks = [
    (f"jurisdiction {ja} returns messages",                 len(msgs_a) > 0),
    (f"all msgs in {ja} feed contain '{ja}'",               len(wrong_a) == 0),
    (f"jurisdiction {jb} returns messages",                 len(msgs_b) > 0),
    (f"all msgs in {jb} feed contain '{jb}'",               len(wrong_b) == 0),
    (f"{ja} feed doesn't contain {jb}-only messages",
        all(m.get("jurisdiction") != jb for m in msgs_a)),
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
echo "Test 5 PASSED ✅"
