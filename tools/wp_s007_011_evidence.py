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
SCALE_INDEX=8

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
      const e=result.event;
      if(e?.location?.anchor){
        PlanetStage.setWorldTileFocus(e.location.anchor.x,e.location.anchor.y);
        PlanetStage.setScaleIndex(arguments[2]);
      }
      return {seed,now,result};
    """,kind,index,SCALE_INDEX)

def state(kind):
    return driver.execute_script("""
      const kind=arguments[0],s=PlanetStage.snapshot(),events=s.localEvents||LocalEventVignettes.snapshot(s.activeSeed);
      const card=document.getElementById("localEventVignette");
      const event=(events.events||[])[0]||null;
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        event,events,cardVisible:Boolean(card&&!card.hidden),cardType:card?.dataset?.eventType||"",
        cardText:String(card?.innerText||""),focus:s.canonicalFocus?.worldTile||null
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
            wait.until(lambda _d,k=kind: state(k)["cardVisible"] and state(k)["cardType"]==k and state(k)["scaleIndex"]==SCALE_INDEX)
        except TimeoutException:
            raise RuntimeError("event presentation timeout "+kind+": "+json.dumps(state(kind)))
        time.sleep(.65)
        st=state(kind)
        ev=st["event"] or {}
        if int(st["events"].get("activeCount",0))!=1:
            raise RuntimeError("event active-count bound failed: "+json.dumps(st))
        if int(st["events"].get("participantCount",0))>4:
            raise RuntimeError("event participant bound failed: "+json.dumps(st))
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
