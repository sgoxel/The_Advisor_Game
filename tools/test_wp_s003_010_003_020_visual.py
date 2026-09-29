#!/usr/bin/env python3
from __future__ import annotations
import json, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/?seed=AGENT6-NAV-PERF-A"
OUT_DIR=Path(sys.argv[2] if len(sys.argv)>2 else "tools/wp_s003_010_003_020_artifact/production_visual")

def driver_for():
    o=Options()
    for arg in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--window-size=1280,800"): o.add_argument(arg)
    o.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    d=webdriver.Chrome(options=o)
    try:d.command_executor.set_timeout(600)
    except Exception:pass
    d.set_script_timeout(300)
    d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{"width":1280,"height":800,"deviceScaleFactor":1,"mobile":False,"screenWidth":1280,"screenHeight":800,"screenOrientation":{"type":"landscapePrimary","angle":90}})
    return d

def wait(d,script,timeout=300,*args):
    return WebDriverWait(d,timeout).until(lambda x:x.execute_script(script,*args))

def snap(d): return d.execute_script("return window.PlanetStage?.snapshot?.()||null")

def set_viewport(d,w,h):
    d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{"width":int(w),"height":int(h),"deviceScaleFactor":1,"mobile":False,"screenWidth":int(w),"screenHeight":int(h),"screenOrientation":{"type":"landscapePrimary" if w>h else "portraitPrimary","angle":90 if w>h else 0}})
    d.execute_script("window.dispatchEvent(new Event('resize'));")
    time.sleep(.5)

def capture(d,name):
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    p=OUT_DIR/(name+".png")
    if not d.save_screenshot(str(p)): raise RuntimeError("screenshot failed "+str(p))
    return p.name

def focus_village(d):
    t=d.execute_script("""
      const s=window.PlanetStage.snapshot(),p=window.StartingVillage?.plan?.(s.activeSeed);
      return p?.center?{x:String(p.center.x),y:String(p.center.y),name:String(p.name||'Starting Village')}:null;
    """)
    if not t: raise AssertionError("starting village unavailable")
    d.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);",t["x"],t["y"])
    time.sleep(.4)
    return t

def settle_scale(d,index,timeout=240):
    d.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);",int(index))
    wait(d,"return window.PlanetStage.snapshot().zoom.scaleIndex===arguments[0]",60,int(index))
    def stable(x):
        s=x.execute_script("return window.PlanetStage.snapshot()")
        if bool(s["zoom"].get("animating")): return False
        if float(s["zoom"]["scalar"])<=float(s["projection"]["transitionStart"]): return True
        return int(s["projection"]["resourceBudget"].get("pendingPreparationCount") or 0)==0
    WebDriverWait(d,timeout).until(stable)
    time.sleep(.7)
    return snap(d)

def main():
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    evidence={"wp":"WP-S003-010-003-020","target":TARGET,"visualMode":"production-no-fast-start","pass":False,"frames":[]}
    d=driver_for()
    try:
        d.get(TARGET)
        wait(d,"return document.readyState==='complete'",90)
        wait(d,"return document.getElementById('planetStageRoot')?.dataset?.ready==='true'",600)
        set_viewport(d,1280,800)
        target=focus_village(d)
        broad=settle_scale(d,0)
        evidence["frames"].append({"phase":"planet-land-focus","scale":broad["zoom"]["scaleLabel"],"screenshot":capture(d,"production-planet-land-focus")})
        base=broad["rotation"]
        for i,(dy,dp) in enumerate(((4,1),(8,-1),(12,2))):
            d.execute_script("window.PlanetStage.setRotation(arguments[0],arguments[1]);",float(base["yawDegrees"])+dy,float(base["pitchDegrees"])+dp)
            time.sleep(.14)
            evidence["frames"].append({"phase":f"rotation-{i}","screenshot":capture(d,f"production-rotation-{i}")})
        focus_village(d)
        settle_scale(d,0)
        d.execute_script("window.PlanetStage.setAnimatedScaleIndex(10,'wp020-production-visual');")
        for i,pause in enumerate((.045,.075,.12)):
            time.sleep(pause)
            s=snap(d)
            evidence["frames"].append({"phase":f"zoom-transition-{i}","displayScale":s["zoom"]["displayScaleLabel"],"scalar":s["zoom"]["scalar"],"projectionMode":s.get("projection",{}).get("mode"),"presentation":s.get("projection",{}).get("presentation"),"resourceBudget":s.get("projection",{}).get("resourceBudget"),"localDetail":s.get("projection",{}).get("localDetail"),"screenshot":capture(d,f"production-zoom-transition-{i}")})
        wait(d,"return window.PlanetStage.snapshot().zoom.animation.active===false",120)
        mid=settle_scale(d,5)
        evidence["frames"].append({"phase":"mid-1_500","scale":mid["zoom"]["scaleLabel"],"screenshot":capture(d,"production-mid-1_500")})
        close=settle_scale(d,7)
        evidence["frames"].append({"phase":"close-1_2500","scale":close["zoom"]["scaleLabel"],"screenshot":capture(d,"production-close-1_2500")})
        set_viewport(d,844,390)
        focus_village(d); phone=settle_scale(d,5)
        evidence["frames"].append({"phase":"phone-landscape-1_500","viewport":{"width":844,"height":390},"screenshot":capture(d,"production-phone-landscape-1_500")})
        final=snap(d)
        evidence.update({
          "seed":final.get("activeSeed"),"targetFocus":target,
          "fullWorldScan":final.get("mapPresentation",{}).get("fullWorldScan"),
          "navigationPerformance":final.get("navigationPerformance"),
          "resourceBudget":final.get("projection",{}).get("resourceBudget"),
          "pass":True
        })
        severe=[x for x in d.get_log("browser") if x.get("level")=="SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe: raise AssertionError(f"severe browser errors: {severe[-10:]}")
    except Exception as exc:
        evidence["error"]=repr(exc); raise
    finally:
        (OUT_DIR/"evidence.json").write_text(json.dumps(evidence,indent=2,sort_keys=True),encoding="utf-8")
        d.quit()
    print(json.dumps({"seed":evidence.get("seed"),"frames":len(evidence["frames"]),"fullWorldScan":evidence.get("fullWorldScan")},indent=2))

if __name__=="__main__": main()
