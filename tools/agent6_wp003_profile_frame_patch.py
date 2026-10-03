#!/usr/bin/env python3
from pathlib import Path

path=Path('tools/screenshot_tool.py')
text=path.read_text(encoding='utf-8')
old='''def _surface_refinement_frame(driver,index,timeout):\n    scalar,label=WP_SURFACE_REFINEMENT_PLAN[index]\n    set_exact_viewport(driver,1280,800)\n'''
new='''def _surface_refinement_frame(driver,index,timeout,viewport=(1280,800)):\n    scalar,label=WP_SURFACE_REFINEMENT_PLAN[index]\n    set_exact_viewport(driver,*viewport)\n'''
if text.count(old)!=1:
    raise SystemExit(f'frame helper anchor count={text.count(old)}')
text=text.replace(old,new,1)
old_call='frame=_surface_refinement_frame(driver,index,args.ready_timeout)'
new_call='frame=_surface_refinement_frame(driver,index,args.ready_timeout,(width,height))'
if text.count(old_call)!=1:
    raise SystemExit(f'frame call anchor count={text.count(old_call)}')
text=text.replace(old_call,new_call,1)
path.write_text(text,encoding='utf-8')
print('Applied WP-S003-010-003 exact profile preservation inside refinement frames')
