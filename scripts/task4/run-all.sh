#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EMBook Task 4 — Master Test Runner
#
# Runs all 9 Task 4 tests in sequence.
# Stops on first failure and reports the result.
#
# Usage:
#   cd ~/Projects/embook/api
#   bash scripts/task4/run-all.sh
#
# Prerequisites:
#   - Server running:  npm run dev
#   - DB migrated:     psql -U moltbook -d moltbook -f scripts/migrate-messages.sql
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0
RESULTS=()

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   EMBook Task 4 — Full Test Suite             ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ── Setup: register agent + get JWT ─────────────────────────────────────────
# Source into current shell so API_KEY, JWT, AGENT_ID are available here
echo "[ SETUP ] Registering test agent and acquiring JWT ..."
source "$SCRIPT_DIR/00-setup.sh"

# ── Helper: run a test in the CURRENT shell (source) ─────────────────────────
# This is needed for tests that export variables used by subsequent tests.
run_sourced() {
  local num="$1"
  local label="$2"
  local script="$3"

  echo ""
  echo "────────────────────────────────────────────────"
  echo "  Running Test $num: $label"
  echo "────────────────────────────────────────────────"

  if source "$SCRIPT_DIR/$script"; then
    PASS=$((PASS+1))
    RESULTS+=("✅  Test $num — $label")
  else
    FAIL=$((FAIL+1))
    RESULTS+=("❌  Test $num — $label  ← FAILED")
    echo ""
    echo "⛔  Test $num FAILED. Aborting suite."
    print_summary
    exit 1
  fi
}

# ── Helper: run a test as a subprocess (bash) ─────────────────────────────────
# Used for tests that are self-contained and don't need to export state.
# Exports JWT, AGENT_ID, MSG1_ID, REPLY_ID into subprocess env automatically
# because they are already exported in the current shell.
run_sub() {
  local num="$1"
  local label="$2"
  local script="$3"

  echo ""
  echo "────────────────────────────────────────────────"
  echo "  Running Test $num: $label"
  echo "────────────────────────────────────────────────"

  if bash "$SCRIPT_DIR/$script"; then
    PASS=$((PASS+1))
    RESULTS+=("✅  Test $num — $label")
  else
    FAIL=$((FAIL+1))
    RESULTS+=("❌  Test $num — $label  ← FAILED")
    echo ""
    echo "⛔  Test $num FAILED. Aborting suite."
    print_summary
    exit 1
  fi
}

print_summary() {
  echo ""
  echo "╔═══════════════════════════════════════════════╗"
  echo "║   Results Summary                             ║"
  echo "╚═══════════════════════════════════════════════╝"
  for r in "${RESULTS[@]}"; do echo "  $r"; done
  echo ""
  echo "  Passed: $PASS / $((PASS+FAIL))"
  if [[ $FAIL -gt 0 ]]; then
    echo "  Status: ❌ SOME TESTS FAILED"
  else
    echo "  Status: ✅ ALL TESTS PASSED"
  fi
  echo ""
}

# ── Run tests ─────────────────────────────────────────────────────────────────
#
# Tests 1 and 2 are sourced because:
#   t1 exports MSG1_ID (needed by t2)
#   t2 exports REPLY_ID (not used further, but sourcing is consistent)
#
# All other tests are independent — they only need JWT/AGENT_ID which are
# already exported in the current shell and thus visible to subprocesses.

run_sourced 1 "Publish to r/sitrep, verify 11 fields"   t1-publish-sitrep.sh
run_sourced 2 "Threaded reply with parent_id"            t2-threading.sh

run_sub     3 "Filter feed by channel"                   t3-filter-channel.sh
run_sub     4 "Filter feed by phase"                     t4-filter-phase.sh
run_sub     5 "Filter feed by jurisdiction"              t5-filter-jurisdiction.sh
run_sub     6 "Filter feed by incident_id"               t6-filter-incident.sh
run_sub     7 "Reject publish to nonexistent channel"    t7-invalid-channel.sh
run_sub     8 "Missing required field validation"        t8-missing-field.sh
run_sub     9 "Private visibility + encrypted payload"   t9-private-visibility.sh

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary

# Sanity check: list channels
echo "── ICS Channels (sanity check) ──────────────────"
curl -s http://localhost:3000/api/v1/channels | python3 -m json.tool 2>/dev/null || true
echo ""
