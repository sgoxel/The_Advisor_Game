#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s007-012"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
TYPES=["damaged-building","road-blockage","abandoned-workplace"]
SCALE_INDEX=16
EXPECTED_SCALE_LABEL="1/5000"
START="9999-03-02 09:00:00"
RECOVERED_AT="9999-03-02 16:00:00"

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-webgl")
options.add_argument("--ignore-gpu-blocklist")
options.add_argument("--use-angle=swiftshader")
options.add_argument("--disable-background-timer-throttling")
options.add_argument("--disable-backgrounding-occluded-windows")
options.add_argument("--disable-renderer-backgrounding")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const s=window.PlanetStage?.snapshot?.(),root=document.getElementById("planetStageRoot");
          // PlanetStage marks its authoritative first-playable snapshot ready before a final
          // paint-only rAF and DOM data-ready decoration. Headless Chromium may throttle that
          // paint indefinitely, so evidence must gate on the actual playable stage state plus
          // the real canvas/dependencies, not on the later decoration flag.
          return Boolean(s?.ready && root && document.getElementById("planetCanvas") &&
            window.PersistentConsequences && window.WorldState && window.CampaignPersistence &&
            window.CatchUpSimulation && window.EventScheduler && window.GameTime);
        """)
    except Exception:
        return False

def bind_evidence_campaign():
    return driver.execute_script("""
      const stageSeed=String(PlanetStage.snapshot().activeSeed||"");
      if(!stageSeed)throw new Error("planet stage active SEED unavailable");
      let campaign=SeedSystem.getCampaign();
      if(!campaign||String(campaign.seed)!==stageSeed){
        const started=SeedSystem.startNewCampaign(stageSeed);
        if(!started?.ok)throw new Error("unable to start evidence campaign: "+JSON.stringify(started));
        campaign=started.campaign;
      }
      const world=WorldState.bindCampaign(campaign,{reset:true});
      EventScheduler.reset(campaign.seed);
      const now=GameTime.getTimestampKey();
      const catchup=CatchUpSimulation.bindCampaign(campaign,{reset:true,timestamp:now});
      if(!world?.ok||!catchup?.ok)throw new Error("unable to bind authoritative evidence state: "+JSON.stringify({world,catchup}));
      return {seed:campaign.seed,stageSeed,seedMatch:String(campaign.seed)===stageSeed,now,world,catchup};
    """)

def set_case(kind):
    return driver.execute_script("""
      const type=arguments[0],stamp=arguments[1],seed=PlanetStage.snapshot().activeSeed;
      const result=PersistentConsequences.proofSetOnly(seed,type,stamp);
      if(!result?.ok)throw new Error("consequence proof activation failed: "+JSON.stringify(result));
      const record=result.record,anchor=record.target.anchor;
      PlanetStage.setWorldTileFocus(anchor.x,anchor.y);
      PlanetStage.setScaleIndex(arguments[2]);
      PersistentConsequences.renderPanel(seed);
      return {seed,result};
    """,kind,START,SCALE_INDEX)

def current_state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),seed=s.activeSeed,c=PersistentConsequences.snapshot(seed);
      const panel=document.getElementById("persistentWorldConsequence");
      const rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{};
      const signatureReady=(!rb.requestedSignature)||Boolean(rb.standInActive)||(rb.activeSignature&&rb.activeSignature===rb.requestedSignature);
      return {
        stageReady:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        focus:s.canonicalFocus?.worldTile||null,localStatic:ls,resourceBudget:rb,signatureReady:Boolean(signatureReady),
        consequence:c,panelVisible:Boolean(panel&&!panel.hidden),panelText:String(panel?.innerText||""),
        panelActiveCount:Number(panel?.dataset?.activeCount||0)
      };
    """)

def restore_roundtrip():
    return driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const s=PlanetStage.snapshot(),seed=s.activeSeed,campaign=SeedSystem.getCampaign();
        const before=PersistentConsequences.snapshot(seed);
        const save=CampaignPersistence.createSave({campaign,persist:false,capturedRealMs:0});
        const validated=save?.ok?CampaignPersistence.validate(save.save):{ok:false,reason:save?.reason||"save-create-failed"};
        if(!save?.ok||!validated?.ok){done({ok:false,reason:"save-or-validation-failed",save,validated});return;}
        const restored=await CampaignPersistence.restoreAndResume(save.save,{
          targetTimestamp:GameTime.getTimestampKey(),
          maxBatches:8,maxSlices:256,priority:"current",capturedRealMs:0
        });
        PersistentConsequences.renderPanel(seed);
        const after=PersistentConsequences.snapshot(seed);
        done({
          ok:Boolean(restored?.ok&&restored?.authoritativeReady),
          restored,save:{ok:Boolean(save?.ok),validated:Boolean(validated?.ok),serializedBytes:Number(save?.save?.serializedBytes||0),deltaEntryCount:Object.keys(save?.save?.campaignStateDelta?.entries||{}).length},
          before:{recordCount:before.recordCount,activeCount:before.activeCount,signature:before.sourceCurrentSignature,deltaRevision:before.sourceDeltaRevision},
          after:{recordCount:after.recordCount,activeCount:after.activeCount,signature:after.sourceCurrentSignature,deltaRevision:after.sourceDeltaRevision}
        });
      })().catch(error=>done({ok:false,error:String(error)}));
    """)

def travel_roundtrip(anchor):
    away=driver.execute_script("""
      const a=arguments[0],scale=arguments[1];
      const x=String(BigInt(a.x)+240n),y=String(BigInt(a.y)+180n);
      PlanetStage.setWorldTileFocus(x,y);PlanetStage.setScaleIndex(scale);
      return {x,y};
    """,anchor,SCALE_INDEX)
    time.sleep(.55)
    driver.execute_script("""
      const a=arguments[0],scale=arguments[1];
      PlanetStage.setWorldTileFocus(a.x,a.y);PlanetStage.setScaleIndex(scale);
    """,anchor,SCALE_INDEX)
    try:
        wait.until(lambda _d: current_state()["signatureReady"] and current_state()["consequence"]["activeCount"]==1)
    except TimeoutException:
        raise RuntimeError("consequence leave/re-enter roundtrip failed: "+json.dumps({"away":away,"state":current_state()}))
    return {"away":away,"returned":current_state()["focus"],"activeAfterReturn":current_state()["consequence"]["activeCount"]}

def recover():
    return driver.execute_script("""
      const seed=PlanetStage.snapshot().activeSeed;
      const result=PersistentConsequences.advance(seed,arguments[0]);
      PersistentConsequences.renderPanel(seed);
      return result;
    """,RECOVERED_AT)

records=[]
try:
    driver.get(TARGET)
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        raise RuntimeError("startup timeout: "+json.dumps(driver.execute_script("return {ready:window.PlanetStage?.snapshot?.()?.ready||false,domReady:document.getElementById(\'planetStageRoot\')?.dataset?.ready||null,canvas:Boolean(document.getElementById(\'planetCanvas\')),deps:{pc:Boolean(window.PersistentConsequences),ws:Boolean(window.WorldState),save:Boolean(window.CampaignPersistence),catchup:Boolean(window.CatchUpSimulation),scheduler:Boolean(window.EventScheduler),time:Boolean(window.GameTime)},error:window.PlanetStage?.snapshot?.()?.startupError||null,body:String(document.body?.innerText||\'\').slice(0,900)}")))
    campaign_binding=bind_evidence_campaign()

    persistence=None
    for idx,kind in enumerate(TYPES):
        activation=set_case(kind)
        try:
            wait.until(lambda _d: (
                current_state()["panelVisible"] and current_state()["scaleIndex"]==SCALE_INDEX and current_state()["scaleLabel"]==EXPECTED_SCALE_LABEL and
                current_state()["signatureReady"] and bool(current_state()["localStatic"].get("active")) and
                int(current_state()["localStatic"].get("buildingCount",0))>0 and
                int(current_state()["localStatic"].get("persistentConsequenceProjectedActiveCount",0))==1 and
                int(current_state()["localStatic"].get("persistentConsequenceWorldCueCount",0))>0
            ))
        except TimeoutException:
            raise RuntimeError("consequence presentation timeout "+kind+": "+json.dumps(current_state()))
        time.sleep(.45)
        st=current_state()
        cs=st["consequence"]
        if cs["recordCount"]!=1 or cs["activeCount"]!=1:
            raise RuntimeError("single active consequence contract failed: "+json.dumps(st))
        if cs.get("registryKind")!="consequence-registry" or cs["fullWorldScan"] or cs["fullSettlementPerFrameScan"] or cs["perFrameScan"] or not cs["lazyLocal"]:
            raise RuntimeError("bounded consequence architecture regression: "+json.dumps(st))
        if int(st["localStatic"].get("persistentConsequenceProjectedActiveCount",0))!=1 or int(st["localStatic"].get("persistentConsequenceWorldCueCount",0))<1:
            raise RuntimeError("local consequence world projection missing: "+json.dumps(st))
        if kind.split("-")[0].upper() not in st["panelText"].upper():
            raise RuntimeError("consequence panel text mismatch: "+json.dumps(st))
        if idx==0:
            persistence=restore_roundtrip()
            if (not persistence.get("ok") or not persistence["save"].get("ok") or not persistence["save"].get("validated") or
                not persistence.get("restored",{}).get("authoritativeReady") or persistence["save"].get("deltaEntryCount")!=1 or
                persistence["before"]["signature"]!=persistence["after"]["signature"] or persistence["after"]["activeCount"]!=1):
                raise RuntimeError("consequence persistence roundtrip failed: "+json.dumps(persistence))
            persistence["travel"]=travel_roundtrip((st["consequence"]["records"][0]["target"]["anchor"]))
            st=current_state()
        path=OUT/f"{PROFILE}-{idx+1:02d}-{kind}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"type":kind,"file":str(path),"activation":activation,"state":st})

    # Recovery presentation: return to the damaged building and advance authoritative fantasy time.
    activation=set_case("damaged-building")
    recovered=recover()
    wait.until(lambda _d: current_state()["consequence"]["recoveredCount"]==1 and current_state()["panelVisible"] and
               int(current_state()["localStatic"].get("persistentConsequenceWorldCueCount",0))==0)
    time.sleep(.45)
    st=current_state()
    if recovered["activeCount"]!=0 or recovered["recoveredCount"]!=1 or "RECOVERED" not in st["panelText"].upper():
        raise RuntimeError("recovery projection failed: "+json.dumps({"recovered":recovered,"state":st}))
    path=OUT/f"{PROFILE}-04-recovered-building.png"
    driver.save_screenshot(str(path))
    records.append({"profile":PROFILE,"type":"recovered-building","file":str(path),"activation":activation,"state":st})

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    result={
        "pass":True,"wp":"WP-S007-012","classification":"MIXED","profile":PROFILE,"viewport":SIZE,"targetScaleIndex":SCALE_INDEX,"targetScaleLabel":EXPECTED_SCALE_LABEL,
        "types":TYPES,"campaignBinding":campaign_binding,"persistence":persistence,"recoveredAt":RECOVERED_AT,"records":records
    }
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
