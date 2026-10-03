#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/ui/protagonist-focus-ui.js')
text=p.read_text(encoding='utf-8')
old='''  state.safeRect={left:Number(left.toFixed(1)),top:Number(top.toFixed(1)),right:Number(right.toFixed(1)),bottom:Number(bottom.toFixed(1)),width:Number((right-left).toFixed(1)),height:Number((bottom-top).toFixed(1)),viewportWidth:iw,viewportHeight:ih};\n  positionDock();\n  return state.safeRect;'''
new='''  state.safeRect={left:Number(left.toFixed(1)),top:Number(top.toFixed(1)),right:Number(right.toFixed(1)),bottom:Number(bottom.toFixed(1)),width:Number((right-left).toFixed(1)),height:Number((bottom-top).toFixed(1)),viewportWidth:iw,viewportHeight:ih};\n  positionDock();\n  // A viewport-class change can move the projected ground billboard even though\n  // the canonical camera tile did not change. Re-run the existing bounded\n  // camera-only follow animation to the current authoritative protagonist point\n  // so phone/tablet rotation cannot leave the actor clipped at a screen edge.\n  if(state.mode==="protagonist"&&state.followEnabled&&!state.followAnimationActive){\n    const snap=stageSnapshot(),p=protagonistPoint(),cam=asStringPoint(snap?.canonicalFocus?.worldTile);\n    const delta=pointDelta(p,cam),distance=delta?Math.hypot(delta.x,delta.y):0;\n    if(cam&&p&&distance>.5){state.lastAction="responsive-safe-area-follow";animateFollow(cam,p);}\n  }\n  return state.safeRect;'''
if old not in text:
    raise SystemExit('safe-rect patch anchor not found')
text=text.replace(old,new,1)
old_css='''    #protagonistFocusDock button:hover{background:rgba(104,179,172,.14)}\n    @media(max-width:620px){#protagonistFocusDock{max-width:calc(100vw - 28px);gap:7px;padding:6px 8px}#protagonistFocusDock button{min-height:28px;padding:5px 8px}.protagonist-focus-sub{max-width:138px}}\n    @media(max-height:430px) and (orientation:landscape){#protagonistFocusDock{padding:5px 7px;gap:6px}.protagonist-focus-sub{display:none}#protagonistFocusDock button{min-height:26px;padding:4px 7px}}\n  `;'''
new_css='''    #protagonistFocusDock button:hover{background:rgba(104,179,172,.14)}\n    /* Protagonist focus outranks optional geographic context when space is tight.\n       On larger viewports keep both by moving the map readout below the focus dock. */\n    #planetStageRoot[data-protagonist-focus-mode] .planet-map-context{top:max(72px,calc(env(safe-area-inset-top) + 72px))!important}\n    @media(max-width:620px){#protagonistFocusDock{max-width:calc(100vw - 28px);gap:7px;padding:6px 8px}#protagonistFocusDock button{min-height:28px;padding:5px 8px}.protagonist-focus-sub{max-width:138px}#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{display:none!important}}\n    @media(max-height:430px) and (orientation:landscape){#protagonistFocusDock{padding:5px 7px;gap:6px}.protagonist-focus-sub{display:none}#protagonistFocusDock button{min-height:26px;padding:4px 7px}#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{display:none!important}}\n  `;'''
if old_css not in text:
    raise SystemExit('style patch anchor not found')
text=text.replace(old_css,new_css,1)
p.write_text(text,encoding='utf-8')

# Strengthen evidence: responsive screenshots must also keep the real protagonist
# ground billboard comfortably inside the viewport, not merely its predicted anchor.
e=Path('tools/wp_s003_010_003_005_003_evidence.py')
et=e.read_text(encoding='utf-8')
old='''def responsive_frame(driver,seed,label,width,height,index):\n    set_exact_viewport(driver,width,height);time.sleep(.35);js(driver,"ProtagonistFocusUI.refresh();");time.sleep(.12)\n    u=ui(driver);assert_safe(u,label)\n    return shot(driver,seed,label,index,{"focusUI":u})'''
new='''def responsive_frame(driver,seed,label,width,height,index):\n    set_exact_viewport(driver,width,height);time.sleep(.35);js(driver,"ProtagonistFocusUI.refresh();");time.sleep(.55)\n    u=ui(driver);assert_safe(u,label)\n    billboard=js(driver,"""\n      const s=PlanetStage.snapshot(),p=s?.npcPresentation||{};\n      const target=(PlanetStage.inspectionTargets?.()||[]).find(x=>x.type==='protagonist')||null;\n      return {visible:Boolean(p.protagonistBillboardVisible),target:target||null};\n    """)\n    projected=u.get("projectedProtagonist") or {}\n    margin=28\n    if billboard.get("visible") and not (margin<=float(projected.get("x",-999))<=width-margin and margin<=float(projected.get("y",-999))<=height-margin):\n        raise RuntimeError(f"{label}: protagonist anchor lacks responsive visual margin: projected={projected} viewport={width}x{height}")\n    return shot(driver,seed,label,index,{"focusUI":u,"protagonistBillboard":billboard})'''
if old not in et:
    raise SystemExit('responsive evidence patch anchor not found')
et=et.replace(old,new,1)
e.write_text(et,encoding='utf-8')
print('patched WP-S003-010-003-005-003 attempt 3')
