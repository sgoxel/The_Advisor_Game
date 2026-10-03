#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


# Runtime: make terrain + semantic/static ownership one painted handoff.
planet_path = Path("scripts/world/planet-stage.js")
planet = planet_path.read_text(encoding="utf-8")
old_runtime = '''  // Keep the atomic terrain swap bounded. Static settlement/wilderness
  // presentation can involve entity destruction/rebuild and canonical local
  // queries; doing that synchronously here caused >100 ms swap spikes after
  // richer map-scale presentation was added. Retain the previous valid static
  // layer for this handoff and rebuild it on the existing deferred refresh
  // path once the new terrain resource is authoritative/active.
  if(atmospherePalette)applyAtmosphereMaterialPalette(atmospherePalette);
  trimLocalResourceCache();
  localResources.activeSignature=signature;localResources.visibleLevel=resource.dims.levelId;localResources.activeCellId=resource.spatialCell?.id||null;localResources.activeResourceCount=1;localResources.cachedResourceCount=localResourceCache.size;
  localResources.pendingPreparationCount=localResources.requestedSignature===signature?0:1;
  localResources.estimatedCacheBytes=Array.from(localResourceCache.values()).reduce((sum,item)=>sum+(item.estimatedBytes||0),0);
  const swapMs=performance.now()-swapStarted;localResources.lastSwapMs=Number(swapMs.toFixed(3));localResources.maxSwapMs=Math.max(localResources.maxSwapMs,localResources.lastSwapMs);localResources.swapCount++;
  scheduleLocalStaticPresentationRefresh();
  return true;'''
new_runtime = '''  // WP-S003-010-003-016: terrain ownership and canonical static/semantic
  // ownership must become paint-visible together. The static rebuild is already
  // a synchronous bounded local operation; deferring it to a later timer let the
  // renderer paint the new terrain first and then add roads/buildings/vegetation
  // at the identical camera scale. Rebuild inside this same JS turn so the last
  // painted parent remains on screen until the complete child presentation is
  // ready, then the renderer observes terrain + static content atomically.
  // This adds no world queries beyond the rebuild that the deferred path already
  // performed and does not change SEED identity, residency bounds, or content.
  rebuildLocalStaticPresentation(resource);
  refreshReadySemanticBand();
  if(atmospherePalette)applyAtmosphereMaterialPalette(atmospherePalette);
  trimLocalResourceCache();
  localResources.activeSignature=signature;localResources.visibleLevel=resource.dims.levelId;localResources.activeCellId=resource.spatialCell?.id||null;localResources.activeResourceCount=1;localResources.cachedResourceCount=localResourceCache.size;
  localResources.pendingPreparationCount=localResources.requestedSignature===signature?0:1;
  localResources.estimatedCacheBytes=Array.from(localResourceCache.values()).reduce((sum,item)=>sum+(item.estimatedBytes||0),0);
  const swapMs=performance.now()-swapStarted;localResources.lastSwapMs=Number(swapMs.toFixed(3));localResources.maxSwapMs=Math.max(localResources.maxSwapMs,localResources.lastSwapMs);localResources.swapCount++;
  return true;'''
planet = replace_once(planet, old_runtime, new_runtime, "atomic terrain/static handoff")
planet_path.write_text(planet, encoding="utf-8")


# Evidence: add a WP016 temporal-coherence scenario that observes every rAF
# during a real settlement refinement handoff, then captures repeated identical
# scale/focus frames to prove no static geometry arrives later.
shot_path = Path("tools/screenshot_tool.py")
shots = shot_path.read_text(encoding="utf-8")
shots = replace_once(
    shots,
    'WP_SCALE_HANDOFF_SCENARIO="wp-s003-010-003-006"\nWP_SCALE_HANDOFF_SHOTS=13\n',
    'WP_SCALE_HANDOFF_SCENARIO="wp-s003-010-003-006"\nWP_SCALE_HANDOFF_SHOTS=13\nWP_TEMPORAL_RESIDENCY_SCENARIO="wp-s003-010-003-016"\nWP_TEMPORAL_RESIDENCY_SHOTS=5\n',
    "temporal scenario constants",
)

helper = r'''
def _temporal_residency_compact(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},z=s.zoom||{},r=s.projection?.resourceBudget||{},l=s.projection?.localStatic||{};
      const f=s.canonicalFocus?.worldTile||{};
      return {
        scalar:Number(z.scalar||0),targetScalar:Number(z.targetScalar||z.scalar||0),
        focus:{x:String(f.x??''),y:String(f.y??'')},
        resource:{
          requestedSignature:r.requestedSignature||null,activeSignature:r.activeSignature||null,
          preparingSignature:r.preparingSignature||null,pendingPreparationCount:Number(r.pendingPreparationCount||0),
          requestedCellCount:Number(r.requestedCellCount||0),preparingCellCount:Number(r.preparingCellCount||0),
          readyCellCount:Number(r.readyCellCount||0),activeCellCount:Number(r.activeCellCount||0),
          graceResidentCellCount:Number(r.graceResidentCellCount||0),evictedCellCount:Number(r.evictedCellCount||0),
          parentFallbackCount:Number(r.parentFallbackCount||0),missingCoverageCount:Number(r.missingCoverageCount||0),
          prefetchHits:Number(r.prefetchHits||0),prefetchMisses:Number(r.prefetchMisses||0),
          revisitRegenerationSignature:r.revisitRegenerationSignature||null,revisitRegenerationPass:r.revisitRegenerationPass!==false,
          requestBudgetPerFrame:Number(r.requestBudgetPerFrame||0),buildJobBudget:Number(r.buildJobBudget||0),
          blockingZoomBuilds:Number(r.blockingZoomBuilds||0),lastSwapMs:Number(r.lastSwapMs||0),maxSwapMs:Number(r.maxSwapMs||0),
          recentMaxFrameMs:Number(r.recentMaxFrameMs||0),longestHandoffLatencyMs:Number(r.longestHandoffLatencyMs||0)
        },
        localStatic:{
          active:Boolean(l.active),signature:l.signature||null,level:l.level||null,revealTier:l.revealTier||'none',
          roadCount:Number(l.roadCount||0),buildingCount:Number(l.buildingCount||0),vegetationCount:Number(l.vegetationCount||0),
          entityCount:Number(l.entityCount||0),triangleEstimate:Number(l.triangleEstimate||0),drawCallEstimate:Number(l.drawCallEstimate||0)
        }
      };
    """)


def _prepare_temporal_residency_scene(driver,timeout):
    set_exact_viewport(driver,1280,800)
    focus=_prepare_starting_village_focus(driver)
    driver.execute_script("""
      const evidenceTime={year:1100,month:1,day:1,hour:11,minute:30,second:0};
      window.PlanetStage?.applyAuthoritativeFantasyTime?.(
        evidenceTime,'wp-s003-010-003-016-visual-evidence',
        {snapshotResult:false,deferPresentation:false}
      );
      window.PlanetStage?.setZoomScalar?.(.88);
    """)
    _wait(driver,"""
      const s=window.PlanetStage?.snapshot?.()||{},z=s.zoom||{},r=s.projection?.resourceBudget||{},l=s.projection?.localStatic||{};
      return Boolean(
        Math.abs(Number(z.scalar||0)-.88)<.00001 &&
        Number(r.pendingPreparationCount||0)===0 && !!r.activeSignature &&
        (!r.requestedSignature || String(r.activeSignature)===String(r.requestedSignature)) &&
        String(l.signature||'')===String(r.activeSignature||'') &&
        Number(l.roadCount||0)>0 && Number(l.buildingCount||0)>0
      );
    """,max(float(timeout),180.0),"WP016 baseline ready settlement representation")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    return focus


def _temporal_residency_handoff(driver,timeout):
    before=_temporal_residency_compact(driver)
    result=driver.execute_async_script("""
      const target=.94,timeoutMs=Number(arguments[0]),done=arguments[arguments.length-1];
      const started=performance.now(),samples=[];
      const initial=window.PlanetStage?.snapshot?.()?.projection?.resourceBudget?.activeSignature||null;
      let mismatchFrames=0,lastKey='';
      const read=()=>{
        const s=window.PlanetStage?.snapshot?.()||{},z=s.zoom||{},r=s.projection?.resourceBudget||{},l=s.projection?.localStatic||{};
        return {
          tMs:Number((performance.now()-started).toFixed(3)),scalar:Number(z.scalar||0),
          resource:{requestedSignature:r.requestedSignature||null,activeSignature:r.activeSignature||null,pendingPreparationCount:Number(r.pendingPreparationCount||0),missingCoverageCount:Number(r.missingCoverageCount||0)},
          localStatic:{signature:l.signature||null,revealTier:l.revealTier||'none',roadCount:Number(l.roadCount||0),buildingCount:Number(l.buildingCount||0),entityCount:Number(l.entityCount||0)}
        };
      };
      const tick=()=>{
        const sample=read(),r=sample.resource,l=sample.localStatic;
        const key=JSON.stringify([sample.scalar,r.requestedSignature,r.activeSignature,r.pendingPreparationCount,l.signature,l.revealTier,l.roadCount,l.buildingCount,l.entityCount]);
        if(key!==lastKey){lastKey=key;samples.push(sample);}
        const childActive=!!r.activeSignature && String(r.activeSignature)!==String(initial) && String(r.activeSignature)===String(r.requestedSignature||'');
        if(childActive && String(l.signature||'')!==String(r.activeSignature||''))mismatchFrames++;
        const settled=Math.abs(sample.scalar-target)<.00001 && r.pendingPreparationCount===0 && childActive && String(l.signature||'')===String(r.activeSignature||'') && ['refined','full'].includes(String(l.revealTier||'')) && l.roadCount>0 && l.buildingCount>0;
        if(settled){done({ok:true,mismatchFrames,samples,durationMs:Number((performance.now()-started).toFixed(3)),initialActiveSignature:initial});return;}
        if(performance.now()-started>=timeoutMs){done({ok:false,mismatchFrames,samples,durationMs:Number((performance.now()-started).toFixed(3)),initialActiveSignature:initial});return;}
        requestAnimationFrame(tick);
      };
      window.PlanetStage.setZoomScalar(target);
      requestAnimationFrame(tick);
    """,min(max(float(timeout),180.0),220.0)*1000.0)
    if not result or not result.get("ok"):
        raise RuntimeError(f"WP016 temporal handoff did not settle: {result}")
    return before,result


def _validate_temporal_residency_frames(frames):
    if len(frames)!=WP_TEMPORAL_RESIDENCY_SHOTS:
        raise RuntimeError(f"{WP_TEMPORAL_RESIDENCY_SCENARIO} requires {WP_TEMPORAL_RESIDENCY_SHOTS} fresh frames")
    proof=frames[1].get("handoffProof") or {}
    if int(proof.get("mismatchFrames") or 0)!=0:
        raise RuntimeError(f"WP016 observed terrain-active/static-stale painted frames: {proof.get('mismatchFrames')}")
    stable=frames[1:]
    reference=stable[0].get("temporalState") or {}
    ref_resource=reference.get("resource") or {};ref_static=reference.get("localStatic") or {};ref_focus=reference.get("focus") or {}
    if not ref_resource.get("activeSignature") or str(ref_static.get("signature") or "")!=str(ref_resource.get("activeSignature") or ""):
        raise RuntimeError(f"WP016 post-handoff representation is not atomically complete: {reference}")
    for index,frame in enumerate(stable,start=2):
        state=frame.get("temporalState") or {};resource=state.get("resource") or {};local=state.get("localStatic") or {};focus=state.get("focus") or {}
        if abs(float(state.get("scalar") or 0)-float(reference.get("scalar") or 0))>1e-7:
            raise RuntimeError(f"WP016 frame {index} changed scale during same-scale stability proof")
        if focus!=ref_focus:
            raise RuntimeError(f"WP016 frame {index} changed canonical focus: {ref_focus} -> {focus}")
        if str(resource.get("activeSignature") or "")!=str(ref_resource.get("activeSignature") or "") or str(resource.get("requestedSignature") or "")!=str(ref_resource.get("requestedSignature") or ""):
            raise RuntimeError(f"WP016 frame {index} changed resident resource after settle: {resource}")
        if int(resource.get("pendingPreparationCount") or 0)!=0 or int(resource.get("missingCoverageCount") or 0)!=0 or int(resource.get("blockingZoomBuilds") or 0)!=0:
            raise RuntimeError(f"WP016 frame {index} has incomplete/blank/blocking streaming state: {resource}")
        static_tuple=(local.get("signature"),local.get("revealTier"),int(local.get("roadCount") or 0),int(local.get("buildingCount") or 0),int(local.get("vegetationCount") or 0),int(local.get("entityCount") or 0))
        ref_tuple=(ref_static.get("signature"),ref_static.get("revealTier"),int(ref_static.get("roadCount") or 0),int(ref_static.get("buildingCount") or 0),int(ref_static.get("vegetationCount") or 0),int(ref_static.get("entityCount") or 0))
        if static_tuple!=ref_tuple:
            raise RuntimeError(f"WP016 frame {index} static payload changed after same-scale settle: {ref_tuple} -> {static_tuple}")
        if resource.get("revisitRegenerationPass") is False:
            raise RuntimeError(f"WP016 frame {index} failed deterministic revisit signature proof")
        if int(resource.get("requestBudgetPerFrame") or 0)>1 or int(resource.get("buildJobBudget") or 0)>1:
            raise RuntimeError(f"WP016 frame {index} exceeded bounded request/build budget: {resource}")
'''
shots = replace_once(shots, '\ndef _generic_frames(driver,shots,width,height,timeout,interval):\n', '\n'+helper+'\ndef _generic_frames(driver,shots,width,height,timeout,interval):\n', "temporal helper insertion")
shots = replace_once(
    shots,
    'if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n',
    'if args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_SCALE_HANDOFF_SCENARIO,WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:\n',
    "temporal viewport",
)
shots = replace_once(
    shots,
    '    elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:\n        total=max(total,WP_SCALE_HANDOFF_SHOTS)\n    elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:\n',
    '    elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:\n        total=max(total,WP_SCALE_HANDOFF_SHOTS)\n    elif args.scenario==WP_TEMPORAL_RESIDENCY_SCENARIO:\n        total=max(total,WP_TEMPORAL_RESIDENCY_SHOTS)\n    elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:\n',
    "temporal shot count",
)
branch = '''        elif args.scenario==WP_TEMPORAL_RESIDENCY_SCENARIO:
            focus=_prepare_temporal_residency_scene(driver,args.ready_timeout)
            frames=[]
            baseline={"action":"ready-parent-before-refinement","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"temporalState":_temporal_residency_compact(driver),"focusPreparation":focus}
            path=_file_name(args.filename,1,WP_TEMPORAL_RESIDENCY_SHOTS,args.timestamp_names);_capture(driver,path)
            baseline["index"]=1;baseline["file"]=path.name;baseline["captured_at"]=datetime.now(timezone.utc).isoformat();frames.append(baseline)
            before,proof=_temporal_residency_handoff(driver,args.ready_timeout)
            for index,delay in enumerate((0.0,.5,1.5,3.0),start=2):
                if delay:time.sleep(delay)
                frame={"action":f"same-scale-post-handoff-{index-1}","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"temporalState":_temporal_residency_compact(driver),"focusPreparation":focus}
                if index==2:frame["handoffProof"]={"before":before,**proof}
                path=_file_name(args.filename,index,WP_TEMPORAL_RESIDENCY_SHOTS,args.timestamp_names);_capture(driver,path)
                frame["index"]=index;frame["file"]=path.name;frame["captured_at"]=datetime.now(timezone.utc).isoformat();frames.append(frame)
            _validate_temporal_residency_frames(frames)
'''
shots = replace_once(
    shots,
    '        elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:\n',
    branch+'        elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:\n',
    "temporal capture branch",
)
shot_path.write_text(shots, encoding="utf-8")
print("patched WP-S003-010-003-016 atomic handoff + temporal evidence scenario")
