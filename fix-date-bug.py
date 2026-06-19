#!/usr/bin/env python3
"""
Fixes a temporal dead zone bug introduced by the date-picker patch.
`businessHealth` useMemo references todayKey/yesterdayKey before they're
declared further down the file. This moves those declarations above
the metrics/businessHealth block.

Run from inside the ml-command project root: python3 fix-date-bug.py
"""

import sys

PATH = "app/page.js"

with open(PATH, "r") as f:
    content = f.read()

original = content

# The block that's currently in the WRONG place (after businessHealth)
misplaced_block = '''  const todayKey = selectedDate;
  const yesterdayKey = (() => {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() - 1);
    return toDateKey(date);
  })();
  const isViewingToday = selectedDate === toDateKey(new Date());
  const selectedDateLabel = (() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? selectedDate
      : parsed.toLocaleDateString("en-MY", { day: "2-digit", month: "short" });
  })();

  const businessHealth = useMemo(() => {'''

# Where it should go: right before "const metrics = useMemo"
target_anchor = '  const metrics = useMemo(() => {\n    const todayKey = selectedDate;'

if misplaced_block not in content:
    print("[FAIL] Could not find the misplaced todayKey/yesterdayKey block.")
    print("File may already be fixed, or differs from expected source.")
    sys.exit(1)

if target_anchor not in content:
    print("[FAIL] Could not find the metrics useMemo anchor point.")
    sys.exit(1)

# 1. Remove the misplaced block, leaving just "const businessHealth = useMemo(() => {"
content = content.replace(
    misplaced_block,
    '  const businessHealth = useMemo(() => {',
    1
)

# 2. Re-insert the block right before metrics() (so it's declared before BOTH metrics and businessHealth use it)
hoisted_block = '''  const todayKey = selectedDate;
  const yesterdayKey = (() => {
    const date = new Date(`${selectedDate}T00:00:00`);
    date.setDate(date.getDate() - 1);
    return toDateKey(date);
  })();
  const isViewingToday = selectedDate === toDateKey(new Date());
  const selectedDateLabel = (() => {
    const parsed = new Date(`${selectedDate}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? selectedDate
      : parsed.toLocaleDateString("en-MY", { day: "2-digit", month: "short" });
  })();

'''

content = content.replace(target_anchor, hoisted_block + target_anchor, 1)

if content == original:
    print("No changes were made.")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(content)

print("Fixed: moved todayKey/yesterdayKey/isViewingToday/selectedDateLabel above their first use.")
print("Restart your dev server (npm run dev) and hard-refresh the browser.")
