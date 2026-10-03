#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/wp-s003-010-003-014")
DISPLAY_BANDS = [
    "planet", "continent", "country / region", "regional overview",
    "regional detail", "local network", "settlement area",
    "settlement approach", "near ground", "ground",
]
VISIBLE_BANDS = [
    "planet", "continent", "country-region", "regional-overview",
    "regional-detail", "district", "local-area", "settlement",
    "near-ground", "ground",
]


def driver_for():
    options = Options()
    for arg in (
        "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        "--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader",
    ):
        options.add_argument(arg)
    options.add_argument("--window-size=1280,800")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=options)


def wait(driver, script, timeout=180, poll=0.25):
    return WebDriverWait(driver, timeout, poll_frequency=poll).until(lambda d: d.execute_script(script))


def snapshot(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def assert_semantic_owner(label, state):
    zoom = state["zoom"]
    semantic = state["mapPresentation"]
    band_index = VISIBLE_BANDS.index(zoom["visibleBand"])
    policy_index = int(semantic["semanticScaleIndex"])
    if policy_index > band_index:
        raise AssertionError(
            f"{label}: semantic policy {policy_index} is finer than ready "
            f"visible band {zoom['visibleBand']}: {semantic}"
        )
    if semantic["semanticDisplayBand"] != DISPLAY_BANDS[policy_index]:
        raise AssertionError(f"{label}: semantic label/policy mismatch: {semantic}")
    layers = set(semantic["semanticSettlementLayersEligible"])
    if policy_index < 6 and layers:
        raise AssertionError(f"{label}: settlement layers leaked into {semantic['semanticDisplayBand']}: {layers}")
    if policy_index < 7 and "roads" in layers:
        raise AssertionError(f"{label}: roads leaked before settlement-approach scale: {semantic}")
    if policy_index < 8 and "buildings" in layers:
        raise AssertionError(f"{label}: buildings leaked before near-ground scale: {semantic}")


def capture(driver, name):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"Screenshot failed: {path}")
    return str(path)


def main():
    parts = urlsplit(TARGET)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["evidence_fast_start"] = "1"
    target = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    driver = driver_for()
    driver.set_script_timeout(180)
    records = []
    try:
        driver.get(target)
        wait(driver, "return document.readyState==='complete'", 60)
        driver.execute_script(
            "const b=document.querySelector('#newCampaignButton');"
            "if(document.querySelector('#campaignState')?.textContent?.trim()!=='ACTIVE')b?.click();"
        )
        wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true")
        wait(driver, "return window.PlanetStage?.snapshot?.()?.mapPresentation?.active===true", 60)

        # Probe immediately after changing requested scale, before the finer
        # local representation has necessarily finished preparing.
        for label, scalar in (("requested-ground", 1.0), ("ready-ground", 1.0), ("ready-planet", 0.0)):
            if label != "ready-ground":
                driver.execute_script("window.PlanetStage.setZoomScalar(arguments[0]);", scalar)
            if label.startswith("ready-"):
                wait(driver, """
                  const s=window.PlanetStage.snapshot(),r=s.projection?.resourceBudget||{};
                  return Number(r.pendingPreparationCount||0)===0&&
                    (!r.requestedSignature||String(r.requestedSignature)===String(r.activeSignature||''));
                """)
            time.sleep(.1)
            state = snapshot(driver)
            assert_semantic_owner(label, state)
            frame = capture(driver, label)
            records.append({
                "label": label,
                "visibleBand": state["zoom"]["visibleBand"],
                "semanticDisplayBand": state["mapPresentation"]["semanticDisplayBand"],
                "semanticScaleIndex": state["mapPresentation"]["semanticScaleIndex"],
                "settlementLayers": state["mapPresentation"]["semanticSettlementLayersEligible"],
                "screenshot": frame,
            })

        driver.execute_script("""
          const stage=window.PlanetStage;
          stage.setZoomScalar(.4);
          stage.setZoomTargetScalar(.4005,'semantic-readiness-test');
        """)
        wait(driver, """
          const s=window.PlanetStage.snapshot();
          const text=document.querySelector('.planet-scale-meta span')?.textContent?.trim();
          return s.zoom.animation.active&&s.mapPresentation.zoomAnimating&&
            s.zoom.scaleLabel===s.zoom.targetDisplayScaleLabel&&
            text===s.mapPresentation.semanticDisplayBand&&!text.includes('→');
        """, 10, poll=0.02)
        state = snapshot(driver)
        assert_semantic_owner("same-label-transition", state)
        if "→" in driver.find_element("css selector", ".planet-scale-meta span").text:
            raise AssertionError("same-label scale transition was redundantly displayed")

        print(json.dumps({"pass": True, "states": records}, indent=2))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
