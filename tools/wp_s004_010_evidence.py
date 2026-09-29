#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-010"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
CLASSES=("village","town","city")
WHEN={"year":1201,"month":2,"day":1,"hour":12,"minute":15,"second":0}

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,150)

def ready():
    try:
        return driver.execute_script("""
          return !!(window.PlanetStage&&PlanetStage.snapshot().ready&&window.CrowdPresentation&&
            window.SettlementArchetypes&&window.StartingVillage&&window.PoliticalGeography&&
            window.ResidentMovement&&window.DailyActivity);
        """)
    except Exception:
        return False

def initialize():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),seed=s.activeSeed;
      const reps={...CrowdPresentation.representativePlans(seed)};
      const country=PoliticalGeography.countryAt(seed,"0","0");
      const start=(SettlementArchetypes.settlementsForCountry(seed,country,4)||[])
        .find(p=>p.role==="starting-village"&&p.classId==="village")||null;
      if(start)reps.village=start;
      const plans={};
      for(const cls of ["village","town","city"]){
        const p=reps[cls];plans[cls]=p?{
          id:String(p.id),name:String(p.name||p.id),classId:String(p.classId),
          role:String(p.role||""),center:{x:String(p.center.x),y:String(p.center.y)},
          population:p.population||null
        }:null;
      }
      return {seed,plans,verify:CrowdPresentation.verify(seed)};
    """)

def set_focus(plan):
    return driver.execute_script("""
      const p=arguments[0],when=arguments[1];
      PlanetStage.applyAuthoritativeFantasyTime(when,"WP-S004-010 evidence "+p.classId);
      PlanetStage.setWorldTileFocus(p.center.x,p.center.y);
      PlanetStage.setScaleIndex(9);
      return PlanetStage.snapshot().zoom;
    """,plan,WHEN)

def compact_state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),cp=s.crowdPresentation||{},np=s.npcPresentation||{},
            rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{},ins=s.inspection||{},
            nav=s.navigationPerformance||{};
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        tier:ls.revealTier||null,localStaticActive:Boolean(ls.active),
        requestedSignature:rb.requestedSignature||null,activeSignature:rb.activeSignature||null,
        pendingPreparationCount:Number(rb.pendingPreparationCount||0),standInActive:Boolean(rb.standInActive),
        focus:s.canonicalFocus?.worldTile||null,
        crowd:{
          active:Boolean(cp.active),generatedCount:Number(cp.generatedCount||0),visibleCount:Number(cp.visibleCount||0),
          entityCount:Number(cp.entityCount||0),drawCallEstimate:Number(cp.drawCallEstimate||0),
          buildTimeMs:Number(cp.buildTimeMs||0),settlementId:cp.settlementId||null,
          settlementName:cp.settlementName||null,settlementClass:cp.settlementClass||null,
          districtBand:cp.districtBand||null,districtFactor:Number(cp.districtFactor||0),
          population:Number(cp.population||0),populationSource:cp.populationSource||null,
          rhythmBand:cp.rhythmBand||null,activityFactor:Number(cp.activityFactor||0),
          cap:Number(cp.cap||0),candidateChecks:Number(cp.candidateChecks||0),
          exactPersistentNpcCount:Number(cp.exactPersistentNpcCount||0),visibleExactNpcCount:Number(cp.visibleExactNpcCount||0),
          mobile:Boolean(cp.mobile),pooledStableIds:Boolean(cp.pooledStableIds),localCulling:Boolean(cp.localCulling),
          lowFrequencyMotion:Boolean(cp.lowFrequencyMotion),presentationOnly:Boolean(cp.presentationOnly),
          simulationAuthority:Boolean(cp.simulationAuthority),persistentIdentity:Boolean(cp.persistentIdentity),
          selectable:Boolean(cp.selectable),collision:Boolean(cp.collision),inspectionRegistered:Boolean(cp.inspectionRegistered),
          exactNpcReplacement:Boolean(cp.exactNpcReplacement),bounded:Boolean(cp.bounded),
          fullSettlementPerFrameScan:Boolean(cp.fullSettlementPerFrameScan),globalScan:Boolean(cp.globalScan),
          actorCount:(cp.actors||[]).length
        },
        exact:{
          visibleCount:Number(np.activeCount||0),entityCount:Number(np.entityCount||0),
          selectableInspectionCount:Number(ins.activeNpcCount||0),presentationOnly:Boolean(np.presentationOnly),
          simulationAuthority:Boolean(np.simulationAuthority)
        },
        performance:{
          frameUpdateMs:Number(nav.lastFrameUpdateMs||0),maxFrameUpdateMs:Number(nav.maxFrameUpdateMs||0),
          renderCpuMs:Number(nav.lastRenderCpuMs||0),maxRenderCpuMs:Number(nav.maxRenderCpuMs||0),
          longTask50Count:Number(nav.longTask50Count||0)
        }
      };
    """)

def focus_ready(cls):
    st=compact_state()
    sig_ok=(not st["requestedSignature"]) or (
        st["activeSignature"] and str(st["activeSignature"])==str(st["requestedSignature"])
    ) or st["standInActive"]
    c=st["crowd"]
    return (
      st["ready"] and st["scaleIndex"]==9 and st["tier"]=="full" and sig_ok and
      c["active"] and c["settlementClass"]==cls and c["visibleCount"]>0
    )

def overlay(cls,state):
    driver.execute_script("""
      const cls=arguments[0],s=arguments[1],c=s.crowd||{},e=s.exact||{};
      document.getElementById("wp-s004-010-evidence-card")?.remove();
      const card=document.createElement("div");card.id="wp-s004-010-evidence-card";
      Object.assign(card.style,{
        position:"fixed",left:"10px",top:"10px",zIndex:"99999",
        width:"min(330px,calc(100vw - 20px))",padding:"9px 11px",borderRadius:"10px",
        background:"rgba(7,12,18,.88)",color:"#f4f0df",border:"1px solid rgba(232,202,128,.68)",
        boxShadow:"0 6px 18px rgba(0,0,0,.32)",font:"600 10px/1.34 system-ui,sans-serif",pointerEvents:"none"
      });
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S004-010 · LOCAL CROWD DENSITY</div>'+
        '<div style="font-size:15px;margin:2px 0 4px">'+cls.toUpperCase()+' · '+String(c.settlementName||"")+'</div>'+
        '<div>Population '+Number(c.population||0).toLocaleString()+' · '+String(c.districtBand||"")+' district · '+String(c.rhythmBand||"")+'</div>'+
        '<div style="margin-top:3px">Anonymous crowd '+Number(c.visibleCount||0)+' / '+Number(c.generatedCount||0)+' · cap '+Number(c.cap||0)+'</div>'+
        '<div>Persistent NPC simulation '+Number(c.exactPersistentNpcCount||0)+' · exact visible '+Number(e.visibleCount||0)+' · selectable '+Number(e.selectableInspectionCount||0)+'</div>'+
        '<div style="opacity:.64;margin-top:2px">crowd: presentation-only · non-selectable · no collision · '+Number(c.drawCallEstimate||0)+' draw calls · '+Number(c.buildTimeMs||0).toFixed(2)+' ms</div>';
      document.body.appendChild(card);
    """,cls,state)

records=[]
try:
    url=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(url)
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        probe=driver.execute_script("""
          return {readyState:document.readyState,planet:typeof PlanetStage,
            planetReady:window.PlanetStage?Boolean(PlanetStage.snapshot().ready):null,
            startupError:window.PlanetStage?PlanetStage.snapshot().startupError:null,
            crowd:typeof CrowdPresentation,body:String(document.body?.innerText||"").slice(0,900)};
        """)
        raise RuntimeError("startup readiness timeout: "+json.dumps({"probe":probe,"browser":driver.get_log("browser")[-20:]}))

    base=initialize()
    if not base["verify"].get("pass"):
        raise RuntimeError("CrowdPresentation.verify failed: "+json.dumps(base["verify"]))
    for cls in CLASSES:
        if not base["plans"].get(cls):
            raise RuntimeError("missing representative "+cls+": "+json.dumps(base["plans"]))

    for idx,cls in enumerate(CLASSES):
        plan=base["plans"][cls]
        set_focus(plan)
        try:
            wait.until(lambda _d, wanted=cls: focus_ready(wanted))
        except TimeoutException:
            raise RuntimeError("focus readiness timeout "+cls+": "+json.dumps(compact_state()))
        time.sleep(.55)
        state=compact_state()
        c=state["crowd"];e=state["exact"]
        if c["districtBand"]!="core":
            raise RuntimeError("center must resolve core district: "+json.dumps(state))
        if c["exactPersistentNpcCount"]!=12:
            raise RuntimeError("persistent exact NPC count changed: "+json.dumps(state))
        if c["inspectionRegistered"] or c["selectable"] or c["persistentIdentity"] or c["collision"] or c["simulationAuthority"] or c["exactNpcReplacement"]:
            raise RuntimeError("crowd authority isolation failed: "+json.dumps(state))
        if not c["presentationOnly"] or not c["bounded"] or c["fullSettlementPerFrameScan"] or c["globalScan"]:
            raise RuntimeError("crowd bounded presentation contract failed: "+json.dumps(state))
        if c["candidateChecks"]>192:
            raise RuntimeError("candidate budget exceeded: "+json.dumps(state))
        if PROFILE=="portrait" and c["visibleCount"]>20:
            raise RuntimeError("mobile visible crowd cap exceeded: "+json.dumps(state))
        if c["buildTimeMs"]>=50:
            raise RuntimeError("crowd build exceeded 50 ms gate: "+json.dumps(state))
        if e["selectableInspectionCount"]!=e["visibleCount"]:
            raise RuntimeError("only exact visible NPCs may be selectable: "+json.dumps(state))
        overlay(cls,state)
        time.sleep(.20)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{cls}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"class":cls,"plan":plan,"file":str(path),"state":state})

    visible=[r["state"]["crowd"]["visibleCount"] for r in records]
    generated=[r["state"]["crowd"]["generatedCount"] for r in records]
    if not (visible[0]<visible[1]<visible[2]):
        raise RuntimeError("visible density must scale village < town < city: "+json.dumps(visible))
    if not (generated[0]<generated[1]<generated[2]):
        raise RuntimeError("generated density must scale village < town < city: "+json.dumps(generated))

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))

    result={"pass":True,"profile":PROFILE,"viewport":SIZE,"seed":base["seed"],
            "verification":base["verify"],"counts":{"generated":generated,"visible":visible},"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
