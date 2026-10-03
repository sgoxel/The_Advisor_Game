#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_010_003_017_reopen_artifact")
BASE_PATH = Path(__file__).with_name("test_wp_s003_010_003_017.py")
SCALES = ["1/10", "1/20", "1/50", "1/100", "1/250", "1/500"]
SECOND_SEED = "AGENT6-WP017-REOPEN-B"

spec = importlib.util.spec_from_file_location("wp017_base", BASE_PATH)
base = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(base)
base.TARGET = TARGET
base.OUT_DIR = OUT_DIR


def starting_village_focus(driver):
    target = driver.execute_script("""
      const s=window.PlanetStage.snapshot(),p=window.StartingVillage?.plan?.(s.activeSeed);
      return p?.center?{x:String(p.center.x),y:String(p.center.y),settlementId:p.id||null}:null;
    """)
    if not target:
        raise AssertionError("Starting Village canonical center unavailable")
    driver.execute_script(
        "window.PlanetStage.setWorldTileFocus(arguments[0],arguments[1]);",
        target["x"], target["y"]
    )
    time.sleep(.35)
    return target


def settle_fully(driver, index, timeout=240):
    driver.execute_script("window.PlanetStage.setScaleIndex(arguments[0]);", int(index))
    WebDriverWait(driver, 60).until(
        lambda d: int(base.snap(d)["zoom"]["scaleIndex"]) == int(index)
    )
    WebDriverWait(driver, timeout).until(lambda d: (
        not base.snap(d)["zoom"]["animation"]["active"] and
        int(base.snap(d)["projection"]["resourceBudget"].get("pendingPreparationCount") or 0) == 0
    ))
    time.sleep(.35)
    return base.snap(driver)


def prime_local_presentation(driver):
    stage = settle_fully(driver, 7)
    WebDriverWait(driver, 120).until(lambda d: (
        str(base.snap(d)["projection"]["localStatic"].get("revealTier") or "none") != "none" and
        bool(base.snap(d)["projection"]["localStatic"].get("active"))
    ))
    stage = base.snap(driver)
    local_static = stage["projection"]["localStatic"]
    if int(local_static.get("buildingCount") or 0) <= 0:
        raise AssertionError(f"close-first setup did not materialize local buildings: {local_static}")
    return stage


def assert_map_microdetail_clean(driver, stage, label):
    base_record = base.assert_marker_contract(stage, label, production=True)
    local_static = stage["projection"]["localStatic"]
    resource = stage["projection"]["resourceBudget"]
    if str(local_static.get("revealTier") or "none") != "none":
        raise AssertionError(f"{label}: local reveal tier remained active: {local_static.get('revealTier')}")
    if local_static.get("mapScaleSuppressedDecorative") is not True:
        raise AssertionError(f"{label}: map-scale decorative suppression not active: {local_static}")
    if resource.get("mapScalePresentationEligible") is not False:
        raise AssertionError(f"{label}: local presentation still eligible at broad scale: {resource}")

    forbidden_counts = {
        "buildingCount": int(local_static.get("buildingCount") or 0),
        "vegetationCount": int(local_static.get("vegetationCount") or 0),
        "dressingCount": int(local_static.get("dressingCount") or 0),
        "wildernessCount": int(local_static.get("wildernessCount") or 0),
        "ambientFaunaCount": int(local_static.get("ambientFaunaCount") or 0),
        "microLocationPrimitiveCount": int(local_static.get("microLocationPrimitiveCount") or 0),
        "persistentConsequenceWorldCueCount": int(local_static.get("persistentConsequenceWorldCueCount") or 0),
    }
    leaked = {k: v for k, v in forbidden_counts.items() if v != 0}
    if leaked:
        raise AssertionError(f"{label}: local/decorative geometry leaked into broad map scale: {leaked}")

    seasonal = driver.execute_script("return window.SeasonalPresentation?.snapshot?.()||null")
    if seasonal:
        if int(seasonal.get("accentCount") or 0) != 0:
            raise AssertionError(f"{label}: seasonal marker-like accents leaked: {seasonal}")
        if seasonal.get("mapScaleAccentEligible") is True:
            raise AssertionError(f"{label}: seasonal accents remain eligible at map scale: {seasonal}")

    return {
        **base_record,
        "localStatic": {
            "active": local_static.get("active"),
            "revealTier": local_static.get("revealTier"),
            "mapScaleSuppressedDecorative": local_static.get("mapScaleSuppressedDecorative"),
            **forbidden_counts,
        },
        "resourceBudget": {
            "mapScalePresentationEligible": resource.get("mapScalePresentationEligible"),
            "mapScaleSuppressionActive": resource.get("mapScaleSuppressionActive"),
            "mapScaleSuppressedRootCount": resource.get("mapScaleSuppressedRootCount"),
            "pendingPreparationCount": resource.get("pendingPreparationCount"),
        },
        "seasonalPresentation": seasonal,
    }


def run_seed(driver, tag, screenshots):
    target = starting_village_focus(driver)
    close = prime_local_presentation(driver)
    close_record = {
        "scale": close["zoom"]["scaleLabel"],
        "localStatic": close["projection"]["localStatic"],
    }
    if screenshots:
        close_record["screenshot"] = base.capture(driver, f"{tag}-close-prime-1_2500")

    records = []
    for index, expected in enumerate(SCALES):
        stage = settle_fully(driver, index)
        if stage["zoom"]["scaleLabel"] != expected:
            raise AssertionError(f"{tag}: expected {expected}, got {stage['zoom']['scaleLabel']}")
        record = assert_map_microdetail_clean(driver, stage, f"{tag} close-return {expected}")
        if screenshots:
            record["screenshot"] = base.capture(driver, f"{tag}-close-return-{expected.replace('/','_')}")
        records.append(record)
    return {"seed": base.snap(driver)["activeSeed"], "target": target, "closePrime": close_record, "records": records}


def set_second_seed(driver):
    result = driver.execute_script(
        "const seed=String(arguments[0]);"
        "const campaign=window.SeedSystem.startNewCampaign(seed);"
        "const planet=window.PlanetGeography.persistSeed(seed);"
        "return {campaign,planet};", SECOND_SEED
    )
    if not result or result.get("campaign", {}).get("ok") is not True or result.get("planet") != SECOND_SEED:
        raise AssertionError(f"Could not create second authoritative seed: {result}")
    driver.refresh()
    base.wait_ready(driver)
    if base.snap(driver).get("activeSeed") != SECOND_SEED:
        raise AssertionError("Second authoritative seed did not persist")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp": "WP-S003-010-003-017", "phase": "reopened-close-return", "target": TARGET, "pass": False}
    driver = base.driver_for(1280, 800)
    try:
        driver.get(TARGET)
        base.wait_ready(driver)
        evidence["primary"] = run_seed(driver, "seed-a", screenshots=True)
        set_second_seed(driver)
        evidence["secondary"] = run_seed(driver, "seed-b", screenshots=False)
        severe = [x for x in driver.get_log("browser") if x.get("level") == "SEVERE" and "favicon" not in str(x.get("message", "")).lower()]
        if severe:
            raise AssertionError(f"Severe browser errors: {severe[-20:]}")
        evidence["pass"] = True
    except Exception as exc:
        evidence["error"] = repr(exc)
        try:
            evidence["failureScreenshot"] = base.capture(driver, "reopen-failure")
        except Exception:
            pass
        raise
    finally:
        (OUT_DIR / "reopened-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        driver.quit()

    all_records = evidence["primary"]["records"] + evidence["secondary"]["records"]
    summary = {
        "pass": evidence["pass"],
        "scales": SCALES,
        "primarySeed": evidence["primary"]["seed"],
        "secondarySeed": evidence["secondary"]["seed"],
        "maxBroadLocalDecorativeCount": max(
            sum(int(row["localStatic"].get(k) or 0) for k in (
                "buildingCount", "vegetationCount", "dressingCount", "wildernessCount",
                "ambientFaunaCount", "microLocationPrimitiveCount", "persistentConsequenceWorldCueCount"
            )) for row in all_records
        ),
        "mapScaleSuppressedEveryFrame": all(row["localStatic"]["mapScaleSuppressedDecorative"] is True for row in all_records),
        "localPresentationIneligibleEveryFrame": all(row["resourceBudget"]["mapScalePresentationEligible"] is False for row in all_records),
        "screenshotCount": 1 + len(evidence["primary"]["records"]),
    }
    evidence["summary"] = summary
    (OUT_DIR / "reopened-evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
