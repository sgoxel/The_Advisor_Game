#!/usr/bin/env python3
"""Deterministic Selenium visual-evidence capture for The Advisor Game.

The module keeps the shared exact-viewport helper used by focused evidence tools
and also provides the CLI invoked by .github/workflows/visual-evidence.yml.
Unknown scenarios intentionally fall back to a current-build static capture so a
new WP name cannot make the shared workflow unusable. Scenarios that need
stronger assertions may add a focused capture path here.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

PROFILES={"landscape":(1365,768),"portrait":(390,844),"tablet":(1024,768),"phone":(390,844),"phone-landscape":(844,390)}
WP_CHARACTER_SCENARIO="wp-s003-004-004"
WP_CHARACTER_SHOTS=5
STARTING_VILLAGE_SCENARIO="starting-village"
STARTING_VILLAGE_SHOTS=3
WP_STARTING_VILLAGE_DRESSING_SCENARIO="wp-s003-009-001"
WP_STARTING_VILLAGE_DRESSING_SHOTS=7
WP_SURFACE_REFINEMENT_SCENARIO="wp-s003-010-003-005-002"
WP_VIEWPORT_REFINEMENT_SCENARIO="wp-s003-010-003"
WP_SURFACE_REFINEMENT_SHOTS=10
WP_SCALE_HANDOFF_SCENARIO="wp-s003-010-003-006"
WP_SCALE_HANDOFF_SHOTS=13
WP_TEMPORAL_RESIDENCY_SCENARIO="wp-s003-010-003-016"
WP_TEMPORAL_RESIDENCY_SHOTS=5
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
WP_SCALE_HANDOFF_PLAN=(
    (None,"fixed-focus:0.20x"),
    (400000,"regional-overview:400km"),
    (140000,"regional-detail:140km"),
    (50000,"district:50km"),
    (20000,"local-area-wide:20km"),
    (10000,"local-area:10km"),
    (5000,"terrain-settlement-wide:5km"),
    (2000,"terrain-settlement:2km"),
    (1000,"terrain-settlement-core:1km"),
    (500,"settlement-ready:500m"),
    (200,"settlement-ready:200m"),
    (80,"near-ground-ready:80m"),
    (36,"ground-ready:36m"),
)
WP_CANONICAL_FOCUS_SCENARIO="wp-s003-008-008"
WP_CANONICAL_FOCUS_SHOTS=5
WP_ATLAS_LIVE_SCENARIO="wp-s003-010-003-008"
WP_ATLAS_LIVE_SHOTS=7
WP_CELL_LOD_SCENARIO="wp-s003-010-003-013"
WP_CELL_LOD_SHOTS=41
WP_PRODUCTION_GATE_SCENARIO="wp-s003-010-005"
WP_PRODUCTION_GATE_SHOTS=41
WP_WILDERNESS_SCENARIO="wp-s003-013"
WP_WILDERNESS_SHOTS=13
WP_SURFACE_REFINEMENT_PLAN=(
    (0.451545,"fixed-focus:0.08x"),
    (0.588046,"fixed-focus:0.15x"),
    (0.731199,"fixed-focus:0.29x"),
    (0.821726,"fixed-focus:0.44x"),
    (0.866461,"fixed-focus:0.54x"),
    (0.899670,"fixed-focus:0.63x"),
    (0.909559,"fixed-focus:0.66x"),
    (0.946047,"fixed-focus:0.78x"),
    (0.954243,"fixed-focus:0.81x"),
    (1.000000,"fixed-focus:1.00x"),
)

def _inner_viewport(driver):
    inner=driver.execute_script("return {width:window.innerWidth,height:window.innerHeight};")
    return {"width":int(inner.get("width",0)),"height":int(inner.get("height",0))}

def _matches(inner,width,height,tolerance):
    return abs(inner["width"]-width)<=tolerance and abs(inner["height"]-height)<=tolerance

def set_exact_viewport(driver,width,height,attempts=6,tolerance=1):
    width=int(width);height=int(height);tolerance=max(0,int(tolerance))
    try:
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{
            "width":width,"height":height,"deviceScaleFactor":1,"mobile":False
        })
        time.sleep(.08)
        inner=_inner_viewport(driver)
        if _matches(inner,width,height,tolerance):
            return inner
    except Exception:
        pass
    driver.set_window_size(width,height)
    for _ in range(max(1,int(attempts))):
        inner=_inner_viewport(driver)
        if _matches(inner,width,height,tolerance):
            return inner
        outer=driver.get_window_size()
        driver.set_window_size(
            max(240,int(outer.get("width",width))+(width-inner["width"])),
            max(240,int(outer.get("height",height))+(height-inner["height"]))
        )
        time.sleep(.08)
    inner=_inner_viewport(driver)
    if not _matches(inner,width,height,tolerance):
        raise RuntimeError(
            f"exact viewport calibration failed: requested {width}x{height}, "
            f"got {inner['width']}x{inner['height']}"
        )
    return inner

def _screenshots_dir():
    path=Path(__file__).resolve().parent/"screenshots"
    path.mkdir(parents=True,exist_ok=True)
    return path

def _clean_ephemeral_capture_dir():
    directory=_screenshots_dir()
    for path in directory.iterdir():
        if path.is_file() and (path.suffix.lower()==".png" or path.name.startswith("evidence-")):
            try:path.unlink()
            except OSError:pass

def _target_url(target):
    parsed=urlparse(target)
    if parsed.scheme in {"http","https","file"}:
        return target
    path=Path(target).expanduser().resolve()
    if path.is_dir():
        path=path/"index.html"
    return path.as_uri()

def _driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    options=Options()
    for arg in (
        "--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl",
        "--ignore-gpu-blocklist","--use-angle=swiftshader","--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling","--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding","--disable-search-engine-choice-screen",
        "--disable-background-networking","--window-size=1920,1080"
    ):
        options.add_argument(arg)
    options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    driver=webdriver.Chrome(options=options)
    driver.set_script_timeout(240)
    try:driver.command_executor.set_timeout(300)
    except Exception:pass
    return driver

def _wait(driver,predicate,timeout,description):
    deadline=time.monotonic()+float(timeout)
    last=None
    while time.monotonic()<deadline:
        try:
            last=driver.execute_script(predicate)
            if last:
                return last
        except Exception as exc:
            last=str(exc)
        time.sleep(.25)
    raise RuntimeError(f"timeout waiting for {description}; last={last}")

def _wait_document(driver,timeout):
    return _wait(driver,"return document.readyState==='complete' && !!document.body;",timeout,"document readiness")

def _wait_stage(driver,timeout):
    return _wait(driver,"""
      const root=document.getElementById('planetStageRoot');
      const s=window.PlanetStage?.snapshot?.();
      return Boolean(root?.dataset?.ready==='true' && s?.ready && s?.activeSeed);
    """,timeout,"PlanetStage readiness")

def _browser_logs(driver):
    try:
        rows=driver.get_log("browser")
    except Exception:
        return []
    return [{"level":str(row.get("level","")),"message":str(row.get("message",""))[-2000:]} for row in rows[-80:]]

def _stage_snapshot(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||null;
      if(!s)return null;
      const r=window.GameRenderer?.snapshot?.()||{};
      return {
        ready:s.ready,activeSeed:s.activeSeed,
        canonicalFocus:s.canonicalFocus,
        zoom:s.zoom,
        projection:{
          mode:s.projection?.mode,
          blend:s.projection?.blend,
          localDetail:s.projection?.localDetail,
          localStatic:s.projection?.localStatic,
          spatialLod:s.projection?.spatialLod,
          resourceBudget:s.projection?.resourceBudget,
          presentation:s.projection?.presentation
        },
        npcPresentation:s.npcPresentation,
        destinationNavigator:s.destinationNavigator,
        explicitFocusNavigation:s.explicitFocusNavigation,
        mapPresentation:s.mapPresentation,
        inspection:s.inspection,
        atmosphere:s.atmosphere,
        worldVisualStyle:s.worldVisualStyle,
        worldVisualStyleIntegration:s.worldVisualStyleIntegration,
        navigationPerformance:s.navigationPerformance,
        startupError:s.startupError,
        frameCount:s.frameCount,
        renderQuality:window.RuntimeRenderQuality?.snapshot?.()||null,
        rendererEvidence:s.rendererEvidence||{
          engine:r.engine||null,
          engineVersion:r.engineVersion||null,
          backend:r.backend||null,
          scene:{
            entityCount:Number(r.scene?.entityCount||0),
            materialCount:Number(r.scene?.materialCount||0),
            materialVariantCount:Number(r.scene?.materialVariantCount||0)
          },
          performance:r.performance||null,
          materialTextureQuality:r.materialTextureQuality||null,
          terrainChunks:r.terrainChunks||null,
          quality:r.quality||null,
          simulationAuthorityPreserved:r.simulationAuthorityPreserved!==false
        }
      };
    """)

def _activate_stage1_feature(driver,feature):
    """Load an explicitly requested deferred Stage-1 feature for evidence only.

    Stage-1 intentionally reaches first playable with local-world dormant. Visual
    scenarios that exercise settlement/local presentation must request that feature
    before using its authorities; this keeps startup acceptance and game authority
    unchanged while making the evidence path compatible with lazy bootstrap.
    """
    result=driver.execute_async_script("""
      const feature=String(arguments[0]||''),done=arguments[arguments.length-1];
      const bootstrap=window.Stage1Bootstrap;
      if(!bootstrap?.activateFeature){done({ok:true,feature,skipped:true,reason:'legacy-root'});return;}
      bootstrap.activateFeature(feature).then(state=>done({
        ok:true,feature,skipped:false,status:state?.status||null,
        bootstrap:bootstrap.snapshot?.()||null
      })).catch(error=>done({ok:false,feature,error:String(error?.stack||error)}));
    """,feature)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not activate Stage-1 feature {feature}: {result}")
    return result


def _prepare_starting_village_focus(driver):
    _activate_stage1_feature(driver,"local-world")
    _wait(driver,"return Boolean(window.StartingVillage?.plan);",60,"Stage-1 local-world StartingVillage authority")
    result=driver.execute_script("""
      const stage=window.PlanetStage,seed=stage?.snapshot?.()?.activeSeed;
      if(!stage||!seed||!window.StartingVillage?.plan)return {ok:false,reason:'authority-unavailable'};
      const village=StartingVillage.plan(seed),center=village?.center;
      if(!center)return {ok:false,reason:'village-center-unavailable'};
      stage.setWorldTileFocus(center.x,center.y);
      return {ok:true,seed,center:{x:String(center.x),y:String(center.y)},name:village?.name||null};
    """)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not focus canonical starting village: {result}")
    return result

def _starting_village_readiness_state(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},local=s?.projection?.localStatic||{},npc=s?.npcPresentation||{};
      const residents=Number(npc?.residentBillboardCount||0),detailed=Number(npc?.detailedBillboardCount||0);
      const conditions={
        stageReady:Boolean(s?.ready),
        zoomSettled:!Boolean(s?.zoom?.animation?.active),
        visibleGround:s?.zoom?.visibleLevel==='ground',
        fullReveal:local?.revealTier==='full',
        worldVisualStyle:Boolean(s?.worldVisualStyleIntegration?.active===true),
        groundRepresentationReady:Boolean(npc?.groundRepresentationReady===true),
        billboardLayerActive:Boolean(npc?.billboardLayerActive===true),
        protagonistBillboardVisible:Boolean(npc?.protagonistBillboardVisible===true),
        residentBillboards:residents>0,
        detailedBillboardsComplete:detailed>=residents+1
      };
      return {
        ready:Object.values(conditions).every(Boolean),
        conditions,
        counts:{residents,detailed},
        zoom:s?.zoom||null,
        localStatic:local,
        npcPresentation:npc,
        projectionResourceBudget:s?.projection?.resourceBudget||null,
        worldVisualStyleIntegration:s?.worldVisualStyleIntegration||null,
        stageStartupError:s?.startupError||null,
        gameRenderer:window.GameRenderer?.snapshot?.()||null
      };
    """)

def _persist_starting_village_readiness_failure(driver):
    directory=_screenshots_dir()
    diagnostic={"readiness":None,"browserLogs":[]}
    try: diagnostic["readiness"]=_starting_village_readiness_state(driver)
    except Exception as exc: diagnostic["readinessError"]=repr(exc)
    try: diagnostic["browserLogs"]=_browser_logs(driver)
    except Exception as exc: diagnostic["browserLogError"]=repr(exc)
    diagnostic["captured_at"]=datetime.now(timezone.utc).isoformat()
    json_path=directory/"starting-village-readiness-failure.json"
    json_path.write_text(json.dumps(diagnostic,indent=2,sort_keys=True),encoding="utf-8")
    try: driver.save_screenshot(str(directory/"starting-village-readiness-failure.png"))
    except Exception as exc: diagnostic["screenshotError"]=repr(exc)
    print("STARTING_VILLAGE_READINESS_DIAGNOSTIC="+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)
    return diagnostic

def _prepare_starting_village_scene(driver,timeout):
    focus=_prepare_starting_village_focus(driver)
    result=driver.execute_script("""
      const stage=window.PlanetStage;
      const evidenceTime={year:1100,month:1,day:1,hour:11,minute:30,second:0};
      stage.applyAuthoritativeFantasyTime?.(evidenceTime,'wp-s003-009-visual-evidence',{snapshotResult:false,deferPresentation:false});
      stage.setZoomScalar(1);
      return {scalar:1,evidenceTime};
    """)
    try:
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.(),local=s?.projection?.localStatic||{},npc=s?.npcPresentation||{};
          const residents=Number(npc?.residentBillboardCount||0),detailed=Number(npc?.detailedBillboardCount||0);
          return Boolean(
            s?.ready && !s?.zoom?.animation?.active &&
            s?.zoom?.visibleLevel==='ground' &&
            local?.revealTier==='full' &&
            s?.worldVisualStyleIntegration?.active===true &&
            npc?.groundRepresentationReady===true &&
            npc?.billboardLayerActive===true &&
            npc?.protagonistBillboardVisible===true &&
            residents>0 && detailed>=residents+1
          );
        """,max(float(timeout),300.0),"Starting Village final-ground living-world presentation with character billboards")
    except Exception as exc:
        diagnostic=_persist_starting_village_readiness_failure(driver)
        failed=[key for key,value in (diagnostic.get("readiness",{}).get("conditions",{}) or {}).items() if not value]
        raise RuntimeError(
            "Starting Village final-ground readiness failed; "
            f"failedConditions={failed}; diagnostic=tools/screenshots/starting-village-readiness-failure.json"
        ) from exc
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    return {**focus,"zoom":result}


def _canonical_focus_ui_state(driver):
    return driver.execute_script("""
      const stage=window.PlanetStage?.snapshot?.()||{};
      const protagonist=(window.PlanetStage?.inspectionTargets?.()||[]).find(item=>item.type==='protagonist')||null;
      const places=document.querySelector('.planet-places-panel');
      const tip=document.querySelector('.world-inspection-tooltip');
      const focusButton=document.querySelector('.world-inspection-focus');
      return {
        placesVisible:Boolean(places),
        placesText:places?.innerText||'',
        tooltipVisible:Boolean(tip&&getComputedStyle(tip).visibility!=='hidden'),
        tooltipText:tip?.innerText||'',
        focusButtonVisible:Boolean(focusButton),
        protagonistTarget:protagonist,
        destinationNavigator:stage.destinationNavigator||null,
        explicitFocusNavigation:stage.explicitFocusNavigation||null,
        npcPresentation:stage.npcPresentation||null,
        zoom:stage.zoom||null,
        canonicalFocus:stage.canonicalFocus||null
      };
    """)

def _install_canonical_focus_campaign(driver):
    seed="CANONICAL-FOCUS-008008-VISUAL"
    campaign=json.dumps({
        "seed":seed,
        "realStartMs":int(time.time()*1000),
        "fantasyStart":{"year":1100,"month":1,"day":1,"hour":11,"minute":30,"second":0,"millisecond":0},
        "protagonist":{"x":"0","y":"0"},
        "restartCount":0,
    },separators=(",",":"))
    settings=json.dumps({"seed":seed},separators=(",",":"))
    source=f"""
      try {{
        localStorage.setItem('theAdvisorGame.wp001.campaign.v2', {json.dumps(campaign)});
        localStorage.setItem('theAdvisorGame.wp001.settings.v2', {json.dumps(settings)});
        localStorage.setItem('advisor.planet.seed.v1', {json.dumps(seed)});
      }} catch (_) {{}}
    """
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":source})
    return seed

def _canonical_focus_starting_village(driver):
    result=driver.execute_script("""
      const stage=window.PlanetStage,seed=stage?.snapshot?.()?.activeSeed;
      const village=seed&&window.StartingVillage?.plan?.(seed),center=village?.center;
      if(!stage||!center)return {ok:false,reason:'starting-village-unavailable'};
      stage.closePlaces?.();
      stage.setWorldTileFocus(String(center.x),String(center.y));
      return {ok:true,seed,center:{x:String(center.x),y:String(center.y)},name:village?.name||'Starting Village'};
    """)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not prepare canonical focus village: {result}")
    return result

def _canonical_focus_protagonist_wide_setup(driver):
    result=driver.execute_script("""
      const stage=window.PlanetStage;
      const read=()=>window.Protagonist?.getPosition?.()||window.SeedSystem?.getCampaign?.()?.protagonist||null;
      const before=read();
      if(!stage||!before)return {ok:false,reason:'authoritative-protagonist-unavailable'};
      stage.closePlaces?.();
      stage.setWorldTileFocus(String(before.x),String(before.y));
      const footprintMeters=240,scalar=stage.scalarForFootprintHeight(footprintMeters);
      stage.setZoomScalar(scalar);
      const after=read();
      return {
        ok:true,scalar,footprintMeters,
        before:{x:String(before.x),y:String(before.y)},
        after:after?{x:String(after.x),y:String(after.y)}:null
      };
    """)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not prepare wider-view protagonist focus: {result}")
    if result.get("before")!=result.get("after"):
        raise RuntimeError(f"wider-view camera setup mutated protagonist simulation position: {result}")
    return result

def _canonical_focus_frame(driver,index,timeout):
    if index==0:
        set_exact_viewport(driver,1440,900)
        prep=_canonical_focus_starting_village(driver)
        driver.execute_script("""
          const stage=window.PlanetStage;
          stage.setScaleIndex(4);
          stage.refreshPlaces();
          stage.openPlaces();
        """)
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.();
          return Boolean(s?.destinationNavigator?.totalDescriptorCount>0 && document.querySelector('.planet-places-panel'));
        """,timeout,"bounded Places descriptors")
        selected=driver.execute_script("""
          const stage=window.PlanetStage,items=stage.placeDescriptors();
          const valid=items.filter(d=>d?.canonicalCoordinateValid!==false&&d?.latitudeRadians!==null&&d?.latitudeRadians!==undefined&&d?.longitudeRadians!==null&&d?.longitudeRadians!==undefined);
          const d=valid.find(x=>x.category==='cities'||x.category==='settlements')||valid[0];
          if(!d)return {ok:false,reason:'no-valid-destination'};
          const result=stage.selectPlace(d.id);
          return {ok:true,id:String(d.id),name:String(d.name||d.id),category:String(d.category||''),type:String(d.type||''),latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees,result};
        """)
        if not selected or not selected.get("ok"):
            raise RuntimeError(f"could not select canonical Places destination: {selected}")
        _wait(driver,"""
          const n=window.PlanetStage?.snapshot?.()?.explicitFocusNavigation?.active;
          return Boolean(n?.targetType==='place' && Number(n?.focusErrorMeters)<=1);
        """,timeout,"exact Places canonical target")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        return {"action":"places-canonical-view","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver),"setup":{**prep,"selected":selected}}
    if index==1:
        set_exact_viewport(driver,1440,900)
        prep=_canonical_focus_protagonist_wide_setup(driver)
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.(),p=s?.npcPresentation||{},ls=s?.projection?.localStatic||{};
          const t=(window.PlanetStage?.inspectionTargets?.()||[]).find(x=>x.type==='protagonist');
          const c=document.getElementById('planetCanvas')?.getBoundingClientRect?.(),b=t?.bounds;
          const cx=b?(Number(b.left)+Number(b.right))/2:NaN,cy=b?(Number(b.top)+Number(b.bottom))/2:NaN;
          const inViewport=Boolean(c&&Number.isFinite(cx)&&Number.isFinite(cy)&&cx>=0&&cx<=Number(c.width)&&cy>=0&&cy<=Number(c.height));
          return Boolean(
            s?.ready && Number(s?.zoom?.scalar)<0.999999 &&
            String(s?.zoom?.visibleLevel||'')!=='ground' &&
            ls?.revealTier==='refined' &&
            p?.protagonistMarkerVisible===true && p?.protagonistBillboardVisible!==true &&
            t && inViewport
          );
        """,timeout,"wider-view protagonist marker")
        picked=driver.execute_script("""
          const t=(window.PlanetStage.inspectionTargets()||[]).find(x=>x.type==='protagonist');
          if(!t?.bounds)return {ok:false,reason:'protagonist-bounds-missing'};
          const x=(Number(t.bounds.left)+Number(t.bounds.right))/2,y=(Number(t.bounds.top)+Number(t.bounds.bottom))/2;
          const record=window.PlanetStage.pickInspection(x,y);
          return {ok:Boolean(record?.type==='protagonist'),type:record?.type||null,x,y,bounds:t.bounds};
        """)
        if not picked or not picked.get("ok"):
            raise RuntimeError(f"could not inspect protagonist marker: {picked}")
        _wait(driver,"return Boolean(document.querySelector('.world-inspection-focus'));",timeout,"protagonist explicit Focus action")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        return {"action":"protagonist-inspection-before-focus","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver),"setup":{**prep,"picked":picked}}
    if index==2:
        button=driver.find_element("css selector",".world-inspection-focus")
        button.click()
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.(),n=s?.explicitFocusNavigation?.active,p=s?.npcPresentation||{};
          return Boolean(n?.targetType==='protagonist' && n?.state==='committed' && n?.maximumScaleReached===true && Number(n?.focusErrorMeters)<=1 && s?.zoom?.visibleLevel==='ground' && p?.protagonistBillboardVisible===true);
        """,timeout,"committed protagonist max-zoom focus")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        return {"action":"protagonist-max-zoom-committed","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver)}
    if index==3:
        set_exact_viewport(driver,390,844)
        _wait(driver,"return window.innerWidth===390 && window.innerHeight===844;",timeout,"phone portrait viewport")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        return {"action":"phone-portrait-protagonist-focus","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver)}
    if index==4:
        set_exact_viewport(driver,844,390)
        _wait(driver,"return window.innerWidth===844 && window.innerHeight===390;",timeout,"phone landscape viewport")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        return {"action":"phone-landscape-protagonist-focus","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver)}
    return {"action":"canonical-focus-extra","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver),"ui":_canonical_focus_ui_state(driver)}

def _validate_canonical_focus_frames(frames):
    if len(frames)<WP_CANONICAL_FOCUS_SHOTS:
        raise RuntimeError(f"{WP_CANONICAL_FOCUS_SCENARIO} requires {WP_CANONICAL_FOCUS_SHOTS} fresh frames")
    places=frames[0];pnav=((places.get("stage") or {}).get("explicitFocusNavigation") or {}).get("active") or {}
    pnav_error=pnav.get("focusErrorMeters")
    if not (places.get("ui") or {}).get("placesVisible") or pnav.get("targetType")!="place" or float(pnav_error if pnav_error is not None else 999999)>1:
        raise RuntimeError(f"Places exact-focus frame invalid: {places}")
    inspect=frames[1];ui=inspect.get("ui") or {};npc=(inspect.get("stage") or {}).get("npcPresentation") or {}
    if not ui.get("tooltipVisible") or not ui.get("focusButtonVisible") or npc.get("protagonistMarkerVisible") is not True:
        raise RuntimeError(f"protagonist inspection frame invalid: {inspect}")
    for frame in frames[2:WP_CANONICAL_FOCUS_SHOTS]:
        stage=frame.get("stage") or {};nav=(stage.get("explicitFocusNavigation") or {}).get("active") or {};npc=stage.get("npcPresentation") or {}
        nav_error=nav.get("focusErrorMeters")
        if nav.get("targetType")!="protagonist" or nav.get("state")!="committed" or nav.get("maximumScaleReached") is not True or float(nav_error if nav_error is not None else 999999)>1:
            raise RuntimeError(f"protagonist focus transaction not committed exactly: {frame}")
        if (stage.get("zoom") or {}).get("visibleLevel")!="ground" or npc.get("protagonistBillboardVisible") is not True:
            raise RuntimeError(f"protagonist ground representation missing: {frame}")
    if frames[3].get("viewport")!={"width":390,"height":844}:
        raise RuntimeError(f"phone portrait viewport mismatch: {frames[3].get('viewport')}")
    if frames[4].get("viewport")!={"width":844,"height":390}:
        raise RuntimeError(f"phone landscape viewport mismatch: {frames[4].get('viewport')}")

def _set_character_scale(driver,mode):
    if mode=="near":
        result=driver.execute_script("""
          const stage=window.PlanetStage;
          const scalar=stage.scalarForFootprintHeight(80);
          stage.setZoomScalar(scalar);
          return {mode:'near',scalar};
        """)
    else:
        result=driver.execute_script("""
          const stage=window.PlanetStage;
          const scalar=Number(stage.constants?.ZOOM_MAX??1);
          stage.setZoomScalar(scalar);
          return {mode:'ground',scalar};
        """)
    return result

def _wait_character_state(driver,mode,timeout):
    if mode=="near":
        predicate="""
          const s=window.PlanetStage?.snapshot?.();
          const p=s?.npcPresentation||{};
          const visible=String(s?.zoom?.visibleLevel||'');
          const requested=String(s?.zoom?.requestedLevel||'');
          return Boolean(
            s?.ready && !s?.zoom?.animation?.active &&
            (visible==='near-ground-close'||requested==='near-ground-close') &&
            p.billboardLayerActive!==true &&
            Number(p.detailedBillboardCount||0)===0
          );
        """
        return _wait(driver,predicate,timeout,"near-ground scale with character art absent")
    predicate="""
      const s=window.PlanetStage?.snapshot?.(),p=s?.npcPresentation||{},r=s?.projection?.resourceBudget||{};
      return Boolean(
        s?.ready && !s?.zoom?.animation?.active &&
        s?.zoom?.visibleLevel==='ground' &&
        r.visibleLevel==='ground' &&
        s?.projection?.localStatic?.revealTier==='full' &&
        p.groundRepresentationReady===true &&
        p.billboardLayerActive===true &&
        Number(p.detailedBillboardCount||0)>0 &&
        p.protagonistBillboardVisible===true &&
        Array.isArray(p.billboardTextureUrls) && p.billboardTextureUrls.length>0
      );
    """
    return _wait(driver,predicate,timeout,"ready ground tier with detailed character billboards")

def _capture(driver,path):
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"screenshot capture failed: {path}")
    if path.stat().st_size<10_000:
        raise RuntimeError(f"screenshot is unexpectedly small: {path.stat().st_size} bytes")

def _file_name(stem,index,total,timestamp_names):
    clean=Path(stem).stem or "visual-evidence"
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") if timestamp_names else ""
    if total==1:
        name=f"{clean}{'-'+stamp if stamp else ''}.png"
    else:
        name=f"{clean}-{index:02d}{'-'+stamp if stamp else ''}.png"
    return _screenshots_dir()/name

def _character_frame(driver,index,base_width,base_height,timeout):
    actions=(
        ("near",base_width,base_height,"near-ground-no-character-art"),
        ("ground",base_width,base_height,"ground-landscape"),
        ("ground",base_width,base_height,"ground-landscape-stable"),
        ("ground",1080,1440,"ground-portrait"),
        ("ground",base_width,base_height,"ground-landscape-return"),
    )
    mode,width,height,label=actions[index]
    set_exact_viewport(driver,width,height)
    if index in (0,1):
        _set_character_scale(driver,mode)
    elif index==4:
        _set_character_scale(driver,"ground")
    _wait_character_state(driver,mode,timeout)
    if index==2:
        time.sleep(.8)
    snapshot=_stage_snapshot(driver)
    return {
        "action":label,
        "viewport":_inner_viewport(driver),
        "stage":snapshot,
    }

def _validate_character_frames(frames):
    if len(frames)!=WP_CHARACTER_SHOTS:
        raise RuntimeError(f"{WP_CHARACTER_SCENARIO} requires {WP_CHARACTER_SHOTS} fresh frames")
    near=frames[0]["stage"] or {}
    near_p=near.get("npcPresentation") or {}
    if near_p.get("billboardLayerActive") is True or int(near_p.get("detailedBillboardCount") or 0)!=0:
        raise RuntimeError(f"detailed character art leaked below ground tier: {near_p}")
    focus_keys=[]
    for index,frame in enumerate(frames[1:],start=2):
        stage=frame["stage"] or {}
        zoom=stage.get("zoom") or {}
        local=((stage.get("projection") or {}).get("localStatic") or {})
        p=stage.get("npcPresentation") or {}
        if zoom.get("visibleLevel")!="ground" or local.get("revealTier")!="full":
            raise RuntimeError(f"frame {index} is not final ready ground: zoom={zoom.get('visibleLevel')} tier={local.get('revealTier')}")
        if p.get("billboardLayerActive") is not True or int(p.get("detailedBillboardCount") or 0)<1:
            raise RuntimeError(f"frame {index} has no detailed billboard layer: {p}")
        if p.get("protagonistBillboardVisible") is not True:
            raise RuntimeError(f"frame {index} has no protagonist billboard: {p}")
        if p.get("billboardOnlyAtGround") is not True:
            raise RuntimeError(f"frame {index} lost ground-only contract: {p}")
        if p.get("cameraPresentation")!="orthographic-3q":
            raise RuntimeError(f"frame {index} lost orthographic camera presentation: {p}")
        focus=(stage.get("canonicalFocus") or {}).get("worldTile") or {}
        focus_keys.append((str(focus.get("x")),str(focus.get("y"))))
    if len(set(focus_keys))!=1:
        raise RuntimeError(f"pure zoom/viewport evidence changed canonical focus: {focus_keys}")

def _prepare_surface_refinement_focus(driver):
    result=driver.execute_script("""
      const stage=window.PlanetStage,s=stage?.snapshot?.();
      const target=s?.featureTargets?.continuityFocus||s?.featureTargets?.continent||s?.featureTargets?.mountain||s?.featureTargets?.peak;
      if(!stage||!s?.ready||!target)return {ok:false,reason:'continuity-focus-unavailable'};
      stage.setViewTarget(target);
      const after=stage.snapshot();
      return {
        ok:true,
        seed:after.activeSeed,
        latitudeDegrees:after.canonicalFocus?.latitudeDegrees,
        longitudeDegrees:after.canonicalFocus?.longitudeDegrees,
        worldTile:after.canonicalFocus?.worldTile||null
      };
    """)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not prepare fixed surface-refinement focus: {result}")
    return result

def _surface_refinement_frame(driver,index,timeout,viewport=(1280,800),exact_public_scale=False):
    scalar,label=WP_SURFACE_REFINEMENT_PLAN[index]
    set_exact_viewport(driver,*viewport)
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    if exact_public_scale:
        public_labels=("1/10","1/20","1/50","1/100","1/250","1/500","1/1000","1/2500","1/5000","1/10000")
        expected_label=public_labels[index]
        label=f"public-scale:{expected_label}"
        driver.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);",int(index))
        _wait(driver,f"""
          const expectedIndex={int(index)!r},expectedLabel={expected_label!r},s=window.PlanetStage?.snapshot?.(),r=s?.projection?.resourceBudget||{{}};
          const current=Number(s?.zoom?.scaleIndex ?? -1);
          const tangentRequired=Number(s?.projection?.blend||0)>.02;
          const resourceOk=!tangentRequired || (
            Number(r?.pendingPreparationCount||0)===0 &&
            !!r?.activeSignature &&
            (!r?.requestedSignature || r?.activeSignature===r?.requestedSignature)
          );
          const presentedTruthOk=!tangentRequired || (
            String(r?.requestedScale||'')===expectedLabel &&
            String(r?.presentedScale||'')===expectedLabel &&
            r?.childResourceState==='presented' &&
            r?.fallbackPinned!==true
          );
          const ruler=document.querySelector('.planet-scale-ruler');
          const currentLabel=((ruler?.innerText||'').trim().split(String.fromCharCode(10))[0]||'').trim();
          return Boolean(s?.ready && current===expectedIndex && !s?.zoom?.animation?.active && resourceOk && presentedTruthOk && currentLabel===expectedLabel);
        """,timeout,f"surface refinement exact public scale {expected_label} readiness")
    else:
        driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))
        driver.execute_async_script("""
          const done=arguments[0];
          requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
        """)
        driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))
        _wait(driver,f"""
          const target={float(scalar)!r},s=window.PlanetStage?.snapshot?.(),r=s?.projection?.resourceBudget||{{}};
          const zoomOk=Math.abs(Number(s?.zoom?.scalar)-target)<0.00001 && !s?.zoom?.animation?.active;
          const tangentRequired=Number(s?.projection?.blend||0)>.02;
          const resourceOk=!tangentRequired || (
            Number(r?.pendingPreparationCount||0)===0 &&
            !!r?.activeSignature &&
            r?.activeSignature===r?.requestedSignature
          );
          return Boolean(s?.ready&&zoomOk&&resourceOk);
        """,timeout,f"surface refinement {label} readiness")
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    stage=_stage_snapshot(driver)
    detail=((stage or {}).get("projection") or {}).get("localDetail") or {}
    budget=((stage or {}).get("projection") or {}).get("resourceBudget") or {}
    zoom=(stage or {}).get("zoom") or {}
    proof={
        "scalar":zoom.get("scalar"),
        "level":detail.get("level"),
        "textureSize":detail.get("textureSize"),
        "sourceTextureWidth":detail.get("sourceTextureWidth"),
        "sourceTextureHeight":detail.get("sourceTextureHeight"),
        "sourceMetersPerSample":detail.get("focusAuthorityMetersPerSample"),
        "metersPerTexel":detail.get("detailMetersPerTexel"),
        "mediumMetersPerTexel":detail.get("mediumMetersPerTexel"),
        "surroundMetersPerTexel":detail.get("surroundMetersPerTexel"),
        "geometrySpacing":detail.get("geometrySampleSpacingMeters") or detail.get("sampleSpacingMeters"),
        "anisotropy":detail.get("anisotropy"),
        "mipmaps":detail.get("mipmaps"),
        "minFilter":detail.get("minFilter"),
        "magFilter":detail.get("magFilter"),
        "samplingPolicy":detail.get("samplingPolicy"),
        "detailBands":detail.get("detailBandCount"),
        "visibleFootprint":[zoom.get("visibleFootprintWidthMeters"),zoom.get("visibleFootprintHeightMeters")],
        "buildMs":budget.get("lastBuildMs"),
        "cached":budget.get("cachedResourceCount"),
        "offscreenFine":budget.get("offscreenFineDetailActive"),
        "visibleNativeMagnification":(((stage or {}).get("projection") or {}).get("spatialLod") or {}).get("visibleNativeMagnification"),
        "foregroundPatchVisible":budget.get("foregroundPatchVisible"),
        "foregroundPatchCoversViewport":budget.get("foregroundPatchCoversViewport"),
        "renderQuality":(stage or {}).get("renderQuality"),
    }
    return {"action":label,"viewport":_inner_viewport(driver),"stage":stage,"densityProof":proof}

def _validate_surface_refinement_frames(frames):
    if len(frames)!=WP_SURFACE_REFINEMENT_SHOTS:
        raise RuntimeError(f"{WP_SURFACE_REFINEMENT_SCENARIO} requires {WP_SURFACE_REFINEMENT_SHOTS} fixed-focus frames")
    focus=[]
    density=[]
    prior_footprint=None
    for index,frame in enumerate(frames,start=1):
        stage=frame.get("stage") or {}
        canonical=stage.get("canonicalFocus") or {}
        focus.append((canonical.get("latitudeDegrees"),canonical.get("longitudeDegrees"),str((canonical.get("worldTile") or {}).get("x")),str((canonical.get("worldTile") or {}).get("y"))))
        zoom=stage.get("zoom") or {}
        footprint=float(zoom.get("visibleFootprintHeightMeters") or 0)
        if footprint<=0:
            raise RuntimeError(f"frame {index} is missing visible footprint telemetry")
        if prior_footprint is not None and footprint>=prior_footprint:
            raise RuntimeError(f"closer zoom did not shrink visible footprint: {prior_footprint} -> {footprint}")
        prior_footprint=footprint
        detail=((stage.get("projection") or {}).get("localDetail") or {})
        budget=((stage.get("projection") or {}).get("resourceBudget") or {})
        if budget.get("offscreenFineDetailActive") is not False:
            raise RuntimeError(f"frame {index} activated offscreen fine detail: {budget}")
        if float(zoom.get("scalar") or 0)>=.70 and detail.get("active") and budget.get("foregroundPatchVisible") is not True:
            raise RuntimeError(f"frame {index} hid the prepared fine terrain beneath its covering rings: {budget}")
        cache_count=int(budget.get("cachedResourceCount") or 0)
        cache_limit=int(budget.get("cacheLimit") or 0)
        cache_bytes=int(budget.get("estimatedCacheBytes") or 0)
        cache_budget=int(budget.get("cacheBudgetBytes") or 0)
        if cache_limit<=0 or cache_count>cache_limit:
            raise RuntimeError(f"frame {index} exceeded bounded local cache count: {budget}")
        if cache_budget<=0 or cache_bytes>cache_budget or budget.get("cacheBudgetExceeded") is True:
            raise RuntimeError(f"frame {index} exceeded bounded local cache bytes: {budget}")
        if detail.get("active"):
            mpt=float(detail.get("detailMetersPerTexel") or 0)
            spacing=float(detail.get("geometrySampleSpacingMeters") or detail.get("sampleSpacingMeters") or 0)
            source_w=int(detail.get("sourceTextureWidth") or detail.get("textureSize") or 0)
            source_h=int(detail.get("sourceTextureHeight") or detail.get("textureSize") or 0)
            if mpt<=0 or spacing<=0 or source_w<=0 or source_h<=0:
                raise RuntimeError(f"frame {index} missing density telemetry: {detail}")
            source_mps=float(detail.get("focusAuthorityMetersPerSample") or 0)
            if source_mps<=0:
                raise RuntimeError(f"frame {index} missing canonical source-density telemetry: {detail}")
            if int(detail.get("anisotropy") or 0)<1 or detail.get("mipmaps") is not False or detail.get("minFilter")!="linear" or detail.get("magFilter")!="linear":
                raise RuntimeError(f"frame {index} invalid texture sampling telemetry: {detail}")
            if detail.get("samplingPolicy")!="single-level-linear-transition-alpha":
                raise RuntimeError(f"frame {index} missing deterministic transition-texture sampling policy: {detail}")
            density.append((index,mpt,spacing,source_mps,source_w,source_h,str(detail.get("level") or "")))
    if len(set(focus))!=1:
        raise RuntimeError(f"surface refinement evidence changed canonical focus: {focus}")
    if len(density)<5:
        raise RuntimeError(f"too few refined terrain samples: {density}")
    for a,b in zip(density,density[1:]):
        if b[1]>a[1]*1.001 or b[2]>a[2]*1.001 or b[3]>a[3]*1.001:
            raise RuntimeError(f"closer zoom lost world-space terrain/source density: {a} -> {b}")
    if density[-1][1]>=density[0][1] or density[-1][2]>=density[0][2] or density[-1][3]>=density[0][3]:
        raise RuntimeError(f"surface refinement did not materially improve density: {density[0]} -> {density[-1]}")


def _scale_handoff_compact(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},z=s.zoom||{},r=s.projection?.resourceBudget||{},l=s.projection?.localStatic||{};
      return {
        ready:Boolean(s.ready),
        scalar:Number(z.scalar||0),requestedBand:z.requestedBand||z.band||null,visibleBand:z.visibleBand||z.band||null,
        requestedLevel:z.requestedLevel||r.requestedLevel||null,visibleLevel:z.visibleLevel||r.visibleLevel||null,
        visibleFootprintHeightMeters:Number(z.visibleFootprintHeightMeters||0),
        blend:Number(s.projection?.blend||0),
        localStatic:{
          active:Boolean(l.active),signature:l.signature||null,level:l.level||null,revealTier:l.revealTier||"none",
          roadCount:Number(l.roadCount||0),buildingCount:Number(l.buildingCount||0)
        },
        resource:{
          pendingPreparationCount:Number(r.pendingPreparationCount||0),
          requestedSignature:r.requestedSignature||null,activeSignature:r.activeSignature||null,preparedSignature:r.preparedSignature||null,preparingSignature:r.preparingSignature||null,
          visibleLevelIndex:Number.isFinite(Number(r.visibleLevelIndex))?Number(r.visibleLevelIndex):null,
          standInActive:Boolean(r.standInActive),mapScalePresentationEligible:r.mapScalePresentationEligible,
          mapScaleSuppressionActive:Boolean(r.mapScaleSuppressionActive),blockingZoomBuilds:Number(r.blockingZoomBuilds||0),
          lastPreparationWallMs:Number(r.lastPreparationWallMs||0),lastPreparationBusyMs:Number(r.lastPreparationBusyMs||0),
          lastPreparationSlices:Number(r.lastPreparationSlices||0),maxPreparationSliceMs:Number(r.maxPreparationSliceMs||0),
          lastSwapMs:Number(r.lastSwapMs||0),maxSwapMs:Number(r.maxSwapMs||0),
          maxFrameMsDuringPreparation:Number(r.maxFrameMsDuringPreparation||0),recentMaxFrameMs:Number(r.recentMaxFrameMs||0)
        }
      };
    """)

def _prepare_scale_handoff_focus(driver,viewport):
    set_exact_viewport(driver,*viewport)
    focus=_prepare_starting_village_focus(driver)
    driver.execute_script("""
      const evidenceTime={year:1100,month:1,day:1,hour:11,minute:30,second:0};
      window.PlanetStage?.applyAuthoritativeFantasyTime?.(
        evidenceTime,'wp-s003-010-003-006-visual-evidence',
        {snapshotResult:false,deferPresentation:false}
      );
      window.PlanetStage?.setZoomScalar?.(.20);
    """)
    _wait(driver,"return Boolean(window.PlanetStage?.snapshot?.()?.ready);",180,"scale handoff starting-village focus")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    return focus

def _scale_handoff_frame(driver,index,timeout):
    height,label=WP_SCALE_HANDOFF_PLAN[index]
    scalar=.20 if height is None else float(driver.execute_script(
        "return Number(window.PlanetStage.scalarForFootprintHeight(arguments[0]));",float(height)
    ))
    before=_scale_handoff_compact(driver)
    timeline=driver.execute_async_script("""
      const target=Number(arguments[0]),timeoutMs=Number(arguments[1]),done=arguments[arguments.length-1];
      const started=performance.now(),samples=[];let lastKey="";
      const read=()=>{
        const s=window.PlanetStage?.snapshot?.()||{},z=s.zoom||{},r=s.projection?.resourceBudget||{},l=s.projection?.localStatic||{};
        return {
          scalar:Number(z.scalar||0),requestedBand:z.requestedBand||z.band||null,visibleBand:z.visibleBand||z.band||null,
          requestedLevel:z.requestedLevel||r.requestedLevel||null,visibleLevel:z.visibleLevel||r.visibleLevel||null,
          blend:Number(s.projection?.blend||0),
          localStatic:{active:Boolean(l.active),signature:l.signature||null,level:l.level||null,revealTier:l.revealTier||"none",roadCount:Number(l.roadCount||0),buildingCount:Number(l.buildingCount||0)},
          resource:{
            pendingPreparationCount:Number(r.pendingPreparationCount||0),requestedSignature:r.requestedSignature||null,activeSignature:r.activeSignature||null,
            visibleLevelIndex:Number.isFinite(Number(r.visibleLevelIndex))?Number(r.visibleLevelIndex):null,
            blockingZoomBuilds:Number(r.blockingZoomBuilds||0),standInActive:Boolean(r.standInActive),
            mapScalePresentationEligible:r.mapScalePresentationEligible
          }
        };
      };
      const record=()=>{
        const sample=read(),r=sample.resource,l=sample.localStatic;
        const key=JSON.stringify([sample.requestedBand,sample.visibleBand,sample.requestedLevel,sample.visibleLevel,r.pendingPreparationCount,r.activeSignature,r.requestedSignature,r.visibleLevelIndex,l.signature,l.level,l.revealTier,l.roadCount,l.buildingCount]);
        if(key!==lastKey){lastKey=key;samples.push(sample);}
        return sample;
      };
      window.PlanetStage.setZoomScalar(target);
      const tick=()=>{
        const sample=record(),r=sample.resource,l=sample.localStatic;
        const exact=Math.abs(Number(sample.scalar)-target)<0.00001;
        const tangentOwns=sample.blend>.02;
        const resourceReady=!tangentOwns || (
          r.pendingPreparationCount===0 &&
          !!r.activeSignature &&
          (!r.requestedSignature || String(r.activeSignature)===String(r.requestedSignature))
        );
        const staticNeeded=tangentOwns && Number.isInteger(r.visibleLevelIndex) && r.visibleLevelIndex>=8;
        const staticReady=!staticNeeded || (!!l.signature && String(l.signature)===String(r.activeSignature));
        if(exact&&resourceReady&&staticReady){
          done({ok:true,samples,last:sample,durationMs:Number((performance.now()-started).toFixed(3))});return;
        }
        if(performance.now()-started>=timeoutMs){
          done({ok:false,samples,last:sample,durationMs:Number((performance.now()-started).toFixed(3))});return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    """,scalar,min(max(float(timeout),180.0),220.0)*1000.0)
    if not timeline or not timeline.get("ok"):
        raise RuntimeError(f"scale handoff {label} did not reach visible-owner readiness: {timeline}")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    stage=_stage_snapshot(driver)
    settled=_scale_handoff_compact(driver)
    return {
        "action":label,"viewport":_inner_viewport(driver),"stage":stage,
        "handoffProof":{"targetHeightMeters":height,"targetScalar":scalar,"before":before,"timeline":timeline.get("samples") or [],"durationMs":timeline.get("durationMs"),"settled":settled}
    }

def _validate_scale_handoff_frames(frames):
    if len(frames)!=WP_SCALE_HANDOFF_SHOTS:
        raise RuntimeError(f"{WP_SCALE_HANDOFF_SCENARIO} requires {WP_SCALE_HANDOFF_SHOTS} fixed-focus frames")
    level_order=[
        "regional-overview","regional-detail","district","local-area-wide","local-area",
        "settlement-wide","settlement","settlement-core","near-ground-wide","near-ground","near-ground-close","ground"
    ]
    level_band={
        "regional-overview":"regional-overview","regional-detail":"regional-detail","district":"district",
        "local-area-wide":"local-area","local-area":"local-area","settlement-wide":"local-area","settlement":"local-area","settlement-core":"local-area",
        "near-ground-wide":"settlement","near-ground":"settlement","near-ground-close":"near-ground","ground":"ground"
    }
    band_order=["planet","continent","country-region","regional-overview","regional-detail","district","local-area","settlement","near-ground","ground"]
    focus_keys=set();prior_footprint=None;pending_handoffs=0;semantic_hold_samples=0
    for index,frame in enumerate(frames,start=1):
        stage=frame.get("stage") or {};projection=stage.get("projection") or {};z=stage.get("zoom") or {};r=projection.get("resourceBudget") or {};local=projection.get("localStatic") or {}
        canonical=stage.get("canonicalFocus") or {};tile=canonical.get("worldTile") or {}
        focus_keys.add((str(tile.get("x")),str(tile.get("y")),canonical.get("latitudeDegrees"),canonical.get("longitudeDegrees")))
        footprint=float(z.get("visibleFootprintHeightMeters") or 0)
        if footprint<=0: raise RuntimeError(f"frame {index} missing visible footprint")
        if prior_footprint is not None and footprint>=prior_footprint:
            raise RuntimeError(f"frame {index} closer target did not shrink visible footprint: {prior_footprint} -> {footprint}")
        prior_footprint=footprint
        tangent=float(projection.get("blend") or 0)>.02
        if tangent and int(r.get("pendingPreparationCount") or 0)!=0:
            raise RuntimeError(f"frame {index} captured before visible local resource settled: {r}")
        if tangent and r.get("requestedSignature") and str(r.get("activeSignature") or "")!=str(r.get("requestedSignature")):
            raise RuntimeError(f"frame {index} requested/active visible resource mismatch after settle: {r}")
        if int(r.get("blockingZoomBuilds") or 0)!=0:
            raise RuntimeError(f"frame {index} used a blocking zoom build: {r}")
        req_band=str(z.get("requestedBand") or z.get("band") or "")
        vis_band=str(z.get("visibleBand") or z.get("band") or "")
        if req_band in band_order and vis_band in band_order and band_order.index(vis_band)>band_order.index(req_band):
            raise RuntimeError(f"frame {index} visible semantic band is finer than requested: {vis_band} > {req_band}")
        visible_level=str(z.get("visibleLevel") or r.get("visibleLevel") or "")
        if tangent and visible_level in level_order and level_order.index(visible_level)>=8:
            if not local.get("signature") or str(local.get("signature"))!=str(r.get("activeSignature") or ""):
                raise RuntimeError(f"frame {index} static presentation is not ready for visible resource: local={local} resource={r}")
            if vis_band in {"settlement","near-ground","ground"} and (int(local.get("roadCount") or 0)<=0 or int(local.get("buildingCount") or 0)<=0):
                raise RuntimeError(f"frame {index} announced {vis_band} without visible roads + buildings: {local}")
            expected=level_band.get(visible_level)
            content_ready=(
                local.get("active") is True
                and str(local.get("revealTier") or "") in {"refined","full"}
                and int(local.get("roadCount") or 0)>0
                and int(local.get("buildingCount") or 0)>0
            )
            if expected in {"settlement","near-ground","ground"} and not content_ready:
                expected="local-area"
            if expected in band_order and req_band in band_order:
                expected=band_order[min(band_order.index(expected),band_order.index(req_band))]
                if vis_band!=expected:
                    raise RuntimeError(f"frame {index} semantic band did not advance to the completed ready representation: expected={expected} actual={vis_band}")
        proof=frame.get("handoffProof") or {}
        for sample in proof.get("timeline") or []:
            pr=sample.get("resource") or {};ls=sample.get("localStatic") or {}
            if int(pr.get("blockingZoomBuilds") or 0)!=0:
                raise RuntimeError(f"frame {index} timeline used a blocking zoom build: {sample}")
            if int(pr.get("pendingPreparationCount") or 0)>0 and float(sample.get("blend") or 0)>.02:
                pending_handoffs+=1
            visible=str(sample.get("visibleLevel") or "")
            if visible not in level_order: continue
            vis_i=level_order.index(visible)
            if vis_i<8: continue
            active=str(pr.get("activeSignature") or "")
            local_sig=str(ls.get("signature") or "")
            content_ready=(
                ls.get("active") is True
                and str(ls.get("revealTier") or "") in {"refined","full"}
                and int(ls.get("roadCount") or 0)>0
                and int(ls.get("buildingCount") or 0)>0
            )
            if active and local_sig!=active:
                semantic_hold_samples+=1
                fallback_level=str(ls.get("level") or "")
                cap_band=level_band.get(fallback_level,"local-area")
            else:
                cap_band=level_band.get(visible,"local-area")
            if cap_band in {"settlement","near-ground","ground"} and not content_ready:
                cap_band="local-area"
            if active:
                sample_band=str(sample.get("visibleBand") or "")
                if sample_band in band_order and cap_band in band_order and band_order.index(sample_band)>band_order.index(cap_band):
                    raise RuntimeError(f"frame {index} semantic band advanced before its visible content was ready: cap={cap_band} sample={sample}")
    if len(focus_keys)!=1:
        raise RuntimeError(f"scale handoff evidence changed canonical focus: {focus_keys}")
    if pending_handoffs<2:
        raise RuntimeError(f"scale handoff evidence did not observe enough cooperative visible-owner preparations: {pending_handoffs}")

def _wp_starting_village_targets(driver):
    targets=driver.execute_script("""
      const stage=window.PlanetStage,s=stage?.snapshot?.(),seed=s?.activeSeed;
      if(!stage||!seed||!window.StartingVillage?.plan||!window.HousePlans?.build||!window.SpecialLots?.build){
        return {ok:false,reason:'village-authority-unavailable'};
      }
      const village=StartingVillage.plan(seed),houses=HousePlans.build(seed)||[],lots=SpecialLots.build(seed)||[];
      const add=(base,dx,dy)=>{
        if(window.WorldCoordinates?.add)return WorldCoordinates.add(base,String(dx),String(dy));
        return {x:String(Number(base?.x||0)+Number(dx||0)),y:String(Number(base?.y||0)+Number(dy||0))};
      };
      const centerOf=record=>{
        const b=record?.bounds;if(!b)return null;
        return add(village.center,Math.round((Number(b.minX)+Number(b.maxX))/2),Math.round((Number(b.minY)+Number(b.maxY))/2));
      };
      const frontageOf=record=>{
        const b=record?.bounds;if(!b)return null;
        const minX=Number(b.minX),maxX=Number(b.maxX),minY=Number(b.minY),maxY=Number(b.maxY);
        const cx=(minX+maxX)/2,cy=(minY+maxY)/2,margin=3;
        let x=cx,y=cy;
        if(Math.abs(cx)>=Math.abs(cy))x=cx>=0?minX-margin:maxX+margin;
        else y=cy>=0?minY-margin:maxY+margin;
        return add(village.center,Math.round(x),Math.round(y));
      };
      const pickLot=(fn,kind)=>lots.find(item=>String(item.function||'')===fn)||lots.find(item=>String(item.kind||'')===kind)||null;
      const direction=StartingVillage.direction(seed),gateway=add(village.center,Number(direction?.dx||0)*14,Number(direction?.dy||0)*14);
      const house=houses[0]||null,market=pickLot('market','shop'),workshop=pickLot('craft','workshop'),farm=pickLot('farm','barn');
      const raw=[
        {label:'village-overview',context:'overview',mode:'refined',point:village.center},
        {label:'residential-yard',context:'residential',mode:'full',point:centerOf(house)},
        {label:'market-frontage',context:'commercial',mode:'full',point:centerOf(market)},
        {label:'workshop-yard',context:'workshop',mode:'full',portraitMode:'refined',point:centerOf(workshop),portraitPoint:frontageOf(workshop)},
        {label:'farm-yard',context:'farm',mode:'full',point:centerOf(farm)},
        {label:'gateway-road-edge',context:'road-edge',mode:'full',point:gateway},
        {label:'public-square-phone',context:'civic',mode:'full',point:village.center,portrait:true}
      ];
      const usable=raw.filter(item=>item.point&&item.point.x!=null&&item.point.y!=null).map(item=>({
        ...item,
        point:{x:String(item.point.x),y:String(item.point.y)},
        portraitPoint:item.portraitPoint?{x:String(item.portraitPoint.x),y:String(item.portraitPoint.y)}:null
      }));
      return {ok:usable.length===raw.length,seed,name:village.name||'Starting Village',targets:usable};
    """)
    if not targets or not targets.get("ok"):
        raise RuntimeError(f"could not build Starting Village dressing evidence targets: {targets}")
    return targets

def _wp_starting_village_frame(driver,target,base_width,base_height,timeout):
    portrait=bool(target.get("portrait"))
    width,height=(1080,1440) if portrait else (base_width,base_height)
    set_exact_viewport(driver,width,height)
    narrow=height>width
    mode=str((target.get("portraitMode") if narrow else None) or target.get("mode") or "full")
    framing_point=(target.get("portraitPoint") if narrow else None) or target["point"]
    focus_key=f"{framing_point['x']},{framing_point['y']}"
    result=driver.execute_script("""
      const target=arguments[0],mode=arguments[1],stage=window.PlanetStage;
      stage.setWorldTileFocus(String(target.x),String(target.y));
      const scalar=mode==='refined'
        ?stage.scalarForFootprintHeight(80)
        :Number(stage.constants?.ZOOM_MAX??1);
      stage.setZoomScalar(scalar);
      return {scalar,mode};
    """,framing_point,mode)
    expected_scalar=float(result.get("scalar") or 0)
    predicate=f"""
      const s=window.PlanetStage?.snapshot?.(),local=s?.projection?.localStatic||{{}},r=s?.projection?.resourceBudget||{{}};
      const readyResource=!r?.requestedSignature||String(r.activeSignature||'')===String(r.requestedSignature||'');
      const scalarReady=Math.abs(Number(s?.zoom?.scalar||0)-{expected_scalar!r})<0.00001;
      const tier=String(local?.revealTier||'');
      return Boolean(
        s?.ready && !s?.zoom?.animation?.active && readyResource && scalarReady &&
        local?.active===true &&
        ['refined','full'].includes(tier) &&
        String(local?.dressingFocusKey||'')==={json.dumps(focus_key)} &&
        Number(local?.roadCount||0)>0 &&
        Number(local?.buildingCount||0)>0 &&
        Number(local?.dressingCount||0)>0 &&
        String(local?.dressingScope||'')==='focused-visible+3-tile-preload'
      );
    """
    _wait(driver,predicate,timeout,
        f"Starting Village {mode} dressing context {target.get('label')}")
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    return {
        "action":target.get("label"),
        "context":target.get("context"),
        "target":target.get("point"),
        "framingTarget":framing_point,
        "narrowViewportFraming":bool(narrow and target.get("portraitPoint")),
        "narrowViewportModeOverride":bool(narrow and target.get("portraitMode")),
        "zoomRequest":result,
        "viewport":_inner_viewport(driver),
        "stage":_stage_snapshot(driver),
    }

def _validate_wp_starting_village_frames(frames):
    if len(frames)<WP_STARTING_VILLAGE_DRESSING_SHOTS:
        raise RuntimeError(
            f"{WP_STARTING_VILLAGE_DRESSING_SCENARIO} requires "
            f"{WP_STARTING_VILLAGE_DRESSING_SHOTS} fresh context frames"
        )
    required={"overview","residential","commercial","workshop","farm","road-edge","civic"}
    contexts={str(frame.get("context") or "") for frame in frames[:WP_STARTING_VILLAGE_DRESSING_SHOTS]}
    missing=sorted(required-contexts)
    if missing:
        raise RuntimeError(f"Starting Village evidence is missing contexts: {missing}")
    focus_keys=set()
    saw_full=False
    saw_near_max=False
    for index,frame in enumerate(frames[:WP_STARTING_VILLAGE_DRESSING_SHOTS],start=1):
        stage=frame.get("stage") or {}
        local=((stage.get("projection") or {}).get("localStatic") or {})
        tier=str(local.get("revealTier") or "")
        if tier=="full":saw_full=True
        scalar=float(((stage.get("zoom") or {}).get("scalar") or 0))
        if 0<scalar<0.999:saw_near_max=True
        if tier not in {"refined","full"}:
            raise RuntimeError(f"frame {index} is not near/max local dressing: {tier}")
        if int(local.get("roadCount") or 0)<=0 or int(local.get("buildingCount") or 0)<=0:
            raise RuntimeError(f"frame {index} lost coherent settlement structure: {local}")
        dressing=int(local.get("dressingCount") or 0)
        if dressing<=0 or dressing>64:
            raise RuntimeError(f"frame {index} lost bounded semantic dressing: {dressing}")
        if local.get("dressingScope")!="focused-visible+3-tile-preload":
            raise RuntimeError(f"frame {index} lost bounded dressing scope: {local.get('dressingScope')}")
        focus=(stage.get("canonicalFocus") or {}).get("worldTile") or {}
        focus_keys.add((str(focus.get("x")),str(focus.get("y"))))
    if not saw_full or not saw_near_max:
        raise RuntimeError("Starting Village evidence must prove both a near-max local view and max full presentation")
    if len(focus_keys)<5:
        raise RuntimeError(f"Starting Village context evidence did not move across enough authoritative targets: {focus_keys}")


def _settlement_reveal_frame(driver,index,timeout,viewport=(1280,800)):
    scalar,label=WP_SETTLEMENT_REVEAL_PLAN[index]
    expected=WP_SETTLEMENT_REVEAL_TIERS[index]
    set_exact_viewport(driver,*viewport)
    driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))
    expected_js=json.dumps(expected)
    _wait(driver,f"""
      const target={float(scalar)!r},expected={expected_js},s=window.PlanetStage?.snapshot?.(),
            r=s?.projection?.resourceBudget||{{}},l=s?.projection?.localStatic||{{}};
      const exact=Math.abs(Number(s?.zoom?.scalar)-target)<0.00001;
      const resourceReady=Number(r?.pendingPreparationCount||0)===0 &&
        !!r?.activeSignature && (!r?.requestedSignature || String(r.activeSignature)===String(r.requestedSignature));
      const tierReady=String(l?.revealTier||'none')===expected;
      const staticReady=expected==='none' || (
        !!l?.signature && String(l.signature)===String(r.activeSignature) &&
        !!l?.settlementId && !!l?.layoutSignature
      );
      return Boolean(s?.ready && !s?.zoom?.animation?.active && exact && resourceReady && tierReady && staticReady);
    """,max(float(timeout),180.0),f"WP007 settlement reveal {label} presented-ready")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    stage=_stage_snapshot(driver)
    raw=driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},l=s?.projection?.localStatic||{},r=s?.projection?.resourceBudget||{};
      return {
        worldTileProjection:s?.projection?.worldTileProjection||null,
        localStatic:l,
        resource:{
          pendingPreparationCount:Number(r.pendingPreparationCount||0),blockingZoomBuilds:Number(r.blockingZoomBuilds||0),
          lastPreparationWallMs:Number(r.lastPreparationWallMs||0),lastPreparationBusyMs:Number(r.lastPreparationBusyMs||0),
          lastPreparationSlices:Number(r.lastPreparationSlices||0),maxPreparationSliceMs:Number(r.maxPreparationSliceMs||0),
          lastSwapMs:Number(r.lastSwapMs||0),maxSwapMs:Number(r.maxSwapMs||0),
          maxFrameMsDuringPreparation:Number(r.maxFrameMsDuringPreparation||0),recentMaxFrameMs:Number(r.recentMaxFrameMs||0)
        },
        navigationPerformance:s?.navigationPerformance||null,
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


def _validate_settlement_reveal_frames(frames,enforce_resource_streaming_budget=True):
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
        if enforce_resource_streaming_budget and (int(resource.get("pendingPreparationCount") or 0)!=0 or int(resource.get("blockingZoomBuilds") or 0)!=0):
            raise RuntimeError(f"frame {index} used blocking parent resource preparation: {resource}")
        if enforce_resource_streaming_budget and (float(resource.get("maxPreparationSliceMs") or 0)>50 or float(resource.get("maxSwapMs") or 0)>50):
            raise RuntimeError(f"frame {index} exceeded bounded parent preparation slice/swap budget: {resource}")
        if index>1:
            if local[-1].get("cooperativeBuild") is not True:
                raise RuntimeError(f"frame {index} did not use cooperative WP007 settlement build: {local[-1]}")
            if local[-1].get("settlementBuildPending"):
                raise RuntimeError(f"frame {index} still has pending WP007 settlement build: {local[-1]}")
            if float(local[-1].get("maxBuildSliceMs") or local[-1].get("buildTimeMs") or 0)>50:
                raise RuntimeError(f"frame {index} exceeded WP007 local-static slice budget: {local[-1]}")
            if int(local[-1].get("buildSliceCount") or 0)<2:
                raise RuntimeError(f"frame {index} did not cooperatively slice WP007 local-static build: {local[-1]}")
        nav=proof.get("navigationPerformance") or stage.get("navigationPerformance") or {}
        if int(nav.get("frameUpdateOver50Count") or 0)!=0:
            raise RuntimeError(f"frame {index} recorded >50 ms frame-update spikes during settlement reveal: {nav}")
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


def _atlas_live_state(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{};
      const canvas=document.querySelector('#planetStageCanvas')||document.querySelector('canvas');
      const root=document.getElementById('planetStageRoot');
      const rootRect=root?.getBoundingClientRect?.()||{left:0,top:0,right:0,bottom:0,width:0,height:0};
      const labels=[...document.querySelectorAll('.planet-atlas-label,.planet-map-landmark')].map(el=>{
        const r=el.getBoundingClientRect();
        const cs=getComputedStyle(el);
        return {
          id:String(el.dataset.canonicalId||''),
          kind:String(el.dataset.kind||''),
          hidden:Boolean(el.hidden||cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity||1)<=0.01),
          left:Number(r.left.toFixed(2)),top:Number(r.top.toFixed(2)),
          right:Number(r.right.toFixed(2)),bottom:Number(r.bottom.toFixed(2)),
          centerX:Number((r.left+r.width*.5).toFixed(2)),
          centerY:Number((r.top+r.height*.5).toFixed(2))
        };
      });
      return {
        mapPresentation:s.mapPresentation||null,
        navigationPerformance:s.navigationPerformance||null,
        zoom:s.zoom||null,
        canonicalFocus:s.canonicalFocus||null,
        viewport:{width:window.innerWidth,height:window.innerHeight},
        canvas:canvas?{width:canvas.getBoundingClientRect().width,height:canvas.getBoundingClientRect().height}:null,
        rootRect:{
          left:Number(rootRect.left.toFixed(2)),top:Number(rootRect.top.toFixed(2)),
          right:Number(rootRect.right.toFixed(2)),bottom:Number(rootRect.bottom.toFixed(2)),
          width:Number(rootRect.width.toFixed(2)),height:Number(rootRect.height.toFixed(2))
        },
        labels
      };
    """)

def _prepare_atlas_live_scene(driver,timeout):
    set_exact_viewport(driver,1280,800)
    result=driver.execute_script("""
      const stage=window.PlanetStage;
      if(!stage)return {ok:false,reason:'stage-unavailable'};
      stage.setWorldTileFocus('0','0');
      stage.setZoomScalar(0.05);
      return {ok:true};
    """)
    if not result or not result.get("ok"):
        raise RuntimeError(f"could not prepare atlas live-projection scene: {result}")
    _wait(driver,"""
      const s=window.PlanetStage?.snapshot?.()||{},m=s.mapPresentation||{},n=s.navigationPerformance||{};
      return Boolean(
        s.ready && !s.zoom?.animation?.active &&
        Number(m.atlasVisibleLabelCount||0)>0 &&
        Array.isArray(m.visibleLabels) && m.visibleLabels.length>0 &&
        Number(n.liveProjectionOver8MsCount||0)===0
      );
    """,timeout,"far-globe atlas labels ready")
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    return _atlas_live_state(driver)

def _wait_atlas_responsive_labels(driver,timeout,label):
    predicate="""
      const s=window.PlanetStage?.snapshot?.()||{},m=s.mapPresentation||{},n=s.navigationPerformance||{};
      const visible=[...document.querySelectorAll('.planet-atlas-label,.planet-map-landmark')].some(el=>{
        const cs=getComputedStyle(el),r=el.getBoundingClientRect();
        return !el.hidden && cs.visibility!=='hidden' && cs.display!=='none' && Number(cs.opacity||1)>0.01 &&
          r.width>0 && r.height>0 && r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight;
      });
      return Boolean(
        s.ready && !n.semanticUpdatePending && !n.pendingReason &&
        Number(m.atlasVisibleLabelCount||0)>0 && visible
      );
    """
    _wait(driver,predicate,timeout,label)
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    _wait(driver,predicate,timeout,label+" after paint settle")


def _atlas_live_frame(driver,index,timeout):
    from selenium.webdriver.common.action_chains import ActionChains
    if index==0:
        state=_prepare_atlas_live_scene(driver,timeout)
        state["action"]="desktop-before-drag"
        return state
    canvas=driver.find_element("css selector","#planetStageCanvas, canvas")
    if index==1:
        ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(55,14).perform()
        time.sleep(.12)
        action="desktop-mid-drag-1"
    elif index==2:
        ActionChains(driver).move_by_offset(55,14).perform()
        time.sleep(.12)
        action="desktop-mid-drag-2"
    elif index==3:
        ActionChains(driver).move_by_offset(55,14).perform()
        time.sleep(.12)
        action="desktop-mid-drag-3"
    elif index==4:
        ActionChains(driver).release().perform()
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.()||{},n=s.navigationPerformance||{};
          return Boolean(!n.semanticUpdatePending && Number(n.pointerSettleFlushCount||0)>=1);
        """,timeout,"post-drag atlas semantic settle")
        driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
        action="desktop-after-settle"
    elif index==5:
        set_exact_viewport(driver,844,390)
        _wait_atlas_responsive_labels(driver,timeout,"phone-landscape atlas labels with settled live DOM")
        action="phone-landscape"
    else:
        set_exact_viewport(driver,390,844)
        _wait_atlas_responsive_labels(driver,timeout,"phone-portrait atlas labels with settled live DOM")
        action="phone-portrait"
    state=_atlas_live_state(driver)
    state["action"]=action
    return state

def _validate_atlas_live_frames(frames):
    if len(frames)<WP_ATLAS_LIVE_SHOTS:
        raise RuntimeError(f"{WP_ATLAS_LIVE_SCENARIO} requires {WP_ATLAS_LIVE_SHOTS} fresh frames")
    baseline=frames[0]
    drag=frames[1:4]
    settled=frames[4]
    previous=int((baseline.get("navigationPerformance") or {}).get("liveProjectionCount") or 0)
    for index,frame in enumerate(drag,start=1):
        nav=frame.get("navigationPerformance") or {}
        presentation=frame.get("mapPresentation") or {}
        current=int(nav.get("liveProjectionCount") or 0)
        if current<=previous:
            raise RuntimeError(f"live atlas projection did not advance during drag frame {index}: {previous} -> {current}")
        if int(nav.get("liveProjectionOver8MsCount") or 0)!=0:
            raise RuntimeError(f"live atlas projection exceeded 8ms budget in drag frame {index}: {nav}")
        if int(presentation.get("liveProjectedLabelCount") or 0)<=0:
            raise RuntimeError(f"drag frame {index} updated no existing atlas labels: {presentation}")
        previous=current
    base_labels={item.get("id"):item for item in baseline.get("labels") or [] if item.get("id") and not item.get("hidden")}
    last_labels={item.get("id"):item for item in drag[-1].get("labels") or [] if item.get("id") and not item.get("hidden")}
    common=sorted(set(base_labels)&set(last_labels))
    if not common:
        raise RuntimeError("no canonical atlas label remained visible across active drag")
    moved=max(
        ((last_labels[key]["centerX"]-base_labels[key]["centerX"])**2+
         (last_labels[key]["centerY"]-base_labels[key]["centerY"])**2)**0.5
        for key in common
    )
    if moved<8:
        raise RuntimeError(f"visible atlas labels did not move with their world anchors during drag: max {moved:.2f}px")
    settled_nav=settled.get("navigationPerformance") or {}
    if int(settled_nav.get("pointerSettleFlushCount") or 0)<1:
        raise RuntimeError("pointer settle did not flush semantic atlas layout")
    if int(settled_nav.get("liveProjectionOver8MsCount") or 0)!=0:
        raise RuntimeError(f"settled atlas exceeded live projection budget: {settled_nav}")
    for frame_index in (4,5,6):
        frame=frames[frame_index]
        viewport=frame.get("viewport") or {}
        width=float(viewport.get("width") or 0);height=float(viewport.get("height") or 0)
        visible=[item for item in frame.get("labels") or [] if not item.get("hidden")]
        if not visible:
            raise RuntimeError(f"atlas frame {frame_index+1} has no visible labels")
        for item in visible:
            if item["left"]<-1 or item["right"]>width+1 or item["top"]<-1 or item["bottom"]>height+1:
                raise RuntimeError(f"atlas label clips viewport in frame {frame_index+1}: {item} viewport={viewport}")


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

def _generic_frames(driver,shots,width,height,timeout,interval):
    set_exact_viewport(driver,width,height)
    _wait_stage(driver,timeout)
    frames=[]
    for index in range(shots):
        if index:time.sleep(max(0.0,interval))
        frames.append({
            "action":"current-build-static",
            "viewport":_inner_viewport(driver),
            "stage":_stage_snapshot(driver),
        })
    return frames

def run_capture(args):
    width,height=PROFILES.get(args.profile,(args.width,args.height))
    if args.scenario in {WP_TEMPORAL_RESIDENCY_SCENARIO,WP_SETTLEMENT_REVEAL_SCENARIO,WP_ATLAS_LIVE_SCENARIO}:
        width,height=1280,800
    elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:
        # WP003 and WP005002 require both desktop landscape and modern-phone evidence.
        # Preserve the explicitly requested profile instead of coercing phone
        # captures to the historical 1280x800 desktop viewport.
        width,height=PROFILES.get(args.profile,(args.width,args.height))
    total=max(1,int(args.shots))
    if args.scenario==WP_CHARACTER_SCENARIO:
        total=max(total,WP_CHARACTER_SHOTS)
    elif args.scenario==WP_STARTING_VILLAGE_DRESSING_SCENARIO:
        total=max(total,WP_STARTING_VILLAGE_DRESSING_SHOTS)
    elif args.scenario==STARTING_VILLAGE_SCENARIO:
        total=max(total,STARTING_VILLAGE_SHOTS)
    elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:
        total=max(total,WP_SURFACE_REFINEMENT_SHOTS)
    elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:
        total=max(total,WP_SCALE_HANDOFF_SHOTS)
    elif args.scenario==WP_TEMPORAL_RESIDENCY_SCENARIO:
        total=max(total,WP_TEMPORAL_RESIDENCY_SHOTS)
    elif args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:
        total=max(total,WP_SETTLEMENT_REVEAL_SHOTS)
    elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:
        total=max(total,WP_CANONICAL_FOCUS_SHOTS)
    elif args.scenario==WP_ATLAS_LIVE_SCENARIO:
        total=max(total,WP_ATLAS_LIVE_SHOTS)
    if args.no_publish:
        _clean_ephemeral_capture_dir()
    driver=_driver()
    frames=[]
    try:
        set_exact_viewport(driver,width,height)
        url=_target_url(args.target)
        if args.scenario==WP_SETTLEMENT_REVEAL_SCENARIO:
            sep="&" if "?" in url else "?"
            url=url+sep+"evidence_fast_start=1&wp007_settlement_test=1&gpu=webgl2"
        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:
            _install_canonical_focus_campaign(driver)
            sep="&" if "?" in url else "?"
            url=url+sep+"evidence_fast_start=1"
        driver.get(url)
        _wait_document(driver,args.ready_timeout)
        _wait_stage(driver,args.ready_timeout)
        if args.scenario==WP_CHARACTER_SCENARIO:
            focus=_prepare_starting_village_focus(driver)
            for index in range(total):
                if index<WP_CHARACTER_SHOTS:
                    frame=_character_frame(driver,index,width,height,args.ready_timeout)
                else:
                    frame={"action":"ground-extra","viewport":_inner_viewport(driver),"stage":_stage_snapshot(driver)}
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,total,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_character_frames(frames[:WP_CHARACTER_SHOTS])
        elif args.scenario==WP_STARTING_VILLAGE_DRESSING_SCENARIO:
            focus=_prepare_starting_village_focus(driver)
            driver.execute_script("""
              const evidenceTime={year:1100,month:1,day:1,hour:11,minute:30,second:0};
              window.PlanetStage?.applyAuthoritativeFantasyTime?.(
                evidenceTime,'wp-s003-009-001-visual-evidence',
                {snapshotResult:false,deferPresentation:false}
              );
            """)
            target_pack=_wp_starting_village_targets(driver)
            targets=target_pack["targets"]
            frames=[]
            for index in range(total):
                target=targets[index%len(targets)]
                frame=_wp_starting_village_frame(driver,target,width,height,args.ready_timeout)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,total,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_wp_starting_village_frames(frames)
        elif args.scenario==STARTING_VILLAGE_SCENARIO:
            focus=_prepare_starting_village_scene(driver,args.ready_timeout)
            pack=_wp_starting_village_targets(driver)
            by_context={str(item.get("context")):item for item in pack["targets"]}
            targets=[
                {"label":"civic-center","context":"civic","mode":"full","point":focus["center"]},
                by_context["workshop"],
                by_context["overview"],
            ]
            frames=[]
            for index in range(total):
                target=targets[index%len(targets)]
                frame=_wp_starting_village_frame(driver,target,width,height,args.ready_timeout)
                if str(target.get("mode") or "full")=="full":
                    _wait(driver,"""
                      const s=window.PlanetStage?.snapshot?.(),p=s?.npcPresentation||{};
                      return Boolean(
                        s?.zoom?.visibleLevel==='ground' &&
                        p?.groundRepresentationReady===true &&
                        p?.billboardLayerActive===true &&
                        p?.protagonistBillboardVisible===true &&
                        Number(p?.residentBillboardCount||0)>0
                      );
                    """,args.ready_timeout,"Starting Village readable final-ground character layer")
                    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
                    frame["stage"]=_stage_snapshot(driver)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,total,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
        elif args.scenario in {WP_SURFACE_REFINEMENT_SCENARIO,WP_VIEWPORT_REFINEMENT_SCENARIO}:
            focus=_prepare_surface_refinement_focus(driver)
            frames=[]
            for index in range(WP_SURFACE_REFINEMENT_SHOTS):
                frame=_surface_refinement_frame(driver,index,args.ready_timeout,(width,height),args.scenario==WP_VIEWPORT_REFINEMENT_SCENARIO)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,WP_SURFACE_REFINEMENT_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_surface_refinement_frames(frames)
        elif args.scenario==WP_SCALE_HANDOFF_SCENARIO:
            focus=_prepare_scale_handoff_focus(driver,(width,height))
            frames=[]
            for index in range(WP_SCALE_HANDOFF_SHOTS):
                frame=_scale_handoff_frame(driver,index,args.ready_timeout)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,WP_SCALE_HANDOFF_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_scale_handoff_frames(frames)
            mismatched=[(frame.get("index"),(frame.get("viewport") or {}).get("width"),(frame.get("viewport") or {}).get("height")) for frame in frames if int((frame.get("viewport") or {}).get("width") or 0)!=int(width) or int((frame.get("viewport") or {}).get("height") or 0)!=int(height)]
            if mismatched:
                raise RuntimeError(f"{WP_SCALE_HANDOFF_SCENARIO} viewport mismatch: expected {width}x{height}, got {mismatched}")
        elif args.scenario==WP_TEMPORAL_RESIDENCY_SCENARIO:
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
            try:
                _validate_settlement_reveal_frames(frames,enforce_resource_streaming_budget=False)
            except Exception as exc:
                diagnostic={
                    "scenario":WP_SETTLEMENT_REVEAL_SCENARIO,
                    "validationError":repr(exc),
                    "frames":frames,
                    "captured_at":datetime.now(timezone.utc).isoformat(),
                }
                path=_screenshots_dir()/"wp-s003-010-003-007-validation-failure.json"
                path.write_text(json.dumps(diagnostic,indent=2,sort_keys=True),encoding="utf-8")
                print("SETTLEMENT_REVEAL_VALIDATION_DIAGNOSTIC="+json.dumps(diagnostic,sort_keys=True),file=sys.stderr)
                raise
            # WP007 requires one acceptance matrix: desktop landscape plus true
            # phone portrait and phone landscape. Keep the existing issue-comment
            # trigger stable and capture the mobile variants inside the same run.
            if args.profile=="landscape":
                matrix={"desktop-landscape":frames}
                for profile,viewport in (("phone-portrait",(390,844)),("phone-landscape",(844,390))):
                    profile_frames=[]
                    for index in range(WP_SETTLEMENT_REVEAL_SHOTS):
                        frame=_settlement_reveal_frame(driver,index,args.ready_timeout,viewport)
                        frame["focusPreparation"]=focus
                        frame["profile"]=profile
                        path=_file_name(f"{args.filename}-{profile}",index+1,WP_SETTLEMENT_REVEAL_SHOTS,args.timestamp_names)
                        _capture(driver,path)
                        frame["index"]=index+1;frame["file"]=path.name
                        frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                        profile_frames.append(frame)
                    matrix[profile]=profile_frames
                    matrix_path=_screenshots_dir()/f"wp-s003-010-003-007-{profile}-frames.json"
                    matrix_path.write_text(json.dumps(profile_frames,indent=2,sort_keys=True),encoding="utf-8")
                    _validate_settlement_reveal_frames(profile_frames)
                (_screenshots_dir()/"wp-s003-010-003-007-required-profile-matrix.json").write_text(
                    json.dumps(matrix,indent=2,sort_keys=True),encoding="utf-8"
                )
        elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:
            frames=[]
            for index in range(WP_CANONICAL_FOCUS_SHOTS):
                frame=_canonical_focus_frame(driver,index,args.ready_timeout)
                path=_file_name(args.filename,index+1,WP_CANONICAL_FOCUS_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_canonical_focus_frames(frames)
        elif args.scenario==WP_ATLAS_LIVE_SCENARIO:
            frames=[]
            for index in range(WP_ATLAS_LIVE_SHOTS):
                frame=_atlas_live_frame(driver,index,args.ready_timeout)
                path=_file_name(args.filename,index+1,WP_ATLAS_LIVE_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_atlas_live_frames(frames)
        elif args.scenario in {WP_CELL_LOD_SCENARIO,WP_PRODUCTION_GATE_SCENARIO}:
            from wp_s003_010_003_013_evidence import capture_cell_lod_frames
            frames=capture_cell_lod_frames(
                driver,args,file_name=_file_name,capture=_capture,
                set_exact_viewport=set_exact_viewport,inner_viewport=_inner_viewport,
                stage_snapshot=_stage_snapshot,wait=_wait
            )
        elif args.scenario==WP_WILDERNESS_SCENARIO:
            from wp_s003_013_evidence import capture_wilderness_frames
            frames=capture_wilderness_frames(
                driver,args,file_name=_file_name,capture=_capture,
                set_exact_viewport=set_exact_viewport,inner_viewport=_inner_viewport
            )
        else:
            frames=_generic_frames(driver,total,width,height,args.ready_timeout,args.interval)
            for index,frame in enumerate(frames,start=1):
                path=_file_name(args.filename,index,total,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
        logs=_browser_logs(driver)
        severe=[row for row in logs if row.get("level")=="SEVERE" and "favicon" not in row.get("message","").lower()]
        if severe:
            raise RuntimeError(f"browser console contains severe errors: {severe[:4]}")
        if args.evidence_json:
            payload={
                "schema":3,
                "captured_at":datetime.now(timezone.utc).isoformat(),
                "target":_target_url(args.target),
                "scenario":args.scenario,
                "issue":args.issue,
                "frames":frames,
                "browserLogs":logs,
            }
            path=_screenshots_dir()/Path(args.evidence_json).name
            path.write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")
        for frame in frames:
            print(f"Saved: {frame['file']} [{args.scenario}:{frame['action']}]")
        return 0
    finally:
        driver.quit()

def parse_args(argv=None):
    parser=argparse.ArgumentParser(description="Capture current The Advisor Game visual evidence.")
    parser.add_argument("target")
    parser.add_argument("filename")
    parser.add_argument("--profile",choices=sorted(PROFILES),default="landscape")
    parser.add_argument("--width",type=int,default=1920)
    parser.add_argument("--height",type=int,default=1080)
    parser.add_argument("--shots",type=int,default=1)
    parser.add_argument("--interval",type=float,default=.25)
    parser.add_argument("--timestamp-names",action="store_true")
    parser.add_argument("--wait-min",type=float,default=0.0)
    parser.add_argument("--wait-max",type=float,default=0.0)
    parser.add_argument("--ready-timeout",type=float,default=180.0)
    parser.add_argument("--scenario",default="static")
    parser.add_argument("--evidence-json")
    parser.add_argument("--issue")
    parser.add_argument("--no-publish",action="store_true")
    parser.add_argument("--publish-branch",default="main")
    parser.add_argument("--commit-message",default="chore: publish visual review screenshots")
    parser.add_argument("--no-force-max-zoom",action="store_true")
    parser.add_argument("--no-auto-start",action="store_true")
    parser.add_argument("--pause-seconds",type=float,default=0.0)
    return parser.parse_args(argv)

def main(argv=None):
    args=parse_args(argv)
    try:
        return run_capture(args)
    except Exception as exc:
        print(f"Error taking screenshot: {exc}",file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
