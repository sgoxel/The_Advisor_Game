#!/usr/bin/env python3
from pathlib import Path

p=Path('scripts/ui/protagonist-focus-ui.js')
text=p.read_text(encoding='utf-8')

# Final Attempt 3: keep the existing canonical focus/Simulation contract, but make
# responsive presentation explicitly recenter the already-followed protagonist,
# subordinate developer diagnostics, and preserve focus identity across coarse LOD.
old='''  pointerDown:null,pointerDragSuspensions:0,telemetryUpdates:0,startedAtMs:0\n};'''
new='''  pointerDown:null,pointerDragSuspensions:0,telemetryUpdates:0,startedAtMs:0,\n  responsiveRefocusCount:0,focusMarkerVisible:false\n};'''
if old not in text:
    raise SystemExit('state patch anchor not found')
text=text.replace(old,new,1)

old='''let dock=null,labelNode=null,metaNode=null,exploreButton=null,returnButton=null;\nlet pollTimer=0,frameTimer=0,followToken=0,resizeTimer=0;'''
new='''let dock=null,labelNode=null,metaNode=null,exploreButton=null,returnButton=null,focusMarker=null;\nlet pollTimer=0,frameTimer=0,followToken=0,resizeTimer=0;'''
if old not in text:
    raise SystemExit('node patch anchor not found')
text=text.replace(old,new,1)

# The map context is optional, but it should still be treated as presentation
# occupancy for telemetry and layout decisions.
old='''  const selectors=["#advisorChatPanel",".planet-places-panel","#windowShellDock",".window-shell-dock",".advisor-toolbelt-panel",".advisor-economy-panel",".travel-encounter-card",".local-event-vignette"];'''
new='''  const selectors=["#advisorChatPanel",".planet-places-panel","#windowShellDock",".window-shell-dock",".advisor-toolbelt-panel",".advisor-economy-panel",".travel-encounter-card",".local-event-vignette",".planet-map-context",".renderer-backend-debug"];'''
if old not in text:
    raise SystemExit('safe selector patch anchor not found')
text=text.replace(old,new,1)

css_anchor='''@media(max-height:430px) and (orientation:landscape){#protagonistFocusDock{padding:4px 5px 4px 7px}.protagonist-focus-copy small{display:none}.protagonist-focus-action{height:26px}}\n`;'''
css_replacement='''@media(max-height:430px) and (orientation:landscape){#protagonistFocusDock{padding:4px 5px 4px 7px}.protagonist-focus-copy small{display:none}.protagonist-focus-action{height:26px}}\n/* Focus context outranks optional geography/debug chrome without deleting it. */\n#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{top:max(72px,calc(env(safe-area-inset-top) + 72px))!important}\n#planetStageRoot[data-protagonist-focus-mode] .renderer-backend-debug{opacity:.16!important;transform:translateX(-50%) scale(.72)!important;transform-origin:top center!important;pointer-events:none!important}\n#protagonistFocusMarker{position:fixed;left:50%;top:50%;z-index:72;transform:translate(-50%,-52px);display:none;pointer-events:none;padding:5px 8px;border:1px solid rgba(226,186,104,.56);border-radius:999px;background:rgba(7,15,22,.80);box-shadow:0 5px 20px rgba(0,0,0,.28);color:#f0d394;font:800 9px/1 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}\n#protagonistFocusMarker[data-visible="true"]{display:block}\n@media(max-width:620px){#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{display:none!important}#protagonistFocusDock{max-width:calc(100vw - 24px)}#protagonistFocusMarker{transform:translate(-50%,-46px)}}\n@media(max-height:430px) and (orientation:landscape){#planetStageRoot[data-protagonist-focus-mode] .planet-map-context{display:none!important}}\n`;'''
if css_anchor not in text:
    raise SystemExit('current CSS patch anchor not found')
text=text.replace(css_anchor,css_replacement,1)

old='''  document.body.appendChild(dock);state.mounted=true;computeSafeRect();attachManualExplorationListeners();render();'''
new='''  focusMarker=document.createElement("div");focusMarker.id="protagonistFocusMarker";focusMarker.textContent="Protagonist focus";focusMarker.setAttribute("aria-hidden","true");document.body.appendChild(focusMarker);\n  document.body.appendChild(dock);state.mounted=true;computeSafeRect();attachManualExplorationListeners();render();'''
if old not in text:
    raise SystemExit('mount patch anchor not found')
text=text.replace(old,new,1)

# Add event-driven responsive recentering and coarse-LOD identity cue. This is
# camera presentation only; it calls the existing canonical focus transaction.
anchor='''function followDeadZone(snapshot,protagonist){'''
insert='''function responsiveRefocus(){\n  if(!stageReady()||state.mode!=="protagonist"||!state.followEnabled)return false;\n  const before=protagonistPoint();\n  try{\n    const result=root.PlanetStage.focusProtagonist();state.focusRequestId=result?.requestId||state.focusRequestId;state.responsiveRefocusCount++;state.lastAction="responsive-safe-area-refocus";\n  }catch(err){state.lastError=String(err?.message||err);return false}\n  const after=protagonistPoint();if(before&&after&&(before.x!==after.x||before.y!==after.y))state.lastError="responsive camera refocus mutated protagonist position";\n  return !state.lastError;\n}\nfunction updateFocusMarker(snapshot){\n  if(!focusMarker)return;\n  const coarse=state.mode==="protagonist"&&snapshot?.zoom?.visibleLevel&&snapshot.zoom.visibleLevel!=="ground";\n  focusMarker.dataset.visible=String(Boolean(coarse));state.focusMarkerVisible=Boolean(coarse);\n}\nfunction scheduleResponsiveLayout(){\n  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{computeSafeRect();responsiveRefocus();setTimeout(()=>poll(),80)},110);\n}\n\nfunction followDeadZone(snapshot,protagonist){'''
if anchor not in text:
    raise SystemExit('follow patch anchor not found')
text=text.replace(anchor,insert,1)

old='''  if(state.mode==="protagonist")followDeadZone(snapshot,protagonist);updateProjected(snapshot,protagonist);'''
new='''  if(state.mode==="protagonist")followDeadZone(snapshot,protagonist);updateProjected(snapshot,protagonist);updateFocusMarker(snapshot);'''
if old not in text:
    raise SystemExit('poll marker patch anchor not found')
text=text.replace(old,new,1)

old='''    followCorrections:state.followCorrections,followAnimationActive:state.followAnimationActive,followAnimationCancels:state.followAnimationCancels,hardSnapCount:state.hardSnapCount,pointerDragSuspensions:state.pointerDragSuspensions,'''
new='''    followCorrections:state.followCorrections,followAnimationActive:state.followAnimationActive,followAnimationCancels:state.followAnimationCancels,hardSnapCount:state.hardSnapCount,pointerDragSuspensions:state.pointerDragSuspensions,responsiveRefocusCount:state.responsiveRefocusCount,focusMarkerVisible:state.focusMarkerVisible,'''
if old not in text:
    raise SystemExit('snapshot patch anchor not found')
text=text.replace(old,new,1)

old='''  addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(computeSafeRect,80)},{passive:true});\n  root.visualViewport?.addEventListener?.("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(computeSafeRect,80)},{passive:true});'''
new='''  addEventListener("resize",scheduleResponsiveLayout,{passive:true});\n  root.visualViewport?.addEventListener?.("resize",scheduleResponsiveLayout,{passive:true});'''
if old not in text:
    raise SystemExit('resize patch anchor not found')
text=text.replace(old,new,1)

p.write_text(text,encoding='utf-8')

# Evidence hardening for the same final attempt: let responsive recenter settle,
# require it to have occurred, and require the coarse-LOD protagonist cue.
e=Path('tools/wp_s003_010_003_005_003_evidence.py')
et=e.read_text(encoding='utf-8')
et=et.replace('''        handoff=shot(driver,seed,"06-lod-focus-identity",records)\n        nav=(handoff.get("navigation") or {}).get("active") or {}\n        if nav.get("targetType")!="protagonist" or (handoff.get("focusUI") or {}).get("mode")!="protagonist":raise RuntimeError("protagonist focus identity lost through LOD handoff")''','''        handoff=shot(driver,seed,"06-lod-focus-identity",records)\n        nav=(handoff.get("navigation") or {}).get("active") or {};hui=handoff.get("focusUI") or {}\n        if nav.get("targetType")!="protagonist" or hui.get("mode")!="protagonist" or hui.get("focusMarkerVisible") is not True:raise RuntimeError("protagonist focus identity lost through LOD handoff")''',1)
et=et.replace('''                set_exact_viewport(driver,w,h);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(.45)\n                responsive=shot(driver,seed,name,records);assert_safe(responsive,name)''','''                set_exact_viewport(driver,w,h);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(1.25)\n                responsive=shot(driver,seed,name,records);assert_safe(responsive,name)\n                if (responsive.get("focusUI") or {}).get("responsiveRefocusCount",0)<1:raise RuntimeError(name+": responsive canonical refocus did not run")''',1)
et=et.replace('''            set_exact_viewport(driver,390,844);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(.45)\n            responsive=shot(driver,seed,"07-second-seed-phone",records);assert_safe(responsive,"second seed phone")''','''            set_exact_viewport(driver,390,844);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(1.25)\n            responsive=shot(driver,seed,"07-second-seed-phone",records);assert_safe(responsive,"second seed phone")\n            if (responsive.get("focusUI") or {}).get("responsiveRefocusCount",0)<1:raise RuntimeError("second seed phone: responsive canonical refocus did not run")''',1)
e.write_text(et,encoding='utf-8')
print('patched WP-S003-010-003-005-003 final Attempt 3')
