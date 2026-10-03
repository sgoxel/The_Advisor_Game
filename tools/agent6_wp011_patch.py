#!/usr/bin/env python3
from datetime import datetime, timedelta, timezone
from pathlib import Path

WP = 'WP-S003-010-003-011'
RUN = '37089489060'
ARTIFACT = '11261904191'
HEAD = '29093d63130d3adae5ebb0355e2c1668f835cf72'
now = datetime.now(timezone(timedelta(hours=3))).strftime('%Y-%m-%d %H:%M +03:00')

changelog = Path('docs/changelog.txt')
changelog_line = (
    f"{now} | {WP} | Accepted MIXED evidence on main {HEAD}: full pure-zoom/canonical-scale/"
    f"scale-aware-navigation gate PASS (run {RUN}, artifact {ARTIFACT}); independent second SEED PASS; "
    "direct inspection of all ten primary scale screenshots VISUAL 8/10 PASS after removing the "
    "1/250–1/500 center-coordinate/focus-label collision while preserving the exact center glyph.\n"
)
text = changelog.read_text(encoding='utf-8')
if f'{WP} | Accepted MIXED evidence on main {HEAD}' not in text:
    changelog.write_text(changelog_line + text, encoding='utf-8')

suggest = Path('docs/suggest_log.txt')
suggest_line = (
    f"{now} | {WP} | Phase accepted-pure-zoom-2 | FUTURE — Improve terrain/material sharpness and "
    "settlement readability through the 1/500–1/5000 local tiers without changing the accepted canonical "
    "1/N scale ladder, fixed-focus pure-zoom invariant, world coordinates, deterministic SEED authority, "
    "or bounded navigation/streaming budgets. Require fresh screenshots and preserve the current no-overlap "
    "center-label presentation. Do not implement unless explicitly requested.\n"
)
text = suggest.read_text(encoding='utf-8')
if f'{WP} | Phase accepted-pure-zoom-2' not in text:
    suggest.write_text(suggest_line + text, encoding='utf-8')

for helper in [
    Path('.github/workflows/agent6-wp011-label-declutter.yml'),
    Path('tools/agent6_wp011_patch.py'),
]:
    if helper.exists():
        helper.unlink()
