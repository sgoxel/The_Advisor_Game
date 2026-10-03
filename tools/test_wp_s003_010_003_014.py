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


def scale_meta_text(driver):
    return driver.find_element("css selector", ".planet-scale-meta span").text.strip()


def record_state(driver, records, label):
    state = snapshot(driver)
    assert_semantic_owner(label, state)
    frame = capture(driver, label)
    records.append({
        "label": label,
        "visibleBand": state["zoom"]["visibleBand"],
        "requestedBand": state["zoom"].get("requestedBand"),
        "semanticDisplayBand": state["mapPresentation"]["semanticDisplayBand"],
        "semanticScaleIndex": state["mapPresentation"]["semanticScaleIndex"],
        "settlementLayers": state["mapPresentation"]["semanticSettlementLayersEligible"],
        "scaleMetaText": scale_meta_text(driver),
        "zoomScalar": state["zoom"]["scalar"],
        "targetZoomScalar": state["zoom"]["targetScalar"],
        "screenshot": frame,
    })
    return state


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

        # Keep every visual state on the same canonical land focus used by the
        # original accepted WP-014 evidence.
        driver.execute_script("window.PlanetStage.setWorldTileFocus('0','0');")
        wait(driver, """
          const t=window.PlanetStage.snapshot()?.canonicalFocus?.worldTile;
          return String(t?.x)==='0'&&String(t?.y)==='0';
        """, 60)

        # Establish a fully ready broad parent first. This mirrors normal
        # player zoom: the current representation is complete before a finer
        # target is requested, so the screenshot can verify visible fallback
        # instead of photographing an artificial teleport between projections.
        driver.execute_script("window.PlanetStage.setZoomScalar(.4);")
        wait(driver, """
          const s=window.PlanetStage.snapshot(),r=s.projection?.resourceBudget||{};
          return s.zoom.visibleBand==='country-region'&&
            Number(r.pendingPreparationCount||0)===0&&
            (!r.requestedSignature||String(r.requestedSignature)===String(r.activeSignature||''));
        """)
        time.sleep(.15)
        record_state(driver, records, "ready-country-parent")

        # Request ground through the normal smooth target path. While the child
        # prepares, the visible semantic owner must remain the ready parent and
        # local settlement layers must not leak into that broad presentation.
        driver.execute_script("window.PlanetStage.setZoomTargetScalar(1.0,'semantic-readiness-test');")
        wait(driver, """
          const s=window.PlanetStage.snapshot();
          return s.zoom.animation.active&&s.zoom.targetScalar>.99&&
            s.zoom.visibleBand==='country-region'&&
            s.mapPresentation.semanticDisplayBand==='country / region';
        """, 15, poll=0.02)
        time.sleep(.05)
        record_state(driver, records, "requested-ground")

        wait(driver, """
          const s=window.PlanetStage.snapshot(),r=s.projection?.resourceBudget||{};
          return !s.zoom.animation.active&&s.zoom.visibleBand==='ground'&&
            Number(r.pendingPreparationCount||0)===0&&
            (!r.requestedSignature||String(r.requestedSignature)===String(r.activeSignature||''));
        """)
        time.sleep(.1)
        record_state(driver, records, "ready-ground")

        # Return to the same ready broad parent and prove that close-only layers
        # disappear again without changing canonical focus.
        driver.execute_script("window.PlanetStage.setZoomScalar(.4);")
        wait(driver, """
          const s=window.PlanetStage.snapshot(),r=s.projection?.resourceBudget||{};
          return s.zoom.visibleBand==='country-region'&&
            Number(r.pendingPreparationCount||0)===0&&
            (!r.requestedSignature||String(r.requestedSignature)===String(r.activeSignature||''));
        """)
        time.sleep(.1)
        record_state(driver, records, "ready-country-return")

        # Tiny animation inside one canonical scale must not display a redundant
        # same-label arrow. The semantic label stays tied to the ready visible
        # representation.
        driver.execute_script("window.PlanetStage.setZoomTargetScalar(.4005,'semantic-readiness-test');")
        wait(driver, """
          const s=window.PlanetStage.snapshot();
          const text=document.querySelector('.planet-scale-meta span')?.textContent?.trim();
          return s.zoom.animation.active&&s.mapPresentation.zoomAnimating&&
            s.zoom.scaleLabel===s.zoom.targetDisplayScaleLabel&&
            text===s.mapPresentation.semanticDisplayBand&&!text.includes('→');
        """, 10, poll=0.02)
        state = record_state(driver, records, "same-label-transition")
        if "→" in scale_meta_text(driver):
            raise AssertionError("same-label scale transition was redundantly displayed")
        if state["mapPresentation"]["semanticSettlementLayersEligible"]:
            raise AssertionError("same-label broad transition leaked local settlement layers")

        print(json.dumps({"pass": True, "states": records}, indent=2))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
