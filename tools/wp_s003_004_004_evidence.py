#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException
from screenshot_tool import set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-004-004"))
OUT.mkdir(parents=True,exist_ok=True)
SEED=os.environ.get("WP_S003_004_004_SEED","GROUND-BILLBOARD-EVIDENCE-004004")
VIEWS=[
    ("desktop-near-ground",1280,800,8),
    ("desktop-ground",1280,800,9),
    ("phone-landscape-ground",844,390,9),
    ("phone-portrait-ground",390,844,9),
]

options=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:
    options.add_argument(arg)
options.add_argument("--window-size=1280,800")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
wait=WebDriverWait(driver,300)

def js(script,*args):
    return driver.execute_script(script,*args)

def ready():
    try:
        return bool(js("return document.getElementById('planetStageRoot')?.dataset?.ready==='true' && window.PlanetStage?.snapshot?.()?.ready===true && !!window.StartingVillage;"))
    except Exception:
        return False

def reset_seed_and_focus():
    return js("""
      const seed=String(arguments[0]);
      const started=window.SeedSystem?.startNewCampaign?.(seed)||null;
      try{window.PlanetGeography?.persistSeed?.(seed)}catch(_){}
      const s=window.PlanetStage.snapshot(),active=s.activeSeed||seed,p=window.StartingVillage?.plan?.(active);
      const center=p?.center||{x:'0',y:'0'};
      window.PlanetStage.setWorldTileFocus(String(center.x),String(center.y));
      return {started,activeSeed:active,center:{x:String(center.x),y:String(center.y)},village:String(p?.name||'Starting Village')};
    """,SEED)

def compact_state():
    return js("""
      const s=window.PlanetStage.snapshot(),rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{},np=s.npcPresentation||{},pp=s.projection?.presentation||{};
      const targets=(window.PlanetStage.inspectionTargets?.()||[]).filter(x=>x.type==='npc');
      return {
        ready:Boolean(s.ready),activeSeed:s.activeSeed,scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.displayScaleLabel||s.zoom?.scaleLabel||null,
        requestedBand:s.zoom?.requestedBand||null,visibleBand:s.zoom?.band||null,
        requestedLevel:s.zoom?.requestedLevel||rb.requestedLevel||rb.requestedLevelId||null,visibleLevel:s.zoom?.visibleLevel||rb.visibleLevel||ls.level||null,
        pending:Number(rb.pendingPreparationCount||0),standIn:Boolean(rb.standInActive),tangentPatchActive:Boolean(s.projection?.tangentPatchActive),
        revealTier:ls.revealTier||null,localStaticActive:Boolean(ls.active),buildingCount:Number(ls.buildingCount||0),
        billboardLayerActive:Boolean(np.billboardLayerActive),detailedBillboardCount:Number(np.detailedBillboardCount||0),residentBillboardCount:Number(np.residentBillboardCount||0),
        protagonistBillboardVisible:Boolean(np.protagonistBillboardVisible),groundRepresentationReady:Boolean(np.groundRepresentationReady),
        billboardTextureUrls:Array.isArray(np.billboardTextureUrls)?np.billboardTextureUrls:[],cameraPresentation:np.cameraPresentation||null,
        cameraPoseInvariant:s.zoom?.pose?.cameraPoseInvariant!==false,cameraPitchDegrees:Number(pp.cameraPitchDegrees||0),zoomTransform:s.zoom?.pose?.zoomTransform||pp.zoomTransform||null,
        residentTargets:targets.slice(0,8).map(t=>({id:String(t.id),bounds:t.bounds||null})),
        navigation:{longTask50Count:Number(s.navigationPerformance?.longTask50Count||0),longTaskWorstMs:Number(s.navigationPerformance?.longTaskWorstMs||0),framePhaseMaxMs:s.navigationPerformance?.framePhaseMaxMs||{}},
        npcPresentation:np
      };
    """)

def set_scale(index):
    js("window.PlanetStage.setScaleIndex(arguments[0]);",int(index))
    wait.until(lambda _d:int(compact_state()["scaleIndex"])==int(index))
    if index==9:
        wait.until(lambda _d: compact_state()["visibleLevel"]=="ground" and compact_state()["pending"]==0 and compact_state()["tangentPatchActive"])
        wait.until(lambda _d: compact_state()["groundRepresentationReady"] and compact_state()["protagonistBillboardVisible"] and compact_state()["residentBillboardCount"]>=1 and compact_state()["detailedBillboardCount"]>=2)
    else:
        wait.until(lambda _d: compact_state()["pending"]==0 and compact_state()["visibleLevel"]!="ground")
        wait.until(lambda _d: compact_state()["detailedBillboardCount"]==0 and not compact_state()["billboardLayerActive"] and not compact_state()["protagonistBillboardVisible"])
    time.sleep(.45)
    return compact_state()

def add_overlay(label,state):
    js("""
      const label=arguments[0],s=arguments[1];
      document.getElementById('wp-s003-004-004-evidence-card')?.remove();
      const card=document.createElement('aside');card.id='wp-s003-004-004-evidence-card';
      Object.assign(card.style,{position:'fixed',left:'8px',top:'8px',zIndex:'99999',width:'min(310px,calc(100vw - 16px))',padding:'8px 10px',borderRadius:'9px',background:'rgba(8,12,17,.86)',color:'#f3ead0',border:'1px solid rgba(224,190,116,.62)',font:'600 10px/1.32 system-ui,sans-serif',pointerEvents:'none'});
      const textures=(s.billboardTextureUrls||[]).map(x=>String(x).split('/').pop()).join(', ');
      card.innerHTML='<div style="font-size:9px;letter-spacing:.1em;color:#e3bf73">WP-S003-004-004 · GROUND CHARACTER ART</div>'+
        '<div style="font-size:13px;margin:2px 0">'+label.replaceAll('-',' ')+'</div>'+
        '<div>'+String(s.scaleLabel||'')+' · visible LOD '+String(s.visibleLevel||'')+' · '+String(s.revealTier||'')+'</div>'+
        '<div>Detailed billboards '+s.detailedBillboardCount+' · protagonist '+(s.protagonistBillboardVisible?'YES':'NO')+' · residents '+s.residentBillboardCount+'</div>'+
        '<div style="opacity:.70;margin-top:2px">'+(textures||'no detailed character textures')+'</div>'+
        '<div style="opacity:.58">camera '+String(s.cameraPresentation||'')+' · pure zoom pose invariant '+String(s.cameraPoseInvariant)+'</div>';
      document.body.appendChild(card);
    """,label,state)

def validate(label,index,state):
    if not state["ready"]:
        raise RuntimeError(label+" stage not ready")
    if index==8:
        if state["visibleLevel"]=="ground" or state["detailedBillboardCount"]!=0 or state["billboardLayerActive"] or state["protagonistBillboardVisible"]:
            raise RuntimeError(label+" leaked detailed character art outside final ground: "+json.dumps(state))
    if index==9:
        if state["visibleLevel"]!="ground" or state["revealTier"]!="full" or not state["groundRepresentationReady"]:
            raise RuntimeError(label+" did not reach ready ground representation: "+json.dumps(state))
        if state["detailedBillboardCount"]<2 or state["residentBillboardCount"]<1 or not state["protagonistBillboardVisible"]:
            raise RuntimeError(label+" missing protagonist/resident detailed billboards: "+json.dumps(state))
        urls=state["billboardTextureUrls"]
        if "assets/characters/protagonist_male.png" not in urls or not any("npc_" in str(u) for u in urls):
            raise RuntimeError(label+" did not use required character PNG assets: "+json.dumps(urls))
    if not state["cameraPoseInvariant"] or abs(float(state["cameraPitchDegrees"]))>0.001:
        raise RuntimeError(label+" violated README pure-zoom camera invariant: "+json.dumps(state))

records=[]
try:
    target=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(target)
    wait.until(lambda _d: ready())
    reset_seed_and_focus()
    driver.refresh();wait.until(lambda _d: ready())
    prime=js("""const s=PlanetStage.snapshot(),p=StartingVillage.plan(s.activeSeed),c=p?.center||{x:'0',y:'0'};PlanetStage.setWorldTileFocus(String(c.x),String(c.y));return {activeSeed:s.activeSeed,center:{x:String(c.x),y:String(c.y)},village:p?.name||'Starting Village'};""")
    for label,width,height,index in VIEWS:
        set_exact_viewport(driver,width,height)
        time.sleep(.18)
        state=set_scale(index)
        validate(label,index,state)
        add_overlay(label,state)
        time.sleep(.12)
        path=OUT/f"{label}.png"
        driver.save_screenshot(str(path))
        records.append({"label":label,"viewport":[width,height],"scaleIndex":index,"file":str(path),"state":state})
    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-12:]))
    result={"pass":True,"wp":"WP-S003-004-004","classification":"MIXED","seed":prime.get("activeSeed"),"center":prime.get("center"),"village":prime.get("village"),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
