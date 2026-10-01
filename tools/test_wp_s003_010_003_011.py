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

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_011_artifact")
LABELS = ["1/10","1/20","1/50","1/100","1/250","1/500","1/1000","1/2500","1/5000","1/10000"]


def driver_for():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--enable-webgl")
    options.add_argument("--ignore-gpu-blocklist")
    options.add_argument("--use-angle=swiftshader")
    options.add_argument("--window-size=1280,800")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=options)


def wait(driver, script, timeout=120, *args):
    return WebDriverWait(driver, timeout).until(lambda d: d.execute_script(script, *args))


def snap(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def wait_ready(driver):
    wait(driver, "return document.readyState==='complete'", 60)
    driver.execute_script(
        "const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim();"
        "if(s!=='ACTIVE'&&b)b.click();"
    )
    wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true", 180)


def set_scale(driver, index, settle=True):
    driver.execute_script("return window.PlanetStage.setScaleIndex(arguments[0]);", int(index))
    wait(driver, "return window.PlanetStage.snapshot().zoom.scaleIndex===arguments[0]", 30, int(index))
    if settle and index >= 5:
        wait(driver, """
          const s=window.PlanetStage.snapshot(),r=s.projection?.resourceBudget||{};
          return Number(r.pendingPreparationCount||0)===0 &&
                 r.preparing!==true &&
                 (!r.requestedSignature || !r.activeSignature || String(r.requestedSignature)===String(r.activeSignature));
        """, 180)
    time.sleep(.35)
    return snap(driver)


def scale_dom(driver):
    return driver.execute_script("""
      const root=document.querySelector('.planet-scale-ruler'),line=root?.querySelector('.planet-scale-line'),label=root?.querySelector('.planet-scale-meta strong');
      const rect=line?.getBoundingClientRect?.(),canvas=document.querySelector('#planetCanvas')?.getBoundingClientRect?.();
      return {label:label?.textContent?.trim()||'',linePixels:Number(rect?.width||0),canvasWidth:Number(canvas?.width||0)};
    """)


def tuple_close(a, b, tol=1e-6):
    return len(a) == len(b) and all(abs(float(x)-float(y)) <= tol for x, y in zip(a, b))


def pose_record(stage):
    pose = stage["zoom"]["pose"]
    return {
        "spherePosition": pose["sphere"]["position"],
        "sphereQuaternion": pose["sphere"]["rotationQuaternion"],
        "cameraPosition": pose["camera"]["position"],
        "cameraQuaternion": pose["camera"]["rotationQuaternion"],
        "cameraLookVector": pose["cameraLookVector"],
        "cameraTarget": pose["cameraTarget"],
    }


def assert_pose(label, baseline, current):
    for key in baseline:
        if not tuple_close(baseline[key], current[key], 1e-6):
            raise AssertionError(f"{label}: zoom changed {key}: {baseline[key]} -> {current[key]}")


def focus_record(stage):
    c = stage["canonicalFocus"]
    return (float(c["latitudeDegrees"]), float(c["longitudeDegrees"]))


def assert_focus(label, baseline, stage):
    current = focus_record(stage)
    if abs(current[0]-baseline[0]) > 1e-6 or abs(current[1]-baseline[1]) > 1e-6:
        raise AssertionError(f"{label}: canonical focus drifted: {baseline} -> {current}")
    sf = stage["zoom"]["pose"]["screenFocus"]
    if sf.get("valid") is not True or float(sf.get("deltaPixels") or 0) > 2.0:
        raise AssertionError(f"{label}: screen-space focus left center: {sf}")


def assert_ruler(label, driver, stage):
    mp = stage["mapPresentation"]
    dom = scale_dom(driver)
    expected = stage["zoom"]["scaleLabel"]
    if dom["label"] != expected or mp.get("scaleStateLabel") != expected:
        raise AssertionError(f"{label}: displayed scale mismatch: {dom}, {mp.get('scaleStateLabel')}, {expected}")
    px = float(dom["linePixels"])
    telemetry_px = float(mp.get("scalePixelLength") or 0)
    mpp = float(mp.get("metersPerScreenPixel") or 0)
    distance = float(mp.get("scaleDistanceMeters") or 0)
    if px <= 0 or mpp <= 0 or distance <= 0:
        raise AssertionError(f"{label}: invalid ruler metrics: {dom}, {mp}")
    if abs(px-telemetry_px) > 0.75:
        raise AssertionError(f"{label}: rendered ruler length != telemetry: DOM {px}, telemetry {telemetry_px}")
    error = abs(px*mpp-distance)
    if error > max(.5, mpp*1.0):
        raise AssertionError(f"{label}: ruler physically false by {error:.3f} m: {dom}, {mp}")
    if float(mp.get("rulerTruthErrorMeters") or 0) > max(.01, distance*1e-6):
        raise AssertionError(f"{label}: ruler math truth error too large: {mp}")


def capture(driver, name):
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"Screenshot failed: {path}")
    return path.name


def land_target(driver):
    candidates = driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed,reps=window.RegionProfile?.representatives?.(seed)||[];
      return reps.map(r=>({id:r.id,name:r.name,x:String(r.administrativeSeat?.x??'0'),y:String(r.administrativeSeat?.y??'0')}))
        .sort((a,b)=>(Math.abs(Number(b.x))+Math.abs(Number(b.y)))-(Math.abs(Number(a.x))+Math.abs(Number(a.y)))||a.id.localeCompare(b.id))
        .slice(0,24);
    """) or []
    if not candidates:
        candidates = [{"id":"origin","name":"Origin","x":"0","y":"0"}]
    for item in candidates:
        driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setScaleIndex(0);", item["x"], item["y"])
        time.sleep(.12)
        stage = snap(driver)
        center = stage.get("canonicalFocus", {}).get("surfaceIdentity", {}).get("center", {})
        rot = stage.get("rotation", {})
        if center.get("land") is True and abs(float(rot.get("yawDegrees") or 0)) >= 10 and abs(float(rot.get("pitchDegrees") or 0)) >= 5:
            return item
    for item in candidates:
        driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setScaleIndex(0);", item["x"], item["y"])
        time.sleep(.12)
        stage = snap(driver)
        if stage.get("canonicalFocus", {}).get("surfaceIdentity", {}).get("center", {}).get("land") is True:
            return item
    raise AssertionError("No deterministic seeded land target available for zoom evidence")


def haversine_meters(a, b, radius):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2-lat1, lon2-lon1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2*radius*math.asin(min(1.0, math.sqrt(max(0.0, h))))


def run_seed(driver, evidence, seed_tag, capture_all):
    target = land_target(driver)
    driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", target["x"], target["y"])
    baseline_stage = set_scale(driver, 0)
    baseline_pose = pose_record(baseline_stage)
    baseline_focus = focus_record(baseline_stage)
    if baseline_stage["rotation"]["yawDegrees"] == 0 and baseline_stage["rotation"]["pitchDegrees"] == 0:
        raise AssertionError("Evidence orientation is not asymmetric")

    forward = []
    indices = range(len(LABELS)) if capture_all else (0, 5, 9)
    for index in indices:
        stage = set_scale(driver, index)
        if stage["zoom"]["scaleLabel"] != LABELS[index]:
            raise AssertionError(f"{seed_tag} scale {index}: expected {LABELS[index]}, got {stage['zoom']['scaleLabel']}")
        assert_pose(f"{seed_tag} {LABELS[index]}", baseline_pose, pose_record(stage))
        assert_focus(f"{seed_tag} {LABELS[index]}", baseline_focus, stage)
        assert_ruler(f"{seed_tag} {LABELS[index]}", driver, stage)
        if stage["projection"]["presentation"].get("cameraPoseInvariant") is not True:
            raise AssertionError(f"{seed_tag} {LABELS[index]}: camera invariant telemetry missing")
        frame = {
            "seedTag": seed_tag,
            "index": index,
            "scale": LABELS[index],
            "scalar": stage["zoom"]["scalar"],
            "band": stage["zoom"]["band"],
            "visibleLevel": stage["zoom"].get("visibleLevel"),
            "footprintWidthMeters": stage["zoom"]["visibleFootprintWidthMeters"],
            "footprintHeightMeters": stage["zoom"]["visibleFootprintHeightMeters"],
            "sampleSpacingMeters": stage["projection"]["localDetail"].get("sampleSpacingMeters"),
            "mapPresentation": {
                "scaleDistanceMeters": stage["mapPresentation"].get("scaleDistanceMeters"),
                "scalePixelLength": stage["mapPresentation"].get("scalePixelLength"),
                "metersPerScreenPixel": stage["mapPresentation"].get("metersPerScreenPixel"),
                "rulerTruthErrorMeters": stage["mapPresentation"].get("rulerTruthErrorMeters"),
                "visibleLabelCount": stage["mapPresentation"].get("atlasVisibleLabelCount"),
                "landmarkVisibleCount": stage["mapPresentation"].get("landmarkVisibleCount"),
                "borderSegmentCount": stage["mapPresentation"].get("projectedBorderSegmentCount"),
            },
            "dragSensitivity": stage["zoom"]["dragSensitivity"],
            "pose": stage["zoom"]["pose"],
        }
        if capture_all or index in (0, 5, 9):
            frame["screenshot"] = capture(driver, f"{seed_tag}-{index:02d}-{LABELS[index].replace('/','_')}")
        evidence["frames"].append(frame)
        forward.append(stage)

    if capture_all:
        widths = [float(x["zoom"]["visibleFootprintWidthMeters"]) for x in forward]
        if any(widths[i+1] >= widths[i] for i in range(len(widths)-1)):
            raise AssertionError(f"Visible footprint did not strictly shrink through scale ladder: {widths}")
        if forward[-1]["projection"]["localDetail"].get("active") is not True:
            raise AssertionError("Finest scale did not activate bounded local detail")
        if float(forward[-1]["projection"]["localDetail"].get("sampleSpacingMeters") or 999999) > 5:
            raise AssertionError(f"Finest scale detail resolution too coarse: {forward[-1]['projection']['localDetail']}")

        reverse = []
        for index in range(len(LABELS)-2, -1, -1):
            stage = set_scale(driver, index)
            assert_pose(f"reverse {LABELS[index]}", baseline_pose, pose_record(stage))
            assert_focus(f"reverse {LABELS[index]}", baseline_focus, stage)
            assert_ruler(f"reverse {LABELS[index]}", driver, stage)
            reverse.append({"index":index,"scale":LABELS[index],"scalar":stage["zoom"]["scalar"],"focus":focus_record(stage)})
        evidence["reverse"] = reverse

        drag = []
        radius = float(baseline_stage["worldRadiusMeters"])
        for index in range(len(LABELS)):
            driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", target["x"], target["y"])
            stage = set_scale(driver, index)
            before = focus_record(stage)
            sensitivity = stage["zoom"]["dragSensitivity"]
            driver.execute_script("window.PlanetStage.rotateByScreenPixels(100,0);")
            time.sleep(.10)
            after_stage = snap(driver)
            after = focus_record(after_stage)
            moved = haversine_meters(before, after, radius)
            expected = float(sensitivity["sampleHorizontalMeters"])
            if expected > 0 and abs(moved-expected)/expected > .08:
                raise AssertionError(f"Scale-aware drag mismatch at {LABELS[index]}: moved {moved:.3f} m expected {expected:.3f} m")
            drag.append({"index":index,"scale":LABELS[index],"pixels":100,"movedMeters":moved,"expectedMeters":expected,"sensitivity":sensitivity})
        moved_values = [row["movedMeters"] for row in drag]
        if any(moved_values[i+1] > moved_values[i]*1.02 for i in range(len(moved_values)-1)):
            raise AssertionError(f"Equal-pixel drag did not get finer with zoom: {moved_values}")
        if moved_values[-1] >= moved_values[0]*.01:
            raise AssertionError(f"Ground drag is not sufficiently finer than planet drag: {moved_values[0]} -> {moved_values[-1]}")
        evidence["drag"] = drag

    return {"seed": baseline_stage["activeSeed"], "target": target, "baselinePose": baseline_pose, "baselineFocus": baseline_focus}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp":"WP-S003-010-003-011","target":TARGET,"pass":False,"frames":[]}
    driver = driver_for()
    try:
        driver.get(TARGET)
        wait_ready(driver)
        primary = run_seed(driver, evidence, "seed-a", True)

        second_seed = "AGENT6-PURE-ZOOM-B"
        result = driver.execute_script(
            "const seed=String(arguments[0]);"
            "const campaign=window.SeedSystem.startNewCampaign(seed);"
            "const planet=window.PlanetGeography.persistSeed(seed);"
            "return {campaign,planet};",
            second_seed,
        )
        if not result or result.get("campaign", {}).get("ok") is not True or result.get("planet") != second_seed:
            raise AssertionError(f"Could not create independent authoritative seed: {result}")
        driver.refresh()
        wait_ready(driver)
        if snap(driver).get("activeSeed") != second_seed:
            raise AssertionError(f"Second planet seed did not become authoritative: {snap(driver).get('activeSeed')}")
        secondary = run_seed(driver, evidence, "seed-b", False)

        logs = driver.get_log("browser")
        severe = [x for x in logs if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe:
            raise AssertionError(f"Severe browser errors: {severe[-20:]}")

        evidence["primary"] = primary
        evidence["secondary"] = secondary
        evidence["pass"] = True
        evidence["summary"] = {
            "labels": LABELS,
            "primarySeed": primary["seed"],
            "secondarySeed": secondary["seed"],
            "frameCount": len(evidence["frames"]),
            "reverseStateCount": len(evidence.get("reverse", [])),
            "dragStateCount": len(evidence.get("drag", [])),
            "planetDrag100pxMeters": evidence["drag"][0]["movedMeters"],
            "groundDrag100pxMeters": evidence["drag"][-1]["movedMeters"],
            "maxRulerTruthErrorMeters": max(float(f["mapPresentation"]["rulerTruthErrorMeters"] or 0) for f in evidence["frames"]),
        }
        (OUT_DIR/"evidence.json").write_text(json.dumps(evidence,indent=2,sort_keys=True),encoding="utf-8")
        print(json.dumps(evidence["summary"],indent=2,sort_keys=True))
    except Exception as exc:
        evidence["error"] = repr(exc)
        evidence["browserLogs"] = driver.get_log("browser")[-200:]
        (OUT_DIR/"evidence.json").write_text(json.dumps(evidence,indent=2,sort_keys=True),encoding="utf-8")
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
