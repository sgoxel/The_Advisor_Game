#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
PROFILE=os.environ.get("PROFILE","landscape")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s006-007-001"))
OUT.mkdir(parents=True,exist_ok=True)
SIZE=(1280,720) if PROFILE=="landscape" else (390,844)
SCALE_INDEX=9

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
        return driver.execute_script("""
          const s=window.PlanetStage?.snapshot?.();
          return Boolean(s?.ready&&window.MicroLocations&&window.WorldDestinations?.poiCell&&window.GameRenderer?.snapshot);
        """)
    except Exception:
        return False

def find_samples():
    found={}
    cells=[]
    for y in range(-10,11):
        for x in range(-10,11):
            cells.append((x*x+y*y,y,x))
    cells.sort()
    for _,cy,cx in cells:
        loc=driver.execute_script("""
          const seed=PlanetStage.snapshot().activeSeed;
          const loc=MicroLocations.composeCell(seed,String(arguments[0]),String(arguments[1]));
          if(!loc)return null;
          return {
            id:loc.id,type:loc.compositionType,sourceType:loc.sourceType,sourceDestinationId:loc.sourceDestinationId,
            anchor:loc.anchor,sourceCenter:loc.sourceCenter,propCount:loc.propCount,signature:loc.signature,
            anchorShiftTiles:loc.anchorShiftTiles,rotation:loc.rotation
          };
        """,cx,cy)
        if loc and loc["type"] not in found:
            found[loc["type"]]=loc
        if len(found)>=6:
            break
    if len(found)<6:
        raise RuntimeError("bounded evidence scan found only "+str(sorted(found)))
    return list(found.values())[:6]

def focus(loc):
    driver.execute_script("""
      const p=arguments[0];
      PlanetStage.setWorldTileFocus(p.anchor.x,p.anchor.y);
      PlanetStage.setScaleIndex(arguments[1]);
    """,loc,SCALE_INDEX)

def state(loc):
    return driver.execute_script("""
      const wanted=arguments[0],s=PlanetStage.snapshot(),r=GameRenderer.snapshot(),t=r.terrainChunks||{};
      const samples=(t.dressingSamples||[]).filter(x=>x.microLocationId===wanted.id);
      return {
        ready:Boolean(s.ready),scaleIndex:Number(s.zoom?.scaleIndex),scaleLabel:s.zoom?.scaleLabel,
        focus:s.canonicalFocus?.worldTile||null,
        localStatic:s.projection?.localStatic||null,
        resourceBudget:s.projection?.resourceBudget||null,
        matchingSamples:samples,
        contextCounts:t.dressingContextCounts||{},semanticCounts:t.dressingSemanticCounts||{},
        dressingDescriptorCount:Number(t.dressingDescriptorCount||0),
        dressingPrimitiveInstanceCount:Number(t.dressingPrimitiveInstanceCount||0),
        optimizedPresentationDrawCalls:Number(t.optimizedPresentationDrawCalls||0),
        worldData:t.worldData||null,
        microStats:MicroLocations.stats()
      };
    """,loc)

def visible(loc):
    st=state(loc)
    rb=st.get("resourceBudget") or {}
    sig_ok=(not rb.get("requestedSignature")) or rb.get("standInActive") or (rb.get("activeSignature") and rb.get("activeSignature")==rb.get("requestedSignature"))
    return st["ready"] and st["scaleIndex"]==SCALE_INDEX and sig_ok and len(st["matchingSamples"])>0

def overlay(loc,st,revisit=False):
    driver.execute_script("""
      const p=arguments[0],s=arguments[1],revisit=arguments[2];
      document.getElementById("wp-s006-007-001-evidence")?.remove();
      const card=document.createElement("div");card.id="wp-s006-007-001-evidence";
      Object.assign(card.style,{position:"fixed",left:"10px",top:"10px",zIndex:"99999",
        width:"min(360px,calc(100vw - 20px))",padding:"9px 11px",borderRadius:"10px",
        background:"rgba(7,12,18,.88)",color:"#f4f0df",border:"1px solid rgba(232,202,128,.68)",
        boxShadow:"0 6px 18px rgba(0,0,0,.32)",font:"600 10px/1.34 system-ui,sans-serif",pointerEvents:"none"});
      card.innerHTML=
        '<div style="font-size:9px;letter-spacing:.11em;color:#e8ca80">WP-S006-007-001 · MICRO-LOCATION'+(revisit?' · REVISIT':'')+'</div>'+
        '<div style="font-size:15px;margin:2px 0 4px">'+String(p.type).replaceAll("-"," ").toUpperCase()+'</div>'+
        '<div>Source '+String(p.sourceType)+' · '+String(p.sourceDestinationId)+'</div>'+
        '<div>Props '+Number(p.propCount)+' · live samples '+Number((s.matchingSamples||[]).length)+' · '+String(s.scaleLabel||"")+'</div>'+
        '<div style="opacity:.64;margin-top:2px">SEED-only · lazy chunk materialization · bounded instanced props · no Simulation authority</div>';
      document.body.appendChild(card);
    """,loc,st,revisit)

records=[]
try:
    driver.get(TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1")
    try:
        wait.until(lambda _d: ready())
    except TimeoutException:
        probe=driver.execute_script("""return {state:document.readyState,planet:window.PlanetStage?.snapshot?.(),micro:typeof MicroLocations,renderer:typeof GameRenderer,body:String(document.body?.innerText||"").slice(0,900)}""")
        raise RuntimeError("startup readiness timeout: "+json.dumps(probe))
    samples=find_samples()
    for idx,loc in enumerate(samples):
        focus(loc)
        try:
            wait.until(lambda _d,p=loc: visible(p))
        except TimeoutException:
            raise RuntimeError("micro-location render timeout "+loc["type"]+": "+json.dumps(state(loc)))
        time.sleep(.45)
        st=state(loc)
        overlay(loc,st,False)
        time.sleep(.18)
        path=OUT/f"{PROFILE}-{idx+1:02d}-{loc['type']}.png"
        driver.save_screenshot(str(path))
        records.append({"profile":PROFILE,"location":loc,"state":st,"file":str(path)})
    first=samples[0]
    focus(samples[1]);time.sleep(.35)
    focus(first)
    try:
        wait.until(lambda _d: visible(first))
    except TimeoutException:
        raise RuntimeError("revisit render timeout: "+json.dumps(state(first)))
    time.sleep(.35)
    revisit=state(first)
    if not revisit["matchingSamples"]:
        raise RuntimeError("revisit lost micro-location presentation")
    overlay(first,revisit,True)
    path=OUT/f"{PROFILE}-07-revisit-{first['type']}.png"
    driver.save_screenshot(str(path))
    records.append({"profile":PROFILE,"location":first,"state":revisit,"file":str(path),"revisit":True})

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S006-007-001","classification":"MIXED","profile":PROFILE,"viewport":SIZE,
            "seed":driver.execute_script("return PlanetStage.snapshot().activeSeed"),
            "compositionTypes":[x["type"] for x in samples],"records":records,
            "revisitStable":records[-1]["location"]["signature"]==records[0]["location"]["signature"]}
    (OUT/f"{PROFILE}-evidence.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
finally:
    driver.quit()
