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
EVIDENCE_TIME="1100-01-01 11:30:00"
VIEWS=[
    ("desktop-near-ground",1280,800,8,"overview"),
    ("desktop-ground",1280,800,9,"overview"),
    ("desktop-building-front",1280,800,9,"front"),
    ("desktop-building-behind",1280,800,9,"behind"),
    ("desktop-interior-cutaway",1280,800,9,"inside"),
    ("phone-landscape-ground",844,390,9,"overview"),
    ("phone-portrait-ground",390,844,9,"overview"),
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
        billboardTextureUrls:Array.isArray(np.billboardTextureUrls)?np.billboardTextureUrls:[],cameraPresentation:np.cameraPresentation||null,presentationScaleMultiplier:Number(np.presentationScaleMultiplier||1),activeResidentCount:Number(np.activeCount||0),
        tangentPresentationPitchDegrees:Number(np.tangentPresentationPitchDegrees||0),
        protagonistPosition:window.Protagonist?.getPosition?.()||window.SeedSystem?.getCampaign?.()?.protagonist||null,
        groundBuildingCutaway:s.groundBuildingCutaway||null,
        cameraPoseInvariant:s.zoom?.pose?.cameraPoseInvariant!==false,cameraPitchDegrees:Number(pp.cameraPitchDegrees||0),zoomTransform:s.zoom?.pose?.zoomTransform||pp.zoomTransform||null,
        residentTargetCount:targets.length,residentTargets:targets.slice(0,8).map(t=>({id:String(t.id),bounds:t.bounds||null})),
        navigation:{longTask50Count:Number(s.navigationPerformance?.longTask50Count||0),longTaskWorstMs:Number(s.navigationPerformance?.longTaskWorstMs||0),framePhaseMaxMs:s.navigationPerformance?.framePhaseMaxMs||{}},
        npcPresentation:np
      };
    """)

def proof_building_points():
    result=js("""
      const seed=window.PlanetStage?.snapshot?.()?.activeSeed;
      const interiors=seed&&window.BuildingInteriors?.build?.(seed)||[];
      const walk=(x,y)=>{try{const c=window.Walkability?.classify?.(seed,String(x),String(y));return Boolean(c?.walkable&&!c?.buildingId)}catch(_){return false}};
      for(const interior of interiors){
        const b=interior?.bounds,inside=interior?.interiorTarget;
        if(!b||!inside)continue;
        const cx=Math.floor((Number(b.minX)+Number(b.maxX))/2),cy=Math.floor((Number(b.minY)+Number(b.maxY))/2);
        const candidates=[
          {x:cx,y:Number(b.minY)-2,side:'south'},
          {x:cx,y:Number(b.maxY)+2,side:'north'},
          {x:Number(b.minX)-2,y:cy,side:'west'},
          {x:Number(b.maxX)+2,y:cy,side:'east'}
        ].filter(p=>walk(p.x,p.y));
        if(candidates.length<2)continue;
        candidates.sort((a,b)=>a.y-b.y||a.x-b.x);
        const behind=candidates[0],front=candidates[candidates.length-1];
        return {
          ok:true,buildingId:String(interior.id),label:String(interior.label||interior.id),
          bounds:b,
          inside:{x:String(inside.x),y:String(inside.y)},
          front:{x:String(front.x),y:String(front.y),side:front.side},
          behind:{x:String(behind.x),y:String(behind.y),side:behind.side}
        };
      }
      return {ok:false,reason:'no-enterable-building-with-two-outdoor-proof-points'};
    """)
    if not result or not result.get("ok"):
        raise RuntimeError("could not derive building depth/cutaway proof points: "+json.dumps(result))
    return result

def set_protagonist_position(point):
    result=js("""
      const p=arguments[0],campaign=window.SeedSystem?.getCampaign?.();
      if(!campaign||!p)return {ok:false,reason:'campaign-or-point-missing'};
      campaign.protagonist=window.WorldCoordinates.position(String(p.x),String(p.y));
      window.PlanetStage.setWorldTileFocus(String(p.x),String(p.y));
      return {ok:true,position:{x:String(campaign.protagonist.x),y:String(campaign.protagonist.y)}};
    """,point)
    if not result or not result.get("ok"):
        raise RuntimeError("could not set evidence campaign protagonist position: "+json.dumps(result))
    return result

def set_scale(index,require_level_settle=True):
    js("window.PlanetStage.setScaleIndex(arguments[0]);",int(index))
    wait.until(lambda _d:int(compact_state()["scaleIndex"])==int(index))
    if index==9:
        wait.until(lambda _d: compact_state()["visibleLevel"]=="ground" and compact_state()["pending"]==0 and compact_state()["tangentPatchActive"])
        wait.until(lambda _d: compact_state()["groundRepresentationReady"] and compact_state()["protagonistBillboardVisible"] and compact_state()["residentBillboardCount"]>=1 and compact_state()["detailedBillboardCount"]>=2)
    else:
        # Scale 8 is also used as a presentation reset before the building/phone
        # proof frames. A ready ground terrain resource may remain temporarily as
        # valid fallback coverage while the coarser child prepares; the WP rule
        # here is that detailed character art must turn off immediately. Captured
        # near-ground evidence still requests a fully settled non-ground resource.
        wait.until(lambda _d: compact_state()["detailedBillboardCount"]==0 and not compact_state()["billboardLayerActive"] and not compact_state()["protagonistBillboardVisible"])
        if require_level_settle:
            wait.until(lambda _d: compact_state()["pending"]==0 and compact_state()["visibleLevel"]!="ground")
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
        '<div>Detailed billboards '+s.detailedBillboardCount+' · visible residents '+s.activeResidentCount+' · 2× art '+s.presentationScaleMultiplier.toFixed(1)+'</div>'+
        '<div style="opacity:.70;margin-top:2px">'+(textures||'no detailed character textures')+'</div>'+
        '<div>cutaway '+(s.groundBuildingCutaway?.active?'ON '+String(s.groundBuildingCutaway.buildingId||''):'OFF')+' · protagonist '+String(s.protagonistPosition?.x||'?')+','+String(s.protagonistPosition?.y||'?')+'</div>'+
        '<div style="opacity:.58">camera '+String(s.cameraPresentation||'')+' · tangent '+String(s.tangentPresentationPitchDegrees||0)+'° · pure zoom pose invariant '+String(s.cameraPoseInvariant)+'</div>';
      document.body.appendChild(card);
    """,label,state)

def validate(label,index,state,mode="overview",proof=None):
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
        if state["activeResidentCount"]<2 or state["residentTargetCount"]<2:
            raise RuntimeError(label+" lacks multiple visible authoritative residents: "+json.dumps(state))
        if state["presentationScaleMultiplier"]<1.99:
            raise RuntimeError(label+" ground character presentation is below intended 2x scale: "+json.dumps(state))
        urls=state["billboardTextureUrls"]
        if "assets/characters/protagonist_male.png" not in urls or not any("npc_" in str(u) for u in urls):
            raise RuntimeError(label+" did not use required character PNG assets: "+json.dumps(urls))
    if not state["cameraPoseInvariant"] or abs(float(state["cameraPitchDegrees"]))>0.001:
        raise RuntimeError(label+" violated README pure-zoom camera invariant: "+json.dumps(state))
    if state["cameraPresentation"]!="orthographic-3q" or not 45<=float(state["tangentPresentationPitchDegrees"])<=75:
        raise RuntimeError(label+" missing fixed orthographic 3/4 tangent presentation: "+json.dumps(state))
    cut=state.get("groundBuildingCutaway") or {}
    if mode=="inside":
        if not cut.get("active") or str(cut.get("buildingId"))!=str((proof or {}).get("buildingId")):
            raise RuntimeError(label+" did not activate the authoritative occupied-building cutaway: "+json.dumps(cut))
        if int(cut.get("hiddenRoofCount") or 0)!=1 or int(cut.get("loweredShellCount") or 0)!=1 or int(cut.get("interiorFloorCount") or 0)!=1:
            raise RuntimeError(label+" cutaway did not expose roof/shell/floor contract: "+json.dumps(cut))
    elif mode in ("front","behind","overview") and cut.get("active"):
        raise RuntimeError(label+" unexpectedly activated building cutaway outside the interior: "+json.dumps(cut))

records=[]
try:
    target=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1"
    driver.get(target)
    wait.until(lambda _d: ready())
    reset_seed_and_focus()
    driver.refresh();wait.until(lambda _d: ready())
    prime=js("""const s=PlanetStage.snapshot(),p=StartingVillage.plan(s.activeSeed),c=p?.center||{x:'0',y:'0'};PlanetStage.applyAuthoritativeFantasyTime(arguments[0],'WP-S003-004-004 daytime visual evidence',{snapshotResult:false});PlanetStage.setWorldTileFocus(String(c.x),String(c.y));return {activeSeed:s.activeSeed,center:{x:String(c.x),y:String(c.y)},village:p?.name||'Starting Village',when:arguments[0]};""",EVIDENCE_TIME)
    proof=proof_building_points()
    overview_point={"x":str(prime["center"]["x"]),"y":str(prime["center"]["y"])}
    for label,width,height,index,mode in VIEWS:
        set_exact_viewport(driver,width,height)
        target_point=overview_point if mode=="overview" else proof[mode]
        if mode!="overview":
            set_protagonist_position(target_point)
            set_scale(8,require_level_settle=False)
        elif label.startswith("phone-"):
            set_protagonist_position(overview_point)
            set_scale(8,require_level_settle=False)
        time.sleep(.18)
        state=set_scale(index)
        validate(label,index,state,mode,proof)
        add_overlay(label,state)
        time.sleep(.16)
        path=OUT/f"{label}.png"
        if not driver.save_screenshot(str(path)):
            raise RuntimeError("screenshot capture failed: "+str(path))
        records.append({"label":label,"viewport":[width,height],"scaleIndex":index,"mode":mode,"file":str(path),"state":state,"proof":proof if mode!="overview" else None})
    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-12:]))
    result={"pass":True,"wp":"WP-S003-004-004","classification":"MIXED","seed":prime.get("activeSeed"),"center":prime.get("center"),"village":prime.get("village"),"buildingProof":proof,"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
