#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-008"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
# Landscape sees a materially wider physical footprint at the same canonical scale.
# Use the closer canonical ground scale (1/10000) there so the resident/building
# presentation is actually materialized inside the wider viewport. Portrait
# already passes at 1/5000 and remains unchanged.
SCALE_INDEX=9 if PROFILE=="landscape" else 8
CASES=["doorway-block","close-follow"]

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,180)

def ready():
    try:
        return driver.execute_script(
            "return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.ContextualReactions&&window.ResidentMovement&&window.DailyActivity)"
        )
    except Exception:
        return False

def verify():
    return driver.execute_script("""
      const seed=PlanetStage.snapshot().activeSeed;
      return {seed,verification:ContextualReactions.verify(seed)};
    """)

def prime_reusable_parent():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),seed=s.activeSeed,p=window.StartingVillage?.plan?.(seed);
      const center=p?.center||{x:"0",y:"0"};
      PlanetStage.setWorldTileFocus(String(center.x),String(center.y));
      PlanetStage.setScaleIndex(8);
      return {seed,center:{x:String(center.x),y:String(center.y)},name:String(p?.name||"Starting Village")};
    """)

def parent_prime_ready():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),rb=s.projection.resourceBudget||{},ls=s.projection.localStatic||{};
      return Boolean(s.ready&&Number(s.zoom.scaleIndex)===8&&["refined","full"].includes(String(ls.revealTier||""))&&
        ls.active&&Number(ls.buildingCount||0)>0&&rb.activeSignature);
    """)

def prepare(case_id):
    return driver.execute_script("""
      const caseId=arguments[0],seed=PlanetStage.snapshot().activeSeed;
      try{ResidentMovement.endProof?.()}catch(_){}
      const movementProof=ResidentMovement.beginProof(seed);
      const proof=ContextualReactions.beginProof(seed,caseId);
      if(!movementProof||!proof?.reaction)return {ok:false,caseId,seed,movementProof,proof};
      const placed=ResidentMovement.proofPlaceResidentsAt(
        [{residentId:proof.residentId,position:proof.residentPosition}],
        "contextual-reaction-"+caseId
      );
      if(!placed)return {ok:false,caseId,seed,reason:"proof-placement-failed",proof};
      PlanetStage.applyAuthoritativeFantasyTime(proof.when,"WP-S004-008 evidence");
      PlanetStage.setWorldTileFocus(proof.residentPosition.x,proof.residentPosition.y);
      PlanetStage.setScaleIndex(arguments[1]);
      return {ok:true,caseId,seed,proof,placed};
    """,case_id,SCALE_INDEX)

def resource_state(info):
    return driver.execute_script("""
      const residentId=arguments[0],s=PlanetStage.snapshot(),rb=s.projection.resourceBudget||{},ls=s.projection.localStatic||{};
      const target=(PlanetStage.inspectionTargets?.()||[]).find(x=>x.type==="npc"&&String(x.id)===String(residentId))||null;
      const b=target?.bounds,w=window.innerWidth,h=window.innerHeight;
      const inView=!!b&&b.right>4&&b.left<w-4&&b.bottom>4&&b.top<h-4;
      const bubble=document.getElementById("contextualReactionLayer");
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom.scaleIndex),tier:ls.revealTier,
        localStaticActive:Boolean(ls.active),localBuildingCount:Number(ls.buildingCount||0),
        standInActive:Boolean(rb.standInActive),pendingPreparationCount:Number(rb.pendingPreparationCount||0),
        residentTarget:target,residentInView:inView,bubbleVisible:Boolean(bubble&&bubble.textContent.trim()),
        bubbleText:bubble?.textContent?.trim()||"",
        reaction:ContextualReactions.stateFor(arguments[0]),telemetry:ContextualReactions.snapshot()
      };
    """,info["proof"]["residentId"])

def visual_ready(info):
    state=resource_state(info)
    return (
        state["ready"] and state["scaleIndex"]==SCALE_INDEX and state["tier"] in ("refined","full") and
        state["localStaticActive"] and state["residentInView"] and state["bubbleVisible"] and
        bool(state["reaction"])
    )

def add_overlay(info,state,verification):
    driver.execute_script("""
      const info=arguments[0],state=arguments[1],verification=arguments[2];
      document.getElementById("wp-s004-008-evidence-card")?.remove();
      const card=document.createElement("div");card.id="wp-s004-008-evidence-card";
      Object.assign(card.style,{
        position:"fixed",left:"10px",top:"10px",zIndex:"99999",width:"min(310px,calc(100vw - 20px))",
        padding:"9px 11px",borderRadius:"10px",background:"rgba(7,12,18,.90)",color:"#f4f0df",
        border:"1px solid rgba(232,202,128,.68)",boxShadow:"0 6px 18px rgba(0,0,0,.32)",
        font:"600 10px/1.32 system-ui,sans-serif",pointerEvents:"none"
      });
      const r=state.reaction||{};
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S004-008 · CONTEXTUAL NPC REACTION</div>'+
        '<div style="font-size:14px;margin:2px 0 4px">'+info.caseId.replace(/-/g," ")+'</div>'+
        '<div>'+String(r.kind||"").toUpperCase()+' · resident '+info.proof.residentId+' · '+(r.holdsPosition?"brief pause":"route continues")+'</div>'+
        '<div style="opacity:.78;margin-top:3px">SEED + fantasy time · addressed local event · cooldown '+state.telemetry.cooldownFantasyMinutes+' fantasy min</div>'+
        '<div style="opacity:.64;margin-top:2px">Verify: doorway + follow + workplace + harmless pass + cooldown = '+(verification.pass?"PASS":"FAIL")+'</div>';
      document.body.appendChild(card);
    """,info,state,verification)

records=[]
try:
    evidence_target=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(evidence_target)
    wait.until(lambda _d: ready())
    prime=prime_reusable_parent()
    try:
        wait.until(lambda _d: parent_prime_ready())
    except TimeoutException:
        raise RuntimeError("initial reusable local parent failed to activate: "+json.dumps(prime))
    checked=verify()
    if not checked["verification"].get("pass"):
        raise RuntimeError("ContextualReactions.verify failed: "+json.dumps(checked["verification"]))

    for idx,case_id in enumerate(CASES):
        info=prepare(case_id)
        if not info.get("ok"):
            raise RuntimeError("prepare failed: "+json.dumps(info))
        try:
            wait.until(lambda _d: visual_ready(info))
        except TimeoutException:
            raise RuntimeError("visual readiness timeout: "+json.dumps(resource_state(info)))
        time.sleep(.35)
        state=resource_state(info)
        add_overlay(info,state,checked["verification"])
        time.sleep(.15)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{case_id}.png"
        driver.save_screenshot(str(path))
        records.append({
            "profile":PROFILE,"caseId":case_id,"file":str(path),
            "proof":info["proof"],"state":state
        })

    browser_logs=driver.get_log("browser")
    severe=[x for x in browser_logs if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    if not all(r["state"].get("residentInView") and r["state"].get("bubbleVisible") and r["state"].get("reaction") for r in records):
        raise RuntimeError("one or more screenshots lacked an in-view resident reaction")
    result={"pass":True,"profile":PROFILE,"viewport":SIZE,"verification":checked["verification"],"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
