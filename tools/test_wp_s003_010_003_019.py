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
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_019_artifact")


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
    # Startup can legitimately occupy software-WebGL for tens of seconds on a
    # hosted runner. Let a cheap readiness probe wait through that work instead
    # of failing at Selenium's shorter script timeout.
    d.set_script_timeout(180)
    d.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
        "screenWidth": width, "screenHeight": height,
        "screenOrientation": {"type": "landscapePrimary" if width > height else "portraitPrimary", "angle": 90 if width > height else 0},
    })
    return d


def set_viewport(driver, width, height):
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": int(width), "height": int(height), "deviceScaleFactor": 1, "mobile": False,
        "screenWidth": int(width), "screenHeight": int(height),
        "screenOrientation": {"type": "landscapePrimary" if width > height else "portraitPrimary", "angle": 90 if width > height else 0},
    })
    driver.execute_script("window.dispatchEvent(new Event('resize'));")
    deadline = time.time() + 15
    while time.time() < deadline:
        s = driver.execute_script("""
          const r=document.querySelector('#planetCanvas')?.getBoundingClientRect?.();
          return {iw:innerWidth,ih:innerHeight,cw:Number(r?.width||0),ch:Number(r?.height||0)};
        """)
        if abs(s["iw"]-width)<=2 and abs(s["ih"]-height)<=2 and s["cw"]>=width*.90 and s["ch"]>=height*.90:
            time.sleep(.5)
            return
        time.sleep(.1)
    raise AssertionError(f"viewport failed to settle: {width}x{height}")


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
    # Do not build the full telemetry snapshot repeatedly during startup.
    # The stage itself publishes this cheap readiness flag only after the first
    # playable frame is ready.
    wait(driver, "return document.getElementById('planetStageRoot')?.dataset?.ready==='true'", 240)
    stage = snap(driver)
    if stage.get("mapPresentation", {}).get("active") is not True:
        wait(driver, "return window.PlanetStage?.snapshot?.()?.mapPresentation?.active===true", 60)
        stage = snap(driver)
    if stage.get("version") != "planet-focus-streaming-v1":
        raise AssertionError(f"unexpected PlanetStage version: {stage.get('version')}")


def capture(driver, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"screenshot failed: {path}")
    return path.name


def focus_starting_village(driver):
    target = driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed;
      const p=window.StartingVillage?.plan?.(seed);
      return p?.center?{x:String(p.center.x),y:String(p.center.y),name:String(p.name||'Starting Village')}:{x:'0',y:'0',name:'Starting Village'};
    """)
    driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", target["x"], target["y"])
    time.sleep(.4)
    return target


def settle_scale(driver, index, timeout=150):
    driver.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);", int(index))
    wait(driver, "return window.PlanetStage.snapshot().zoom.scaleIndex===arguments[0]", 30, int(index))
    def stable(d):
        s = d.execute_script("return window.PlanetStage.snapshot()")
        if float(s["zoom"]["scalar"]) <= float(s["projection"]["transitionStart"]):
            return True
        rb = s["projection"]["resourceBudget"]
        return int(rb.get("pendingPreparationCount") or 0) == 0 and (
            not rb.get("requestedLevel") or rb.get("requestedLevel") == rb.get("visibleLevel")
        )
    WebDriverWait(driver, timeout).until(stable)
    time.sleep(.6)
    return snap(driver)


def streaming(stage):
    return stage["projection"]["spatialLod"]["focusStreaming"]


def assert_streaming(stage, label, require_local=False):
    slod = stage["projection"]["spatialLod"]
    fs = slod.get("focusStreaming") or {}
    if fs.get("revision") != "focus-streaming-v1" or fs.get("centerFirst") is not True:
        raise AssertionError(f"{label}: focus-streaming contract missing")
    if fs.get("fullWorldScan") is not False or slod.get("fullWorldScan") is not False:
        raise AssertionError(f"{label}: full world scan enabled")
    if fs.get("globalHighDetailMaterialized") is not False:
        raise AssertionError(f"{label}: global high detail materialized")
    rings = fs.get("rings") or []
    if [r.get("id") for r in rings] != ["focus","medium","outer","global-root"]:
        raise AssertionError(f"{label}: bad ring order {rings}")
    spans = [rings[0].get("spanFactor"), rings[1].get("spanFactor"), rings[2].get("spanFactor")]
    if spans != [1,3,6]:
        raise AssertionError(f"{label}: bad ring spans {spans}")
    cache = fs.get("cache") or {}
    if int(cache.get("entries") or 0) > int(cache.get("limit") or 0):
        raise AssertionError(f"{label}: cache entry budget exceeded {cache}")
    if int(cache.get("usedBytes") or 0) > int(cache.get("budgetBytes") or 0):
        raise AssertionError(f"{label}: cache byte budget exceeded {cache}")
    if cache.get("budgetExceeded") is True:
        raise AssertionError(f"{label}: cache budget flagged exceeded")
    handoff = fs.get("handoff") or {}
    if int(handoff.get("missingCoverageCount") or 0) != 0:
        raise AssertionError(f"{label}: missing coverage recorded {handoff}")
    if require_local:
        mpts = [rings[i].get("metersPerTexel") for i in range(3)]
        if any(v is None for v in mpts):
            raise AssertionError(f"{label}: local ring density missing {mpts}")
        if not (float(mpts[0]) < float(mpts[1]) < float(mpts[2])):
            raise AssertionError(f"{label}: center-first density order failed {mpts}")
        if rings[0].get("status") not in ("ready","active","parent-fallback"):
            raise AssertionError(f"{label}: unexpected focus status {rings[0]}")
        if rings[1].get("status") != "ready" or rings[2].get("status") != "ready":
            raise AssertionError(f"{label}: medium/outer coverage not ready {rings}")
    return {
        "scale": stage["zoom"]["scaleLabel"],
        "footprintMeters": stage["zoom"]["visibleFootprintHeightMeters"],
        "rings": rings,
        "states": fs.get("states"),
        "cache": cache,
        "handoff": handoff,
        "budget": fs.get("budget"),
        "motionPrefetch": fs.get("motionPrefetch"),
        "activeCellsByLod": fs.get("activeCellsByLod"),
        "localStatic": {
            "tier": stage["projection"]["localStatic"].get("revealTier"),
            "roads": stage["projection"]["localStatic"].get("roadCount"),
            "buildings": stage["projection"]["localStatic"].get("buildingCount"),
            "occupiedAreas": stage["projection"]["localStatic"].get("occupiedAreaCount"),
        },
        "focusDeltaPixels": stage["canonicalFocus"].get("screenSpaceFocusDeltaPixels"),
    }


def move_across_cell_and_back(driver, stage):
    original = stage["canonicalFocus"]["worldTile"]
    cell = stage["projection"]["spatialLod"]["requestedCell"]
    tile_m = float(stage["projection"]["worldTileProjection"].get("tileMeters") or 2)
    delta_tiles = max(16, int(math.ceil(float(cell["cellSizeMeters"]) / tile_m * 1.15)))
    before = snap(driver)["projection"]["resourceBudget"]
    driver.execute_script("""
      const x=BigInt(String(arguments[0])),dx=BigInt(String(arguments[2]));
      window.PlanetStage.setWorldTileFocus((x+dx).toString(),String(arguments[1]));
    """, original["x"], original["y"], str(delta_tiles))
    away = settle_scale(driver, stage["zoom"]["scaleIndex"])
    away_shot = capture(driver, "pan-away")
    driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", original["x"], original["y"])
    back = settle_scale(driver, stage["zoom"]["scaleIndex"])
    after = back["projection"]["resourceBudget"]
    if int(after.get("cacheHits") or 0) <= int(before.get("cacheHits") or 0):
        raise AssertionError(f"return did not reuse cached detail: before={before.get('cacheHits')} after={after.get('cacheHits')}")
    if str(back["canonicalFocus"]["worldTile"]["x"]) != str(original["x"]) or str(back["canonicalFocus"]["worldTile"]["y"]) != str(original["y"]):
        raise AssertionError("return focus did not restore original tile")
    return {
        "deltaTiles": delta_tiles,
        "away": assert_streaming(away, "pan-away", True),
        "back": assert_streaming(back, "pan-back", True),
        "cacheHitsBefore": before.get("cacheHits"),
        "cacheHitsAfter": after.get("cacheHits"),
        "graceReuseCount": after.get("graceReuseCount"),
        "awayScreenshot": away_shot,
        "backScreenshot": capture(driver, "pan-back"),
    }


def slow_fallback_proof(driver):
    settle_scale(driver, 6)
    # Four-times CPU throttling still forces a parent-fallback window while
    # keeping software WebGL responsive enough to capture that transient frame.
    driver.execute_cdp_cmd("Emulation.setCPUThrottlingRate", {"rate": 4})
    try:
        driver.execute_script("window.PlanetStage.setScaleIndex(8);")
        wait(driver, """
          const s=window.PlanetStage.snapshot(),r=s.projection.resourceBudget;
          return r.pendingPreparationCount>0 || r.standInActive===true;
        """, 30)
        stage = snap(driver)
        proof = assert_streaming(stage, "slow-fallback", True)
        if proof["handoff"].get("fallbackActive") is not True:
            raise AssertionError(f"slow proof did not retain parent fallback {proof['handoff']}")
        shot = capture(driver, "slow-cpu-parent-fallback")
    finally:
        driver.execute_cdp_cmd("Emulation.setCPUThrottlingRate", {"rate": 1})
    final = settle_scale(driver, 8, 180)
    return {
        "transient": proof,
        "transientScreenshot": shot,
        "settled": assert_streaming(final, "slow-settled", True),
        "settledScreenshot": capture(driver, "slow-cpu-settled"),
    }


def run_seed(driver, tag, screenshots=True):
    target = focus_starting_village(driver)
    far = settle_scale(driver, 0)
    far_record = assert_streaming(far, f"{tag}-far", False)
    if screenshots:
        far_record["screenshot"] = capture(driver, f"{tag}-far-1_10")

    mid = settle_scale(driver, 5)
    mid_record = assert_streaming(mid, f"{tag}-mid", True)
    if screenshots:
        mid_record["screenshot"] = capture(driver, f"{tag}-mid-1_500")

    close = settle_scale(driver, 7)
    close_record = assert_streaming(close, f"{tag}-close", True)
    if int(close_record["localStatic"]["roads"] or 0) <= 0:
        raise AssertionError(f"{tag}: close focus did not progressively materialize roads {close_record['localStatic']}")
    if screenshots:
        close_record["screenshot"] = capture(driver, f"{tag}-close-1_2500")

    return {"seed": snap(driver)["activeSeed"], "target": target, "far": far_record, "mid": mid_record, "close": close_record}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp":"WP-S003-010-003-019","target":TARGET,"pass":False}
    driver = driver_for()
    try:
        driver.get(TARGET)
        wait_ready(driver)
        set_viewport(driver, 1280, 800)
        primary = run_seed(driver, "seed-a", True)

        pan = move_across_cell_and_back(driver, snap(driver))
        slow = slow_fallback_proof(driver)

        set_viewport(driver, 844, 390)
        phone_land = settle_scale(driver, 5)
        phone_land_record = assert_streaming(phone_land, "phone-landscape", True)
        phone_land_record["screenshot"] = capture(driver, "phone-landscape-1_500")
        phone_land_record["viewport"] = {"width":844,"height":390}

        set_viewport(driver, 390, 844)
        phone_port = settle_scale(driver, 7)
        phone_port_record = assert_streaming(phone_port, "phone-portrait", True)
        phone_port_record["screenshot"] = capture(driver, "phone-portrait-1_2500")
        phone_port_record["viewport"] = {"width":390,"height":844}

        # Second authoritative campaign seed: functional proof without duplicating the visual matrix.
        second_seed = "AGENT6-FOCUS-STREAM-B"
        result = driver.execute_script(
            "const seed=String(arguments[0]);"
            "const campaign=window.SeedSystem.startNewCampaign(seed);"
            "const planet=window.PlanetGeography.persistSeed(seed);"
            "return {campaign,planet};", second_seed
        )
        if not result or result.get("campaign", {}).get("ok") is not True or result.get("planet") != second_seed:
            raise AssertionError(f"could not create second seed: {result}")
        # The second seed is functional-only evidence. Keep the first seed on
        # the real production globe for mandatory visual proof, then use the
        # trusted local-only bootstrap for this second-seed determinism pass.
        separator = "&" if "?" in TARGET else "?"
        driver.get(f"{TARGET}{separator}evidence_fast_start=1")
        wait_ready(driver)
        set_viewport(driver, 1280, 800)
        if snap(driver).get("activeSeed") != second_seed:
            raise AssertionError("second seed did not persist")
        secondary = run_seed(driver, "seed-b", False)

        logs = driver.get_log("browser")
        severe = [x for x in logs if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe:
            raise AssertionError(f"severe browser errors: {severe[-20:]}")

        final = snap(driver)
        fs = streaming(final)
        evidence.update({
            "primary": primary,
            "panReuse": pan,
            "slowCpu": slow,
            "phoneLandscape": phone_land_record,
            "phonePortrait": phone_port_record,
            "secondary": secondary,
            "summary": {
                "version": final["version"],
                "rings": [r["id"] for r in fs["rings"]],
                "ringSpans": [r.get("spanFactor") for r in fs["rings"]],
                "cacheBudgetBytes": fs["cache"]["budgetBytes"],
                "cacheEntries": fs["cache"]["entries"],
                "cacheUsedBytes": fs["cache"]["usedBytes"],
                "longestHandoffLatencyMs": fs["handoff"]["longestLatencyMs"],
                "missingCoverageCount": fs["handoff"]["missingCoverageCount"],
                "fullWorldScan": fs["fullWorldScan"],
                "globalHighDetailMaterialized": fs["globalHighDetailMaterialized"],
                "primarySeed": primary["seed"],
                "secondarySeed": secondary["seed"],
            },
            "pass": True,
        })
    except Exception as exc:
        evidence["error"] = repr(exc)
        raise
    finally:
        (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        driver.quit()

    print(json.dumps(evidence["summary"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
