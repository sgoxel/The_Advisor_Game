#!/usr/bin/env python3
from __future__ import annotations
import json, math, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/?evidence_fast_start=1"
OUT=Path(sys.argv[2] if len(sys.argv)>2 else "tools/wp_s003_010_003_021_artifact")
SEED="AGENT6-NAV-PERF-A"

def driver_for(w=390,h=844):
    o=Options()
    for a in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader"): o.add_argument(a)
    o.add_argument(f"--window-size={w},{h}")
    o.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    d=webdriver.Chrome(options=o); d.set_script_timeout(240)
    try:d.command_executor.set_timeout(300)
    except Exception:pass
    return d

def metrics(d,w,h):
    d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{"width":w,"height":h,"deviceScaleFactor":1,"mobile":False,"screenWidth":w,"screenHeight":h,"screenOrientation":{"type":"portraitPrimary" if h>w else "landscapePrimary","angle":0 if h>w else 90}})
    d.execute_script("window.dispatchEvent(new Event('resize'))")
    time.sleep(.35)

def snap(d): return d.execute_script("return window.PlanetStage?.snapshot?.()||null")

def wait_ready(d):
    WebDriverWait(d,180).until(lambda x:x.execute_script("return document.readyState==='complete'"))
    WebDriverWait(d,300).until(lambda x:x.execute_script("return document.getElementById('planetStageRoot')?.dataset?.ready==='true'"))

def set_seed(d):
    r=d.execute_script("const s=String(arguments[0]);const c=window.SeedSystem.startNewCampaign(s);const p=window.PlanetGeography.persistSeed(s);return {c,p};",SEED)
    if r.get("c",{}).get("ok") is not True or r.get("p")!=SEED: raise AssertionError(f"seed setup failed {r}")
    d.refresh(); wait_ready(d)

def focus_village(d):
    t=d.execute_script("""const s=window.PlanetStage.snapshot(),p=window.StartingVillage?.plan?.(s.activeSeed);return p?.center?{x:String(p.center.x),y:String(p.center.y)}:null;""")
    if not t: raise AssertionError("starting village missing")
    d.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);",t["x"],t["y"])
    time.sleep(.3); return t

def settle_index(d,i,timeout=240):
    d.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);",i)
    WebDriverWait(d,60).until(lambda x:int(snap(x)["zoom"]["scaleIndex"])==i)
    WebDriverWait(d,timeout).until(lambda x:not snap(x)["zoom"]["animation"]["active"] and int(snap(x)["projection"]["resourceBudget"].get("pendingPreparationCount") or 0)==0)
    time.sleep(.35); return snap(d)

def regional_mid(d):
    a=d.execute_script("window.PlanetStage.setScaleIndex(4);return window.PlanetStage.snapshot().zoom.scalar;")
    time.sleep(.2)
    b=d.execute_script("window.PlanetStage.setScaleIndex(5);return window.PlanetStage.snapshot().zoom.scalar;")
    target=math.sqrt(float(a)*float(b))
    d.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);",target)
    WebDriverWait(d,240).until(lambda x:int(snap(x)["projection"]["resourceBudget"].get("pendingPreparationCount") or 0)==0)
    time.sleep(.4)
    return snap(d),target

def shot(d,name):
    OUT.mkdir(parents=True,exist_ok=True); p=OUT/f"{name}.png"
    if not d.save_screenshot(str(p)): raise RuntimeError("screenshot failed")
    return p.name

def labels(d):
    return d.execute_script("""return [...document.querySelectorAll('.planet-map-labels .planet-atlas-label[data-canonical-id],.planet-map-labels .planet-map-landmark[data-canonical-id]')].filter(e=>!e.hidden).map(e=>({id:e.dataset.canonicalId,text:e.textContent.trim(),left:parseFloat(e.style.left)||0,top:parseFloat(e.style.top)||0,kind:e.dataset.kind||''}));""")

def install_observer(d):
    d.execute_script("""window.__wp021Long=[];try{window.__wp021Obs?.disconnect?.();window.__wp021Obs=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__wp021Long.push({duration:e.duration,startTime:e.startTime});});window.__wp021Obs.observe({entryTypes:['longtask']});}catch(_){window.__wp021Obs=null;}""")

def drag_probe(d,w,h,steps=18):
    rect=d.execute_script("const r=document.querySelector('#planetCanvas').getBoundingClientRect();return {x:r.left+r.width*.48,y:r.top+r.height*.54,w:r.width,h:r.height};")
    x=float(rect["x"]); y0=float(rect["y"])
    before=snap(d); before_labels=labels(d)
    if not before_labels: raise AssertionError("no visible labels to track at regional scale")
    d.execute_cdp_cmd("Input.dispatchMouseEvent",{"type":"mousePressed","x":x,"y":y0,"button":"left","buttons":1,"clickCount":1})
    per=[]; prev={r["id"]:(r["left"],r["top"]) for r in before_labels}
    semantic_before=int(before["navigationPerformance"].get("semanticUpdateRenderCount") or 0)
    for i in range(steps):
        x+=6.0; y=y0+math.sin(i*.43)*5
        d.execute_cdp_cmd("Input.dispatchMouseEvent",{"type":"mouseMoved","x":x,"y":y,"button":"left","buttons":1})
        time.sleep(.02)
        cur=labels(d); nav=snap(d)["navigationPerformance"]
        moved=0; maxmove=0.0
        for r in cur:
            if r["id"] in prev:
                p=prev[r["id"]]; m=math.hypot(r["left"]-p[0],r["top"]-p[1]); maxmove=max(maxmove,m)
                if m>.25:moved+=1
        per.append({"step":i,"visible":len(cur),"moved":moved,"maxMotionPx":round(maxmove,3),"semanticRenders":int(nav.get("semanticUpdateRenderCount") or 0),"liveProjectionCount":int(nav.get("liveProjectionCount") or 0)})
        prev={r["id"]:(r["left"],r["top"]) for r in cur}
        if i==steps//2: mid=shot(d,f"{w}x{h}-regional-mid-drag")
    during=snap(d)
    if int(during["navigationPerformance"].get("semanticUpdateRenderCount") or 0)!=semantic_before:
        raise AssertionError("full semantic render occurred during pointer drag")
    if int(during["navigationPerformance"].get("streamingRequestDeferredCount") or 0)<=int(before["navigationPerformance"].get("streamingRequestDeferredCount") or 0):
        raise AssertionError("drag did not defer streaming requests")
    if during["navigationPerformance"].get("interactionStreamingDeferred") is not True:
        raise AssertionError("drag streaming deferral flag was not active")
    if sum(1 for r in per if r["moved"]>0)<max(4,steps//2):
        raise AssertionError(f"labels did not track drag continuously: {per}")
    d.execute_cdp_cmd("Input.dispatchMouseEvent",{"type":"mouseReleased","x":x,"y":y0,"button":"left","buttons":0,"clickCount":1})
    WebDriverWait(d,30).until(lambda z:int(snap(z)["navigationPerformance"].get("pointerSettleFlushCount") or 0)>int(before["navigationPerformance"].get("pointerSettleFlushCount") or 0))
    time.sleep(.35)
    after=snap(d)
    if int(after["navigationPerformance"].get("pointerSettleStreamingRefreshCount") or 0)<=int(before["navigationPerformance"].get("pointerSettleStreamingRefreshCount") or 0):
        raise AssertionError("pointer settle did not refresh deferred streaming")
    return {"beforeLabels":before_labels,"steps":per,"midScreenshot":mid,"before":before["navigationPerformance"],"during":during["navigationPerformance"],"after":after["navigationPerformance"],"afterLabels":labels(d)}

def assert_regional_clean(s):
    ls=s["projection"]["localStatic"]; rb=s["projection"]["resourceBudget"]; mp=s["mapPresentation"]
    if str(ls.get("revealTier"))!="none": raise AssertionError(f"regional reveal tier not none: {ls.get('revealTier')}")
    if ls.get("mapScaleSuppressedDecorative") is not True: raise AssertionError(f"map-scale decorative suppression missing: {ls}")
    if rb.get("mapScalePresentationEligible") is not False: raise AssertionError(f"map-scale local presentation unexpectedly eligible: {rb}")
    if int(ls.get("buildingCount") or 0) or int(ls.get("vegetationCount") or 0) or int(ls.get("microLocationPrimitiveCount") or 0): raise AssertionError(f"local decorative geometry leaked into regional scale: {ls}")
    if int(mp.get("markerStandaloneDecorativeGlyphCount") or 0)!=0 or int(mp.get("markerUnknownProductionCount") or 0)!=0: raise AssertionError("standalone/unknown marker glyph leaked")

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    ev={"wp":"WP-S003-010-003-021","target":TARGET,"seed":SEED,"pass":False,"views":[]}
    d=driver_for()
    try:
        d.get(TARGET); wait_ready(d); set_seed(d); install_observer(d)
        for view_index,(w,h) in enumerate(((390,844),(844,390))):
            metrics(d,w,h); focus_village(d)
            if view_index==0:
                close=settle_index(d,7)
                ev["views"].append({"viewport":[w,h],"phase":"close-materialized","scale":close["zoom"]["scaleLabel"],"localStatic":close["projection"]["localStatic"]})
            regional,target=regional_mid(d); assert_regional_clean(regional)
            seasonal=d.execute_script("return window.SeasonalPresentation?.snapshot?.()||null")
            if not seasonal: raise AssertionError("seasonal presentation telemetry unavailable")
            if int(seasonal.get("accentCount") or 0)!=0 or seasonal.get("mapScaleAccentSuppressed") is not True:
                raise AssertionError(f"marker-like seasonal accents remain at regional map scale: {seasonal}")
            pre=shot(d,f"{w}x{h}-regional-before")
            probe=drag_probe(d,w,h)
            post=shot(d,f"{w}x{h}-regional-after")
            final=snap(d); assert_regional_clean(final)
            ev["views"].append({"viewport":[w,h],"phase":"regional","targetScalar":target,"displayScale":regional["zoom"]["displayScaleLabel"],"scalar":regional["zoom"]["scalar"],"beforeScreenshot":pre,"afterScreenshot":post,"localStatic":regional["projection"]["localStatic"],"resourceBudget":regional["projection"]["resourceBudget"],"mapPresentation":{"markerStandaloneDecorativeGlyphCount":regional["mapPresentation"].get("markerStandaloneDecorativeGlyphCount"),"markerUnknownProductionCount":regional["mapPresentation"].get("markerUnknownProductionCount"),"semanticOrderingSignature":regional["mapPresentation"].get("semanticOrderingSignature")},"seasonalPresentation":seasonal,"drag":probe})
        longs=d.execute_script("return window.__wp021Long||[]")
        final=snap(d); nav=final["navigationPerformance"]
        ev["longTasks"]=longs; ev["navigationPerformance"]=nav
        if float(nav.get("liveProjectionMaxMs") or 0)>=50: raise AssertionError(f"live label projection exceeded 50 ms: {nav.get('liveProjectionMaxMs')}")
        if int(nav.get("liveProjectionCount") or 0)<20: raise AssertionError("live projection path insufficiently exercised")
        if int(final["projection"]["resourceBudget"].get("missingCoverageCount") or 0)!=0: raise AssertionError(f"terrain coverage gap reported: {final['projection']['resourceBudget']}")
        severe=[x for x in d.get_log("browser") if x.get("level")=="SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe: raise AssertionError(f"severe browser errors: {severe[-8:]}")
        ev["pass"]=True
    except Exception as e:
        ev["error"]=repr(e); raise
    finally:
        (OUT/"evidence.json").write_text(json.dumps(ev,indent=2,sort_keys=True),encoding="utf-8")
        d.quit()
    print(json.dumps({"pass":ev["pass"],"views":len(ev["views"]),"liveProjectionMaxMs":ev.get("navigationPerformance",{}).get("liveProjectionMaxMs")},indent=2))

if __name__=="__main__": main()
