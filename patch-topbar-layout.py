#!/usr/bin/env python3
"""
Fixes topbar cramping/wrapping caused by adding the date picker.
Splits the topbar into two rows: greeting on top, action controls below,
so nothing fights for horizontal space and "Welcome, Adam" never wraps.

Run from inside the ml-command project root: python3 patch-topbar-layout.py
"""

import sys

PATH = "app/page.module.css"

with open(PATH, "r") as f:
    content = f.read()

original = content
errors = []

def must_replace(old, new, label):
    global content
    if old not in content:
        errors.append(f"[SKIP] Pattern not found for: {label}")
        return
    if content.count(old) > 1:
        errors.append(f"[WARN] Pattern appears multiple times for: {label} (replacing first only)")
    content = content.replace(old, new, 1)

# 1. Change .topbar from a single flex row to a wrapping two-row layout
must_replace(
    '''.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}''',
    '''.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px 20px;
  margin-bottom: 22px;
}

.topbar > div:first-child {
  flex: 1 1 260px;
  min-width: 0;
}''',
    "split topbar into wrapping rows with greeting taking its own space",
)

# 2. Let topbarActions wrap onto its own full-width row and wrap internally if needed
must_replace(
    '''.topbarActions {
  gap: 10px;
  justify-content: flex-end;
}''',
    '''.topbarActions {
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

@media (min-width: 920px) {
  .topbarActions {
    flex: 0 1 auto;
  }
}''',
    "make topbarActions wrap to its own row on narrower screens, stay inline on wide screens",
)

if content == original:
    print("No changes were made. Nothing matched - file may already differ from expected source.")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(content)

print("Patched", PATH)
if errors:
    print("\n".join(errors))
    print("\nSome patterns were skipped/warned above - review app/page.module.css manually for those spots.")
else:
    print("All patches applied cleanly.")

print("\nRestart your dev server (npm run dev) and hard-refresh the browser.")
