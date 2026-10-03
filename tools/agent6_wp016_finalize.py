#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


roadmap_path = Path("docs/ROADMAP.md")
roadmap = roadmap_path.read_text(encoding="utf-8")
roadmap = replace_once(
    roadmap,
    "- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch\n",
    "- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch — ACCEPTED\n",
    "WP016 roadmap status",
)
roadmap_path.write_text(roadmap, encoding="utf-8")

changelog_path = Path("docs/changelog.txt")
changelog = changelog_path.read_text(encoding="utf-8")
entry = (
    "2026-10-03 07:47 +03:00 | AGENT #6 | WP-S003-010-003-016 | MIXED ACCEPTED — "
    "Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch passed fresh exact-main acceptance. "
    "Runtime commit 47c1325a2615449ca18122877db638b235dd75ad makes terrain and canonical static/semantic ownership paint-visible in one JavaScript turn instead of scheduling the static rebuild in a later timer task, so the prior ready representation remains the last painted state until the finer terrain + roads/buildings/vegetation payload is complete. "
    "Fresh run 37097497930 / artifact 11264602739 exercised the real Starting Village 0.88→0.94 refinement and sampled every requestAnimationFrame; its strict harness passed with no child-active/static-stale frame, no missing coverage, no pending or blocking zoom build after settle, deterministic revisit identity, and bounded request/build budgets. "
    "All five 1280x800 frames were directly inspected; VISUAL 8.5/10 PASS with continuous parent coverage and stable complete same-scale post-handoff settlement geometry. "
    "GitHub Pages run 37097497352 successfully deployed tested descendant b5dba7f15a86de41ca35599564ecc196d090b9de.\n"
)
if entry not in changelog:
    changelog_path.write_text(entry + changelog, encoding="utf-8")

suggest_path = Path("docs/suggest_log.txt")
suggest = suggest_path.read_text(encoding="utf-8")
suggestion = (
    "2026-10-03 07:47 +03:00 | WP-S003-010-003-016 | Phase temporal-handoff-acceptance-2 | FUTURE — "
    "If transition latency later needs reduction on representative mobile hardware, prepare the bounded canonical static presentation while the child resource is still in ready state and commit terrain + a prebuilt static root by one atomic ownership swap, rather than weakening the accepted ready-before-paint rule. Preserve Campaign-SEED identity, deterministic revisit signatures, grace residency/prefetch bounds, request/build budgets, and zero terrain-active/static-stale painted frames. Require fresh same-scale screenshots plus frame-by-frame handoff evidence before changing this contract. Do not implement unless explicitly requested.\n"
)
if suggestion not in suggest:
    suggest_path.write_text(suggestion + suggest, encoding="utf-8")

print("prepared WP016 acceptance docs")
