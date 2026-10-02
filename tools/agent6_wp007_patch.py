#!/usr/bin/env python3
from pathlib import Path

p = Path("tools/screenshot_tool.py")
text = p.read_text(encoding="utf-8")

if 'WP_SETTLEMENT_REVEAL_SCENARIO="wp-s003-010-003-007"' in text:
    print("WP007 evidence scenario already present")
    raise SystemExit(0)

old = 'WP_SCALE_HANDOFF_SHOTS=13\nWP_SCALE_HANDOFF_PLAN=('
new = '''WP_SCALE_HANDOFF_SHOTS=13
WP_SETTLEMENT_REVEAL_SCENARIO="wp-s003-010-003-007"
WP_SETTLEMENT_REVEAL_SHOTS=10
WP_SETTLEMENT_REVEAL_PLAN=(
    (0.540,"pre-reveal"),
    (0.630,"occupied-footprint"),
    (0.660,"footprint-confirm"),
    (0.750,"route-clusters"),
    (0.780,"problem-checkpoint"),
    (0.810,"district-route"),
    (0.880,"coarse-settlement"),
    (0.940,"refined-settlement"),
    (0.985,"full-local"),
    (1.000,"ground"),
)
WP_SETTLEMENT_REVEAL_TIERS=("none","footprint","footprint","route","route","route","coarse","refined","full","full")
WP_SCALE_HANDOFF_PLAN=('''
if old not in text:
    raise SystemExit("constants anchor missing")
text = text.replace(old, new, 1)

anchor = "\n\n\ndef _atlas_live_state(driver):\n"
block = r'''


def _settlement_reveal_frame(driver,index,timeout):
    scalar,label=WP_SETTLEMENT_REVEAL_PLAN[index]
    expected=WP_SETTLEMENT_REVEAL_TIERS[index]
    set_exact_viewport(driver,1280,800)
    driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))
    _wait(driver,f"""
      const target={float(scalar)!r},s=window.PlanetStage?.snapshot?.(),r=s?.projection?.resourceBudget||{{}};
      return Boolean(
        s?.ready && !s?.zoom?.animation?.active &&
        Math.abs(Number(s?.zoom?.scalar)-target)<0.00001 &&
        Number(r?.pendingPreparationCount||0)===0
      );
    """,timeout,f"WP007 settlement reveal {label} settled")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    stage=_stage_snapshot(driver)
    raw=driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},l=s?.projection?.localStatic||{},r=s?.projection?.resourceBudget||{};
      return {
        worldTileProjection:s?.projection?.worldTileProjection||null,
        localStatic:l,
        resource:{pendingPreparationCount:Number(r.pendingPreparationCount||0),blockingZoomBuilds:Number(r.blockingZoomBuilds||0)},
        focusWorldTile:s?.canonicalFocus?.worldTile||null,
        centerLand:s?.canonicalFocus?.surfaceIdentity?.center?.land===true
      };
    """)
    return {
        "action":"settlement-reveal:"+label,
        "expectedRevealTier":expected,
        "viewport":_inner_viewport(driver),
        "stage":stage,
        "settlementRevealProof":raw,
    }


def _validate_settlement_reveal_frames(frames):
    if len(frames)!=WP_SETTLEMENT_REVEAL_SHOTS:
        raise RuntimeError(f"{WP_SETTLEMENT_REVEAL_SCENARIO} requires {WP_SETTLEMENT_REVEAL_SHOTS} fixed-focus frames")
    focus=[];local=[]
    for index,frame in enumerate(frames,start=1):
        stage=frame.get("stage") or {};proof=frame.get("settlementRevealProof") or {}
        canonical=stage.get("canonicalFocus") or {};tile=canonical.get("worldTile") or {}
        focus.append((str(tile.get("x")),str(tile.get("y"))))
        item=proof.get("localStatic") or ((stage.get("projection") or {}).get("localStatic") or {})
        local.append(item)
        resource=proof.get("resource") or {}
        if proof.get("centerLand") is not True:
            raise RuntimeError(f"frame {index} settlement focus is not canonical land: {proof}")
        if int(resource.get("pendingPreparationCount") or 0)!=0 or int(resource.get("blockingZoomBuilds") or 0)!=0:
            raise RuntimeError(f"frame {index} used blocking settlement preparation: {resource}")
        if item.get("presentationOnly") is not True or item.get("simulationAuthority") is not False:
            raise RuntimeError(f"frame {index} crossed presentation/simulation authority boundary: {item}")
        if int(item.get("entityCount") or 0)>140 or int(item.get("drawCallEstimate") or 0)>140:
            raise RuntimeError(f"frame {index} exceeded bounded settlement presentation cost: {item}")
    if len(set(focus))!=1:
        raise RuntimeError(f"settlement reveal evidence changed canonical focus: {focus}")
    expected=WP_SETTLEMENT_REVEAL_TIERS
    tiers=tuple(str(item.get("revealTier") or "none") for item in local)
    if tiers!=expected:
        raise RuntimeError(f"settlement reveal tier progression mismatch: expected={expected}, actual={tiers}")
    active=local[1:]
    ids=[str(item.get("settlementId") or "") for item in active]
    layouts=[str(item.get("layoutSignature") or "") for item in active]
    if any(not value for value in ids) or len(set(ids))!=1:
        raise RuntimeError(f"settlement identity changed or missing across zoom: {ids}")
    if any(not value for value in layouts) or len(set(layouts))!=1:
        raise RuntimeError(f"settlement layout changed or missing across zoom: {layouts}")
    footprint=local[1]
    if int(footprint.get("occupiedAreaCount") or 0)<1 or int(footprint.get("roadCount") or 0)<1:
        raise RuntimeError(f"0.63x footprint tier lacks physically meaningful settlement/route cues: {footprint}")
    route=local[3]
    if int(route.get("roadCount") or 0)<2 or int(route.get("coarseBuildingCount") or 0)<1:
        raise RuntimeError(f"0.75x route tier lacks readable road/building clusters: {route}")
    coarse=local[6]
    if int(coarse.get("coarseBuildingCount") or 0)<3 or int(coarse.get("roadCount") or 0)<3 or int(coarse.get("landmarkCount") or 0)<1:
        raise RuntimeError(f"0.88x coarse settlement is structurally incomplete: {coarse}")
    refined=local[7]
    if int(refined.get("fullBuildingCount") or 0)<1 or int(refined.get("roadCount") or 0)<3:
        raise RuntimeError(f"0.94x refined settlement lacks canonical buildings/roads: {refined}")
    ground=local[9]
    if int(ground.get("fullBuildingCount") or 0)<6 or int(ground.get("fullRoadCount") or 0)<3:
        raise RuntimeError(f"ground tier did not preserve canonical settlement structure: {ground}")
    if abs(float(ground.get("presentationScale") or 0)-1.0)>0.001:
        raise RuntimeError(f"ground tier did not converge to physical 1:1 scale: {ground.get('presentationScale')}")
'''
if anchor not in text:
    raise SystemExit("function anchor missing")
text = text.replace(anchor, block + anchor, 1)

old = 'if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:'
new = 'if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:'
if old not in text:
    raise SystemExit("viewport anchor missing")
text = text.replace(old, new, 1)

old = '''    elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:
        total=max(total,WP_SCALE_HANDOFF_SHOTS)
    elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:'''
new = '''    elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:
        total=max(total,WP_SCALE_HANDOFF_SHOTS)
    elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:
        total=max(total,WP_SETTLEMENT_REVEAL_SHOTS)
    elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:'''
if old not in text:
    raise SystemExit("shot-count anchor missing")
text = text.replace(old, new, 1)

old = '''            _validate_scale_handoff_frames(frames)
        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:'''
new = '''            _validate_scale_handoff_frames(frames)
        elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:
            focus=_prepare_starting_village_focus(driver)
            frames=[]
            for index in range(WP_SETTLEMENT_REVEAL_SHOTS):
                frame=_settlement_reveal_frame(driver,index,args.ready_timeout)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,WP_SETTLEMENT_REVEAL_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_settlement_reveal_frames(frames)
        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:'''
if old not in text:
    raise SystemExit("capture branch anchor missing")
text = text.replace(old, new, 1)

p.write_text(text, encoding="utf-8")
print("patched dedicated WP007 settlement reveal evidence scenario")
