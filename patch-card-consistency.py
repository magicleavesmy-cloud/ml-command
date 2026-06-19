#!/usr/bin/env python3
"""
Harmonizes the visual weight of .kpiDark and .profitStatus* cards so they
read as part of the same card family instead of looking pasted-in.
Adds a stronger shadow + visible border to dark cards, and a subtle
colored border to profit-status tinted cards.

Run from inside the ml-command project root: python3 patch-card-consistency.py
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

# 1. Give .kpiDark its own border + stronger shadow so it doesn't look flat
must_replace(
    '''.kpiDark {
  background: #102115;
}''',
    '''.kpiDark {
  border-color: #1b3322;
  background: #102115;
  box-shadow: 0 22px 46px rgba(8, 20, 12, 0.32);
}''',
    "add border/shadow to .kpiDark",
)

# 2. Same treatment for the other dark "hero" card variants (intelligenceCard, statCard, miniCard 1st child)
must_replace(
    '''.intelligenceCard:nth-child(1) {
  background: #102115;
}''',
    '''.intelligenceCard:nth-child(1) {
  border-color: #1b3322;
  background: #102115;
  box-shadow: 0 22px 46px rgba(8, 20, 12, 0.32);
}''',
    "add border/shadow to .intelligenceCard:nth-child(1)",
)

must_replace(
    '''.statCard:nth-child(1) {
  background: #102115;
}''',
    '''.statCard:nth-child(1) {
  border-color: #1b3322;
  background: #102115;
  box-shadow: 0 22px 46px rgba(8, 20, 12, 0.32);
}''',
    "add border/shadow to .statCard:nth-child(1)",
)

must_replace(
    '''.miniCard:nth-child(3n + 1) {
  background: #102115;
}''',
    '''.miniCard:nth-child(3n + 1) {
  border-color: #1b3322;
  background: #102115;
  box-shadow: 0 22px 46px rgba(8, 20, 12, 0.32);
}''',
    "add border/shadow to .miniCard:nth-child(3n+1)",
)

# 3. Give the profit-status tinted cards a matching colored border so they read as a
#    cohesive status family instead of flat pastel fills
must_replace(
    '''.profitStatusgreen {
  background: #e8f8df;
}

.profitStatusorange {
  background: #fff4dd;
}

.profitStatusred {
  background: #ffe9e7;
}''',
    '''.profitStatusgreen {
  border-color: #b7e3a4;
  background: #e8f8df;
}

.profitStatusorange {
  border-color: #f3cf8e;
  background: #fff4dd;
}

.profitStatusred {
  border-color: #f3b3ac;
  background: #ffe9e7;
}''',
    "add colored borders to profit status cards",
)

# 4. Dark theme overrides: keep the hero cards visually distinct there too
must_replace(
    '''.darkTheme .kpiDark,
.darkTheme .intelligenceCard:nth-child(1),
.darkTheme .activeNavItem {
  background: #0c130e;
}''',
    '''.darkTheme .kpiDark,
.darkTheme .intelligenceCard:nth-child(1),
.darkTheme .activeNavItem {
  border-color: #2a4030;
  background: #0c130e;
  box-shadow: 0 22px 46px rgba(0, 0, 0, 0.4);
}''',
    "add border/shadow to dark-theme hero cards",
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
