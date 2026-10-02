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
WP_SURFACE_REFINEMENT_SCENARIO="wp-s003-010-003-005-002"
WP_SURFACE_REFINEMENT_SHOTS=10
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
        "--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen",
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
        atmosphere:s.atmosphere,
        worldVisualStyle:s.worldVisualStyle,
        worldVisualStyleIntegration:s.worldVisualStyleIntegration,
        navigationPerformance:s.navigationPerformance,
        startupError:s.startupError,
        frameCount:s.frameCount,
        renderQuality:window.RuntimeRenderQuality?.snapshot?.()||null
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

def _prepare_starting_village_scene(driver,timeout):
    focus=_prepare_starting_village_focus(driver)
    result=driver.execute_script("""
      const stage=window.PlanetStage;
      const evidenceTime={year:1100,month:1,day:1,hour:11,minute:30,second:0};
      stage.applyAuthoritativeFantasyTime?.(evidenceTime,'wp-s003-009-visual-evidence',{snapshotResult:false,deferPresentation:false});
      stage.setZoomScalar(1);
      return {scalar:1,evidenceTime};
    """)
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
    """,timeout,"Starting Village final-ground living-world presentation with character billboards")
    # Let the just-materialized billboard scene survive two paint frames before
    # capture; the wait condition above observes scene state, not rendered pixels.
    driver.execute_async_script("""
      const done=arguments[0];
      requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));
    """)
    return {**focus,"zoom":result}

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
        "metersPerTexel":detail.get("detailMetersPerTexel"),
        "mediumMetersPerTexel":detail.get("mediumMetersPerTexel"),
        "surroundMetersPerTexel":detail.get("surroundMetersPerTexel"),
        "geometrySpacing":detail.get("geometrySampleSpacingMeters") or detail.get("sampleSpacingMeters"),
        "anisotropy":detail.get("anisotropy"),
        "minFilter":detail.get("minFilter"),
        "magFilter":detail.get("magFilter"),
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
        if int(budget.get("cachedResourceCount") or 0)>4:
            raise RuntimeError(f"frame {index} exceeded bounded local cache: {budget}")
        if detail.get("active"):
            mpt=float(detail.get("detailMetersPerTexel") or 0)
            spacing=float(detail.get("geometrySampleSpacingMeters") or detail.get("sampleSpacingMeters") or 0)
            source_w=int(detail.get("sourceTextureWidth") or detail.get("textureSize") or 0)
            source_h=int(detail.get("sourceTextureHeight") or detail.get("textureSize") or 0)
            if mpt<=0 or spacing<=0 or source_w<=0 or source_h<=0:
                raise RuntimeError(f"frame {index} missing density telemetry: {detail}")
            if int(detail.get("anisotropy") or 0)<1 or detail.get("minFilter")!="linear-mipmap-linear" or detail.get("magFilter")!="linear":
                raise RuntimeError(f"frame {index} invalid texture sampling telemetry: {detail}")
            density.append((index,mpt,spacing,source_w,source_h,str(detail.get("level") or "")))
    if len(set(focus))!=1:
        raise RuntimeError(f"surface refinement evidence changed canonical focus: {focus}")
    if len(density)<5:
        raise RuntimeError(f"too few refined terrain samples: {density}")
    for a,b in zip(density,density[1:]):
        # Reusing one ready native resource over adjacent checkpoints is valid,
        # but world-space texel and geometry density must never get coarser.
        if b[1]>a[1]*1.001 or b[2]>a[2]*1.001:
            raise RuntimeError(f"closer zoom lost world-space terrain density: {a} -> {b}")
    if density[-1][1]>=density[0][1] or density[-1][2]>=density[0][2]:
        raise RuntimeError(f"surface refinement did not materially improve density: {density[0]} -> {density[-1]}")

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
    total=max(1,int(args.shots))
    if args.scenario==WP_CHARACTER_SCENARIO:
        total=max(total,WP_CHARACTER_SHOTS)
    elif args.scenario==WP_SURFACE_REFINEMENT_SCENARIO:
        total=max(total,WP_SURFACE_REFINEMENT_SHOTS)
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
        elif args.scenario==STARTING_VILLAGE_SCENARIO:
            focus=_prepare_starting_village_scene(driver,args.ready_timeout)
            frames=_generic_frames(driver,total,width,height,args.ready_timeout,args.interval)
            for frame in frames:
                frame["action"]="starting-village-ground"
                frame["focusPreparation"]=focus
            for index,frame in enumerate(frames,start=1):
                path=_file_name(args.filename,index,total,args.timestamp_names)
                _capture(driver,path)
                frame["index"]=index;frame["file"]=path.name
                frame["captured_at"]=datetime.now(timezone.utc).isoformat()
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
