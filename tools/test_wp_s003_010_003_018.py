#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/?evidence_fast_start=1"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_018_artifact")
DISPLAY_LADDER = [
    "1/10","1/15","1/20","1/30","1/50","1/75","1/100","1/150","1/250",
    "1/375","1/500","1/750","1/1000","1/1500","1/2500","1/3750",
    "1/5000","1/7500","1/10000"
]
FORWARD_GROUPS = [
    [0,1,2,3,4],
    [8,9,10,11,12],
    [14,15,16,17,18],
]


def driver_for(width=1280, height=800):
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--enable-webgl")
    options.add_argument("--ignore-gpu-blocklist")
    options.add_argument("--use-angle=swiftshader")
    options.add_argument(f"--window-size={width},{height}")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    d = webdriver.Chrome(options=options)
    set_viewport(d, width, height)
    return d


def set_viewport(driver, width, height):
    orientation = {"type":"landscapePrimary","angle":90} if width > height else {"type":"portraitPrimary","angle":0}
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": int(width), "height": int(height), "deviceScaleFactor": 1,
        "mobile": False, "screenWidth": int(width), "screenHeight": int(height),
        "screenOrientation": orientation,
    })
    driver.execute_script("window.dispatchEvent(new Event('resize'));")
    target_aspect = width / max(1.0, height)
    deadline = time.time() + 12
    last = None
    while time.time() < deadline:
        last = driver.execute_script("""
          const node=document.querySelector('#planetCanvas');
          const c=node?.getBoundingClientRect?.();
          return {iw:Number(innerWidth||0),ih:Number(innerHeight||0),hasCanvas:Boolean(node),
                  cw:Number(c?.width||0),ch:Number(c?.height||0)};
        """)
        iw, ih = float(last.get("iw") or 0), float(last.get("ih") or 0)
        cw, ch = float(last.get("cw") or 0), float(last.get("ch") or 0)
        if iw > 0 and ih > 0:
            inner_ok = abs((iw / ih) - target_aspect) / target_aspect <= .04
            canvas_ok = (not last.get("hasCanvas")) or (
                cw > 0 and ch > 0 and
                abs((cw / ch) - target_aspect) / target_aspect <= .04 and
                cw >= iw * .90 and ch >= ih * .90
            )
            if inner_ok and canvas_ok:
                time.sleep(.5)
                return
        time.sleep(.1)
    raise AssertionError(f"viewport did not settle for {width}x{height}: {last}")


def wait(driver, script, timeout=120, *args):
    return WebDriverWait(driver, timeout).until(lambda d: d.execute_script(script, *args))


def snap(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def capture(driver, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"screenshot failed: {path}")
    return path.name


def wait_ready(driver):
    wait(driver, "return document.readyState==='complete'", 60)
    driver.execute_script(
        "const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim();"
        "if(s!=='ACTIVE'&&b)b.click();"
    )
    wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true", 180)
    wait(driver, "return window.PlanetStage?.snapshot?.()?.mapPresentation?.active===true", 60)
    stage = snap(driver)
    if stage.get("version") != "planet-smooth-zoom-v1":
        raise AssertionError(f"unexpected PlanetStage version: {stage.get('version')}")
    if stage["zoom"].get("displayScaleLadder") != DISPLAY_LADDER:
        raise AssertionError(f"display ladder mismatch: {stage['zoom'].get('displayScaleLadder')}")


def deterministic_land_target(driver):
    candidates = driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed,reps=window.RegionProfile?.representatives?.(seed)||[];
      return reps.map(r=>({id:r.id,name:r.name,x:String(r.administrativeSeat?.x??'0'),y:String(r.administrativeSeat?.y??'0')}))
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,20);
    """) or []
    if not candidates:
        candidates = [{"id":"origin","name":"Origin","x":"0","y":"0"}]
    for item in candidates:
        driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setZoomScalar(0);", item["x"], item["y"])
        time.sleep(.25)
        stage = snap(driver)
        if stage.get("canonicalFocus", {}).get("surfaceIdentity", {}).get("center", {}).get("land") is True:
            return item
    raise AssertionError("no deterministic land focus available")


def focus_tuple(stage):
    f = stage["canonicalFocus"]
    return (float(f["latitudeDegrees"]), float(f["longitudeDegrees"]))


def camera_pose(stage):
    return tuple(stage["zoom"]["pose"]["camera"]["eulerDegrees"])


def lon_delta(a, b):
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def stable_detail(driver, timeout=120):
    def done(d):
        s = d.execute_script("return window.PlanetStage.snapshot()")
        if float(s["zoom"]["scalar"]) <= float(s["projection"]["transitionStart"]):
            return True
        rb = s["projection"]["resourceBudget"]
        return int(rb.get("pendingPreparationCount") or 0) == 0 and (
            not rb.get("requestedLevel") or rb.get("requestedLevel") == rb.get("visibleLevel")
        )
    WebDriverWait(driver, timeout).until(done)


def assert_focus_pose(stage, focus0, pose0, label):
    f = focus_tuple(stage)
    lat_err = abs(f[0] - focus0[0])
    lon_err = lon_delta(f[1], focus0[1])
    if lat_err > 1e-5 or lon_err > 1e-5:
        raise AssertionError(f"{label}: canonical focus drifted {lat_err}, {lon_err}")
    if tuple(stage["zoom"]["pose"]["camera"]["eulerDegrees"]) != pose0:
        raise AssertionError(f"{label}: camera orientation changed")
    focus_screen = stage["canonicalFocus"].get("screenSpaceFocus") or {}
    if focus_screen.get("valid") and float(focus_screen.get("deltaPixels") or 0) > 3.5:
        raise AssertionError(f"{label}: screen focus drift {focus_screen}")


def transition_to(driver, index, tag, focus0, pose0, screenshot=True, settle_detail=True):
    before = snap(driver)
    before_scalar = float(before["zoom"]["scalar"])
    driver.execute_script("window.PlanetStage.setAnimatedScaleIndex(arguments[0],arguments[1]);", int(index), tag)
    commanded = snap(driver)
    target_scalar = float(commanded["zoom"]["targetScalar"])
    if commanded["zoom"]["targetDisplayScaleIndex"] != index:
        raise AssertionError(f"{tag}: target index mismatch: {commanded['zoom']}")
    if abs(target_scalar - before_scalar) > 1e-7:
        if commanded["zoom"]["animation"].get("active") is not True:
            raise AssertionError(f"{tag}: transition became instantaneous")
        if abs(float(commanded["zoom"]["scalar"]) - before_scalar) > 1e-6:
            raise AssertionError(f"{tag}: command teleported rendered scalar")
    direction = 1 if target_scalar >= before_scalar else -1
    samples = []
    start = time.time()
    deadline = start + 25
    last_scalar = before_scalar
    labels = []
    lods = []
    max_focus_delta = 0.0
    while time.time() < deadline:
        s = snap(driver)
        assert_focus_pose(s, focus0, pose0, tag)
        scalar = float(s["zoom"]["scalar"])
        if direction > 0 and scalar + 2e-6 < last_scalar:
            raise AssertionError(f"{tag}: non-monotonic forward scalar {last_scalar}->{scalar}")
        if direction < 0 and scalar - 2e-6 > last_scalar:
            raise AssertionError(f"{tag}: non-monotonic reverse scalar {last_scalar}->{scalar}")
        last_scalar = scalar
        labels.append(s["zoom"]["displayScaleLabel"])
        lods.append(s["zoom"].get("requestedLevel"))
        fd = float((s["canonicalFocus"].get("screenSpaceFocus") or {}).get("deltaPixels") or 0)
        max_focus_delta = max(max_focus_delta, fd)
        if len(samples) < 16:
            samples.append({
                "scalar": scalar,
                "targetScalar": float(s["zoom"]["targetScalar"]),
                "displayScale": s["zoom"]["displayScaleLabel"],
                "targetScale": s["zoom"]["targetDisplayScaleLabel"],
                "active": bool(s["zoom"]["animation"]["active"]),
                "velocity": float(s["zoom"]["animation"]["velocityScalarPerSecond"]),
                "requestedLevel": s["zoom"].get("requestedLevel"),
                "visibleLevel": s["zoom"].get("visibleLevel"),
                "prefetchState": s["zoom"]["animation"].get("prefetchState"),
            })
        if not s["zoom"]["animation"]["active"] and s["zoom"]["displayScaleLabel"] == DISPLAY_LADDER[index]:
            break
        time.sleep(.04)
    else:
        raise AssertionError(f"{tag}: animation did not settle")

    final = snap(driver)
    assert_focus_pose(final, focus0, pose0, tag + " final")
    if abs(float(final["zoom"]["scalar"]) - float(final["zoom"]["targetScalar"])) > 8e-5:
        raise AssertionError(f"{tag}: scalar did not reach target")
    if abs(target_scalar - before_scalar) > 1e-7:
        if int(final["zoom"]["animation"].get("frameCount") or 0) < 3:
            raise AssertionError(f"{tag}: too few animation frames")
        if float(final["zoom"]["animation"].get("lastDurationMs") or 0) < 80:
            raise AssertionError(f"{tag}: transition duration too short")
    if settle_detail:
        stable_detail(driver)
        final = snap(driver)
        assert_focus_pose(final, focus0, pose0, tag + " detail")

    shot = capture(driver, tag) if screenshot else None
    return {
        "tag": tag,
        "index": index,
        "label": DISPLAY_LADDER[index],
        "startScalar": before_scalar,
        "targetScalar": target_scalar,
        "durationMs": float(final["zoom"]["animation"].get("lastDurationMs") or 0),
        "animationFrames": int(final["zoom"]["animation"].get("frameCount") or 0),
        "labelsSeen": list(dict.fromkeys(labels)),
        "lodsSeen": [x for x in dict.fromkeys(lods) if x],
        "maxScreenFocusDeltaPixels": max_focus_delta,
        "prefetchState": final["zoom"]["animation"].get("prefetchState"),
        "prefetchRequests": int(final["zoom"]["animation"].get("prefetchRequests") or 0),
        "screenshot": shot,
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp":"WP-S003-010-003-018","target":TARGET,"pass":False}
    driver = driver_for()
    try:
        driver.get(TARGET)
        wait_ready(driver)
        set_viewport(driver, 1280, 800)
        target = deterministic_land_target(driver)
        base = snap(driver)
        focus0, pose0 = focus_tuple(base), camera_pose(base)
        evidence["seed"] = base["activeSeed"]
        evidence["targetFocus"] = {"target":target,"latitudeDegrees":focus0[0],"longitudeDegrees":focus0[1]}
        evidence["displayLadder"] = base["zoom"]["displayScaleLadder"]

        # Normal wheel input must retarget without teleporting the rendered view.
        canvas = driver.find_element("id", "planetCanvas")
        driver.execute_script("window.PlanetStage.setZoomScalar(0);")
        wheel_before = snap(driver)
        driver.execute_script("arguments[0].dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));", canvas)
        wheel_commanded = snap(driver)
        if wheel_commanded["zoom"]["targetDisplayScaleLabel"] != "1/15":
            raise AssertionError(f"wheel did not target 1/15: {wheel_commanded['zoom']}")
        if wheel_commanded["zoom"]["animation"].get("active") is not True:
            raise AssertionError("wheel zoom was instantaneous")
        if abs(float(wheel_commanded["zoom"]["scalar"]) - float(wheel_before["zoom"]["scalar"])) > 1e-6:
            raise AssertionError("wheel input teleported current scalar")
        wheel = transition_to(driver, 1, "wheel-1_15", focus0, pose0, screenshot=True, settle_detail=False)
        evidence["wheelProof"] = wheel

        # Retarget an active zoom and prove current presentation does not jump.
        driver.execute_script("window.PlanetStage.setZoomScalar(0);")
        driver.execute_script("window.PlanetStage.setAnimatedScaleIndex(4,'retarget-start');")
        time.sleep(.09)
        mid = snap(driver)
        scalar_mid = float(mid["zoom"]["scalar"])
        driver.execute_script("window.PlanetStage.setAnimatedScaleIndex(3,'retarget-reverse');")
        immediately = snap(driver)
        if abs(float(immediately["zoom"]["scalar"]) - scalar_mid) > 1e-6:
            raise AssertionError("retarget teleported rendered scalar")
        retarget = transition_to(driver, 3, "retarget-1_30", focus0, pose0, screenshot=False, settle_detail=False)
        if int(snap(driver)["zoom"]["animation"].get("retargetCount") or 0) < 1:
            raise AssertionError("retarget count missing")
        evidence["retargetProof"] = retarget

        driver.execute_script("window.PlanetStage.setZoomScalar(0);")
        transitions = []
        target_scalars = []
        for gi, group in enumerate(FORWARD_GROUPS):
            for index in group:
                if index == 0 and gi == 0:
                    shot = capture(driver, "forward-1_10")
                    s = snap(driver)
                    transitions.append({"tag":"forward-1_10","index":0,"label":"1/10","startScalar":0,"targetScalar":0,"durationMs":0,"animationFrames":0,"labelsSeen":["1/10"],"lodsSeen":[],"maxScreenFocusDeltaPixels":float((s["canonicalFocus"].get("screenSpaceFocus") or {}).get("deltaPixels") or 0),"prefetchState":s["zoom"]["animation"].get("prefetchState"),"prefetchRequests":int(s["zoom"]["animation"].get("prefetchRequests") or 0),"screenshot":shot})
                    target_scalars.append(0.0)
                    continue
                rec = transition_to(driver, index, f"forward-{DISPLAY_LADDER[index].replace('/','_')}", focus0, pose0, screenshot=True)
                transitions.append(rec)
                target_scalars.append(rec["targetScalar"])
        if any(b <= a for a,b in zip(target_scalars, target_scalars[1:])):
            raise AssertionError(f"forward target scalars not strictly increasing: {target_scalars}")

        reverse_indices = [17,16,15,14,12,11,10,9,8,4,3,2,1,0]
        reverse = []
        reverse_capture = {17,14,12,8,4,0}
        for index in reverse_indices:
            reverse.append(transition_to(driver, index, f"reverse-{DISPLAY_LADDER[index].replace('/','_')}", focus0, pose0, screenshot=index in reverse_capture))
        evidence["forward"] = transitions
        evidence["reverse"] = reverse

        stage = snap(driver)
        if int(stage["zoom"]["animation"].get("prefetchRequests") or 0) < 1:
            raise AssertionError(f"target LOD prefetch never started: {stage['zoom']['animation']}")
        if float(stage["mapPresentation"].get("semanticHysteresisRatio") or 0) <= 1:
            raise AssertionError("semantic hysteresis missing")
        if float(stage["projection"]["resourceBudget"].get("lodHysteresis") or 0) <= 0:
            raise AssertionError("LOD hysteresis missing")

        set_viewport(driver, 844, 390)
        landscape = transition_to(driver, 9, "phone-landscape-1_375", focus0, pose0, screenshot=True)
        landscape["viewport"] = driver.execute_script("const r=document.querySelector('#planetCanvas').getBoundingClientRect();return {width:r.width,height:r.height};")
        set_viewport(driver, 390, 844)
        portrait = transition_to(driver, 17, "phone-portrait-1_7500", focus0, pose0, screenshot=True)
        portrait["viewport"] = driver.execute_script("const r=document.querySelector('#planetCanvas').getBoundingClientRect();return {width:r.width,height:r.height};")
        evidence["mobile"] = {"landscape":landscape,"portrait":portrait}

        logs = driver.get_log("browser")
        severe = [x for x in logs if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe:
            raise AssertionError(f"severe browser errors: {severe[-20:]}")

        final = snap(driver)
        evidence["summary"] = {
            "version": final["version"],
            "displayMilestoneCount": len(DISPLAY_LADDER),
            "forwardTransitionCount": len(transitions),
            "reverseTransitionCount": len(reverse),
            "retargetCount": int(final["zoom"]["animation"].get("retargetCount") or 0),
            "settledCount": int(final["zoom"]["animation"].get("settledCount") or 0),
            "totalAnimationFrames": int(final["zoom"]["animation"].get("totalFrames") or 0),
            "targetPrefetchRequests": int(final["zoom"]["animation"].get("prefetchRequests") or 0),
            "targetPrefetchHits": int(final["zoom"]["animation"].get("prefetchHits") or 0),
            "targetPrefetchCompleted": int(final["zoom"]["animation"].get("prefetchCompleted") or 0),
            "semanticHysteresisRatio": float(final["mapPresentation"].get("semanticHysteresisRatio") or 0),
            "lodHysteresis": float(final["projection"]["resourceBudget"].get("lodHysteresis") or 0),
            "focusLatitudeDegrees": focus0[0],
            "focusLongitudeDegrees": focus0[1],
            "cameraEulerDegrees": pose0,
            "phoneLandscapeViewport": landscape["viewport"],
            "phonePortraitViewport": portrait["viewport"],
        }
        evidence["pass"] = True
    except Exception as exc:
        evidence["error"] = repr(exc)
        (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        raise
    finally:
        driver.quit()

    (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(evidence["summary"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
