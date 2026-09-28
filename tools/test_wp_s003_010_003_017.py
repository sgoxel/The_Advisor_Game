#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_017_artifact")
SCALES = ["1/10","1/20","1/50","1/100","1/250","1/500"]
KNOWN_MARKER_CLASSES = {
    "gameplay-center","capital","major-city","city","town","village",
    "landmark-poi","route-road-node","debug-diagnostic"
}


def with_query(url: str, **params) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({k: str(v) for k, v in params.items()})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


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
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": int(width), "height": int(height), "deviceScaleFactor": 1,
        "mobile": False, "screenWidth": int(width), "screenHeight": int(height)
    })
    driver.execute_script("window.dispatchEvent(new Event('resize'));")
    deadline = time.time() + 10
    while time.time() < deadline:
        metrics = driver.execute_script("""
          const node=document.querySelector('#planetCanvas');
          const c=node?.getBoundingClientRect?.();
          return {iw:innerWidth,ih:innerHeight,hasCanvas:Boolean(node),cw:Number(c?.width||0),ch:Number(c?.height||0)};
        """)
        canvas_ok = (not metrics.get("hasCanvas")) or (
            float(metrics.get("cw") or 0) > 0 and float(metrics.get("ch") or 0) > 0
        )
        if (abs(float(metrics.get("iw") or 0)-width) <= 2 and
            abs(float(metrics.get("ih") or 0)-height) <= 2 and canvas_ok):
            time.sleep(.8)
            return
        time.sleep(.15)
    raise AssertionError(f"Viewport did not settle to {width}x{height}")


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
    wait(driver, "return window.PlanetStage?.snapshot?.()?.mapPresentation?.active===true", 60)


def settle_scale(driver, index):
    driver.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);", int(index))
    wait(driver, "return window.PlanetStage.snapshot().zoom.scaleIndex===arguments[0]", 30, int(index))
    wait(driver, "return window.PlanetStage.snapshot().mapPresentation.scaleStateIndex===arguments[0]", 30, int(index))
    # Let async atlas authority workers publish any already-bounded labels.
    time.sleep(.7)
    wait(driver, """
      const s=window.PlanetStage.snapshot();
      return s.mapPresentation?.centerMarker?.visible===true;
    """, 20)
    return snap(driver)


def capture(driver, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"Screenshot failed: {path}")
    return path.name


def deterministic_land_target(driver):
    candidates = driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed,reps=window.RegionProfile?.representatives?.(seed)||[];
      return reps.map(r=>({id:r.id,name:r.name,x:String(r.administrativeSeat?.x??'0'),y:String(r.administrativeSeat?.y??'0')}))
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,20);
    """) or []
    if not candidates:
        candidates = [{"id":"origin","name":"Origin","x":"0","y":"0"}]
    for item in candidates:
        driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);window.PlanetStage.setScaleIndex(0);", item["x"], item["y"])
        time.sleep(.25)
        stage = snap(driver)
        if stage.get("canonicalFocus", {}).get("surfaceIdentity", {}).get("center", {}).get("land") is True:
            return item
    raise AssertionError("No deterministic land focus available")


def assert_marker_contract(stage, label, production=True):
    mp = stage["mapPresentation"]
    if mp.get("markerPolicyRevision") != "semantic-marker-visibility-v1":
        raise AssertionError(f"{label}: marker policy revision missing: {mp.get('markerPolicyRevision')}")
    if mp.get("markerViewportBounded") is not True or mp.get("markerFullWorldScan") is not False:
        raise AssertionError(f"{label}: marker query is not viewport-bounded: {mp}")
    if int(mp.get("markerStandaloneDecorativeGlyphCount", -1)) != 0:
        raise AssertionError(f"{label}: unexplained decorative marker glyphs remain")
    if production:
        if mp.get("markerDebugMode") is not False:
            raise AssertionError(f"{label}: production capture unexpectedly in marker debug mode")
        if int(mp.get("markerDebugSuppressedCount") or 0) < 1:
            raise AssertionError(f"{label}: debug marker was not explicitly suppressed")
        if int(mp.get("markerUnknownProductionCount", -1)) != 0:
            raise AssertionError(f"{label}: unknown/debug production markers rendered")
        if int(mp.get("markerBroadScaleMinorRenderedCount", -1)) != 0:
            raise AssertionError(f"{label}: town/village/road/debug marker leaked into 1/10-1/500 broad scales")
    decisions = mp.get("markerDecisions") or []
    visible = mp.get("visibleMarkers") or []
    if not decisions:
        raise AssertionError(f"{label}: no marker decisions exposed")
    if not any(x.get("semanticClass") == "gameplay-center" for x in decisions):
        raise AssertionError(f"{label}: gameplay-center marker contract absent")
    for row in decisions:
        semantic = row.get("semanticClass")
        if semantic not in KNOWN_MARKER_CLASSES:
            raise AssertionError(f"{label}: unknown semantic class {semantic}: {row}")
        if not row.get("canonicalEntityId"):
            raise AssertionError(f"{label}: marker missing canonical ID: {row}")
        if not row.get("visibilityReason"):
            raise AssertionError(f"{label}: marker missing visibility reason: {row}")
        if not isinstance(row.get("canonicalAnchorWorldTile"), dict):
            raise AssertionError(f"{label}: marker missing canonical anchor: {row}")
    for row in visible:
        if row.get("debugOnly") and production:
            raise AssertionError(f"{label}: debug-only marker visible in production: {row}")
        if not str(row.get("visibilityReason", "")).startswith("visible-"):
            raise AssertionError(f"{label}: visible marker lacks visible reason: {row}")
    center = mp.get("centerMarker") or {}
    if center.get("visible") is not True or center.get("worldAnchored") is not True:
        raise AssertionError(f"{label}: gameplay center marker not visibly world-anchored: {center}")
    if int(mp.get("atlasVisibleLabelCount") or 0) > int(mp.get("maxLabelBudget") or 0):
        raise AssertionError(f"{label}: atlas density budget exceeded")
    return {
        "scale": stage["zoom"]["scaleLabel"],
        "semanticPolicyId": mp.get("semanticPolicyId"),
        "visibleLabelCount": mp.get("atlasVisibleLabelCount"),
        "visibleLabelClasses": mp.get("visibleLabelClasses"),
        "markerVisibleCount": mp.get("markerVisibleCount"),
        "markerEligibleCountsByClass": mp.get("markerEligibleCountsByClass"),
        "markerRenderedCountsByClass": mp.get("markerRenderedCountsByClass"),
        "markerCulledCountsByClass": mp.get("markerCulledCountsByClass"),
        "markerHiddenReasonCounts": mp.get("markerHiddenReasonCounts"),
        "markerDebugSuppressedCount": mp.get("markerDebugSuppressedCount"),
        "markerUnknownProductionCount": mp.get("markerUnknownProductionCount"),
        "markerBroadScaleMinorRenderedCount": mp.get("markerBroadScaleMinorRenderedCount"),
        "markerStandaloneDecorativeGlyphCount": mp.get("markerStandaloneDecorativeGlyphCount"),
        "semanticOrderingSignature": mp.get("semanticOrderingSignature"),
        "mapUpdateMs": mp.get("lastUpdateMs"),
        "hiddenHemisphereCulledCount": mp.get("hiddenHemisphereCulledCount"),
        "behindCameraCulledCount": mp.get("behindCameraCulledCount"),
        "offscreenCulledCount": mp.get("offscreenCulledCount"),
        "overlapRejectedCount": mp.get("overlapRejectedCount"),
        "visibleMarkers": mp.get("visibleMarkers"),
    }


def run_production_seed(driver, tag, all_screenshots=True):
    target = deterministic_land_target(driver)
    driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", target["x"], target["y"])
    records = []
    signatures = {}
    for index, expected in enumerate(SCALES):
        stage = settle_scale(driver, index)
        if stage["zoom"]["scaleLabel"] != expected:
            raise AssertionError(f"{tag}: scale {index} expected {expected}, got {stage['zoom']['scaleLabel']}")
        record = assert_marker_contract(stage, f"{tag} {expected}", production=True)
        signatures[index] = record["semanticOrderingSignature"]
        if all_screenshots:
            record["screenshot"] = capture(driver, f"{tag}-desktop-{expected.replace('/','_')}")
        records.append(record)

    # Identical visible state must produce the same deterministic ordering/marker result.
    repeat = settle_scale(driver, 2)
    repeat_record = assert_marker_contract(repeat, f"{tag} repeat 1/50", production=True)
    if repeat_record["semanticOrderingSignature"] != signatures[2]:
        raise AssertionError(f"{tag}: deterministic ordering changed at repeated 1/50")

    if all_screenshots:
        set_viewport(driver, 844, 390)
        phone_land = settle_scale(driver, 2)
        wait(driver, "return innerWidth===844 && innerHeight===390 && window.PlanetStage.snapshot().mapPresentation?.centerMarker?.visible===true", 20)
        phone_land = snap(driver)
        phone_land_record = assert_marker_contract(phone_land, f"{tag} phone landscape 1/50", production=True)
        phone_land_record["viewport"] = driver.execute_script("return {width:innerWidth,height:innerHeight}")
        phone_land_record["screenshot"] = capture(driver, f"{tag}-phone-landscape-1_50")

        set_viewport(driver, 390, 844)
        phone_portrait = settle_scale(driver, 5)
        wait(driver, "return innerWidth===390 && innerHeight===844 && window.PlanetStage.snapshot().mapPresentation?.centerMarker?.visible===true", 20)
        phone_portrait = snap(driver)
        phone_portrait_record = assert_marker_contract(phone_portrait, f"{tag} phone portrait 1/500", production=True)
        phone_portrait_record["viewport"] = driver.execute_script("return {width:innerWidth,height:innerHeight}")
        phone_portrait_record["screenshot"] = capture(driver, f"{tag}-phone-portrait-1_500")

        set_viewport(driver, 1280, 800)
    else:
        phone_land_record = None
        phone_portrait_record = None

    return {
        "seed": snap(driver)["activeSeed"],
        "target": target,
        "records": records,
        "phoneLandscape": phone_land_record,
        "phonePortrait": phone_portrait_record,
    }


def run_debug_proof(target_url):
    driver = driver_for(1280, 800)
    try:
        driver.get(with_query(target_url, marker_debug=1))
        wait_ready(driver)
        target = deterministic_land_target(driver)
        driver.execute_script("window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);", target["x"], target["y"])
        stage = settle_scale(driver, 2)
        mp = stage["mapPresentation"]
        if mp.get("markerDebugMode") is not True:
            raise AssertionError("Debug proof did not enable explicit marker debug mode")
        rendered = mp.get("markerRenderedCountsByClass") or {}
        if int(rendered.get("debug-diagnostic") or 0) != 1:
            raise AssertionError(f"Expected exactly one explicit diagnostic marker, got {rendered}")
        debug_rows = [x for x in (mp.get("visibleMarkers") or []) if x.get("semanticClass") == "debug-diagnostic"]
        if len(debug_rows) != 1 or debug_rows[0].get("visibilityReason") != "visible-debug-callout":
            raise AssertionError(f"Debug marker is not explainable: {debug_rows}")
        return {
            "seed": stage["activeSeed"],
            "target": target,
            "scale": stage["zoom"]["scaleLabel"],
            "visibleMarkers": mp.get("visibleMarkers"),
            "screenshot": capture(driver, "debug-explicit-1_50"),
        }
    finally:
        driver.quit()


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp":"WP-S003-010-003-017","target":TARGET,"pass":False}
    driver = driver_for()
    try:
        driver.get(TARGET)
        wait_ready(driver)
        primary = run_production_seed(driver, "seed-a", all_screenshots=True)

        second_seed = "AGENT6-SEMANTIC-MARKERS-B"
        result = driver.execute_script(
            "const seed=String(arguments[0]);"
            "const campaign=window.SeedSystem.startNewCampaign(seed);"
            "const planet=window.PlanetGeography.persistSeed(seed);"
            "return {campaign,planet};", second_seed
        )
        if not result or result.get("campaign", {}).get("ok") is not True or result.get("planet") != second_seed:
            raise AssertionError(f"Could not create second authoritative seed: {result}")
        driver.refresh()
        wait_ready(driver)
        if snap(driver).get("activeSeed") != second_seed:
            raise AssertionError("Second authoritative seed did not persist")
        secondary = run_production_seed(driver, "seed-b", all_screenshots=False)

        logs = driver.get_log("browser")
        severe = [x for x in logs if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message","")).lower()]
        if severe:
            raise AssertionError(f"Severe browser errors: {severe[-20:]}")

        evidence["primary"] = primary
        evidence["secondary"] = secondary
    except Exception as exc:
        evidence["error"] = repr(exc)
        (OUT_DIR/"evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        raise
    finally:
        driver.quit()

    debug = run_debug_proof(TARGET)
    evidence["debug"] = debug
    evidence["pass"] = True
    all_records = primary["records"] + secondary["records"]
    evidence["summary"] = {
        "scales": SCALES,
        "primarySeed": primary["seed"],
        "secondarySeed": secondary["seed"],
        "productionDebugSuppressedEveryFrame": all(int(x["markerDebugSuppressedCount"] or 0) >= 1 for x in all_records),
        "unknownProductionMarkers": max(int(x["markerUnknownProductionCount"] or 0) for x in all_records),
        "broadScaleMinorRendered": max(int(x["markerBroadScaleMinorRenderedCount"] or 0) for x in all_records),
        "standaloneDecorativeGlyphs": max(int(x["markerStandaloneDecorativeGlyphCount"] or 0) for x in all_records),
        "maxMapUpdateMs": max(float(x["mapUpdateMs"] or 0) for x in all_records),
        "desktopScreenshotCount": sum(1 for x in primary["records"] if x.get("screenshot")),
        "phoneLandscapeViewport": primary["phoneLandscape"]["viewport"],
        "phonePortraitViewport": primary["phonePortrait"]["viewport"],
        "debugMarkerVisible": True,
    }
    (OUT_DIR/"evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(evidence["summary"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
