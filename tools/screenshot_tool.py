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

PROFILES={"landscape":(1920,1080),"portrait":(1080,1920),"tablet":(1920,1080),"phone":(1080,1920)}
WP_CHARACTER_SCENARIO="wp-s003-004-004"
WP_CHARACTER_SHOTS=5
STARTING_VILLAGE_SCENARIO="starting-village"
STARTING_VILLAGE_SHOTS=3
WP_STARTING_VILLAGE_DRESSING_SCENARIO="wp-s003-009-001"
WP_STARTING_VILLAGE_DRESSING_SHOTS=7
WP_SURFACE_REFINEMENT_SCENARIO="wp-s003-010-003-005-002"
WP_SURFACE_REFINEMENT_SHOTS=10
WP_CANONICAL_FOCUS_SCENARIO="wp-s003-008-008"
WP_CANONICAL_FOCUS_SHOTS=5
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
        inspection:s.inspection,
        atmosphere:s.atmosphere,
        worldVisualStyle:s.worldVisualStyle,
        worldVisualStyleIntegration:s.worldVisualStyleIntegration,
        navigationPerformance:s.navigationPerformance,
        startupError:s.startupError,
        frameCount:s.frameCount,
        renderQuality:window.RuntimeRenderQuality?.snapshot?.()||null,
        rendererEvidence:{
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

def _prepare_starting_village_focus(driver):
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
    # Let the just-materialized billboard scene survive two paint frames before
    # capture; the wait condition above observes scene state, not rendered pixels.
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
        prep=_canonical_focus_starting_village(driver)
        driver.execute_script("""
          const stage=window.PlanetStage;
          stage.setZoomScalar(stage.scalarForFootprintHeight(80));
        """)
        _wait(driver,"""
          const s=window.PlanetStage?.snapshot?.(),p=s?.npcPresentation||{};
          const nonFinal=Number(s?.zoom?.scalar)<0.999999;
          const nearReady=s?.zoom?.visibleLevel==='near-ground-close'||s?.zoom?.requestedLevel==='near-ground-close';
          return Boolean(s?.ready && nonFinal && nearReady && p?.protagonistMarkerVisible===true && p?.protagonistBillboardVisible!==true && (window.PlanetStage?.inspectionTargets?.()||[]).some(x=>x.type==='protagonist'));
        """,timeout,"80m wider-view protagonist marker")
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
    if not (places.get("ui") or {}).get("placesVisible") or pnav.get("targetType")!="place" or float(pnav.get("focusErrorMeters") or 999999)>1:
        raise RuntimeError(f"Places exact-focus frame invalid: {places}")
    inspect=frames[1];ui=inspect.get("ui") or {};npc=(inspect.get("stage") or {}).get("npcPresentation") or {}
    if not ui.get("tooltipVisible") or not ui.get("focusButtonVisible") or npc.get("protagonistMarkerVisible") is not True:
        raise RuntimeError(f"protagonist inspection frame invalid: {inspect}")
    for frame in frames[2:WP_CANONICAL_FOCUS_SHOTS]:
        stage=frame.get("stage") or {};nav=(stage.get("explicitFocusNavigation") or {}).get("active") or {};npc=stage.get("npcPresentation") or {}
        if nav.get("targetType")!="protagonist" or nav.get("state")!="committed" or nav.get("maximumScaleReached") is not True or float(nav.get("focusErrorMeters") or 999999)>1:
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

def _surface_refinement_frame(driver,index,timeout):
    scalar,label=WP_SURFACE_REFINEMENT_PLAN[index]
    set_exact_viewport(driver,1280,800)
    # ResizeObserver preserves physical footprint by recomputing the scalar.
    # Let the fixed evidence viewport finish that reframing before applying the
    # exact checkpoint, otherwise a late resize callback can legitimately move
    # the scalar after this harness sets it and the exact-value wait never ends.
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",float(scalar))
    # One more paint pair makes the checkpoint resilient to a trailing browser
    # metrics callback; reapplying the same target is deterministic and changes
    # camera presentation only, never canonical focus/world authority.
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
    # Capture only after two paint frames so a just-swapped child texture/mesh is
    # actually visible rather than merely reported ready by telemetry.
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
        # Reusing one ready native resource over adjacent checkpoints is valid,
        # but world-space texel and geometry density must never get coarser.
        if b[1]>a[1]*1.001 or b[2]>a[2]*1.001 or b[3]>a[3]*1.001:
            raise RuntimeError(f"closer zoom lost world-space terrain/source density: {a} -> {b}")
    if density[-1][1]>=density[0][1] or density[-1][2]>=density[0][2] or density[-1][3]>=density[0][3]:
        raise RuntimeError(f"surface refinement did not materially improve density: {density[0]} -> {density[-1]}")


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
      const pickLot=(fn,kind)=>lots.find(item=>String(item.function||'')===fn)||lots.find(item=>String(item.kind||'')===kind)||null;
      const direction=StartingVillage.direction(seed),gateway=add(village.center,Number(direction?.dx||0)*14,Number(direction?.dy||0)*14);
      const house=houses[0]||null,market=pickLot('market','shop'),workshop=pickLot('craft','workshop'),farm=pickLot('farm','barn');
      const raw=[
        {label:'village-overview',context:'overview',mode:'refined',point:village.center},
        {label:'residential-yard',context:'residential',mode:'full',point:centerOf(house)},
        {label:'market-frontage',context:'commercial',mode:'full',point:centerOf(market)},
        {label:'workshop-yard',context:'workshop',mode:'full',point:centerOf(workshop)},
        {label:'farm-yard',context:'farm',mode:'full',point:centerOf(farm)},
        {label:'gateway-road-edge',context:'road-edge',mode:'full',point:gateway},
        {label:'public-square-phone',context:'civic',mode:'full',point:village.center,portrait:true}
      ];
      const usable=raw.filter(item=>item.point&&item.point.x!=null&&item.point.y!=null).map(item=>({
        ...item,point:{x:String(item.point.x),y:String(item.point.y)}
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
    mode=str(target.get("mode") or "full")
    focus_key=f"{target['point']['x']},{target['point']['y']}"
    result=driver.execute_script("""
      const target=arguments[0],mode=arguments[1],stage=window.PlanetStage;
      stage.setWorldTileFocus(String(target.x),String(target.y));
      const scalar=mode==='refined'
        ?stage.scalarForFootprintHeight(80)
        :Number(stage.constants?.ZOOM_MAX??1);
      stage.setZoomScalar(scalar);
      return {scalar,mode};
    """,target["point"],mode)
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
    # Surface-refinement acceptance has one canonical 1280x800 viewport. Start
    # the browser at that size so the game never boots at one aspect ratio and
    # receives a first-checkpoint resize after its zoom/LOD state is live.
    if args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:
        width,height=1280,800
    total=max(1,int(args.shots))
    if args.scenario==WP_CHARACTER_SCENARIO:
        total=max(total,WP_CHARACTER_SHOTS)
    elif args.scenario==WP_STARTING_VILLAGE_DRESSING_SCENARIO:
        total=max(total,WP_STARTING_VILLAGE_DRESSING_SHOTS)
    elif args.scenario==STARTING_VILLAGE_SCENARIO:
        total=max(total,STARTING_VILLAGE_SHOTS)
    elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:
        total=max(total,WP_SURFACE_REFINEMENT_SHOTS)
    elif args.scenario==WP_CANONICAL_FOCUS_SCENARIO:
        total=max(total,WP_CANONICAL_FOCUS_SHOTS)
    if args.no_publish:
        _clean_ephemeral_capture_dir()
    driver=_driver()
    frames=[]
    try:
        set_exact_viewport(driver,width,height)
        url=_target_url(args.target)
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
            # Parent art-direction acceptance needs more than one center-frame.
            # Capture the canonical civic center, one authored worksite context,
            # and a wider near-max village overview without inventing any camera-
            # relative world position. Every target comes from StartingVillage.
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
        elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:
            focus=_prepare_surface_refinement_focus(driver)
            frames=[]
            for index in range(WP_SURFACE_REFINEMENT_SHOTS):
                frame=_surface_refinement_frame(driver,index,args.ready_timeout)
                frame["focusPreparation"]=focus
                path=_file_name(args.filename,index+1,WP_SURFACE_REFINEMENT_SHOTS,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index+1;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
                frames.append(frame)
            _validate_surface_refinement_frames(frames)
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
