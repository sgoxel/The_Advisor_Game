#!/usr/bin/env python3
from __future__ import annotations
import base64, json, sys, time
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8000/?seed=AGENT6-NAV-PERF-A"
DIAGNOSTIC_TARGET=TARGET+("&" if "?" in TARGET else "?")+"wp020_surface_contributors=1&wp020_presentation_isolation=1"
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

def save_data_url(data_url,name):
    if not isinstance(data_url,str) or "," not in data_url or ";base64" not in data_url.split(",",1)[0]:
        raise AssertionError(f"invalid contributor data URL for {name}")
    p=OUT_DIR/(name+".png")
    p.write_bytes(base64.b64decode(data_url.split(",",1)[1]))
    return p.name

def capture_contributors(d,phase):
    payload=d.execute_script("return window.PlanetStage?.surfaceContributorEvidence?.()||null")
    if not payload or payload.get("available") is not True:
        raise AssertionError(f"contributor capture unavailable at {phase}: {payload}")
    if int(payload.get("worldResampleCount",-1))!=0 or int(payload.get("geographyQueryCount",-1))!=0:
        raise AssertionError(f"contributor capture performed forbidden resampling at {phase}: {payload}")
    roles={}
    required={"base","macro","structure","landCover","final"}
    for role,record in (payload.get("roles") or {}).items():
        images={}
        for name,data_url in (record.get("images") or {}).items():
            images[name]=save_data_url(data_url,f"contributors-{phase}-{role}-{name}")
        if set(images)!=required:
            raise AssertionError(f"contributor layer mismatch at {phase}/{role}: {sorted(images)}")
        roles[role]={**record,"images":images}
    if set(roles)!={"focus","medium","outer"}:
        raise AssertionError(f"contributor role mismatch at {phase}: {sorted(roles)}")
    return {
      "phase":phase,"revision":payload.get("revision"),"resourceSignature":payload.get("resourceSignature"),
      "level":payload.get("level"),"componentRanges":payload.get("componentRanges"),"roles":roles,
      "worldResampleCount":payload.get("worldResampleCount"),"geographyQueryCount":payload.get("geographyQueryCount")
    }

def screenshot_delta(a_name,b_name):
    a=Image.open(OUT_DIR/a_name).convert("RGB")
    b=Image.open(OUT_DIR/b_name).convert("RGB")
    if a.size!=b.size: raise AssertionError(f"screenshot size mismatch: {a.size} != {b.size}")
    w,h=a.size
    box=(int(w*.12),int(h*.10),int(w*.88),int(h*.90))
    diff=ImageChops.difference(a.crop(box),b.crop(box))
    stat=ImageStat.Stat(diff)
    mean_rgb=[float(v) for v in stat.mean]
    extrema=[int(pair[1]) for pair in stat.extrema]
    return {
      "crop":[int(v) for v in box],"meanAbsRgb":round(sum(mean_rgb)/3,4),
      "meanAbsByChannel":[round(v,4) for v in mean_rgb],"maxAbsByChannel":extrema
    }

def capture_flat_height_isolation(d,phase):
    # Freeze the currently displayed physical scalar before the A/B. The
    # diagnostic scale is reached through animated zoom, and displayScaleIndex
    # can become correct slightly before the animation settles. Without this,
    # the normal and flat screenshots can differ simply because the camera kept
    # moving between captures.
    frozen=d.execute_script("""
      const s=window.PlanetStage?.snapshot?.();
      if(!s) return null;
      window.PlanetStage.setZoomScalar(Number(s.zoom.scalar));
      return window.PlanetStage.snapshot();
    """)
    if not frozen:
        raise AssertionError(f"unable to freeze A/B scalar at {phase}")
    WebDriverWait(d,60).until(lambda x: (
        not bool((x.execute_script("return window.PlanetStage.snapshot()") or {}).get("zoom",{}).get("animating"))
        and int(((x.execute_script("return window.PlanetStage.snapshot()") or {}).get("projection",{}).get("resourceBudget",{}).get("pendingPreparationCount") or 0))==0
    ))
    time.sleep(.12)
    normal=d.execute_script("return window.PlanetStage?.setWp020PresentationEvidenceMode?.('normal')||null")
    if not normal or normal.get("available") is not True or normal.get("mode")!="normal":
        raise AssertionError(f"normal evidence unavailable at {phase}: {normal}")
    time.sleep(.12)
    normal_frame=snap(d)
    normal_shot=capture(d,f"presentation-isolation-{phase}-normal")

    flat=d.execute_script("return window.PlanetStage?.setWp020PresentationEvidenceMode?.('flat-height')||null")
    if not flat or flat.get("available") is not True or flat.get("mode")!="flat-height":
        raise AssertionError(f"flat-height evidence unavailable at {phase}: {flat}")
    if int(flat.get("worldResampleCount",-1))!=0 or int(flat.get("geographyQueryCount",-1))!=0:
        raise AssertionError(f"flat-height evidence performed forbidden resampling at {phase}: {flat}")
    time.sleep(.12)
    flat_frame=snap(d)
    flat_shot=capture(d,f"presentation-isolation-{phase}-flat-height")

    restored=d.execute_script("return window.PlanetStage?.setWp020PresentationEvidenceMode?.('normal')||null")
    if not restored or restored.get("available") is not True or restored.get("mode")!="normal":
        raise AssertionError(f"failed to restore canonical heightfield at {phase}: {restored}")
    time.sleep(.08)

    ns=normal.get("state") or {}; fs=flat.get("state") or {}
    if normal.get("resourceSignature")!=flat.get("resourceSignature") or normal.get("level")!=flat.get("level"):
        raise AssertionError(f"A/B resource identity changed at {phase}: normal={normal} flat={flat}")
    exact_numeric=("scalar","focusLatitudeRadians","focusLongitudeRadians","yawDegrees","pitchDegrees",
                   "presentationCompensation","patchScale","shownHeightMeters","tangentOpacity",
                   "mapScaleShellOpacity","reliefGlobeOpacity","cameraOrthoHeight","detailMetersPerTexel")
    for key in exact_numeric:
        av=float(ns.get(key) or 0); bv=float(fs.get(key) or 0)
        if abs(av-bv)>1e-6:
            raise AssertionError(f"A/B screen state changed at {phase} field={key}: {av} != {bv}")
    if ns.get("viewport")!=fs.get("viewport") or ns.get("representationOwner")!=fs.get("representationOwner"):
        raise AssertionError(f"A/B viewport/owner changed at {phase}: normal={ns} flat={fs}")
    if ns.get("material")!=fs.get("material") or ns.get("texture")!=fs.get("texture"):
        raise AssertionError(f"A/B material/texture state changed at {phase}: normal={ns} flat={fs}")

    return {
      "phase":phase,"mode":"exact-screen-height-ab","resourceSignature":flat.get("resourceSignature"),
      "level":flat.get("level"),"textureIdentityUnchanged":flat.get("textureIdentityUnchanged"),
      "materialIdentityUnchanged":flat.get("materialIdentityUnchanged"),
      "worldResampleCount":flat.get("worldResampleCount"),"geographyQueryCount":flat.get("geographyQueryCount"),
      "normalState":ns,"flatState":fs,
      "normalDisplayScale":normal_frame.get("zoom",{}).get("displayScaleLabel"),
      "flatDisplayScale":flat_frame.get("zoom",{}).get("displayScaleLabel"),
      "normalScreenshot":normal_shot,"flatScreenshot":flat_shot,
      "pixelDelta":screenshot_delta(normal_shot,flat_shot)
    }

def screenshot_samples(path_name,points=None):
    points=points or {"center":(.50,.50),"ridge_west":(.34,.50),"ridge_east":(.66,.50),"north":(.50,.36),"south":(.50,.64)}
    img=Image.open(OUT_DIR/path_name).convert("RGB")
    samples={}
    for name,(fx,fy) in points.items():
        x=max(0,min(img.width-1,round(fx*(img.width-1))))
        y=max(0,min(img.height-1,round(fy*(img.height-1))))
        samples[name]=list(img.getpixel((x,y)))
    return samples

def capture_transition_layer_isolation(d,scalar=.690488):
    # Phase 20 must inspect the actual retained regional parent visible in the
    # failing animated handoff. Arming the evidence-only freeze lets the normal
    # zoom path reach that exact resource, then holds animation and blocks only
    # resource activation while A/B layer screenshots are captured. Preparation
    # may finish into cache; no generation inputs or canonical world state change.
    focus_village(d)
    settle_scale(d,0)
    arm=d.execute_script(
        "return window.PlanetStage.armWp020TransitionEvidenceFreeze({minScalar:arguments[0],level:'regional-detail'});",
        float(scalar)
    )
    if not arm or arm.get("available") is not True or arm.get("armed") is not True:
        raise AssertionError(f"unable to arm retained-parent isolation: {arm}")
    d.execute_script("window.PlanetStage.setAnimatedScaleIndex(10,'wp020-transition-parent-isolation');")
    wait(d,"return window.PlanetStage.wp020TransitionEvidenceFreezeState().frozen===true",180)
    time.sleep(.08)
    freeze=d.execute_script("return window.PlanetStage.wp020TransitionEvidenceFreezeState();")
    baseline=snap(d)
    sig=baseline.get("projection",{}).get("resourceBudget",{}).get("visibleResourceSignature")
    level=baseline.get("projection",{}).get("localDetail",{}).get("level")
    frozen_scalar=float(baseline.get("zoom",{}).get("scalar") or 0)
    if level!="regional-detail" or not sig or "regional-detail" not in sig:
        raise AssertionError(f"retained-parent freeze missed regional-detail: level={level} sig={sig} freeze={freeze}")
    frames={}
    states={}
    contributor=None
    try:
        contributor=capture_contributors(d,"transition-retained-parent")
        for mode in ("normal","focus-only","medium-only","outer-only"):
            state=d.execute_script("return window.PlanetStage.setWp020PresentationEvidenceMode(arguments[0]);",mode)
            if not state or state.get("available") is not True or state.get("mode")!=mode:
                raise AssertionError(f"layer isolation unavailable for {mode}: {state}")
            time.sleep(.08)
            current=snap(d)
            current_sig=current.get("projection",{}).get("resourceBudget",{}).get("visibleResourceSignature")
            current_level=current.get("projection",{}).get("localDetail",{}).get("level")
            current_scalar=float(current.get("zoom",{}).get("scalar") or 0)
            frozen=d.execute_script("return window.PlanetStage.wp020TransitionEvidenceFreezeState().frozen===true")
            if not frozen or current_sig!=sig or current_level!="regional-detail" or abs(current_scalar-frozen_scalar)>1e-6:
                raise AssertionError(f"retained-parent isolation drifted: {mode} level={current_level} sig={current_sig} scalar={current_scalar}")
            shot=capture(d,f"transition-retained-parent-{mode}")
            frames[mode]={"screenshot":shot,"framebufferRgb":screenshot_samples(shot)}
            states[mode]=state
    finally:
        try:d.execute_script("window.PlanetStage.setWp020PresentationEvidenceMode('normal');")
        finally:d.execute_script("window.PlanetStage.releaseWp020TransitionEvidenceFreeze();")
    return {"mode":"retained-regional-parent-layer-isolation-v2","requestedMinScalar":float(scalar),
            "scalar":frozen_scalar,"resourceSignature":sig,"level":level,
            "displayScale":baseline.get("zoom",{}).get("displayScaleLabel"),"freeze":freeze,
            "states":states,"frames":frames,"contributors":contributor}

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

def settle_display_scale(d,index,timeout=300):
    d.execute_script("window.PlanetStage.setAnimatedScaleIndex(arguments[0],'wp020-contributor-diagnostic');",int(index))
    def stable(x):
        s=x.execute_script("return window.PlanetStage.snapshot()")
        if bool(s["zoom"].get("animating")): return False
        if int(s["zoom"].get("displayScaleIndex") or -1)!=int(index): return False
        if float(s["zoom"]["scalar"])<=float(s["projection"]["transitionStart"]): return False
        return int(s["projection"]["resourceBudget"].get("pendingPreparationCount") or 0)==0
    WebDriverWait(d,timeout).until(stable)
    time.sleep(.8)
    return snap(d)

def main():
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    evidence={"wp":"WP-S003-010-003-020","target":TARGET,"diagnosticTarget":DIAGNOSTIC_TARGET,"visualMode":"production-no-fast-start","pass":False,"frames":[],"contributorDiagnostics":[],"presentationIsolation":[],"transitionLayerIsolation":None}
    d=driver_for()
    try:
        d.get(DIAGNOSTIC_TARGET)
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
        diag75=settle_display_scale(d,5)
        evidence["frames"].append({"phase":"diagnostic-1_75","displayScale":diag75["zoom"]["displayScaleLabel"],"scalar":diag75["zoom"]["scalar"],"localDetail":diag75.get("projection",{}).get("localDetail"),"resourceBudget":diag75.get("projection",{}).get("resourceBudget"),"screenshot":capture(d,"production-diagnostic-1_75")})
        evidence["contributorDiagnostics"].append(capture_contributors(d,"1_75"))
        evidence["presentationIsolation"].append(capture_flat_height_isolation(d,"1_75"))
        diag150=settle_display_scale(d,7)
        evidence["frames"].append({"phase":"diagnostic-1_150","displayScale":diag150["zoom"]["displayScaleLabel"],"scalar":diag150["zoom"]["scalar"],"localDetail":diag150.get("projection",{}).get("localDetail"),"resourceBudget":diag150.get("projection",{}).get("resourceBudget"),"screenshot":capture(d,"production-diagnostic-1_150")})
        evidence["contributorDiagnostics"].append(capture_contributors(d,"1_150"))
        evidence["presentationIsolation"].append(capture_flat_height_isolation(d,"1_150"))
        focus_village(d)
        evidence["transitionLayerIsolation"]=capture_transition_layer_isolation(d,.690488)
        focus_village(d)
        settle_scale(d,0)
        d.execute_script("window.PlanetStage.setAnimatedScaleIndex(10,'wp020-production-visual');")
        for i,pause in enumerate((.045,.075,.12)):
            time.sleep(pause)
            pre=snap(d)
            shot=capture(d,f"production-zoom-transition-{i}")
            s=snap(d)
            evidence["frames"].append({"phase":f"zoom-transition-{i}","displayScale":s["zoom"]["displayScaleLabel"],"scalar":s["zoom"]["scalar"],"preCaptureScalar":pre["zoom"]["scalar"],"projectionMode":s.get("projection",{}).get("mode"),"presentation":s.get("projection",{}).get("presentation"),"resourceBudget":s.get("projection",{}).get("resourceBudget"),"localDetail":s.get("projection",{}).get("localDetail"),"screenshot":shot})
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
    print(json.dumps({"seed":evidence.get("seed"),"frames":len(evidence["frames"]),"contributors":len(evidence.get("contributorDiagnostics") or []),"presentationIsolation":len(evidence.get("presentationIsolation") or []),"fullWorldScan":evidence.get("fullWorldScan")},indent=2))

if __name__=="__main__": main()
