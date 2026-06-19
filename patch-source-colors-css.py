#!/usr/bin/env python3
"""
Adds CSS for color-coding panels by data source (Duitbiz/DuitStock/Supplier Debt).
This is the CSS-only half of the change - run patch-source-colors-jsx.py after this
to actually apply the classes to each panel in app/page.js.

Run from inside the ml-command project root: python3 patch-source-colors-css.py
"""

import sys

PATH = "app/page.module.css"

with open(PATH, "r") as f:
    content = f.read()

original = content

addition = '''
/* Source color-coding: Duitbiz=green, DuitStock=teal, Supplier Debt=rust */
.sourceDuitbiz {
  border-left: 4px solid #1f6b31;
}

.sourceDuitbiz .eyebrow {
  color: #1f6b31;
}

.sourceDuitStock {
  border-left: 4px solid #00a896;
}

.sourceDuitStock .eyebrow {
  color: #00a896;
}

.sourceSupplierDebt {
  border-left: 4px solid #b33a2f;
}

.sourceSupplierDebt .eyebrow {
  color: #b33a2f;
}

.sourceDot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 999px;
  vertical-align: middle;
}

.sourceDuitbiz .sourceDot {
  background: #1f6b31;
}

.sourceDuitStock .sourceDot {
  background: #00a896;
}

.sourceSupplierDebt .sourceDot {
  background: #b33a2f;
}

.darkTheme .sourceDuitbiz .eyebrow {
  color: #4ec45f;
}

.darkTheme .sourceDuitStock .eyebrow {
  color: #2dd4c4;
}

.darkTheme .sourceSupplierDebt .eyebrow {
  color: #e0786c;
}
'''

if ".sourceDuitbiz" in content:
    print("Source color CSS already present - skipping to avoid duplicates.")
    sys.exit(0)

content = content.rstrip() + "\n" + addition

with open(PATH, "w") as f:
    f.write(content)

print("Added source color-coding CSS to", PATH)
print("Next: run patch-source-colors-jsx.py to apply these classes to each panel.")
