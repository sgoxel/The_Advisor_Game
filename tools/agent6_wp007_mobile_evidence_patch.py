#!/usr/bin/env python3
from pathlib import Path

shot = Path("tools/screenshot_tool.py")
text = shot.read_text(encoding="utf-8")
old = 'PROFILES={"landscape":(1920,1080),"portrait":(1080,1920),"tablet":(1920,1080),"phone":(1080,1920)}'
new = 'PROFILES={"landscape":(1920,1080),"portrait":(1080,1920),"tablet":(1920,1080),"phone":(390,844),"phone-portrait":(390,844),"phone-landscape":(844,390)}'
if text.count(old) != 1:
    raise SystemExit(f"profile anchor mismatch: {text.count(old)}")
text = text.replace(old,new,1)
old = '''    if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n        width,height=1280,800\n'''
new = '''    if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n        width,height=1280,800\n    elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:\n        # WP007 acceptance explicitly requires desktop landscape plus real phone\n        # portrait/landscape evidence; never coerce its mobile profiles to desktop.\n        width,height={\n            "landscape":(1280,800),\n            "portrait":(390,844),\n            "phone-portrait":(390,844),\n            "phone-landscape":(844,390),\n        }.get(args.profile,(1280,800))\n'''
if text.count(old) != 1:
    raise SystemExit(f"scenario viewport anchor mismatch: {text.count(old)}")
shot.write_text(text.replace(old,new,1),encoding="utf-8")

workflow=Path(".github/workflows/visual-evidence.yml")
yml=workflow.read_text(encoding="utf-8")
old='''        options:\n          - landscape\n          - portrait\n      scenario:\n'''
new='''        options:\n          - landscape\n          - portrait\n          - phone-portrait\n          - phone-landscape\n      scenario:\n'''
if yml.count(old) != 1:
    raise SystemExit(f"workflow profile options anchor mismatch: {yml.count(old)}")
yml=yml.replace(old,new,1)
old='case "$profile" in landscape|portrait) ;; *) echo "Unsupported profile: $profile" >&2; exit 2 ;; esac'
new='case "$profile" in landscape|portrait|phone-portrait|phone-landscape) ;; *) echo "Unsupported profile: $profile" >&2; exit 2 ;; esac'
if yml.count(old) != 1:
    raise SystemExit(f"workflow profile validation anchor mismatch: {yml.count(old)}")
workflow.write_text(yml.replace(old,new,1),encoding="utf-8")
print("WP007 mobile evidence profiles enabled")
