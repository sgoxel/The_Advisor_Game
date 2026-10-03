#!/usr/bin/env python3
from pathlib import Path

path = Path("docs/ROADMAP.md")
text = path.read_text(encoding="utf-8")
old = "- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch — ACCEPTED\n"
new = "- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch — COMPLETED\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one ACCEPTED WP016 roadmap entry, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("WP016 roadmap marked COMPLETED")
