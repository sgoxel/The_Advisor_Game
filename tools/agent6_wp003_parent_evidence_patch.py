#!/usr/bin/env python3
from pathlib import Path

PATH = Path("tools/screenshot_tool.py")
text = PATH.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count == 0 and new in text:
        return
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'WP_SURFACE_REFINEMENT_SCENARIO="wp-s003-010-003-005-002"\nWP_SURFACE_REFINEMENT_SHOTS=10',
    'WP_SURFACE_REFINEMENT_SCENARIO="wp-s003-010-003-005-002"\nWP_VIEWPORT_REFINEMENT_SCENARIO="wp-s003-010-003"\nWP_SURFACE_REFINEMENT_SHOTS=10',
    "parent scenario constant",
)
replace_once(
    'elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:\n        # WP005002 requires both desktop landscape and modern-phone evidence.',
    'elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:\n        # WP003 and WP005002 require both desktop landscape and modern-phone evidence.',
    "profile routing",
)
replace_once(
    'elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:\n        total=max(total,WP_SURFACE_REFINEMENT_SHOTS)',
    'elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:\n        total=max(total,WP_SURFACE_REFINEMENT_SHOTS)',
    "shot-count routing",
)
replace_once(
    'elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:\n            focus=_prepare_surface_refinement_focus(driver)',
    'elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:\n            focus=_prepare_surface_refinement_focus(driver)',
    "capture routing",
)

PATH.write_text(text, encoding="utf-8")
