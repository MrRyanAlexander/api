#!/usr/bin/env python3
"""
EMBook audit log reader.
Pipe curl output into this script:

    curl -s "https://api-production-f2d2.up.railway.app/api/v1/messages?sort=oldest&limit=50" \
      -H "Authorization: Bearer $TOKEN" | python3 scripts/audit.py
"""

import sys
import json

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"ERROR: Could not parse JSON from API response: {e}")
        print("Check that your $TOKEN is set and not expired.")
        sys.exit(1)

    messages = data.get("messages", data.get("data", []))

    if not messages:
        print("No messages found. Database may be empty or TOKEN may be invalid.")
        sys.exit(0)

    print("=== FULL MESSAGE LOG ===")
    print(f"{'#':>3}  {'timestamp':19}  {'channel':25}  {'jx':8}  {'phase':10}  {'type':20}  parent")
    print("-" * 110)

    for i, m in enumerate(messages, 1):
        pid = m.get("parent_id") or "-"
        ts  = m.get("created_at", m.get("timestamp", "?"))[:19]
        ch  = m.get("channel", "?")
        jx  = m.get("jurisdiction", "?")
        ph  = m.get("phase", "?")
        mt  = m.get("message_type", "?")
        # Shorten parent_id to first 8 chars for readability
        pid_short = pid[:8] if pid != "-" else "-"
        print(f"{i:3d}  {ts:19}  {ch:25}  {jx:8}  {ph:10}  {mt:20}  {pid_short}")

    print("-" * 110)
    print(f"Total: {len(messages)} messages")

if __name__ == "__main__":
    main()
