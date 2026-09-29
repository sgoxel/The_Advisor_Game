#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/tools/wp_s004_010_local_evidence.html")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s004-010"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
CLASSES=("village","town","city")
EVIDENCE_SEED="WP-S004-010-EVIDENCE"

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-unsafe-swiftshader")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_window_size(*SIZE)
driver.set_script_timeout(180)
wait=WebDriverWait(driver,180)

def ready():
    try:
        return driver.execute_script("""
          const startup=window.AppUI?.applicationStartupSnapshot?.();
          const renderer=window.GameRenderer?.snapshot?.();
          return !!(
            window.AppUI&&window.CrowdPresentation&&window.SettlementArchetypes&&window.Camera&&
            window.ResidentMovement&&window.SeedSystem&&window.GameTime&&
            startup?.state==="ready"&&renderer?.ready
          );
        """)
    except Exception:
        return False

def startup_probe():
    return driver.execute_script("""
      return {
        href:location.href,readyState:document.readyState,
        appUI:typeof window.AppUI,renderer:typeof window.GameRenderer,
        rendererReady:Boolean(window.GameRenderer?.snapshot?.().ready),
        startup:window.AppUI?.applicationStartupSnapshot?.()||null,
        crowd:typeof window.CrowdPresentation,settlement:typeof window.SettlementArchetypes,
        camera:typeof window.Camera,residentMovement:typeof window.ResidentMovement,
        bodyText:String(document.body?.innerText||"").slice(0,1200)
      };
    """)

def start_campaign():
    result=driver.execute_async_script("""
      const seed=arguments[0],done=arguments[arguments.length-1];
      (async()=>{
        try{
          await AppUI.startNewCampaignForEvidence(seed);
          const campaign=SeedSystem.getCampaign(),renderer=GameRenderer.snapshot();
          done({
            ok:Boolean(campaign?.seed&&renderer?.ready&&renderer?.regionKey),
            campaign,regionKey:renderer?.regionKey||null,
            scene:AppUI.sceneLoadingSnapshot?.()||null,
            startup:AppUI.applicationStartupSnapshot?.()||null
          });
        }catch(error){done({ok:false,error:String(error?.stack||error)})}
      })();
    """,EVIDENCE_SEED)
    if not result or not result.get("ok"):
        raise RuntimeError("campaign startup failed: "+json.dumps(result))
    return result

def initialize():
    return driver.execute_script("""
      const campaign=SeedSystem.getCampaign(),seed=campaign?.seed||"";
      const verification=CrowdPresentation.verify(seed);
      const plans=CrowdPresentation.representativePlans(seed);
      return {
        seed,verification,
        plans:Object.fromEntries(["village","town","city"].map(k=>[k,plans[k]?{
          id:plans[k].id,name:plans[k].name,classId:plans[k].classId,
          center:plans[k].center,population:plans[k].population
        }:null]))
      };
    """)

def navigate(plan):
    return driver.execute_async_script("""
      const plan=arguments[0],done=arguments[arguments.length-1];
      (async()=>{
        try{
          Camera.setZoom(1);
          await AppUI.navigateCameraToForEvidence(String(plan.center.x),String(plan.center.y),true);
          await AppUI.refreshResidentCharacters();
          const r=GameRenderer.snapshot();
          done({
            ok:Boolean(r?.ready&&r?.regionKey),
            camera:Camera.getCenter(),zoom:Camera.getZoom(),
            regionKey:r?.regionKey||null,runtime:AppUI.runtimeAreaLoadingSnapshot?.()||null
          });
        }catch(error){done({ok:false,error:String(error?.stack||error)})}
      })();
    """,plan)

def state():
    return driver.execute_script("""
      const crowd=CrowdPresentation.last()||{},npc=AppUI.npcVisibilitySnapshot()||{};
      const r=GameRenderer.snapshot(),cp=r.characterPresentation||{};
      const crowdInstances=(cp.instances||[]).filter(x=>x.role==="crowd");
      return {
        crowd:{
          active:Boolean(crowd.active),settlementId:crowd.settlementId,settlementName:crowd.settlementName,
          settlementClass:crowd.settlementClass,population:Number(crowd.population||0),
          populationSource:crowd.populationSource,rhythmBand:crowd.rhythmBand,
          activityFactor:Number(crowd.activityFactor||0),requestedCount:Number(crowd.requestedCount||0),
          activeCount:Number(crowd.activeCount||0),cap:Number(crowd.cap||0),
          candidateChecks:Number(crowd.candidateChecks||0),updateMs:Number(crowd.updateMs||0),
          resolveMs:Number(crowd.resolveMs||0),totalUpdateMs:Number(crowd.totalUpdateMs||crowd.updateMs||0),
          presentationOnly:Boolean(crowd.presentationOnly),simulationAuthority:Boolean(crowd.simulationAuthority),
          persistentIdentity:Boolean(crowd.persistentIdentity),selectable:Boolean(crowd.selectable),
          collision:Boolean(crowd.collision),exactNpcReplacement:Boolean(crowd.exactNpcReplacement),
          fullSettlementPerFrameScan:Boolean(crowd.fullSettlementPerFrameScan),globalScan:Boolean(crowd.globalScan)
        },
        npc:{
          exactSimulatedResidentCount:Number(npc.exactSimulatedResidentCount||0),
          visibleExactCount:(npc.visibleResidentIds||[]).length,
          visibleCrowdCount:(npc.visibleCrowdIds||[]).length,
          hiddenCrowdCount:(npc.hiddenCrowdIds||[]).length
        },
        renderer:{
          activeCharacterCount:Number(cp.activeCharacterCount||0),
          activeExactResidentCount:Number(cp.activeExactResidentCount||0),
          activeCrowdCount:Number(cp.activeCrowdCount||0),
          simulatedCharacterCount:Number(cp.simulatedCharacterCount||0),
          crowdInstanceCount:crowdInstances.length,
          crowdNonInteractive:crowdInstances.every(x=>x.presentationOnly===true&&x.selectable===false&&x.persistentIdentity===false),
          crowdPixelHeights:crowdInstances.map(x=>Number(x.renderedPixelHeight||0)),
          sharedTextureCount:Number(cp.sharedTextureCount||0),sharedMaterialCount:Number(cp.sharedMaterialCount||0),
          frameMs:Number(r.performance?.frameMs||0),drawCalls:Number(r.performance?.drawCalls||0)
        },
        inspection:r.inspection||null,camera:Camera.getCenter(),zoom:Number(Camera.getZoom()),
        regionKey:r.regionKey||null,runtime:AppUI.runtimeAreaLoadingSnapshot?.()||null
      };
    """)

def add_overlay(cls,s):
    driver.execute_script("""
      const cls=arguments[0],s=arguments[1];
      document.getElementById("wp-s004-010-evidence-card")?.remove();
      const c=s.crowd||{},n=s.npc||{},r=s.renderer||{};
      const card=document.createElement("div");card.id="wp-s004-010-evidence-card";
      Object.assign(card.style,{
        position:"fixed",left:"10px",top:"10px",zIndex:"99999",
        width:"min(338px,calc(100vw - 20px))",padding:"9px 11px",borderRadius:"10px",
        background:"rgba(7,12,18,.88)",color:"#f4f0df",border:"1px solid rgba(232,202,128,.68)",
        boxShadow:"0 6px 18px rgba(0,0,0,.32)",font:"600 10px/1.34 system-ui,sans-serif",pointerEvents:"none"
      });
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S004-010 · DENSITY-SCALED LOCAL CROWD</div>'+
        '<div style="font-size:15px;margin:2px 0 4px">'+cls.toUpperCase()+' · '+String(c.settlementName||"")+'</div>'+
        '<div>Population '+Number(c.population||0).toLocaleString()+' · '+String(c.rhythmBand||"")+' · activity '+Math.round(Number(c.activityFactor||0)*100)+'%</div>'+
        '<div style="margin-top:3px">Exact simulation '+Number(n.exactSimulatedResidentCount||0)+' · exact visible '+Number(n.visibleExactCount||0)+' · crowd visible '+Number(n.visibleCrowdCount||0)+' / '+Number(c.activeCount||0)+'</div>'+
        '<div style="opacity:.72;margin-top:2px">crowd cap '+Number(c.cap||0)+' · renderer crowd '+Number(r.activeCrowdCount||0)+' · update '+Number(c.totalUpdateMs||0).toFixed(2)+' ms</div>'+
        '<div style="opacity:.56;margin-top:2px">anonymous presentation only · non-selectable · no collision · no exact-NPC replacement</div>';
      document.body.appendChild(card);
    """,cls,s)

records=[]
try:
    url=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(url)
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        raise RuntimeError("local evidence shell startup timeout: "+json.dumps({
            "probe":startup_probe(),"browserLogs":driver.get_log("browser")[-30:]
        }))
    campaign=start_campaign()
    base=initialize()
    if not base["verification"].get("pass"):
        raise RuntimeError("CrowdPresentation.verify failed: "+json.dumps(base["verification"]))
    for cls in CLASSES:
        if not base["plans"].get(cls):
            raise RuntimeError("missing representative "+cls+": "+json.dumps(base["plans"]))

    for idx,cls in enumerate(CLASSES):
        plan=base["plans"][cls]
        nav=navigate(plan)
        if not nav.get("ok"):
            raise RuntimeError("navigation failed for "+cls+": "+json.dumps(nav))
        time.sleep(.55)
        s=state();c=s["crowd"];n=s["npc"];r=s["renderer"]
        if c.get("settlementClass")!=cls:
            raise RuntimeError("crowd resolved wrong settlement class: "+json.dumps({"expected":cls,"state":s}))
        if not c.get("active") or c.get("activeCount",0)<=0:
            raise RuntimeError("crowd inactive for "+cls+": "+json.dumps(s))
        if n.get("exactSimulatedResidentCount")!=12:
            raise RuntimeError("exact resident simulation count changed: "+json.dumps(s))
        if r.get("simulatedCharacterCount")!=13:
            raise RuntimeError("renderer simulated count should remain protagonist + 12 exact residents: "+json.dumps(s))
        if r.get("activeCrowdCount")!=n.get("visibleCrowdCount") or r.get("crowdInstanceCount")!=n.get("visibleCrowdCount"):
            raise RuntimeError("visible crowd telemetry mismatch: "+json.dumps(s))
        if not r.get("crowdNonInteractive"):
            raise RuntimeError("renderer crowd became interactive/persistent: "+json.dumps(s))
        if not c.get("presentationOnly") or c.get("simulationAuthority") or c.get("persistentIdentity") or c.get("selectable") or c.get("collision") or c.get("exactNpcReplacement"):
            raise RuntimeError("crowd authority isolation failed: "+json.dumps(s))
        if c.get("fullSettlementPerFrameScan") or c.get("globalScan"):
            raise RuntimeError("crowd scan budget isolation failed: "+json.dumps(s))
        if c.get("candidateChecks",9999)>192:
            raise RuntimeError("candidate budget exceeded: "+json.dumps(s))
        if PROFILE=="portrait" and c.get("activeCount",9999)>20:
            raise RuntimeError("mobile crowd cap exceeded: "+json.dumps(s))
        if c.get("totalUpdateMs",9999)>=50:
            raise RuntimeError("crowd update exceeded 50 ms gate: "+json.dumps(s))
        if s.get("inspection",{}).get("activeNpcCount")!=r.get("activeExactResidentCount"):
            raise RuntimeError("inspection registry included anonymous crowd: "+json.dumps(s))
        add_overlay(cls,s)
        time.sleep(.25)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{cls}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"class":cls,"plan":plan,"file":str(path),"state":s})

    generated=[r["state"]["crowd"]["activeCount"] for r in records]
    visible=[r["state"]["npc"]["visibleCrowdCount"] for r in records]
    if not (generated[0]<generated[1]<generated[2]):
        raise RuntimeError("generated density does not scale village < town < city: "+json.dumps(generated))
    if not (visible[0]<visible[1]<visible[2]):
        raise RuntimeError("visible density does not scale village < town < city: "+json.dumps(visible))

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-15:]))

    result={
      "pass":True,"profile":PROFILE,"viewport":SIZE,"seed":base["seed"],"campaign":campaign,
      "verification":base["verification"],"counts":{"generated":generated,"visible":visible},"records":records
    }
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
