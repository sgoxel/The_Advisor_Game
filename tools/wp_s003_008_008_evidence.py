#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from screenshot_tool import _driver, _wait, set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-008-008-functional"))
OUT.mkdir(parents=True,exist_ok=True)
SEEDS=("CANONICAL-FOCUS-008008-A","CANONICAL-FOCUS-008008-B")
SETTLEMENT_TYPES={"hamlet","village","town","city","capital"}
OFFSETS=[
    (0,0),(30000,0),(-30000,0),(0,30000),(0,-30000),
    (60000,0),(-60000,0),(0,60000),(0,-60000),
    (90000,0),(-90000,0),(0,90000),(0,-90000),
    (120000,0),(-120000,0),(0,120000),(0,-120000),
    (90000,90000),(-90000,90000),(90000,-90000),(-90000,-90000),
]

def target_url():
    sep="&" if "?" in TARGET else "?"
    return TARGET+sep+"evidence_fast_start=1&dev=1&gpu=webgl2"

def install_seed(driver,seed):
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

def startup_probe(driver):
    return driver.execute_script("""
      const root=document.getElementById('planetStageRoot'),s=window.PlanetStage?.snapshot?.()||null;
      const p=s?.startupProgress||{},scheduler=s?.startupScheduler||{},backend=s?.rendererBackend||{};
      return {
        ok:Boolean(root?.dataset?.ready==='true'&&s?.ready&&s?.activeSeed&&window.StartingVillage&&window.WorldDestinations),
        failed:Boolean(root?.dataset?.error||s?.startupError||p?.mode==='failed'),
        documentReady:document.readyState,
        rootExists:Boolean(root),
        rootReady:root?.dataset?.ready||null,
        rootError:root?.dataset?.error||null,
        stagePresent:Boolean(window.PlanetStage),
        activeSeed:s?.activeSeed||null,
        startupError:s?.startupError||null,
        startupProgress:{
          mode:p?.mode||null,phaseId:p?.phaseId||null,phaseLabel:p?.phaseLabel||null,
          measuredPercent:p?.measuredPercent??null,watchdogStatus:p?.watchdogStatus||null,
          lastProgressLabel:p?.lastProgressLabel||null
        },
        startupScheduler:{
          phaseTimings:scheduler?.phaseTimings||null,
          watchdogChecks:scheduler?.watchdogChecks??null,
          watchdogStallCount:scheduler?.watchdogStallCount??null,
          evidenceFastStart:scheduler?.evidenceFastStart??null,
          evidencePlanetPlaceholder:scheduler?.evidencePlanetPlaceholder??null,
          evidenceShaderWarmupSkipped:scheduler?.evidenceShaderWarmupSkipped??null
        },
        rendererBackend:{
          requested:backend?.requested||null,active:backend?.active||null,
          selection:backend?.selection||null,fallbackReason:backend?.fallbackReason||null
        },
        canvasCount:s?.canvasCount??0,
        frameCount:s?.frameCount??0,
        startingVillage:Boolean(window.StartingVillage),
        worldDestinations:Boolean(window.WorldDestinations)
      };
    """)

def startup_diagnostic(driver,seed,error,probe=None):
    state=probe
    if state is None:
        try:
            state=startup_probe(driver)
        except Exception as exc:
            state={"probeError":str(exc)}
    try:
        logs=driver.get_log("browser")
        browser_logs=[{
            "level":str(row.get("level","")),
            "message":str(row.get("message",""))[-4000:]
        } for row in logs[-80:]]
    except Exception as exc:
        browser_logs=[{"level":"diagnostic","message":"browser log unavailable: "+str(exc)}]
    payload={"seed":seed,"error":str(error),"probe":state,"browserLogs":browser_logs}
    (OUT/f"{seed}-startup-diagnostic.json").write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")
    return payload

def ready(driver,seed,timeout=240):
    deadline=time.monotonic()+float(timeout)
    last=None
    while time.monotonic()<deadline:
        try:
            last=startup_probe(driver)
            if last.get("ok"):
                return last
            if last.get("failed"):
                diagnostic=startup_diagnostic(driver,seed,"PlanetStage reported startup failure",last)
                raise RuntimeError("WP-S003-008-008 startup failed: "+json.dumps(diagnostic,sort_keys=True))
        except RuntimeError:
            raise
        except Exception as exc:
            last={"probeError":str(exc)}
        time.sleep(.25)
    diagnostic=startup_diagnostic(driver,seed,"stage readiness timeout",last)
    raise RuntimeError("timeout waiting for WP-S003-008-008 stage readiness: "+json.dumps(diagnostic,sort_keys=True))

def js(driver,script,*args):
    return driver.execute_script(script,*args)

def snapshot(driver):
    return js(driver,"""
      const s=window.PlanetStage.snapshot(),p=window.Protagonist?.getPosition?.()||null;
      return {
        activeSeed:s.activeSeed,canonicalFocus:s.canonicalFocus,zoom:s.zoom,
        explicitFocusNavigation:s.explicitFocusNavigation,destinationNavigator:s.destinationNavigator,
        npcPresentation:s.npcPresentation,inspection:s.inspection,
        protagonist:p?{x:String(p.x),y:String(p.y)}:null,
        spatialLod:s.projection?.spatialLod||null,resourceBudget:s.projection?.resourceBudget||null
      };
    """)

def focus_starting_village(driver):
    result=js(driver,"""
      const stage=window.PlanetStage,seed=stage.snapshot().activeSeed,v=window.StartingVillage.plan(seed),c=v?.center;
      if(!c)return {ok:false};
      stage.setWorldTileFocus(String(c.x),String(c.y));stage.setScaleIndex(4);stage.refreshPlaces();
      return {ok:true,id:String(v.id||''),name:String(v.name||''),center:{x:String(c.x),y:String(c.y)}};
    """)
    if not result or not result.get("ok"):
        raise RuntimeError("starting village unavailable")
    return result

def descriptors(driver):
    return js(driver,"""
      return (window.PlanetStage.placeDescriptors()||[]).map(d=>({
        id:String(d.id),name:String(d.name||d.id),type:String(d.type||''),category:String(d.category||''),
        center:d.center?{x:String(d.center.x),y:String(d.center.y)}:null,
        latitudeRadians:d.latitudeRadians,longitudeRadians:d.longitudeRadians,
        latitudeDegrees:d.latitudeDegrees,longitudeDegrees:d.longitudeDegrees,
        canonicalCoordinateValid:d.canonicalCoordinateValid!==false,
        expectedSurfaceClass:String(d.expectedSurfaceClass||d.evidence?.terrain||'')
      }));
    """)

def canonical_water_probe_origin(driver):
    return js(driver,"""
      const seed=window.PlanetStage.snapshot().activeSeed,pg=window.PlanetGeography.create(seed);
      const candidates=[[-60,-150],[-60,-90],[-60,-30],[-60,30],[-60,90],[-60,150],
        [-30,-150],[-30,-90],[-30,-30],[-30,30],[-30,90],[-30,150],
        [0,-150],[0,-90],[0,-30],[0,30],[0,90],[0,150],
        [30,-150],[30,-90],[30,-30],[30,30],[30,90],[30,150],
        [60,-150],[60,-90],[60,-30],[60,30],[60,90],[60,150]];
      for(const [latDeg,lonDeg] of candidates){
        const lat=latDeg*Math.PI/180,lon=lonDeg*Math.PI/180,sample=pg.sampleLatLon(lat,lon);
        if(sample?.land===false){
          const tile=pg.worldTileForLatLon(lat,lon,window.WorldDestinations.TILE_METERS,window.PlanetGeography.DEFAULT_WORLD_RADIUS_METERS);
          return {x:String(tile.x),y:String(tile.y),latitudeDegrees:latDeg,longitudeDegrees:lonDeg,surfaceClass:String(sample.surfaceClass||''),land:false};
        }
      }
      return null;
    """)

def select_and_assert(driver,d,label,stream_handoff=False):
    initial=js(driver,"""
      const id=String(arguments[0]),before=window.Protagonist?.getPosition?.()||null;
      const snap=window.PlanetStage.selectPlace(id),nav=snap.explicitFocusNavigation?.active||null;
      return {requestId:nav?.requestId||null,before:before?{x:String(before.x),y:String(before.y)}:null,nav};
    """,d["id"])
    request_id=(initial or {}).get("requestId")
    if not request_id:
        raise RuntimeError(f"{label}: focus request was not created: {initial}")
    _wait(driver,f"""
      const n=window.PlanetStage?.snapshot?.()?.explicitFocusNavigation?.active;
      return Boolean(n&&n.requestId==={json.dumps(request_id)}&&n.targetId==={json.dumps(d["id"])}&&n.targetType==='place'&&n.state==='committed'&&Number(n.focusErrorMeters)<=1);
    """,180,f"{label} canonical focus commit")
    result=js(driver,"""
      const snap=window.PlanetStage.snapshot(),after=window.Protagonist?.getPosition?.()||null;
      return {nav:snap.explicitFocusNavigation?.active||null,before:arguments[0],after:after?{x:String(after.x),y:String(after.y)}:null,canonical:snap.canonicalFocus};
    """,(initial or {}).get("before"))
    nav=(result or {}).get("nav") or {}
    if nav.get("targetId")!=d["id"] or nav.get("targetType")!="place" or nav.get("state")!="committed":
        raise RuntimeError(f"{label}: target identity/commit mismatch: {result}")
    if float(nav.get("focusErrorMeters") if nav.get("focusErrorMeters") is not None else 999999)>1:
        raise RuntimeError(f"{label}: final coordinate error > 1m: {result}")
    coord=nav.get("canonicalCoordinate") or {}
    if abs(float(coord.get("latitudeRadians",99))-float(d["latitudeRadians"]))>1e-10 or abs(float(coord.get("longitudeRadians",99))-float(d["longitudeRadians"]))>1e-10:
        raise RuntimeError(f"{label}: canonical descriptor coordinate changed: {result}")
    if nav.get("surfaceConsistent") is False:
        raise RuntimeError(f"{label}: terrestrial/water classification mismatch: {result}")
    if result.get("before")!=result.get("after") or nav.get("simulationMutation") is not False or nav.get("cameraOnly") is not True:
        raise RuntimeError(f"{label}: camera focus mutated protagonist simulation state: {result}")
    proof={"label":label,"descriptor":d,"selection":result}
    if stream_handoff:
        initial_id=nav.get("targetId");initial_coord=coord.copy()
        js(driver,"window.PlanetStage.setScaleIndex(8);")
        _wait(driver,"""
          const n=window.PlanetStage?.snapshot?.()?.explicitFocusNavigation?.active;
          return Boolean(n&&n.targetId===arguments[0]&&Number(n.focusErrorMeters)<=1);
        """.replace("arguments[0]",json.dumps(initial_id)),180,f"{label} stable identity through LOD handoff")
        after=snapshot(driver);nav2=(after.get("explicitFocusNavigation") or {}).get("active") or {}
        if nav2.get("targetId")!=initial_id or (nav2.get("canonicalCoordinate") or {})!=initial_coord:
            raise RuntimeError(f"{label}: target drift through LOD handoff: {nav2}")
        proof["handoff"]=after
        js(driver,"window.PlanetStage.setScaleIndex(4);")
    return proof

def repeat_same_target_assert(driver,d,first):
    second=select_and_assert(driver,d,"repeat-"+str(first.get("label") or "target"))
    first_nav=(first.get("selection") or {}).get("nav") or {}
    second_nav=(second.get("selection") or {}).get("nav") or {}
    if first_nav.get("targetId")!=second_nav.get("targetId") or first_nav.get("canonicalCoordinate")!=second_nav.get("canonicalCoordinate"):
        raise RuntimeError("same-target repeat changed canonical identity: "+json.dumps({"first":first_nav,"second":second_nav}))
    return {
        "firstRequestId":first_nav.get("requestId"),"secondRequestId":second_nav.get("requestId"),
        "targetId":second_nav.get("targetId"),"canonicalCoordinate":second_nav.get("canonicalCoordinate"),
        "deterministic":True
    }

def invalid_target_assert(driver):
    result=js(driver,"""
      const stage=window.PlanetStage,before=stage.snapshot().canonicalFocus;
      const response=stage.requestCanonicalFocus({targetId:'invalid-proof',targetType:'place',source:'wp-s003-008-008-evidence',target:{latitudeRadians:null,longitudeRadians:''}});
      const after=stage.snapshot();
      return {response,before,afterFocus:after.canonicalFocus,nav:after.explicitFocusNavigation};
    """)
    if (result.get("response") or {}).get("ok") is not False:
        raise RuntimeError("invalid target was not rejected: "+json.dumps(result))
    b=result.get("before") or {};a=result.get("afterFocus") or {}
    if abs(float(b.get("latitudeRadians",0))-float(a.get("latitudeRadians",0)))>1e-12 or abs(float(b.get("longitudeRadians",0))-float(a.get("longitudeRadians",0)))>1e-12:
        raise RuntimeError("invalid target moved camera: "+json.dumps(result))
    failure=(result.get("nav") or {}).get("lastFailure") or {}
    if failure.get("cameraUnchanged") is not True:
        raise RuntimeError("invalid target missing safe-failure telemetry: "+json.dumps(result))
    return result

def wait_marker(driver):
    result=js(driver,"""
      const stage=window.PlanetStage;
      const read=()=>window.Protagonist?.getPosition?.()||window.SeedSystem?.getCampaign?.()?.protagonist||null;
      const before=read();
      if(!before)return {ok:false,reason:'authoritative-protagonist-unavailable'};
      stage.setWorldTileFocus(String(before.x),String(before.y));
      const scalar=stage.scalarForFootprintHeight(80);
      stage.setZoomScalar(scalar);
      const after=read();
      return {
        ok:true,scalar,
        before:{x:String(before.x),y:String(before.y)},
        after:after?{x:String(after.x),y:String(after.y)}:null
      };
    """)
    if not result or not result.get("ok"):
        raise RuntimeError("could not prepare wider-view protagonist focus: "+json.dumps(result))
    if result.get("before")!=result.get("after"):
        raise RuntimeError("wider-view camera setup mutated protagonist simulation position: "+json.dumps(result))
    _wait(driver,"""
      const s=window.PlanetStage?.snapshot?.(),p=s?.npcPresentation||{},ls=s?.projection?.localStatic||{};
      const t=(window.PlanetStage?.inspectionTargets?.()||[]).find(x=>x.type==='protagonist');
      const c=document.getElementById('planetCanvas')?.getBoundingClientRect?.(),b=t?.bounds;
      const cx=b?(Number(b.left)+Number(b.right))/2:NaN,cy=b?(Number(b.top)+Number(b.bottom))/2:NaN;
      const inViewport=Boolean(c&&Number.isFinite(cx)&&Number.isFinite(cy)&&cx>=0&&cx<=Number(c.width)&&cy>=0&&cy<=Number(c.height));
      return Boolean(
        s?.ready&&Number(s?.zoom?.scalar)<0.999999&&
        s?.zoom?.visibleLevel==='near-ground-close'&&
        ls?.revealTier==='refined'&&
        p?.protagonistMarkerVisible===true&&p?.protagonistBillboardVisible!==true&&
        t&&inViewport
      );
    """,200,"inspectable 80m wider-view protagonist")
    return result

def protagonist_focus_assert(driver,moved=False):
    before=js(driver,"""
      const p=window.Protagonist?.getPosition?.()||window.SeedSystem?.getCampaign?.()?.protagonist||null;
      if(!p)return null;
      return {x:String(p.x),y:String(p.y),source:window.Protagonist?.getPosition?'Protagonist.getPosition':'SeedSystem.campaign.protagonist'};
    """)
    if not before:
        raise RuntimeError("authoritative protagonist position unavailable")
    response=js(driver,"""
      const read=()=>window.Protagonist?.getPosition?.()||window.SeedSystem?.getCampaign?.()?.protagonist||null;
      const before=read(),response=window.PlanetStage.focusProtagonist(),after=read();
      return {response,before:before?{x:String(before.x),y:String(before.y)}:null,after:after?{x:String(after.x),y:String(after.y)}:null};
    """)
    expected_before={"x":before["x"],"y":before["y"]}
    if response.get("before")!=response.get("after") or response.get("before")!=expected_before:
        raise RuntimeError("protagonist focus teleported or changed authoritative simulation position: "+json.dumps({"before":before,"response":response}))
    _wait(driver,"""
      const s=window.PlanetStage?.snapshot?.(),n=s?.explicitFocusNavigation?.active,p=s?.npcPresentation||{};
      return Boolean(n?.targetType==='protagonist'&&n?.state==='committed'&&n?.maximumScaleReached===true&&Number(n?.focusErrorMeters)<=1&&s?.zoom?.visibleLevel==='ground'&&p?.protagonistBillboardVisible===true);
    """,240,"protagonist max-zoom focus commit")
    final=snapshot(driver);nav=(final.get("explicitFocusNavigation") or {}).get("active") or {}
    req=nav.get("protagonistPositionAtRequest") or {}
    if str(req.get("x"))!=str(before.get("x")) or str(req.get("y"))!=str(before.get("y")):
        raise RuntimeError("protagonist focus did not resolve current authoritative position: "+json.dumps({"before":before,"final":final}))
    if nav.get("followCurrentUntilCommit") is not True or nav.get("simulationMutation") is not False:
        raise RuntimeError("protagonist focus policy telemetry invalid: "+json.dumps(final))
    return {"moved":moved,"before":before,"response":response,"final":final}

def move_protagonist_for_evidence(driver):
    return js(driver,"""
      const campaign=window.SeedSystem?.getCampaign?.(),p=window.Protagonist?.getPosition?.()||campaign?.protagonist||null;
      if(!campaign||!p)return null;
      const next=window.WorldCoordinates.position(String(BigInt(String(p.x))+17n),String(BigInt(String(p.y))+11n));
      campaign.protagonist=next;
      return {x:String(next.x),y:String(next.y),source:'SeedSystem.campaign.protagonist'};
    """)

all_records=[]
for seed in SEEDS:
    driver=_driver()
    driver.set_script_timeout(240)
    try:
        set_exact_viewport(driver,1280,800)
        install_seed(driver,seed)
        driver.get(target_url())
        ready(driver,seed)
        state=snapshot(driver)
        if state.get("activeSeed")!=seed:
            raise RuntimeError(f"seed bootstrap mismatch: expected {seed}, got {state.get('activeSeed')}")
        village=focus_starting_village(driver)
        start_x=int(village["center"]["x"]);start_y=int(village["center"]["y"])
        found={}
        repeat_target=None
        water_probe={"available":False,"tested":False,"probeCount":0,"candidate":None}
        for ox,oy in OFFSETS:
            target_x=start_x+ox;target_y=start_y+oy
            js(driver,"""window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setScaleIndex(4);window.PlanetStage.refreshPlaces();""",str(target_x),str(target_y))
            items=descriptors(driver)
            for d in items:
                if not d.get("canonicalCoordinateValid") or d.get("latitudeRadians") is None or d.get("longitudeRadians") is None:
                    continue
                is_settlement=d.get("type") in SETTLEMENT_TYPES
                same_center=d.get("center")==village.get("center")
                surface=str(d.get("expectedSurfaceClass") or "").lower()
                is_water=d.get("category")=="water" or surface=="water"
                if "current-village" not in found and is_settlement and same_center:
                    found["current-village"]=select_and_assert(driver,d,"current-village",stream_handoff=True)
                    repeat_target=repeat_same_target_assert(driver,d,found["current-village"])
                elif "other-settlement" not in found and is_settlement and not same_center:
                    found["other-settlement"]=select_and_assert(driver,d,"other-settlement")
                if "water-destination" not in found and is_water:
                    found["water-destination"]=select_and_assert(driver,d,"water-destination")
                    water_probe={"available":True,"tested":True,"probeCount":water_probe["probeCount"],"candidate":{"id":d["id"],"center":d.get("center")}}
                if "land-poi" not in found and not is_settlement and not is_water and surface!="water":
                    found["land-poi"]=select_and_assert(driver,d,"land-poi")
            if {"current-village","other-settlement","land-poi","water-destination"}.issubset(found):
                break

        if "water-destination" not in found:
            canonical_water_origin=canonical_water_probe_origin(driver)
            if canonical_water_origin:
                water_probe["canonicalWaterOrigin"]=canonical_water_origin
                water_probe["probeCount"]+=1
                js(driver,"""window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setScaleIndex(4);window.PlanetStage.refreshPlaces();""",canonical_water_origin["x"],canonical_water_origin["y"])
                water_items=[
                    item for item in descriptors(driver)
                    if item.get("canonicalCoordinateValid")
                    and item.get("latitudeRadians") is not None
                    and item.get("longitudeRadians") is not None
                    and (item.get("category")=="water" or str(item.get("expectedSurfaceClass") or "").lower()=="water")
                ]
                if water_items:
                    candidate=water_items[0]
                    water_probe["available"]=True
                    water_probe["candidate"]={"id":candidate["id"],"center":candidate.get("center")}
                    found["water-destination"]=select_and_assert(driver,candidate,"water-destination")
                    water_probe["tested"]=True

        missing=sorted({"current-village","other-settlement","land-poi"}-set(found))
        if missing:
            raise RuntimeError(f"{seed}: missing mandatory bounded Places evidence classes {missing}")
        if water_probe["available"] and not water_probe["tested"]:
            raise RuntimeError(f"{seed}: bounded water destination was available but could not be exercised through Places")
        if not repeat_target or repeat_target.get("deterministic") is not True:
            raise RuntimeError(f"{seed}: repeated same-target focus proof missing")
        invalid=invalid_target_assert(driver)
        focus_starting_village(driver)
        wait_marker(driver)
        protagonist_first=protagonist_focus_assert(driver,False)
        moved_to=move_protagonist_for_evidence(driver)
        if not moved_to:
            raise RuntimeError(f"{seed}: could not establish second authoritative protagonist position")
        wait_marker(driver)
        protagonist_moved=protagonist_focus_assert(driver,True)
        moved_expected={"x":moved_to["x"],"y":moved_to["y"]}
        moved_actual={"x":protagonist_moved["before"]["x"],"y":protagonist_moved["before"]["y"]}
        if moved_actual!=moved_expected:
            raise RuntimeError(f"{seed}: moved protagonist authority mismatch: expected {moved_expected}, got {moved_actual}")
        all_records.append({
            "seed":seed,"village":village,"places":found,"repeatSameTarget":repeat_target,"waterProbe":water_probe,"invalidTarget":invalid,
            "protagonistInitial":protagonist_first,"movedTo":moved_to,"protagonistMoved":protagonist_moved,
            "final":snapshot(driver)
        })
    except TimeoutException as exc:
        diagnostic={"seed":seed,"error":"timeout","state":snapshot(driver)}
        (OUT/f"{seed}-timeout.json").write_text(json.dumps(diagnostic,indent=2),encoding="utf-8")
        raise RuntimeError(json.dumps(diagnostic)) from exc
    finally:
        driver.quit()

payload={
    "schema":1,"wp":"WP-S003-008-008","seeds":list(SEEDS),"records":all_records,
    "checks":{
        "twoSeeds":len(all_records)==2,
        "mandatoryPlacesClassesPerSeed":all(all(k in r["places"] for k in ("current-village","other-settlement","land-poi")) for r in all_records),
        "waterDestinationWhereAvailable":all((not r["waterProbe"]["available"]) or r["waterProbe"]["tested"] for r in all_records),
        "repeatedSameTargetDeterministic":all(r["repeatSameTarget"]["deterministic"] for r in all_records),
        "invalidCoordinateCameraUnchanged":True,
        "stableTargetThroughLod":True,
        "protagonistMaxZoomCurrentPosition":True,
        "protagonistNoTeleport":True,
        "bounded":True,"fullWorldScan":False
    }
}
(OUT/"functional-evidence.json").write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")
print(json.dumps(payload["checks"],sort_keys=True))
