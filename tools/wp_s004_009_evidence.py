#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-009"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
SAMPLES=[
    ("dawn",{"year":1201,"month":2,"day":1,"hour":7,"minute":15,"second":0}),
    ("midday",{"year":1201,"month":2,"day":1,"hour":10,"minute":30,"second":0}),
    ("evening",{"year":1201,"month":2,"day":1,"hour":19,"minute":15,"second":0}),
    ("night",{"year":1201,"month":2,"day":1,"hour":23,"minute":30,"second":0}),
]
EXPECTED={"dawn":"dawn","midday":"daytime","evening":"evening","night":"night"}

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,120)

def ready():
    try:
        return driver.execute_script("""
          return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.SettlementActivityRhythm&&
            window.ResidentMovement&&window.DailyActivity&&window.StartingVillage);
        """)
    except Exception:
        return False

def prepare_world():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),seed=s.activeSeed,plan=StartingVillage.plan(seed),center=plan.center||{x:"0",y:"0"};
      PlanetStage.setWorldTileFocus(center.x,center.y);
      PlanetStage.setScaleIndex(8);
      return {seed,center,verify:SettlementActivityRhythm.verify(seed)};
    """)

def resource_state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{};
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        tier:ls.revealTier,localStaticActive:Boolean(ls.active),buildingCount:Number(ls.buildingCount||0),
        requestedSignature:rb.requestedSignature||null,activeSignature:rb.activeSignature||null,
        pendingPreparationCount:Number(rb.pendingPreparationCount||0),standInActive:Boolean(rb.standInActive)
      };
    """)

def resource_ready():
    st=resource_state()
    signature_ok=(not st["requestedSignature"]) or (
        st["activeSignature"] and str(st["activeSignature"])==str(st["requestedSignature"])
    )
    return (
        st["ready"] and st["scaleIndex"]==8 and st["tier"] in ("refined","full") and
        st["localStaticActive"] and st["buildingCount"]>0 and
        (signature_ok or st["standInActive"])
    )

def apply_sample(name,when):
    return driver.execute_script("""
      const name=arguments[0],when=arguments[1],seed=PlanetStage.snapshot().activeSeed;
      PlanetStage.applyAuthoritativeFantasyTime(when,"WP-S004-009 evidence "+name);
      ResidentMovement.reset(seed);
      let last=null;
      // Capture the authoritative active travel window instead of waiting until
      // every resident has finished indoors. This exposes real route execution
      // while leaving targets, schedules and movement authority unchanged.
      for(let i=0;i<18;i++)ResidentMovement.advance(seed,when,2,{snapshot:false,maxTicks:240});
      last=ResidentMovement.snapshot();
      return {name,when,last,rhythm:SettlementActivityRhythm.snapshot(seed,when)};
    """,name,when)

def sample_state(info):
    return driver.execute_script("""
      const info=arguments[0],s=PlanetStage.snapshot(),rh=SettlementActivityRhythm.snapshot(s.activeSeed,info.when);
      const np=s.npcPresentation||{},ba=s.buildingActivity||{},rm=ResidentMovement.snapshot();
      const statuses={};
      for(const r of rm.residents||[])statuses[r.status]=(statuses[r.status]||0)+1;
      return {
        rhythm:rh,npcPresentation:np,buildingActivity:ba,residentStatuses:statuses,
        scaleIndex:s.zoom?.scaleIndex,scaleLabel:s.zoom?.scaleLabel,
        atmosphere:s.atmosphere||null,
        localStatic:s.projection?.localStatic||null,
        resourceBudget:s.projection?.resourceBudget||null
      };
    """,info)

def add_overlay(name,state):
    driver.execute_script("""
      const name=arguments[0],state=arguments[1];
      document.getElementById("wp-s004-009-evidence-card")?.remove();
      const card=document.createElement("div");card.id="wp-s004-009-evidence-card";
      Object.assign(card.style,{
        position:"fixed",left:"10px",top:"10px",zIndex:"99999",width:"min(320px,calc(100vw - 20px))",
        padding:"9px 11px",borderRadius:"10px",background:"rgba(7,12,18,.88)",color:"#f4f0df",
        border:"1px solid rgba(232,202,128,.68)",boxShadow:"0 6px 18px rgba(0,0,0,.32)",
        font:"600 10px/1.32 system-ui,sans-serif",pointerEvents:"none"
      });
      const r=state.rhythm||{},c=r.counts||{},m=r.modifiers||{},np=state.npcPresentation||{},ba=state.buildingActivity||{};
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S004-009 · FANTASY-DAY RHYTHM</div>'+
        '<div style="font-size:15px;margin:2px 0 4px">'+name.toUpperCase()+' · '+String(r.band||"unknown").replace(/-/g," ")+'</div>'+
        '<div>Exact visible residents '+Number(np.activeCount||0)+' / 12 · building cues '+Number(ba.cueCount||0)+'</div>'+
        '<div style="opacity:.80;margin-top:3px">schedule: work '+Number(c.work||0)+' · market '+Number(c.marketPublic||0)+' · social '+Number(c.tavernSocial||0)+' · traffic '+Number(c.traffic||0)+' · home '+Number(c.home||0)+'</div>'+
        '<div style="opacity:.66;margin-top:2px">profile: outdoor '+Math.round(Number(m.outdoorResidentShare||0)*100)+'% · work '+Math.round(Number(m.workSiteOccupancy||0)*100)+'% · tavern '+Math.round(Number(m.tavernSocialActivity||0)*100)+'% · guard '+Math.round(Number(m.guardPatrolPresence||0)*100)+'%</div>'+
        '<div style="opacity:.56;margin-top:2px">SEED + fantasy time · DailyActivity schedule unchanged · bounded 12-resident presentation</div>';
      document.body.appendChild(card);
    """,name,state)

records=[]
try:
    url=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(url)
    wait.until(lambda _d: ready())
    base=prepare_world()
    if not base["verify"].get("pass"):
        raise RuntimeError("SettlementActivityRhythm.verify failed: "+json.dumps(base["verify"]))
    try:
        wait.until(lambda _d: resource_ready())
    except TimeoutException:
        raise RuntimeError("resource readiness timeout: "+json.dumps(resource_state()))

    for idx,(name,when) in enumerate(SAMPLES):
        info=apply_sample(name,when)
        time.sleep(.65)
        state=sample_state(info)
        if state["rhythm"].get("band")!=EXPECTED[name]:
            raise RuntimeError("unexpected rhythm band: "+json.dumps({"name":name,"state":state["rhythm"]}))
        if state["npcPresentation"].get("rhythmBand")!=EXPECTED[name]:
            raise RuntimeError("NPC presentation did not consume rhythm band: "+json.dumps({"name":name,"npc":state["npcPresentation"]}))
        if state["buildingActivity"].get("rhythmBand")!=EXPECTED[name]:
            raise RuntimeError("building presentation did not consume rhythm band: "+json.dumps({"name":name,"building":state["buildingActivity"]}))
        add_overlay(name,state)
        time.sleep(.2)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{name}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"name":name,"when":when,"file":str(path),"state":state})

    browser_logs=driver.get_log("browser")
    severe=[x for x in browser_logs if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))

    by_name={r["name"]:r for r in records}
    day=by_name["midday"]["state"]["rhythm"]["modifiers"]
    night=by_name["night"]["state"]["rhythm"]["modifiers"]
    evening=by_name["evening"]["state"]["rhythm"]["modifiers"]
    if not (day["outdoorResidentShare"]>night["outdoorResidentShare"] and
            day["workSiteOccupancy"]>evening["workSiteOccupancy"] and
            evening["tavernSocialActivity"]>day["tavernSocialActivity"]):
        raise RuntimeError("profile contrast gate failed")
    if any(float(r["state"]["npcPresentation"].get("maxMotionUpdateMs") or 0)>=50 for r in records):
        raise RuntimeError("NPC presentation exceeded 50 ms update gate")
    if any(float(r["state"]["buildingActivity"].get("maxUpdateMs") or 0)>=50 for r in records):
        raise RuntimeError("building activity exceeded 50 ms update gate")

    result={
      "pass":True,"profile":PROFILE,"viewport":SIZE,"seed":base["seed"],"center":base["center"],
      "verification":base["verify"],"records":records
    }
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
