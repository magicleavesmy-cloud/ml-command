#!/usr/bin/env python3
"""
Applies color-coded source labels to every panel in the Dashboard.
Adds a SourceLabel component and wires it + a colored left-border class onto
every <section className={...}> that contains a Duitbiz/DuitStock/Supplier Debt
eyebrow label.

Run AFTER patch-source-colors-css.py.
Run from inside the ml-command project root: python3 patch-source-colors-jsx.py
"""

import re
import sys

PATH = "app/page.js"

with open(PATH, "r") as f:
    content = f.read()

original = content

SOURCE_CLASS = {
    "Duitbiz": "sourceDuitbiz",
    "DuitStock": "sourceDuitStock",
    "Supplier Debt": "sourceSupplierDebt",
}

# 1. Add the SourceLabel helper component right after EmptyState
anchor = '''function EmptyState({ children }) {
  return <div className={styles.empty}>{children}</div>;
}'''

addition = '''function EmptyState({ children }) {
  return <div className={styles.empty}>{children}</div>;
}

const SOURCE_CLASS = {
  Duitbiz: "sourceDuitbiz",
  DuitStock: "sourceDuitStock",
  "Supplier Debt": "sourceSupplierDebt",
};

function SourceLabel({ source }) {
  return (
    <p className={`${styles.eyebrow} ${styles[SOURCE_CLASS[source]] || ""}`}>
      <span className={styles.sourceDot} />
      {source}
    </p>
  );
}'''

if anchor not in content:
    print("[FAIL] Could not find EmptyState anchor point. Aborting.")
    sys.exit(1)

if "function SourceLabel" in content:
    print("SourceLabel component already present - skipping component injection.")
else:
    content = content.replace(anchor, addition, 1)

# 2. Replace every <p className={styles.eyebrow}>SOURCE</p> with <SourceLabel source="SOURCE" />
replaced_count = 0
for source in SOURCE_CLASS:
    old = f'<p className={{styles.eyebrow}}>{source}</p>'
    new = f'<SourceLabel source="{source}" />'
    count = content.count(old)
    if count:
        content = content.replace(old, new)
        replaced_count += count
        print(f"Replaced {count} occurrence(s) of '{source}' eyebrow with SourceLabel.")
    else:
        print(f"[SKIP] No occurrences found for source label: {source}")

# 3. Find each <section className={...}> opening tag and check if a SourceLabel for a
#    known source appears before the NEXT <section, i.e. within that section's own header.
#    This avoids regex backtracking issues by doing a simple linear scan.
section_open_re = re.compile(r'<section className=(\{`[^`]*`\}|\{[^{}]*\}|"[^"]*")>')
source_label_re = re.compile(r'<SourceLabel source="([^"]+)" />')

sections = list(section_open_re.finditer(content))
border_applied = 0

# Process from the end backwards so earlier replacements don't shift later offsets
for i in range(len(sections) - 1, -1, -1):
    sec_match = sections[i]
    sec_start_of_class = sec_match.start(1)
    sec_end_of_class = sec_match.end(1)
    sec_tag_end = sec_match.end(0)
    next_start = sections[i + 1].start(0) if i + 1 < len(sections) else len(content)

    # Look for a SourceLabel that belongs to THIS section's own header, not a nested
    # child section's header. Require it to appear before the next nested <section
    # (if any) opens, AND within a short distance of this section's own opening tag
    # (panelHeader -> div -> SourceLabel is always close, ~150 chars in practice).
    next_nested_section = section_open_re.search(content, sec_tag_end)
    window_end = min(next_start, next_nested_section.start() if next_nested_section else next_start)
    window = content[sec_tag_end:window_end]
    label_match = source_label_re.search(window)
    if not label_match:
        continue
    if label_match.start() > 250:
        # Too far away to be this section's own header label - likely belongs deeper in
        continue
    source = label_match.group(1)
    border_class = SOURCE_CLASS.get(source)
    if not border_class:
        continue

    class_expr = content[sec_start_of_class:sec_end_of_class]

    if f"styles.{border_class}" in class_expr:
        continue  # already applied

    if class_expr.startswith('"') and class_expr.endswith('"'):
        inner = class_expr[1:-1]
        new_expr = "{`" + inner + " ${styles." + border_class + "}`}"
    elif class_expr.startswith("`") and class_expr.endswith("`"):
        # shouldn't normally happen since regex captures with braces, but handle anyway
        new_expr = class_expr[:-1] + " ${styles." + border_class + "}`"
    elif class_expr.startswith("{`") and class_expr.endswith("`}"):
        new_expr = class_expr[:-2] + " ${styles." + border_class + "}`}"
    elif class_expr.startswith("{styles.") and class_expr.endswith("}"):
        inner = class_expr[1:-1]
        new_expr = "{`${" + inner + "} ${styles." + border_class + "}`}"
    else:
        print(f"[WARN] Unrecognized className expression format near section #{i}: {class_expr!r} - skipped.")
        continue

    content = content[:sec_start_of_class] + new_expr + content[sec_end_of_class:]
    border_applied += 1

print(f"Applied source border class to {border_applied} panel section(s).")

if content == original:
    print("No changes were made overall.")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(content)

print("\nPatched", PATH)
print(f"Total SourceLabel replacements: {replaced_count}")
print("Restart your dev server (npm run dev) and hard-refresh the browser.")
