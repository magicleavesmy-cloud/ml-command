#!/usr/bin/env python3
"""
Applies the Ubuntu Google Font globally across ml-command using Next.js's
built-in font optimization (next/font/google) - no manual <link> tags,
no layout shift, automatically self-hosted by Next.js at build time.

Run from inside the ml-command project root: python3 patch-ubuntu-font.py
"""

import sys

PATH = "app/layout.js"

with open(PATH, "r") as f:
    content = f.read()

original = content

old = '''import "./globals.css";

export const metadata = {
  title: "Magic Leaves Command Center",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}'''

new = '''import { Ubuntu } from "next/font/google";
import "./globals.css";

const ubuntu = Ubuntu({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-ubuntu",
  display: "swap",
});

export const metadata = {
  title: "Magic Leaves Command Center",
  description: "Unified Magic Leaves dashboard for sales, stock, and supplier debt.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={ubuntu.variable}>
      <body>{children}</body>
    </html>
  );
}'''

if old not in content:
    print("[FAIL] Could not find expected layout.js content. File may have changed.")
    print("Paste the current content and I will adjust the patch.")
    sys.exit(1)

content = content.replace(old, new, 1)

with open(PATH, "w") as f:
    f.write(content)

print("Patched", PATH, "- Ubuntu font now loaded via next/font/google.")

# Now apply the font globally in globals.css
CSS_PATH = "app/globals.css"
with open(CSS_PATH, "r") as f:
    css_content = f.read()

css_original = css_content

font_rule = '''body {
  font-family: var(--font-ubuntu), "Ubuntu", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
'''

if "var(--font-ubuntu)" in css_content:
    print("Ubuntu font-family rule already present in globals.css - skipping.")
else:
    css_content = css_content.rstrip() + "\n\n" + font_rule
    with open(CSS_PATH, "w") as f:
        f.write(css_content)
    print("Added Ubuntu font-family rule to", CSS_PATH)

print("\nRestart your dev server (npm run dev) and hard-refresh the browser.")
print("Note: if globals.css already has a `body { font-family: ... }` rule,")
print("you may have two conflicting rules now - check and remove the old one if so.")
