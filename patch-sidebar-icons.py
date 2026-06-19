#!/usr/bin/env python3
"""
Replaces the sidebar nav's single-letter icon badges (D/D/D, S/S, L/L collisions)
with distinct inline SVG icons. No new npm dependency.

Run from inside the ml-command project root: python3 patch-sidebar-icons.py
"""

import sys

PATH = "app/page.js"

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

# 1. Add a NAV_ICONS lookup + small icon component, right after NAV_ITEMS constant
must_replace(
    'const NAV_ITEMS = ["Dashboard", "Duitbiz", "DuitStock", "Supplier Debt", "Settings", "Help", "Logout", "Lock"];',
    '''const NAV_ITEMS = ["Dashboard", "Duitbiz", "DuitStock", "Supplier Debt", "Settings", "Help", "Logout", "Lock"];

const NAV_ICON_PATHS = {
  Dashboard: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  Duitbiz: "M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H3V7Zm0 3h16v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7Zm11 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  DuitStock: "M12 2 3 6.5V17.5L12 22l9-4.5V6.5L12 2Zm0 2.2 6.2 3.1L12 10.6 5.8 7.5 12 4.2ZM5 9.3l6 3v7.6l-6-3V9.3Zm8 10.6v-7.6l6-3v7.6l-6 3Z",
  "Supplier Debt": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6.5-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20.5C2 17 5.5 14.5 9 14.5s7 2.5 7 6v.5H2v-.5Zm13.5-4.3c2.6.5 4.5 2.4 4.5 4.3v.5h-3v-.5c0-1.5-.6-2.9-1.5-4.3Z",
  Settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8.4 3a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L15.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7.5 7.5 0 0 0 6.6 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2L11.5 21h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  Help: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.1 15.5h-.2a1.1 1.1 0 1 1 0-2.2h.2a1.1 1.1 0 1 1 0 2.2ZM13 13.4v.6h-2v-1.2c0-1 .6-1.5 1.3-2 .6-.4 1.1-.8 1.1-1.5 0-.8-.7-1.3-1.5-1.3-.7 0-1.3.4-1.5 1.1l-1.9-.8C8.9 6.7 10.2 6 11.9 6c2 0 3.5 1.2 3.5 3 0 1.4-.9 2.1-1.7 2.7-.4.3-.7.6-.7 1.7Z",
  Logout: "M10 3a1 1 0 0 1 0 2H6v14h4a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5Zm6.3 4.3 4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4L17.6 13H9a1 1 0 1 1 0-2h8.6l-2.7-2.3a1 1 0 0 1 1.4-1.4Z",
  Lock: "M12 2a4 4 0 0 1 4 4v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1V6a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v3h4V6a2 2 0 0 0-2-2Zm0 9a1.5 1.5 0 0 0-.7 2.8v1.7a.7.7 0 1 0 1.4 0v-1.7A1.5 1.5 0 0 0 12 13Z",
};

function NavIcon({ item }) {
  const path = NAV_ICON_PATHS[item];
  if (!path) return <span>{item.slice(0, 1)}</span>;
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}''',
    "add NAV_ICON_PATHS lookup + NavIcon component",
)

# 2. Swap the rendered <span>{item.slice(0, 1)}</span> badge for <NavIcon item={item} />
must_replace(
    '              <span>{item.slice(0, 1)}</span>\n              {item}',
    '              <NavIcon item={item} />\n              {item}',
    "use NavIcon component in nav button",
)

if content == original:
    print("No changes were made. Nothing matched - file may already differ from expected source.")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(content)

print("Patched", PATH)
if errors:
    print("\n".join(errors))
    print("\nSome patterns were skipped/warned above - review app/page.js manually for those spots.")
else:
    print("All patches applied cleanly.")

print("\nOptional CSS tweak for app/page.module.css (if icon alignment looks off):")
print('''
.navItem span,
.navItem svg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}
''')
print("Restart your dev server (npm run dev) and hard-refresh the browser.")
