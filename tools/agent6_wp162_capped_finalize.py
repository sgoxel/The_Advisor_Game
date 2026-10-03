#!/usr/bin/env python3
from pathlib import Path

STAMP="2026-10-03T08:40:00+03:00"
WP="WP-S003-010-003-005-002"
roadmap=Path("docs/ROADMAP.md")
text=roadmap.read_text(encoding="utf-8")
lines=text.splitlines()
replacement=(
    "- `WP-S003-010-003-005-002` — True Cross-LOD Surface Refinement + Texel/Geometry Density Continuity — "
    "IN PROGRESS (AGENT #6; capped continuation 2026-10-03 07:55 +03:00. Functional density/coverage gate PASS on final product "
    "`dc917f6abf7269538941ce238ae6d0c02ef86be7`; fresh Visual Evidence run `37100218836` / artifact `11265754151`, "
    "all ten 1280×800 screenshots directly inspected at VISUAL 5.9/10 FAIL. Remaining defects: regional/local terrain still reads as coarse or enlarged mottled texture, near-ground 0.78×/0.81× retains a richer center against smoother context, and ground remains soft. "
    "Peak captured local-resource build time `22796.6 ms`, longest handoff `79723.6 ms`, cache occupancy 8. Third-attempt cap reached; no completion claim.)"
)
count=0
for i,line in enumerate(lines):
    if line.startswith("- `WP-S003-010-003-005-002`"):
        lines[i]=replacement
        count+=1
if count!=1:
    raise SystemExit(f"expected one ROADMAP WP line, found {count}")
roadmap.write_text("\n".join(lines)+"\n",encoding="utf-8")

changelog=Path("docs/changelog.txt")
entry=(
    f"{STAMP} | {WP} | Capped continuation retained deterministic density/coverage continuity and broadened focus/context handoff while removing a duplicate coarse surface sample. "
    "Final fresh evidence remained below visual acceptance (5.9/10); issue stays open. Exact tested product dc917f6abf7269538941ce238ae6d0c02ef86be7, run 37100218836, artifact 11265754151.\n"
)
ct=changelog.read_text(encoding="utf-8")
if entry not in ct:
    changelog.write_text(ct + ("" if ct.endswith("\n") or not ct else "\n") + entry,encoding="utf-8")

suggest=Path("docs/suggest_log.txt")
sentry=(
    f"{STAMP} | {WP} | phase capped-continuation | Future improvement: replace per-layer enlarged/mottled local albedo with a cached deterministic multi-resolution registered surface source shared by focus/medium rings; benchmark reuse of prepared source rasters so near-ground refinement gains structured detail while software-rendered preparation falls well below the current ~23 s peak. Do not implement without a new claim.\n"
)
st=suggest.read_text(encoding="utf-8")
if sentry not in st:
    suggest.write_text(st + ("" if st.endswith("\n") or not st else "\n") + sentry,encoding="utf-8")

print("updated capped WP162 roadmap/changelog/suggest bookkeeping")
