#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s007-013"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
TYPES=["traveling-merchant","small-caravan","road-patrol","hunter-party"]
STAMP="1201-06-02 12:00:00"
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
            s?.ready && window.TravelEncounters && window.CrowdPresentation);
        """)
    except Exception:
        return False

def activate(kind):
    return driver.execute_script("""
      const type=arguments[0],stamp=arguments[1],scale=arguments[2],seed=PlanetStage.snapshot().activeSeed;
      TravelEncounters.clearProof(seed);
      const current=PlanetStage.snapshot().canonicalFocus?.worldTile||{x:"0",y:"0",level:0};
      const result=TravelEncounters.proofActivate(seed,type,current,stamp);
      if(!result?.pass)throw new Error("travel encounter proof activation failed: "+JSON.stringify(result));
      const anchor=result.event.anchor;
      PlanetStage.setWorldTileFocus(anchor.x,anchor.y);
      PlanetStage.setScaleIndex(scale);
      PlanetStage.applyAuthoritativeFantasyTime(stamp,"WP-S007-013 evidence",{snapshotResult:false});
      return {seed,type,stamp,result};
    """,kind,STAMP,SCALE_INDEX)

def state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),te=s.travelEncounters||TravelEncounters.snapshot(s.activeSeed),cp=s.crowdPresentation||{};
      const card=document.getElementById("travelEncounterCard");
      const rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{};
      const signatureReady=(!rb.requestedSignature)||Boolean(rb.standInActive)||(rb.activeSignature&&rb.activeSignature===rb.requestedSignature);
      const encounterActors=(cp.actors||[]).filter(a=>a.travelEncounter);
      const visibleEncounterActors=encounterActors.filter(a=>a.visible).length;
      return {
        ready:Boolean(s.ready),seed:s.activeSeed,scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        focus:s.canonicalFocus?.worldTile||null,resourceBudget:rb,localStatic:ls,signatureReady:Boolean(signatureReady),
        travel:te,crowd:cp,encounterActors,visibleEncounterActors,
        cardVisible:Boolean(card&&!card.hidden),cardType:card?.dataset?.encounterType||"",cardText:String(card?.innerText||"")
      };
    """)

def refresh():
    driver.execute_script("""
      PlanetStage.applyAuthoritativeFantasyTime(arguments[0],"WP-S007-013 evidence refresh",{snapshotResult:false});
    """,STAMP)

def leave_and_return(event):
    anchor=event["anchor"]
    away=driver.execute_script("""
      const a=arguments[0],scale=arguments[1];
      const x=String(BigInt(a.x)+180n),y=String(BigInt(a.y)+144n);
      PlanetStage.setWorldTileFocus(x,y);PlanetStage.setScaleIndex(scale);
      PlanetStage.applyAuthoritativeFantasyTime(arguments[2],"WP-S007-013 evidence leave",{snapshotResult:false});
      return {x,y};
    """,anchor,SCALE_INDEX,STAMP)
    try:
        wait.until(lambda _d: state()["signatureReady"] and not state()["travel"].get("active") and state()["travel"].get("summaryOnly") is True)
    except TimeoutException:
        raise RuntimeError("off-screen summary transition failed: "+json.dumps({"away":away,"state":state()}))
    off=state()
    driver.execute_script("""
      const a=arguments[0],scale=arguments[1];
      PlanetStage.setWorldTileFocus(a.x,a.y);PlanetStage.setScaleIndex(scale);
      PlanetStage.applyAuthoritativeFantasyTime(arguments[2],"WP-S007-013 evidence return",{snapshotResult:false});
    """,anchor,SCALE_INDEX,STAMP)
    try:
        wait.until(lambda _d: state()["signatureReady"] and state()["travel"].get("active") and state()["visibleEncounterActors"]>=1)
    except TimeoutException:
        raise RuntimeError("encounter return transition failed: "+json.dumps(state()))
    back=state()
    return {
      "away":away,
      "offscreen":{"active":off["travel"].get("active"),"summaryOnly":off["travel"].get("summaryOnly"),"exactActorCount":off["travel"].get("exactActorCount")},
      "returned":{"focus":back["focus"],"id":back["travel"].get("encounter",{}).get("id"),"visibleEncounterActors":back["visibleEncounterActors"]}
    }

records=[]
roundtrip=None
try:
    driver.get(TARGET)
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        raise RuntimeError("startup timeout: "+json.dumps(driver.execute_script("return {ready:window.PlanetStage?.snapshot?.()?.ready||false,error:window.PlanetStage?.snapshot?.()?.startupError||null,body:String(document.body?.innerText||'').slice(0,900)}")))

    for idx,kind in enumerate(TYPES):
        activation=activate(kind)
        expected=int(activation["result"]["event"]["actorCount"])
        try:
            wait.until(lambda _d,k=kind,e=expected: (
                state()["cardVisible"] and state()["cardType"]==k and state()["scaleIndex"]==SCALE_INDEX and
                state()["signatureReady"] and state()["travel"].get("active") and
                int(state()["travel"].get("exactActorCount",0))==e and
                int(state()["crowd"].get("travelEncounterCount",0))==e and
                state()["visibleEncounterActors"]>=e
            ))
        except TimeoutException:
            refresh()
            try:
                wait.until(lambda _d,k=kind,e=expected: (
                    state()["cardVisible"] and state()["cardType"]==k and state()["travel"].get("active") and
                    int(state()["crowd"].get("travelEncounterCount",0))==e and state()["visibleEncounterActors"]>=e
                ))
            except TimeoutException:
                raise RuntimeError("travel encounter presentation timeout "+kind+": "+json.dumps(state()))
        time.sleep(.45)
        st=state()
        travel=st["travel"]
        crowd=st["crowd"]
        if int(travel.get("exactActorCount",0))<1 or int(travel.get("exactActorCount",0))>4:
            raise RuntimeError("exact encounter actor bound failed: "+json.dumps(st))
        if int(crowd.get("drawCallEstimate",0))>1:
            raise RuntimeError("encounter presentation exceeded one merged draw call: "+json.dumps(st))
        if travel.get("fullWorldScan") or travel.get("perFrameScan") or not travel.get("eventDriven"):
            raise RuntimeError("encounter scheduling architecture regression: "+json.dumps(st))
        if not travel.get("exactOnlyNearRelevance") or not travel.get("seedAndFantasyTimeOnly"):
            raise RuntimeError("encounter authority/relevance contract failed: "+json.dumps(st))
        if kind.replace("-"," ").split()[0].upper() not in st["cardText"].upper():
            raise RuntimeError("encounter card text mismatch: "+json.dumps(st))
        if idx==0:
            roundtrip=leave_and_return(activation["result"]["event"])
            if roundtrip["returned"]["id"]!=activation["result"]["event"]["id"]:
                raise RuntimeError("encounter identity changed after leave/return: "+json.dumps(roundtrip))
            st=state()
        path=OUT/f"{PROFILE}-{idx+1:02d}-{kind}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"type":kind,"file":str(path),"activation":activation,"state":st})

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    result={
      "pass":True,"wp":"WP-S007-013","classification":"MIXED","profile":PROFILE,"viewport":SIZE,
      "types":TYPES,"roundtrip":roundtrip,"records":records
    }
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
