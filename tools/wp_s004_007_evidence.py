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
DESIRED_SCALE=8
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
        projection=snap.get("projection",{})
        budget=projection.get("resourceBudget",{})
        local=projection.get("localStatic",{})
        exact=(
            budget.get("preparing") is False and
            budget.get("standInActive") is False and
            budget.get("requestedSignature") and
            budget.get("requestedSignature")==budget.get("activeSignature") and
            budget.get("requestedCellId")==budget.get("activeCellId") and
            budget.get("requestedLevel")==budget.get("visibleLevel")
        )
        return bool(local.get("active")) and local.get("revealTier") in ("refined","full") and snap.get("zoom",{}).get("scaleIndex")==DESIRED_SCALE and bool(exact)
    except Exception:
        return False

def visible_npc(resident_id):
    try:
        return driver.execute_script("""
          const id=String(arguments[0]),w=innerWidth,h=innerHeight;
          const target=(PlanetStage.inspectionTargets()||[]).find(t=>t.type==="npc"&&String(t.id)===id);
          if(!target?.bounds)return null;
          const b=target.bounds,cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
          if(![b.left,b.right,b.top,b.bottom,cx,cy].every(Number.isFinite))return null;
          if(b.right<0||b.left>w||b.bottom<0||b.top>h||cx<w*.08||cx>w*.92||cy<h*.08||cy>h*.84)return null;
          const picked=PlanetStage.pickInspection(cx,cy);
          const snap=PlanetStage.snapshot();
          if(!picked||String(snap.inspection?.selectedId)!==id||snap.inspection?.selectedType!=="npc")return null;
          return {bounds:b,cx,cy,inspection:snap.inspection};
        """,resident_id)
    except Exception:
        return None

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
      PlanetStage.setScaleIndex(arguments[1]);
      return {ok:true,seed,sample,state,verify:WorkCycles.verify(seed),work:WorkCycles.snapshot(seed),movement:ResidentMovement.snapshot()};
    """,profession,DESIRED_SCALE)

def add_overlay(info):
    driver.execute_script("""
      const info=arguments[0];
      document.getElementById("wp-s004-007-evidence-card")?.remove();
      const card=document.createElement("div");
      card.id="wp-s004-007-evidence-card";
      Object.assign(card.style,{
        position:"fixed",right:"8px",bottom:"46px",zIndex:"99999",width:"min(250px,calc(100vw - 16px))",
        padding:"7px 9px",borderRadius:"8px",background:"rgba(7,12,18,.86)",color:"#f4f0df",
        border:"1px solid rgba(232,202,128,.68)",boxShadow:"0 5px 16px rgba(0,0,0,.30)",
        font:"600 10.5px/1.28 system-ui,sans-serif",pointerEvents:"none"
      });
      const s=info.sample,st=info.state;
      card.innerHTML=
        '<div style="font-size:8.5px;letter-spacing:.10em;color:#e8ca80">WP-S004-007 · LIVE</div>'+
        '<div style="font-size:13px;margin:1px 0 3px">'+String(s.profession).replace(/-/g," ")+' · '+s.label+'</div>'+
        '<div>'+s.action.toUpperCase()+' · '+(st?.status||"unknown")+' · step '+(Number(s.stepIndex)+1)+'/'+(st?.workCycle?.stepCount||"?")+'</div>'+
        '<div style="opacity:.68;margin-top:2px">SEED + fantasy time · target-change routing · no economy mutation</div>';
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
        # Require the chosen resident to be an actually visible, production-pickable NPC
        # after the exact requested SLOD cell has atomically replaced any stand-in.
        wait.until(lambda _d: driver.execute_script(
            "const s=PlanetStage.snapshot();return s.npcPresentation.activeWorkCycleToolCount>0 && s.projection.resourceBudget.standInActive===false && s.projection.resourceBudget.preparing===false;"
        ))
        vis=wait.until(lambda _d: visible_npc(info["sample"]["residentId"]))
        time.sleep(0.45)
        info["state"]=driver.execute_script("return ResidentMovement.get(arguments[0])",info["sample"]["residentId"])
        info["stage"]=driver.execute_script("return PlanetStage.snapshot()")
        info["work"]=driver.execute_script("return WorkCycles.snapshot(arguments[0])",info["seed"])
        info["visibleNpc"]=vis
        add_overlay(info)
        time.sleep(0.15)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{profession}.png"
        driver.save_screenshot(str(path))
        records.append({
            "profile":PROFILE,"profession":profession,"file":str(path),
            "sample":info["sample"],"state":info["state"],
            "npcPresentation":info["stage"]["npcPresentation"],
            "zoom":info["stage"]["zoom"],"localStatic":info["stage"]["projection"]["localStatic"],
            "work":info["work"],"verifyPass":bool(info["verify"]["pass"]),
            "visibleNpc":info["visibleNpc"],"resourceBudget":info["stage"]["projection"]["resourceBudget"],
            "inspection":info["stage"]["inspection"]
        })
        (OUT/f"{PROFILE}-{idx+1:02d}-{profession}.json").write_text(json.dumps(records[-1],indent=2))
    browser_logs=driver.get_log("browser")
    severe=[x for x in browser_logs if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
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
