#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s007-011"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
TYPES=["market-day-setup","village-gathering","minor-argument","predator-warning"]
SCALE_INDEX=9

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-webgl")
options.add_argument("--ignore-gpu-blocklist")
options.add_argument("--use-angle=swiftshader")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const s=window.PlanetStage?.snapshot?.();
          return Boolean(document.getElementById("planetStageRoot")?.dataset?.ready==="true" &&
            s?.ready && window.LocalEventVignettes && window.DailyActivity && window.EventScheduler);
        """)
    except Exception:
        return False

def activate(kind,index):
    return driver.execute_script("""
      const type=arguments[0],idx=arguments[1],seed=PlanetStage.snapshot().activeSeed;
      const hh=12+idx,now="1201-02-01 "+String(hh).padStart(2,"0")+":00:00";
      const result=LocalEventVignettes.proofActivate(seed,type,now);
      const event=result.event;
      let placement=null;
      if(event?.location?.anchor){
        ResidentMovement.beginProof(seed);
        const anchor=event.location.anchor;
        const placements=event.participants.map(p=>({residentId:p.id,position:p.eventTarget||anchor}));
        if(placements.some(p=>!p.position?.x||!p.position?.y))throw new Error("missing product local-event staging target");
        placement=ResidentMovement.proofPlaceResidentsAt(placements,"local-event-"+type);
        if(!placement)throw new Error("unable to place local-event participants at product staging targets");
        PlanetStage.setWorldTileFocus(anchor.x,anchor.y);
        PlanetStage.setScaleIndex(arguments[2]);
      }
      return {seed,now,result,placement};
    """,kind,index,SCALE_INDEX)

def state(kind):
    return driver.execute_script("""
      const kind=arguments[0],s=PlanetStage.snapshot(),events=s.localEvents||LocalEventVignettes.snapshot(s.activeSeed);
      const card=document.getElementById("localEventVignette");
      const event=(events.events||[])[0]||null;
      const participants=(event?.participants||[]).map(p=>({
        id:p.id,name:p.name,
        movement:ResidentMovement.get?.(p.id)||null,
        visual:PlanetStage.workCycleEvidenceState?.(p.id)||null
      }));
      const rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{},np=s.npcPresentation||{};
      const signatureReady=(!rb.requestedSignature)||Boolean(rb.standInActive)||(rb.activeSignature&&rb.activeSignature===rb.requestedSignature);
      const visibleParticipants=participants.filter(p=>p.visual?.visible&&p.visual?.inViewport).length;
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        event,events,cardVisible:Boolean(card&&!card.hidden),cardType:card?.dataset?.eventType||"",
        cardText:String(card?.innerText||""),focus:s.canonicalFocus?.worldTile||null,
        localStatic:ls,resourceBudget:rb,npcPresentation:np,signatureReady:Boolean(signatureReady),
        activeLocalEventCueCount:Number(np.activeLocalEventCueCount||0),
        activeLocalEventResidentIds:Array.isArray(np.activeLocalEventResidentIds)?np.activeLocalEventResidentIds:[],
        localEventPresentationRevision:String(np.localEventPresentationRevision||""),
        participants,visibleParticipants
      };
    """,kind)

records=[]
try:
    driver.get(TARGET)
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        raise RuntimeError("startup timeout: "+json.dumps(driver.execute_script("return {ready:window.PlanetStage?.snapshot?.()?.ready||false,error:window.PlanetStage?.snapshot?.()?.startupError||null,body:String(document.body?.innerText||'').slice(0,800)}")))
    for idx,kind in enumerate(TYPES):
        activation=activate(kind,idx)
        try:
            wait.until(lambda _d,k=kind: (
                state(k)["cardVisible"] and state(k)["cardType"]==k and state(k)["scaleIndex"]==SCALE_INDEX and
                state(k)["signatureReady"] and bool(state(k)["localStatic"].get("active")) and
                int(state(k)["localStatic"].get("buildingCount",0))>0 and state(k)["visibleParticipants"]>=2 and
                state(k)["activeLocalEventCueCount"]>=state(k)["visibleParticipants"] and
                state(k)["localEventPresentationRevision"]=="compact-event-silhouette-v3"
            ))
        except TimeoutException:
            raise RuntimeError("event presentation timeout "+kind+": "+json.dumps(state(kind)))
        time.sleep(.45)
        st=state(kind)
        ev=st["event"] or {}
        if int(st["events"].get("activeCount",0))!=1:
            raise RuntimeError("event active-count bound failed: "+json.dumps(st))
        if int(st["events"].get("participantCount",0))>4:
            raise RuntimeError("event participant bound failed: "+json.dumps(st))
        participant_count=int((st["event"] or {}).get("participantCount") or len((st["event"] or {}).get("participants") or []))
        staged=(st["event"] or {}).get("participants") or []
        if not staged or any(p.get("eventTargetSource")!="bounded-walkable-staging" for p in staged):
            raise RuntimeError("production event staging fallback used in visual proof: "+json.dumps(st))
        if len({str(p.get("eventTarget",{}).get("x"))+","+str(p.get("eventTarget",{}).get("y")) for p in staged})!=participant_count:
            raise RuntimeError("production event staging targets are not distinct: "+json.dumps(st))
        center=(st["event"] or {}).get("stagingCenter") or {}
        if (st["event"] or {}).get("stagingMode")!="compact-walkable-cluster-v2" or not center:
            raise RuntimeError("production event compact staging center missing: "+json.dumps(st))
        cx,cy=int(center.get("x")),int(center.get("y"))
        if any(max(abs(int(p["eventTarget"]["x"])-cx),abs(int(p["eventTarget"]["y"])-cy))>1 for p in staged):
            raise RuntimeError("production participants escaped compact 1-tile cluster: "+json.dumps(st))
        visible=[p for p in st["participants"] if p.get("visual",{}).get("visible") and p.get("visual",{}).get("inViewport")]
        screens=[p["visual"].get("screen") for p in visible if p["visual"].get("screen")]
        pairwise=[]
        for i in range(len(screens)):
            for j in range(i+1,len(screens)):
                dx=screens[i]["x"]-screens[j]["x"];dy=screens[i]["y"]-screens[j]["y"]
                pairwise.append((dx*dx+dy*dy)**0.5)
        if pairwise and (min(pairwise)<3 or max(pairwise)>180):
            raise RuntimeError("participant screen-space grouping/separation outside compact contract: "+json.dumps({"distances":pairwise,"state":st}))
        for p in visible:
            body=p["visual"].get("bodyScreenSizePx") or {}
            silhouette=p["visual"].get("eventSilhouetteScreenSizePx") or {}
            if max(float(body.get("width",0)),float(body.get("height",0)))<5 or max(float(silhouette.get("width",0)),float(silhouette.get("height",0)))<5:
                raise RuntimeError("participant body/silhouette screen readability too small: "+json.dumps({"participant":p,"state":st}))
        if st["visibleParticipants"]<2 or int(st["localStatic"].get("buildingCount",0))<=0:
            raise RuntimeError("event participants/local context not visibly materialized: "+json.dumps(st))
        if st["activeLocalEventCueCount"]<st["visibleParticipants"] or st["activeLocalEventCueCount"]>max(1,participant_count)*4:
            raise RuntimeError("event cue count outside compact bounded contract: "+json.dumps(st))
        if len(st["activeLocalEventResidentIds"])<st["visibleParticipants"] or st["localEventPresentationRevision"]!="compact-event-silhouette-v3":
            raise RuntimeError("event cue resident/revision telemetry mismatch: "+json.dumps(st))
        if not st["events"].get("eventDriven") or st["events"].get("perFrameScan") or st["events"].get("fullSettlementPerFrameScan") or st["events"].get("fullWorldScan"):
            raise RuntimeError("event scheduling architecture regression: "+json.dumps(st))
        if kind.replace("-"," ").split()[0].upper() not in st["cardText"].upper():
            raise RuntimeError("event card text mismatch: "+json.dumps(st))
        path=OUT/f"{PROFILE}-{idx+1:02d}-{kind}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"type":kind,"file":str(path),"activation":activation,"state":st})
    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S007-011","classification":"MIXED","profile":PROFILE,"viewport":SIZE,
            "types":TYPES,"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
