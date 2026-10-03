#!/usr/bin/env python3
from pathlib import Path

path=Path('tools/screenshot_tool.py')
text=path.read_text(encoding='utf-8')
old='''    if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n        width,height=1280,800\n'''
new='''    if args.scenario in {WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n        width,height=1280,800\n    elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:\n        # WP005002 requires both desktop landscape and modern-phone evidence.\n        # Preserve the explicitly requested profile instead of coercing phone\n        # captures to the historical 1280x800 desktop viewport.\n        width,height=PROFILES.get(args.profile,(args.width,args.height))\n'''
if new in text:
    print('WP005002 evidence profiles already current')
elif text.count(old)!=1:
    raise SystemExit(f'evidence viewport anchor expected once, found {text.count(old)}')
else:
    path.write_text(text.replace(old,new,1),encoding='utf-8')
    print('patched WP005002 desktop/phone evidence profiles')
