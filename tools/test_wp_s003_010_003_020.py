#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import statistics
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/?evidence_fast_start=1"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_020_artifact")
SEED = "AGENT6-NAV-PERF-A"
BASELINE_DESKTOP = {"p95Ms": 929.7, "worstMs": 1304.6, "elapsedMs": 10463.0, "mapUpdateDelta": 72}
BASELINE_MOBILE = {"p95Ms": 53.3, "worstMs": 713.5, "elapsedMs": 1978.8, "mapUpdateDelta": 43}
EXPECTED_FINAL_SIGNATURE = {
    "seed": SEED,
    "geographyHash": "6fe0130c",
    "worldTile": {"x": "-248761", "y": "28293"},
    "latitudeDegrees": -8.928232,
    "longitudeDegrees": 7.592527,
    "scaleIndex": 0,
    "scaleLabel": "1/10",
    "semanticOrderingSignature": "5BD86CDF",
    "borderTopologySignature": None,
    "coordinateFabricRevision": "SCF-B83ABE19",
}


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
    # Startup/benchmark tasks can temporarily occupy software WebGL. Keep the
    # Selenium transport timeout above the script timeout so the harness reports
    # game assertions rather than a client-side 120 s socket timeout.
    try:
        d.command_executor.set_timeout(300)
    except Exception:
        try:
            d.command_executor._client_config.timeout = 300
        except Exception:
            pass
    d.set_script_timeout(240)
    d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
        "screenWidth": width, "screenHeight": height,
        "screenOrientation": {"type": "landscapePrimary", "angle": 90},
    })
    return d


def wait(driver, script, timeout=120, *args):
    return WebDriverWait(driver, timeout).until(lambda d: d.execute_script(script, *args))


def snap(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def wait_ready(driver):
    wait(driver, "return document.readyState==='complete'", 60)
    wait(driver, "return typeof window.SeedSystem?.startNewCampaign==='function'", 60)
    driver.execute_script(
        "const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim();"
        "if(s!=='ACTIVE'&&b)b.click();"
    )
    wait(driver, "return document.getElementById('planetStageRoot')?.dataset?.ready==='true'", 240)


def set_seed(driver):
    result = driver.execute_script(
        "const seed=String(arguments[0]);"
        "const campaign=window.SeedSystem.startNewCampaign(seed);"
        "const planet=window.PlanetGeography.persistSeed(seed);"
        "return {campaign,planet};", SEED
    )
    if not result or result.get("campaign", {}).get("ok") is not True or result.get("planet") != SEED:
        raise AssertionError(f"seed setup failed: {result}")
    driver.refresh()
    wait_ready(driver)
    if snap(driver).get("activeSeed") != SEED:
        raise AssertionError("fixed benchmark seed did not persist")


def set_viewport(driver, width, height):
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": int(width), "height": int(height), "deviceScaleFactor": 1, "mobile": False,
        "screenWidth": int(width), "screenHeight": int(height),
        "screenOrientation": {"type": "landscapePrimary" if width > height else "portraitPrimary", "angle": 90 if width > height else 0},
    })
    driver.execute_script("window.dispatchEvent(new Event('resize'));")
    time.sleep(.5)


def settle_scale(driver, index, timeout=180):
    driver.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);", int(index))
    wait(driver, "return window.PlanetStage.snapshot().zoom.scaleIndex===arguments[0]", 30, int(index))
    def stable(d):
        s = d.execute_script("return window.PlanetStage.snapshot()")
        if bool(s["zoom"].get("animating")):
            return False
        if float(s["zoom"]["scalar"]) <= float(s["projection"]["transitionStart"]):
            return True
        rb = s["projection"]["resourceBudget"]
        return int(rb.get("pendingPreparationCount") or 0) == 0
    WebDriverWait(driver, timeout).until(stable)
    time.sleep(.4)
    return snap(driver)


def capture(driver, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"screenshot failed: {path}")
    return path.name


def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(float(x) for x in values)
    index = min(len(ordered)-1, max(0, math.ceil(q*len(ordered))-1))
    return ordered[index]


def install_observers(driver):
    driver.execute_script("""
      window.__wp020LongTasks=[];
      window.__wp020Frames=[];
      window.__wp020FrameActive=true;
      window.__wp020LastFrame=performance.now();
      try{
        window.__wp020LongObserver?.disconnect?.();
        window.__wp020LongObserver=new PerformanceObserver(list=>{
          for(const e of list.getEntries())window.__wp020LongTasks.push({startTime:e.startTime,duration:e.duration,name:e.name});
        });
        window.__wp020LongObserver.observe({entryTypes:['longtask']});
      }catch(_){window.__wp020LongObserver=null;}
      const tick=(now)=>{
        if(!window.__wp020FrameActive)return;
        const last=window.__wp020LastFrame;
        if(Number.isFinite(last))window.__wp020Frames.push(now-last);
        window.__wp020LastFrame=now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    """)


def clear_samples(driver):
    driver.execute_script("window.__wp020LongTasks=[];window.__wp020Frames=[];window.__wp020LastFrame=performance.now();")


def collect_samples(driver):
    return driver.execute_script("""
      return {
        longTasks:(window.__wp020LongTasks||[]).map(x=>({startTime:Number(x.startTime),duration:Number(x.duration),name:String(x.name||'')})),
        frames:(window.__wp020Frames||[]).map(Number)
      };
    """)


def summarize_times(values):
    values = [float(v) for v in values if float(v) >= 0]
    return {
        "count": len(values),
        "medianMs": round(statistics.median(values), 3) if values else 0.0,
        "p95Ms": round(percentile(values, .95), 3),
        "worstMs": round(max(values), 3) if values else 0.0,
    }


def rotation_benchmark(driver, steps=72):
    clear_samples(driver)
    before = snap(driver)
    result = driver.execute_script("""
      const count=Number(arguments[0]),samples=[];
      const before=window.PlanetStage.snapshot();
      const basePitch=Number(before.rotation.pitchDegrees||0);
      const baseYaw=Number(before.rotation.yawDegrees||0);
      const started=performance.now();
      for(let i=0;i<count;i++){
        const t=performance.now();
        const yaw=baseYaw+(i+1)*3.25;
        const pitch=basePitch+Math.sin(i*.31)*8;
        window.PlanetStage.setRotation(yaw,pitch);
        samples.push(performance.now()-t);
      }
      return {
        elapsedMs:performance.now()-started,
        samples,
        mapUpdatesBefore:Number(before.mapPresentation?.updateCount||0)
      };
    """, int(steps))
    time.sleep(.7)
    after = snap(driver)
    observed = collect_samples(driver)
    result["mapUpdatesAfter"] = int(after.get("mapPresentation", {}).get("updateCount") or 0)
    result["mapUpdateDelta"] = result["mapUpdatesAfter"] - int(result["mapUpdatesBefore"])
    before_nav = before.get("navigationPerformance") or {}
    after_nav = after.get("navigationPerformance") or {}
    result["internalLongTask50Delta"] = int(after_nav.get("longTask50Count") or 0) - int(before_nav.get("longTask50Count") or 0)
    result["internalLongTaskWorstMs"] = round(float(after_nav.get("longTaskWorstMs") or 0), 3)
    result["callTiming"] = summarize_times(result.pop("samples"))
    result["frameTiming"] = summarize_times(observed.get("frames") or [])
    result["longTasks"] = observed.get("longTasks") or []
    result["longTask50Count"] = sum(1 for x in result["longTasks"] if float(x.get("duration") or 0) > 50)
    result["longTaskWorstMs"] = round(max([float(x.get("duration") or 0) for x in result["longTasks"]] or [0]), 3)
    return result


def paced_rotation_benchmark(driver, steps=36, delay_seconds=0.022):
    clear_samples(driver)
    before = snap(driver)
    samples = []
    for i in range(int(steps)):
        result = driver.execute_script("""
          const t=performance.now();
          window.PlanetStage.rotateByScreenPixels(Number(arguments[0]),Number(arguments[1]));
          return performance.now()-t;
        """, 5.0, math.sin(i*.27)*2.0)
        samples.append(float(result or 0))
        time.sleep(delay_seconds)
    time.sleep(.35)
    after = snap(driver)
    observed = collect_samples(driver)
    longs = observed.get("longTasks") or []
    before_nav = before.get("navigationPerformance") or {}
    after_nav = after.get("navigationPerformance") or {}
    return {
        "steps": int(steps),
        "delaySeconds": delay_seconds,
        "callTiming": summarize_times(samples),
        "frameTiming": summarize_times(observed.get("frames") or []),
        "internalLongTask50Delta": int(after_nav.get("longTask50Count") or 0) - int(before_nav.get("longTask50Count") or 0),
        "internalLongTaskWorstMs": round(float(after_nav.get("longTaskWorstMs") or 0), 3),
        "longTask50Count": sum(1 for x in longs if float(x.get("duration") or 0) > 50),
        "longTaskWorstMs": round(max([float(x.get("duration") or 0) for x in longs] or [0]), 3),
        "longTasks": longs,
        "mapUpdateDelta": int(after.get("mapPresentation", {}).get("updateCount") or 0) - int(before.get("mapPresentation", {}).get("updateCount") or 0),
    }


def animated_zoom_benchmark(driver, target_index):
    clear_samples(driver)
    started = time.time()
    driver.execute_script("window.PlanetStage.setAnimatedScaleIndex(arguments[0]);", int(target_index))
    WebDriverWait(driver, 90).until(lambda d: not bool(d.execute_script("return window.PlanetStage.snapshot().zoom.animating")))
    elapsed = (time.time()-started)*1000
    time.sleep(.25)
    observed = collect_samples(driver)
    longs = observed.get("longTasks") or []
    return {
        "targetIndex": int(target_index),
        "elapsedWallMs": round(elapsed, 3),
        "frameTiming": summarize_times(observed.get("frames") or []),
        "longTask50Count": sum(1 for x in longs if float(x.get("duration") or 0) > 50),
        "longTaskWorstMs": round(max([float(x.get("duration") or 0) for x in longs] or [0]), 3),
    }


def capture_navigation_sequence(driver):
    set_viewport(driver, 1280, 800)
    settle_scale(driver, 0)
    start = snap(driver)
    base_yaw = float(start["rotation"]["yawDegrees"])
    base_pitch = float(start["rotation"]["pitchDegrees"])
    frames = []
    for idx, (dyaw, dpitch) in enumerate([(0, 0), (7, 2), (14, -2), (21, 3), (28, 0)]):
        driver.execute_script("window.PlanetStage.setRotation(arguments[0],arguments[1]);", base_yaw + dyaw, base_pitch + dpitch)
        time.sleep(.10)
        frames.append({"phase": f"rotate-{idx}", "screenshot": capture(driver, f"sequence-rotate-{idx}")})

    driver.execute_script("window.PlanetStage.setAnimatedScaleIndex(5,'wp020-sequence');")
    for idx, pause in enumerate((.035, .055, .075)):
        time.sleep(pause)
        stage = snap(driver)
        frames.append({
            "phase": f"zoom-{idx}",
            "scale": stage["zoom"]["displayScaleLabel"],
            "scalar": stage["zoom"]["scalar"],
            "screenshot": capture(driver, f"sequence-zoom-{idx}"),
        })
    WebDriverWait(driver, 90).until(lambda d: not bool(d.execute_script("return window.PlanetStage.snapshot().zoom.animating")))
    frames.append({"phase": "zoom-settled", "screenshot": capture(driver, "sequence-zoom-settled")})
    settle_scale(driver, 0)
    return frames


def deterministic_signature(stage):
    return {
        "seed": stage.get("activeSeed"),
        "geographyHash": stage.get("geographyHash"),
        "worldTile": stage.get("canonicalFocus", {}).get("worldTile"),
        "latitudeDegrees": stage.get("canonicalFocus", {}).get("latitudeDegrees"),
        "longitudeDegrees": stage.get("canonicalFocus", {}).get("longitudeDegrees"),
        "scaleIndex": stage.get("zoom", {}).get("scaleIndex"),
        "scaleLabel": stage.get("zoom", {}).get("scaleLabel"),
        "semanticOrderingSignature": stage.get("mapPresentation", {}).get("semanticOrderingSignature"),
        "borderTopologySignature": stage.get("mapPresentation", {}).get("borderTopologySignature"),
        "coordinateFabricRevision": stage.get("mapPresentation", {}).get("coordinateFabricRevision"),
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp":"WP-S003-010-003-020","target":TARGET,"seed":SEED,"pass":False}
    d = driver_for()
    try:
        d.get(TARGET)
        wait_ready(d)
        set_seed(d)
        set_viewport(d, 1280, 800)
        settle_scale(d, 0)
        install_observers(d)
        time.sleep(.25)

        baseline_signature = deterministic_signature(snap(d))
        rotation = rotation_benchmark(d)
        broad_shot = capture(d, "desktop-broad-after-rotation")

        forward = animated_zoom_benchmark(d, 5)
        mid = settle_scale(d, 5)
        mid_shot = capture(d, "desktop-mid-after-zoom")
        reverse = animated_zoom_benchmark(d, 0)
        far = settle_scale(d, 0)

        set_viewport(d, 844, 390)
        mobile_rotation = rotation_benchmark(d, 42)
        mobile_shot = capture(d, "phone-landscape-rotation")

        final = snap(d)
        final_signature = deterministic_signature(final)
        if final_signature != EXPECTED_FINAL_SIGNATURE:
            raise AssertionError(f"canonical benchmark signature changed vs pre-optimization baseline: {final_signature}")

        # Normal input cadence: separate browser tasks with a short inter-event delay.
        # This is the authoritative >50 ms long-task acceptance path; unlike the
        # synchronous stress loop above, it models actual pointer/key navigation.
        set_viewport(d, 1280, 800)
        settle_scale(d, 0)
        paced_rotation = paced_rotation_benchmark(d, 36)
        paced_shot = capture(d, "desktop-paced-rotation")
        sequence = capture_navigation_sequence(d)

        logs = d.get_log("browser")
        severe = [x for x in logs if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe:
            raise AssertionError(f"severe browser errors: {severe[-20:]}")

        nav = final.get("navigationPerformance") or {}
        optimized = nav.get("revision") == "world-map-navigation-budget-v1"
        evidence.update({
            "optimizedTelemetryPresent": optimized,
            "baselineReference": {"desktop": BASELINE_DESKTOP, "mobile": BASELINE_MOBILE},
            "baselineSignature": baseline_signature,
            "finalSignature": final_signature,
            "navigationSequence": sequence,
            "desktop": {
                "rotation": rotation,
                "forwardZoom": forward,
                "reverseZoom": reverse,
                "broadScreenshot": broad_shot,
                "midScreenshot": mid_shot,
                "pacedRotation": paced_rotation,
                "pacedScreenshot": paced_shot,
            },
            "mobile": {
                "viewport": {"width":844,"height":390},
                "rotation": mobile_rotation,
                "screenshot": mobile_shot,
            },
            "navigationPerformance": nav,
            "mapPresentation": {
                "lastUpdateMs": final.get("mapPresentation", {}).get("lastUpdateMs"),
                "updateCount": final.get("mapPresentation", {}).get("updateCount"),
                "labelQueryBuildMs": final.get("mapPresentation", {}).get("labelQueryBuildMs"),
                "atlasCandidateCount": final.get("mapPresentation", {}).get("atlasCandidateCount"),
                "atlasQueryCellCount": final.get("mapPresentation", {}).get("atlasQueryCellCount"),
                "markerFullWorldScan": final.get("mapPresentation", {}).get("markerFullWorldScan"),
                "fullWorldScan": final.get("mapPresentation", {}).get("fullWorldScan"),
            },
            "pass": True,
        })
        if optimized:
            if nav.get("fullWorldScan") is not False or nav.get("bounded") is not True:
                raise AssertionError(f"navigation budget contract invalid: {nav}")
            if int(nav.get("semanticUpdateCoalescedCount") or 0) <= 0:
                raise AssertionError(f"semantic updates were not coalesced: {nav}")
            if rotation["mapUpdateDelta"] >= 36:
                raise AssertionError(f"desktop rotation still rebuilds semantic map too often: {rotation['mapUpdateDelta']}")
            if mobile_rotation["mapUpdateDelta"] >= 24:
                raise AssertionError(f"mobile rotation still rebuilds semantic map too often: {mobile_rotation['mapUpdateDelta']}")
            if rotation["callTiming"]["p95Ms"] >= BASELINE_DESKTOP["p95Ms"] * .25 or rotation["callTiming"]["worstMs"] >= 50:
                raise AssertionError(f"desktop rotation timing did not materially improve: {rotation}")
            if mobile_rotation["callTiming"]["p95Ms"] >= BASELINE_MOBILE["p95Ms"] * .5 or mobile_rotation["callTiming"]["worstMs"] >= 50:
                raise AssertionError(f"mobile rotation timing did not materially improve: {mobile_rotation}")
            if rotation["longTask50Count"] != 0 or rotation["internalLongTask50Delta"] != 0:
                raise AssertionError(f"desktop rotation produced >50 ms navigation tasks: {rotation}")
            if mobile_rotation["longTask50Count"] != 0 or mobile_rotation["internalLongTask50Delta"] != 0:
                raise AssertionError(f"mobile rotation produced >50 ms navigation tasks: {mobile_rotation}")
            if paced_rotation["longTask50Count"] != 0 or paced_rotation["internalLongTask50Delta"] != 0:
                raise AssertionError(f"paced desktop navigation produced >50 ms long tasks: {paced_rotation}")
            if forward["longTask50Count"] != 0 or reverse["longTask50Count"] != 0:
                raise AssertionError(f"animated zoom produced >50 ms long tasks: forward={forward} reverse={reverse}")
            if paced_rotation["mapUpdateDelta"] >= 24:
                raise AssertionError(f"paced desktop navigation still rebuilds semantic map too often: {paced_rotation['mapUpdateDelta']}")
    except Exception as exc:
        evidence["error"] = repr(exc)
        raise
    finally:
        try:
            d.execute_script("window.__wp020FrameActive=false;window.__wp020LongObserver?.disconnect?.();")
        except Exception:
            pass
        (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        d.quit()

    print(json.dumps({
        "optimized": evidence["optimizedTelemetryPresent"],
        "desktopRotation": evidence["desktop"]["rotation"],
        "mobileRotation": evidence["mobile"]["rotation"],
        "signature": evidence["finalSignature"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
