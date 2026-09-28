#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-007"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
PRIORITY=["smith","shopkeeper","guard","woodcutter","tavern-keeper","farmer"]

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
        return driver.execute_script(
            "return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.WorkCycles&&window.ResidentMovement&&window.DailyActivity)"
        )
    except Exception:
        return False

def candidate_professions():
    return driver.execute_script("""
      const seed=PlanetStage.snapshot().activeSeed,priority=arguments[0],roster=DailyActivity.build(seed)||[];
      return priority.map(profession=>{
        const resident=roster.find(r=>r.profession===profession)||null;
        if(!resident)return null;
        const plan=WorkCycles.plan(seed,resident),samples=WorkCycles.evidenceSamples(seed,profession);
        const visible=samples.find(s=>s.targetSource==="work-choreography")||
          samples.find(s=>s.targetSource==="outdoor-worksite")||null;
        return {profession,residentId:resident.id,plan,visible};
      }).filter(x=>x&&x.plan?.valid&&x.visible).slice(0,4);
    """,PRIORITY)

def prepare_focus(profession):
    return driver.execute_script("""
      const profession=arguments[0],stage=PlanetStage.snapshot(),seed=stage.activeSeed;
      const samples=WorkCycles.evidenceSamples(seed,profession);
      let sample=samples.find(s=>s.targetSource==="work-choreography")||
        samples.find(s=>s.targetSource==="outdoor-worksite")||null;
      if(!sample)return {ok:false,reason:"no-visible-sample",profession,seed,samples};
      // Focus/LOD preparation must settle before the resident is advanced.
      // Otherwise rebuilding local presentation can clear the exact NPC entities
      // after the worker already reached the requested choreography step.
      PlanetStage.applyAuthoritativeFantasyTime(sample.when,"WP-S004-007 evidence");
      PlanetStage.setWorldTileFocus(sample.target.x,sample.target.y);
      PlanetStage.setScaleIndex(8);
      return {ok:true,seed,sample,verify:WorkCycles.verify(seed),work:WorkCycles.snapshot(seed)};
    """,profession)

def resource_state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),rb=s.projection.resourceBudget||{},ls=s.projection.localStatic||{};
      return {
        ready:Boolean(s.ready),preparing:Boolean(rb.preparing),standInActive:Boolean(rb.standInActive),
        pendingPreparationCount:Number(rb.pendingPreparationCount||0),
        requestedSignature:rb.requestedSignature||null,activeSignature:rb.activeSignature||null,
        scaleIndex:Number(s.zoom.scaleIndex),scaleLabel:s.zoom.scaleLabel,
        tier:ls.revealTier,localStaticActive:Boolean(ls.active),localBuildingCount:Number(ls.buildingCount||0)
      };
    """)

def resource_ready():
    state=resource_state()
    requested=state.get("requestedSignature")
    active=state.get("activeSignature")
    signature_ready=(not requested) or (bool(active) and str(active)==str(requested))
    return (
        state["ready"] and not state["preparing"] and not state["standInActive"] and
        state["pendingPreparationCount"]==0 and signature_ready and state["scaleIndex"]==8 and
        state["tier"] in ("refined","full") and state["localStaticActive"] and
        state["localBuildingCount"]>0
    )

def activate(info):
    return driver.execute_script("""
      const info=arguments[0],sample=info.sample,seed=info.seed;
      PlanetStage.applyAuthoritativeFantasyTime(sample.when,"WP-S004-007 evidence settled");
      ResidentMovement.reset(seed);
      let state=null;
      for(let i=0;i<260;i++){
        ResidentMovement.advance(seed,sample.when,1);
        state=ResidentMovement.get(sample.residentId);
        if(state?.status==="arrived"&&state?.workCycle?.stepId===sample.stepId)break;
      }
      return {...info,state,verify:WorkCycles.verify(seed),work:WorkCycles.snapshot(seed)};
    """,info)

def visual_state(resident_id,building_id):
    return driver.execute_script("""
      const residentId=arguments[0],buildingId=arguments[1],s=PlanetStage.snapshot();
      const exact=PlanetStage.workCycleEvidenceState(residentId),rb=s.projection.resourceBudget||{},ls=s.projection.localStatic||{},np=s.npcPresentation||{};
      const targets=PlanetStage.inspectionTargets?.()||[];
      const npcTarget=targets.find(x=>x.type==="npc"&&String(x.id)===String(residentId))||null;
      const buildingTarget=buildingId?targets.find(x=>x.type==="building"&&String(x.id)===String(buildingId))||null:null;
      const workplaceKnown=Boolean(!buildingId||(s.buildingActivity?.buildings||[]).some(x=>String(x.id)===String(buildingId)));
      return {
        settled:Boolean(!rb.preparing&&!rb.standInActive&&Number(rb.pendingPreparationCount||0)===0&&
          (!rb.requestedSignature||(rb.activeSignature&&String(rb.activeSignature)===String(rb.requestedSignature)))),
        requestedSignature:rb.requestedSignature,activeSignature:rb.activeSignature,localStaticSignature:ls.signature,
        preparing:Boolean(rb.preparing),pendingPreparationCount:Number(rb.pendingPreparationCount||0),
        standInActive:Boolean(rb.standInActive),scaleIndex:s.zoom.scaleIndex,scaleLabel:s.zoom.scaleLabel,
        tier:ls.revealTier,localStaticActive:Boolean(ls.active),localBuildingCount:Number(ls.buildingCount||0),
        workplaceKnown,npcInspectionBounds:npcTarget?.bounds||null,workplaceInspectionBounds:buildingTarget?.bounds||null,exact,
        exactToolActive:Boolean(exact?.toolEnabled&&(np.activeWorkCycleResidentIds||[]).includes(String(residentId))),
        activeWorkCycleResidentIds:np.activeWorkCycleResidentIds||[],
        activeWorkCycleToolCount:Number(np.activeWorkCycleToolCount||0),
        sceneLoading:document.querySelector(".planet-stage-loading")?.getAttribute("data-state")||null
      };
    """,resident_id,building_id)

def visual_ready(info):
    state=visual_state(info["sample"]["residentId"],info["sample"].get("buildingId"))
    exact=state.get("exact") or {}
    npc_bounds=state.get("npcInspectionBounds")
    building_id=info["sample"].get("buildingId")
    workplace_bounds=state.get("workplaceInspectionBounds")
    return (
        state["settled"] and state["scaleIndex"]==8 and state["tier"] in ("refined","full") and
        state["localStaticActive"] and state["localBuildingCount"]>0 and state["workplaceKnown"] and
        bool(npc_bounds) and (not building_id or bool(workplace_bounds)) and
        exact.get("visible") and exact.get("inViewport") and state["exactToolActive"] and
        exact.get("movementStatus")=="arrived" and
        (exact.get("workCycle") or {}).get("stepId")==info["sample"]["stepId"]
    )

def add_overlay(info,bounds):
    driver.execute_script("""
      const info=arguments[0],bounds=arguments[1]||{},w=window.innerWidth,h=window.innerHeight;
      document.getElementById("wp-s004-007-evidence-card")?.remove();
      const card=document.createElement("div");
      card.id="wp-s004-007-evidence-card";
      const cx=((Number(bounds.left)||0)+(Number(bounds.right)||0))/2;
      const cy=((Number(bounds.top)||0)+(Number(bounds.bottom)||0))/2;
      const horizontal=cx>w*.5?"left":"right",vertical=cy>h*.5?"top":"bottom";
      Object.assign(card.style,{
        position:"fixed",zIndex:"99999",width:"min(286px,calc(100vw - 20px))",
        padding:"8px 10px",borderRadius:"9px",background:"rgba(7,12,18,.86)",color:"#f4f0df",
        border:"1px solid rgba(232,202,128,.68)",boxShadow:"0 6px 18px rgba(0,0,0,.32)",
        font:"600 11px/1.32 system-ui,sans-serif",pointerEvents:"none"
      });
      card.style[horizontal]="10px";card.style[vertical]="10px";
      const s=info.sample,st=info.state;
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S004-007 · LIVE WORK CYCLE</div>'+
        '<div style="font-size:15px;margin:2px 0 4px">'+String(s.profession).replace(/-/g," ")+' · '+s.label+'</div>'+
        '<div>'+s.action.toUpperCase()+' · '+s.targetSource.replace(/-/g," ")+' · '+(st?.status||"unknown")+'</div>'+
        '<div style="opacity:.76;margin-top:3px">Step '+(Number(s.stepIndex)+1)+'/'+(st?.workCycle?.stepCount||"?")+
        ' · route '+(st?.routeRequests??"?")+' · ≤12 exact workers</div>'+
        '<div style="opacity:.62;margin-top:2px">SEED + fantasy time · cached target-change routing · no economy mutation</div>';
      document.body.appendChild(card);
    """,info,bounds)

records=[]
try:
    driver.get(TARGET)
    wait.until(lambda _d: ready())
    candidates=candidate_professions()
    if len(candidates)<3:
        raise RuntimeError("fewer than three live professions have valid visible work cycles: "+json.dumps(candidates))

    for idx,candidate in enumerate(candidates):
        profession=candidate["profession"]
        info=prepare_focus(profession)
        if not info.get("ok"):
            raise RuntimeError(f"prepare failed: {info}")
        try:
            wait.until(lambda _d: resource_ready())
        except TimeoutException:
            raise RuntimeError("resource readiness timeout for "+profession+": "+json.dumps(resource_state()))
        info=activate(info)
        if (info.get("state") or {}).get("status")!="arrived":
            raise RuntimeError(f"worker failed to arrive after settled resource focus: {info.get('state')}")
        try:
            wait.until(lambda _d: visual_ready(info))
        except TimeoutException:
            diagnostic=visual_state(info["sample"]["residentId"],info["sample"].get("buildingId"))
            raise RuntimeError("visual readiness timeout for "+profession+": "+json.dumps(diagnostic))
        time.sleep(0.45)

        state=visual_state(info["sample"]["residentId"],info["sample"].get("buildingId"))
        info["state"]=driver.execute_script("return ResidentMovement.get(arguments[0])",info["sample"]["residentId"])
        info["stage"]=driver.execute_script("return PlanetStage.snapshot()")
        info["work"]=driver.execute_script("return WorkCycles.snapshot(arguments[0])",info["seed"])
        add_overlay(info,{"left":state["exact"]["screen"]["x"],"right":state["exact"]["screen"]["x"],"top":state["exact"]["screen"]["y"],"bottom":state["exact"]["screen"]["y"]})
        time.sleep(0.15)

        path=OUT/f"{PROFILE}-{idx+1:02d}-{profession}.png"
        driver.save_screenshot(str(path))
        records.append({
            "profile":PROFILE,"profession":profession,"file":str(path),
            "sample":info["sample"],"state":info["state"],"visualState":state,
            "npcPresentation":info["stage"]["npcPresentation"],"zoom":info["stage"]["zoom"],
            "localStatic":info["stage"]["projection"]["localStatic"],
            "resourceBudget":info["stage"]["projection"]["resourceBudget"],
            "work":info["work"],"verifyPass":bool(info["verify"]["pass"])
        })

    browser_logs=driver.get_log("browser")
    severe=[x for x in browser_logs if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    if not all(r["verifyPass"] for r in records):
        raise RuntimeError("WorkCycles.verify failed during evidence")
    if not all(r["state"].get("status")=="arrived" for r in records):
        raise RuntimeError("selected worker did not reach its choreography target")
    if not all(r["visualState"].get("settled") and (r["visualState"].get("exact") or {}).get("inViewport") and r["visualState"].get("workplaceKnown") and r["visualState"].get("exactToolActive") for r in records):
        raise RuntimeError("one or more screenshots lacked settled exact worker/workplace visibility")
    result={"pass":True,"profile":PROFILE,"viewport":SIZE,"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
