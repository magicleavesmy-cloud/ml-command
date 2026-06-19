#!/usr/bin/env python3
"""
Adds a free calendar date picker to ml-command's Dashboard + Duitbiz views.
Run from inside the ml-command project root: python3 patch-date-picker.py
"""

import re
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

# 1. Add selectedDate state next to range state
must_replace(
    '  const [range, setRange] = useState("week");',
    '  const [range, setRange] = useState("week");\n'
    '  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));',
    "add selectedDate state",
)

# 2. Replace todayKey / yesterdayKey computation to be based on selectedDate
must_replace(
    '  const todayKey = toDateKey(new Date());\n'
    '  const yesterdayKey = (() => {\n'
    '    const date = new Date();\n'
    '    date.setDate(date.getDate() - 1);\n'
    '    return toDateKey(date);\n'
    '  })();',
    '  const todayKey = selectedDate;\n'
    '  const yesterdayKey = (() => {\n'
    '    const date = new Date(`${selectedDate}T00:00:00`);\n'
    '    date.setDate(date.getDate() - 1);\n'
    '    return toDateKey(date);\n'
    '  })();\n'
    '  const isViewingToday = selectedDate === toDateKey(new Date());\n'
    '  const selectedDateLabel = (() => {\n'
    '    const parsed = new Date(`${selectedDate}T00:00:00`);\n'
    '    return Number.isNaN(parsed.getTime())\n'
    '      ? selectedDate\n'
    '      : parsed.toLocaleDateString("en-MY", { day: "2-digit", month: "short" });\n'
    '  })();',
    "rebind todayKey/yesterdayKey to selectedDate + add label/isViewingToday helpers",
)

# 3. Also rebase metrics' internal todayKey (separate const inside useMemo) to selectedDate
must_replace(
    '  const metrics = useMemo(() => {\n'
    '    const todayKey = toDateKey(new Date());',
    '  const metrics = useMemo(() => {\n'
    '    const todayKey = selectedDate;',
    "rebind metrics() internal todayKey to selectedDate",
)
must_replace(
    '  }, [dashboard]);',
    '  }, [dashboard, selectedDate]);',
    "add selectedDate to metrics useMemo deps",
)

# 4. Update "Total Sales Today" card label to use selectedDateLabel
must_replace(
    '<p>Total Sales Today</p>',
    '<p>{isViewingToday ? "Total Sales Today" : `Total Sales (${selectedDateLabel})`}</p>',
    "dynamic Total Sales card label",
)

# 5. Update "vs yesterday" trend text to be date-aware
must_replace(
    '{businessHealth.salesTrend >= 0 ? "Up" : "Down"} {formatPercent(Math.abs(businessHealth.salesTrend))} vs yesterday',
    '{businessHealth.salesTrend >= 0 ? "Up" : "Down"} {formatPercent(Math.abs(businessHealth.salesTrend))} vs {isViewingToday ? "yesterday" : "previous day"}',
    "dynamic vs yesterday/previous day label",
)

# 6. Add the date picker input into the topbar actions
must_replace(
    '          <div className={styles.topbarActions}>\n'
    '            <button className={styles.iconButton} type="button" title="Search">',
    '          <div className={styles.topbarActions}>\n'
    '            <input\n'
    '              aria-label="Select date"\n'
    '              className={styles.datePickerInput}\n'
    '              max={toDateKey(new Date())}\n'
    '              onChange={(event) => event.target.value && setSelectedDate(event.target.value)}\n'
    '              type="date"\n'
    '              value={selectedDate}\n'
    '            />\n'
    '            {!isViewingToday && (\n'
    '              <button\n'
    '                className={styles.viewAllButton}\n'
    '                onClick={() => setSelectedDate(toDateKey(new Date()))}\n'
    '                type="button"\n'
    '              >\n'
    '                Today\n'
    '              </button>\n'
    '            )}\n'
    '            <button className={styles.iconButton} type="button" title="Search">',
    "insert date picker input + Today reset button into topbar",
)

if content == original:
    print("No changes were made. Nothing matched — file may already differ from expected source.")
    sys.exit(1)

with open(PATH, "w") as f:
    f.write(content)

print("Patched", PATH)
if errors:
    print("\n".join(errors))
    print("\nSome patterns were skipped/warned above — review app/page.js manually for those spots.")
else:
    print("All patches applied cleanly.")

print("\nNext steps:")
print("1. Add this CSS rule to app/page.module.css for the date input:")
print("""
.datePickerInput {
  border: 1px solid rgba(31, 75, 38, 0.15);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
  color: inherit;
  background: var(--card-bg, #fff);
  cursor: pointer;
}
""")
print("2. Restart your dev server (npm run dev) and hard-refresh the browser.")
