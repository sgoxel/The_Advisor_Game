#!/usr/bin/env bash
# Print the next claimable WP in a few lines, so an agent does not have to list and read every Issue.
# Order: open WPs in docs/ROADMAP.md by code (earliest stage first). A WP is claimable when none of its
# open Issues has a "CLAIMED" comment younger than 2 hours. Needs: gh (authenticated), python3.
# Usage: tools/next_wp.sh [--hours 2] [--all]
exec python3 - "$@" <<'PY'
import json, re, subprocess, sys
from datetime import datetime, timezone, timedelta

REPO = "sgoxel/The_Advisor_Game"
args = sys.argv[1:]
hours = float(args[args.index("--hours") + 1]) if "--hours" in args else 2.0
show_all = "--all" in args
now = datetime.now(timezone.utc)

def api(path):
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if out.returncode:
        sys.exit("gh api failed: " + path + " " + out.stderr.strip()[:200])
    return json.loads(out.stdout)

# 1. open WPs from the roadmap (completed ones were moved to ROADMAP_ARCHIVE.md)
wps = []
for line in open("docs/ROADMAP.md", encoding="utf-8"):
    m = re.match(r"- (WP-S\d+-\d+-\d+) — (.*)", line)
    if m:  # every WP line still in ROADMAP.md is open
        wps.append((m.group(1), m.group(2).strip(), "IN PROGRESS" in line))
wps.sort(key=lambda w: [int(x) for x in re.findall(r"\d+", w[0])])

# 2. open Issues grouped by WP code (a WP can have several corrective Issues)
issues = {}
page = 1
while True:
    batch = api(f"repos/{REPO}/issues?state=open&per_page=100&page={page}")
    for i in batch:
        if "pull_request" in i:
            continue
        m = re.search(r"WP-S\d+-\d+-\d+", i["title"])
        if m:
            issues.setdefault(m.group(0), []).append(i)
    if len(batch) < 100:
        break
    page += 1

def claim_of(num):
    """Newest CLAIMED comment -> (time, who) or None."""
    comments = api(f"repos/{REPO}/issues/{num}/comments?per_page=100")
    for c in reversed(comments):
        body = c["body"]
        if re.match(r"\s*CLAIMED", body, re.I):
            t = re.search(r"\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z", body)
            when = datetime.fromisoformat(t.group(0).replace("Z", "+00:00")) if t else datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return when, body.split("\n")[0][:80]
    return None

picked = False
for code, title, in_progress in wps:
    found = sorted(issues.get(code, []), key=lambda i: i["number"])
    if not found:
        print(f"{code}  no open Issue (planning gap or already finished) - skipped")
        continue
    fresh = None
    for i in found:
        c = claim_of(i["number"])
        if c and now - c[0] < timedelta(hours=hours):
            fresh = (i["number"], c)
            break
    nums = ", ".join("#%d" % i["number"] for i in found)
    flag = " [roadmap: IN PROGRESS]" if in_progress else ""
    if fresh:
        age = int((now - fresh[1][0]).total_seconds() // 60)
        print(f"{code}  CLAIMED {age} min ago on #{fresh[0]} ({fresh[1][1]}) - skip{flag}")
        continue
    print(f"{code}  CLAIMABLE  Issues: {nums}{flag}\n  {title[:150]}")
    for i in found:
        print(f"  https://github.com/{REPO}/issues/{i['number']}  {i['title'][:90]}")
    picked = True
    if not show_all:
        break
if not picked:
    print("No claimable open WP: if the roadmap has no open WPs, switch to Planning mode.")
PY
