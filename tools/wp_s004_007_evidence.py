#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-007"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
PROFESSIONS=["smith","shopkeeper","guard","woodcutter"]

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
        return driver.execute_script("return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.WorkCycles&&window.ResidentMovement)")
    except Exception:
        return False

def local_ready():
    try:
        snap=driver.execute_script("return PlanetStage.snapshot()")
        return bool(snap.get("projection",{}).get("localStatic",{}).get("active")) and snap.get("zoom",{}).get("scaleIndex")==9
    except Exception:
        return False

def prepare(profession):
    return driver.execute_script("""
      const profession=arguments[0];
      const stage=PlanetStage.snapshot(),seed=stage.activeSeed;
      const samples=WorkCycles.evidenceSamples(seed,profession);
      if(!samples.length){
        const resident=(DailyActivity.build(seed)||[]).find(r=>r.profession===profession)||null;
        return {ok:false,reason:"no-samples",profession,seed,plan:resident?WorkCycles.plan(seed,resident):null};
      }
      let sample=samples.find(s=>s.targetSource==="work-choreography")||samples.find(s=>s.targetSource==="outdoor-worksite")||null;
      if(!sample)return {ok:false,reason:"no-visible-exterior-sample",profession,seed,samples};
      if(profession==="woodcutter"&&samples.length>1)sample=samples[1];
      PlanetStage.applyAuthoritativeFantasyTime(sample.when,"WP-S004-007 evidence");
      ResidentMovement.reset(seed);
      let state=null;
      for(let i=0;i<160;i++){
        ResidentMovement.advance(seed,sample.when,1);
        state=ResidentMovement.get(sample.residentId);
        if(state&&state.status==="arrived"&&state.workCycle&&state.workCycle.stepId===sample.stepId)break;
      }
      PlanetStage.setWorldTileFocus(sample.target.x,sample.target.y);
      PlanetStage.setScaleIndex(9);
      return {ok:true,seed,sample,state,verify:WorkCycles.verify(seed),work:WorkCycles.snapshot(seed),movement:ResidentMovement.snapshot()};
    """,profession)

def add_overlay(info):
    driver.execute_script("""
      const info=arguments[0];
      document.getElementById("wp-s004-007-evidence-card")?.remove();
      const card=document.createElement("div");
      card.id="wp-s004-007-evidence-card";
      Object.assign(card.style,{
        position:"fixed",right:"12px",bottom:"12px",zIndex:"99999",width:"min(320px,calc(100vw - 24px))",
        padding:"10px 12px",borderRadius:"10px",background:"rgba(7,12,18,.88)",color:"#f4f0df",
        border:"1px solid rgba(232,202,128,.7)",boxShadow:"0 7px 20px rgba(0,0,0,.35)",
        font:"600 12px/1.35 system-ui,sans-serif",pointerEvents:"none"
      });
      const s=info.sample,st=info.state,w=info.work;
      card.innerHTML=
        '<div style="font-size:10px;letter-spacing:.12em;color:#e8ca80">WP-S004-007 · LIVE WORK CYCLE</div>'+
        '<div style="font-size:17px;margin:2px 0 5px">'+String(s.profession).replace(/-/g," ")+' · '+s.label+'</div>'+
        '<div>'+s.action.toUpperCase()+' · '+s.targetSource.replace(/-/g," ")+' · '+(st?.status||"unknown")+'</div>'+
        '<div style="opacity:.78;margin-top:4px">Step '+(Number(s.stepIndex)+1)+'/'+(st?.workCycle?.stepCount||"?")+
        ' · route requests '+(st?.routeRequests??"?")+' · exact local workers ≤12</div>'+
        '<div style="opacity:.65;margin-top:3px">SEED + fantasy time · cached target-change routing · no economy/resource mutation</div>';
      document.body.appendChild(card);
    """,info)

records=[]
try:
    driver.get(TARGET)
    wait.until(lambda _d: ready())
    for idx,profession in enumerate(PROFESSIONS):
        info=prepare(profession)
        if not info.get("ok"):
            raise RuntimeError(f"prepare failed: {info}")
        wait.until(lambda _d: local_ready())
        # Wait for the selected outdoor worker/tool to be represented by the live pooled NPC layer.
        wait.until(lambda _d: driver.execute_script(
            "const s=PlanetStage.snapshot();return s.npcPresentation.activeWorkCycleToolCount>0 && s.projection.localStatic.active===true;"
        ))
        time.sleep(0.35)
        # Refresh state after the local representation settles.
        info["state"]=driver.execute_script("return ResidentMovement.get(arguments[0])",info["sample"]["residentId"])
        info["stage"]=driver.execute_script("return PlanetStage.snapshot()")
        info["work"]=driver.execute_script("return WorkCycles.snapshot(arguments[0])",info["seed"])
        add_overlay(info)
        time.sleep(0.12)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{profession}.png"
        driver.save_screenshot(str(path))
        records.append({
            "profile":PROFILE,"profession":profession,"file":str(path),
            "sample":info["sample"],"state":info["state"],
            "npcPresentation":info["stage"]["npcPresentation"],
            "zoom":info["stage"]["zoom"],"localStatic":info["stage"]["projection"]["localStatic"],
            "work":info["work"],"verifyPass":bool(info["verify"]["pass"])
        })
    browser_logs=driver.get_log("browser")
    severe=[x for x in browser_logs if x.get("level")=="SEVERE"]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    if not all(r["verifyPass"] for r in records):
        raise RuntimeError("WorkCycles.verify failed during evidence")
    if not all(r["state"].get("status")=="arrived" for r in records):
        raise RuntimeError("selected worker did not reach its choreography target")
    if not all(r["npcPresentation"].get("activeWorkCycleToolCount",0)>0 for r in records):
        raise RuntimeError("work tool was not active in one or more frames")
    result={"pass":True,"profile":PROFILE,"viewport":SIZE,"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
