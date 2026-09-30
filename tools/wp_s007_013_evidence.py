#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/?evidence_fast_start=1")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s007-013"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
TYPES=["traveling-merchant","small-caravan","road-patrol","messenger"]
STAMP="1201-06-02 12:00:00"
SCALE_INDEX=9
MIN_BODY_PX=12.0

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-webgl")
options.add_argument("--ignore-gpu-blocklist")
options.add_argument("--use-angle=swiftshader")
options.add_argument(f"--window-size={SIZE[0]},{SIZE[1]}")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
driver.set_window_size(*SIZE)
wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const s=window.PlanetStage?.snapshot?.();
          return Boolean(document.getElementById("planetStageRoot")?.dataset?.ready==="true" &&
            s?.ready && window.TravelEncounters && window.CrowdPresentation && window.StartingVillage && window.HousePlans);
        """)
    except Exception:
        return False

def activation_base(index):
    return driver.execute_script("""
      const i=arguments[0],s=PlanetStage.snapshot(),seed=s.activeSeed,plan=StartingVillage.plan(seed),houses=HousePlans.build(seed)||[];
      if(i===0)return {x:String(plan.center.x),y:String(plan.center.y),level:0,source:"StartingVillage.center"};
      const h=houses[(i-1)%Math.max(1,houses.length)],p=h?.entrance?.target||plan.center;
      return {x:String(p.x),y:String(p.y),level:0,source:h?"HousePlans.entrance.target":"StartingVillage.center"};
    """,index)

def activate(kind,index):
    base=activation_base(index)
    return driver.execute_script("""
      const type=arguments[0],stamp=arguments[1],scale=arguments[2],base=arguments[3],seed=PlanetStage.snapshot().activeSeed;
      TravelEncounters.clearProof(seed);
      const resolved=TravelEncounters.resolveVisualAnchor(seed,base,stamp,type,"browser-evidence-"+type);
      if(!resolved?.valid)throw new Error("no canonical encounter visual anchor: "+JSON.stringify({type,base,resolved}));
      PlanetStage.setWorldTileFocus(resolved.point.x,resolved.point.y);
      PlanetStage.setScaleIndex(scale);
      const result=TravelEncounters.proofActivate(seed,type,resolved.point,stamp);
      if(!result?.pass)throw new Error("travel encounter proof activation failed: "+JSON.stringify(result));
      PlanetStage.setWorldTileFocus(result.event.anchor.x,result.event.anchor.y);
      PlanetStage.setScaleIndex(scale);
      PlanetStage.applyAuthoritativeFantasyTime(stamp,"WP-S007-013 evidence",{snapshotResult:false});
      return {seed,type,stamp,base,resolved,result};
    """,kind,STAMP,SCALE_INDEX,base)

def state():
    return driver.execute_script("""
      const s=PlanetStage.snapshot(),te=s.travelEncounters||TravelEncounters.snapshot(s.activeSeed),cp=s.crowdPresentation||{};
      const card=document.getElementById("travelEncounterCard"),cardRect=card&&!card.hidden?card.getBoundingClientRect():null;
      const cardCenter=cardRect?{x:(cardRect.left+cardRect.right)/2,y:(cardRect.top+cardRect.bottom)/2}:null;
      const cardTopElement=cardCenter?document.elementFromPoint(cardCenter.x,cardCenter.y):null;
      const cardTopmost=Boolean(card&&cardTopElement&&(cardTopElement===card||card.contains(cardTopElement)));
      const panel=document.querySelector(".planet-places-panel:not([hidden])"),panelRect=panel?panel.getBoundingClientRect():null;
      const center=document.querySelector(".planet-world-center:not([hidden])"),centerGlyph=center?.querySelector("i"),centerCode=center?.querySelector("code");
      const centerGlyphRect=centerGlyph?.getBoundingClientRect?.()||null,centerCodeStyle=centerCode?getComputedStyle(centerCode):null;
      const rb=s.projection?.resourceBudget||{},ls=s.projection?.localStatic||{},actors=(cp.actors||[]).filter(a=>a.travelEncounter);
      const signatureReady=(!rb.requestedSignature)||Boolean(rb.standInActive)||(rb.activeSignature&&rb.activeSignature===rb.requestedSignature);
      const cardBox=cardRect?{left:cardRect.left,top:cardRect.top,right:cardRect.right,bottom:cardRect.bottom,width:cardRect.width,height:cardRect.height}:null;
      const panelBox=panelRect?{left:panelRect.left,top:panelRect.top,right:panelRect.right,bottom:panelRect.bottom}:null;
      const overlaps=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)):0;
      const actorRows=actors.map(a=>{
        const size=a.bodyScreenSizePx||{},scr=a.screen||{},w=Number(size.width||0),h=Number(size.height||0);
        const box=scr&&Number.isFinite(Number(scr.x))?{left:Number(scr.x)-w/2,right:Number(scr.x)+w/2,top:Number(scr.y)-h/2,bottom:Number(scr.y)+h/2}:null;
        const glyphBox=centerGlyphRect?{left:centerGlyphRect.left,right:centerGlyphRect.right,top:centerGlyphRect.top,bottom:centerGlyphRect.bottom}:null;
        return {...a,cardOverlapPx2:overlaps(cardBox,box),centerGlyphOverlapPx2:overlaps(glyphBox,box)};
      });
      return {
        ready:Boolean(s.ready),seed:s.activeSeed,scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        focus:s.canonicalFocus?.worldTile||null,resourceBudget:rb,localStatic:ls,signatureReady:Boolean(signatureReady),
        travel:te,crowd:cp,actors:actorRows,visibleEncounterActors:actorRows.filter(a=>a.visible&&a.inViewport).length,
        cardVisible:Boolean(card&&!card.hidden&&getComputedStyle(card).display!=="none"),cardTopmost,cardType:card?.dataset?.encounterType||"",
        cardSafeSlot:card?.dataset?.safeSlot||"",cardText:String(card?.innerText||""),cardRect:cardBox,
        cardPanelOverlapPx2:overlaps(cardBox,panelBox),
        travelEncounterFocus:document.getElementById("planetStageRoot")?.dataset?.travelEncounterFocus||"",
        centerGlyphRect:centerGlyphRect?{left:centerGlyphRect.left,right:centerGlyphRect.right,top:centerGlyphRect.top,bottom:centerGlyphRect.bottom,width:centerGlyphRect.width,height:centerGlyphRect.height}:null,
        centerCodeVisible:Boolean(centerCode&&centerCodeStyle&&centerCodeStyle.display!=="none"&&centerCodeStyle.visibility!=="hidden"&&Number(centerCodeStyle.opacity||1)>.01),
        viewport:{width:innerWidth,height:innerHeight}
      };
    """)

def valid_state(kind,expected):
    st=state()
    sizes=[max(float((a.get("bodyScreenSizePx") or {}).get("width",0)),float((a.get("bodyScreenSizePx") or {}).get("height",0))) for a in st["actors"]]
    ls=st["localStatic"] or {}
    context_score=sum(int(ls.get(k,0) or 0) for k in ["roadCount","buildingCount","wildernessCount","vegetationCount","microLocationCount","microLocationPropCount"])
    card=st.get("cardRect") or {}
    card_inside=bool(card and card["left"]>=0 and card["top"]>=0 and card["right"]<=st["viewport"]["width"] and card["bottom"]<=st["viewport"]["height"])
    no_actor_card_overlap=all(float(a.get("cardOverlapPx2",0) or 0)<=max(20.0,float((a.get("bodyScreenSizePx") or {}).get("width",0))*float((a.get("bodyScreenSizePx") or {}).get("height",0))*.15) for a in st["actors"])
    no_center_glyph_overlap=all(float(a.get("centerGlyphOverlapPx2",0) or 0)<=1.0 for a in st["actors"])
    return bool(
      st["cardVisible"] and st["cardTopmost"] and st["cardType"]==kind and st["cardSafeSlot"]=="bottom-center" and card_inside and
      st["cardPanelOverlapPx2"]==0 and no_actor_card_overlap and st["travelEncounterFocus"]=="true" and
      not st["centerCodeVisible"] and no_center_glyph_overlap and st["scaleIndex"]==SCALE_INDEX and st["signatureReady"] and
      st["travel"].get("active") and int(st["travel"].get("exactActorCount",0))==expected and
      int(st["crowd"].get("travelEncounterCount",0))==expected and int(st["crowd"].get("visibleTravelEncounterCount",0))>=expected and
      st["visibleEncounterActors"]>=expected and sizes and min(sizes)>=MIN_BODY_PX and
      st["crowd"].get("travelerSilhouetteRevision")=="travel-encounter-silhouette-v3" and
      int(st["crowd"].get("drawCallEstimate",0))<=1 and
      int(ls.get("waterCount",0) or 0)==0 and context_score>=2 and
      st["travel"].get("encounter",{}).get("context",{}).get("visualSurfaceValid") is True and
      st["travel"].get("encounter",{}).get("visualAnchor",{}).get("planetSurfaceAgreement") is True
    )

def refresh():
    driver.execute_script('PlanetStage.applyAuthoritativeFantasyTime(arguments[0],"WP-S007-013 evidence refresh",{snapshotResult:false});',STAMP)

def leave_and_return(event):
    anchor=event["anchor"]
    away=driver.execute_script("""
      const a=arguments[0],scale=arguments[1],x=String(BigInt(a.x)+180n),y=String(BigInt(a.y)+144n);
      PlanetStage.setWorldTileFocus(x,y);PlanetStage.setScaleIndex(scale);PlanetStage.applyAuthoritativeFantasyTime(arguments[2],"WP-S007-013 evidence leave",{snapshotResult:false});
      return {x,y};
    """,anchor,SCALE_INDEX,STAMP)
    wait.until(lambda _d: state()["signatureReady"] and not state()["travel"].get("active") and state()["travel"].get("summaryOnly") is True)
    off=state()
    driver.execute_script("""
      const a=arguments[0],scale=arguments[1];PlanetStage.setWorldTileFocus(a.x,a.y);PlanetStage.setScaleIndex(scale);
      PlanetStage.applyAuthoritativeFantasyTime(arguments[2],"WP-S007-013 evidence return",{snapshotResult:false});
    """,anchor,SCALE_INDEX,STAMP)
    wait.until(lambda _d: state()["signatureReady"] and state()["travel"].get("active") and state()["visibleEncounterActors"]>=1)
    back=state()
    return {"away":away,"offscreen":{"active":off["travel"].get("active"),"summaryOnly":off["travel"].get("summaryOnly"),"exactActorCount":off["travel"].get("exactActorCount")},"returned":{"focus":back["focus"],"id":back["travel"].get("encounter",{}).get("id"),"visibleEncounterActors":back["visibleEncounterActors"]}}

records=[];roundtrip=None;anchors=[]
try:
    driver.get(TARGET)
    try: wait.until(lambda _d: ready())
    except TimeoutException:
        driver.save_screenshot(str(OUT/f"{PROFILE}-failure-startup.png"))
        raise RuntimeError("startup timeout: "+json.dumps(driver.execute_script("return {ready:window.PlanetStage?.snapshot?.()?.ready||false,error:window.PlanetStage?.snapshot?.()?.startupError||null,body:String(document.body?.innerText||'').slice(0,900)}")))

    for idx,kind in enumerate(TYPES):
        activation=activate(kind,idx);expected=int(activation["result"]["event"]["actorCount"]);anchors.append(activation["result"]["event"]["anchor"])
        try: wait.until(lambda _d,k=kind,e=expected: valid_state(k,e))
        except TimeoutException:
            refresh()
            try: wait.until(lambda _d,k=kind,e=expected: valid_state(k,e))
            except TimeoutException:
                driver.save_screenshot(str(OUT/f"{PROFILE}-failure-{idx+1:02d}-{kind}.png"))
                failure_state=state()
                (OUT/f"{PROFILE}-failure-{idx+1:02d}-{kind}.json").write_text(json.dumps(failure_state,indent=2))
                raise RuntimeError("travel encounter presentation gate failed "+kind+": "+json.dumps(failure_state))
        time.sleep(.35)
        st=state();travel=st["travel"];crowd=st["crowd"]
        path=OUT/f"{PROFILE}-{idx+1:02d}-{kind}.png"
        driver.save_screenshot(str(path))
        if travel.get("fullWorldScan") or travel.get("perFrameScan") or not travel.get("eventDriven"): raise RuntimeError("encounter scheduling architecture regression: "+json.dumps(st))
        if not travel.get("exactOnlyNearRelevance") or not travel.get("seedAndFantasyTimeOnly"): raise RuntimeError("encounter authority/relevance contract failed: "+json.dumps(st))
        merged_ms=float(crowd.get("mergedPresentationBuildMs",0) or 0)
        if merged_ms>16.7:
            driver.save_screenshot(str(OUT/f"{PROFILE}-failure-{idx+1:02d}-{kind}-performance.png"))
            (OUT/f"{PROFILE}-failure-{idx+1:02d}-{kind}-performance.json").write_text(json.dumps(st,indent=2))
            raise RuntimeError("merged traveler presentation exceeded 16.7 ms incremental budget: "+json.dumps(st))
        if idx==0:
            roundtrip=leave_and_return(activation["result"]["event"])
            if roundtrip["returned"]["id"]!=activation["result"]["event"]["id"]: raise RuntimeError("encounter identity changed after leave/return: "+json.dumps(roundtrip))
            wait.until(lambda _d,k=kind,e=expected: valid_state(k,e));st=state()
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"type":kind,"file":str(path),"activation":activation,"state":st})

    unique={(a["x"],a["y"]) for a in anchors}
    if len(unique)<3: raise RuntimeError("evidence did not cover at least three distinct canonical encounter anchors: "+json.dumps(anchors))
    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe: raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S007-013","classification":"MIXED","profile":PROFILE,"viewport":SIZE,"types":TYPES,"minBodyPx":MIN_BODY_PX,"mergedPresentationBudgetMs":16.7,"distinctAnchorCount":len(unique),"roundtrip":roundtrip,"records":records}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:
    driver.quit()
