#!/usr/bin/env python3
"""WP-S003-008-004 current-startup regression evidence."""
import json
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/?evidence_fast_start=1"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_008_004_regression_artifact")
OUT.mkdir(parents=True, exist_ok=True)

options = Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument("--window-size=430,900")
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
driver = webdriver.Chrome(options=options)
driver.set_page_load_timeout(120)
driver.set_script_timeout(300)

evidence = {
    "wp": "WP-S003-008-004",
    "classification": "FUNCTIONAL / PERFORMANCE",
    "visual": "N/A — startup responsiveness and no-progress recovery are functional timing/state requirements.",
}

def js(script, *args):
    return driver.execute_script(script, *args)

def startup_diagnostic():
    try:
        return js("""
          return {
            readyState: document.readyState,
            hasAppUI: !!window.AppUI,
            hasGameRenderer: !!window.GameRenderer,
            gate: window.AppUI?.applicationStartupSnapshot?.() || null,
            scene: window.AppUI?.sceneLoadingSnapshot?.() || null,
            renderer: window.GameRenderer?.snapshot?.() || null,
            campaign: window.SeedSystem?.getCampaign?.() || null
          };
        """)
    except Exception as exc:
        return {"diagnosticError": repr(exc)}

def wait_app_ready(timeout=60):
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(
                "return !!window.AppUI && !!window.GameRenderer && "
                "window.AppUI.applicationStartupSnapshot().state === 'ready';"
            )
        )
    except Exception:
        evidence["startupDiagnostic"] = startup_diagnostic()
        evidence["browserLogsAtStartupFailure"] = driver.get_log("browser")[-80:]
        print(json.dumps({
            "checkpoint": "application-startup-timeout",
            "diagnostic": evidence["startupDiagnostic"],
            "browserLogs": evidence["browserLogsAtStartupFailure"],
        }, indent=2), flush=True)
        raise

def wait_loader_settled():
    WebDriverWait(driver, 240).until(
        lambda d: d.execute_script(
            "return ['hidden','ready'].includes(window.AppUI.sceneLoadingSnapshot().current.state);"
        )
    )

try:
    print(json.dumps({"checkpoint": "navigate", "url": URL}), flush=True)
    driver.get(URL)
    wait_app_ready()
    print(json.dumps({"checkpoint": "application-ready", "diagnostic": startup_diagnostic()}), flush=True)

    driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      Promise.resolve(window.AppUI.startNewCampaignForEvidence('AGENT6-WP-S003-008-004-REGRESSION'))
        .then(()=>done({ok:true}))
        .catch(error=>done({ok:false,error:String(error)}));
    """)
    wait_loader_settled()

    initial = js("""
      return {
        ui: window.AppUI.sceneLoadingSnapshot(),
        renderer: window.GameRenderer.snapshot(),
        campaign: window.SeedSystem.getCampaign()
      };
    """)
    current = initial["ui"]["current"]
    preload = initial["renderer"].get("terrainPreload") or {}
    prep = current.get("preparation") or {}

    decisions = {
        "healthy": js("return window.AppUI.evaluateStartupWatchdogForEvidence(0);"),
        "slow": js("return window.AppUI.evaluateStartupWatchdogForEvidence(9000);"),
        "stalled": js("return window.AppUI.evaluateStartupWatchdogForEvidence(31000);"),
    }
    expected = {"healthy": "healthy", "slow": "slow", "stalled": "stalled"}
    for name, status in expected.items():
        if decisions[name].get("status") != status:
            raise AssertionError(f"watchdog threshold mismatch for {name}: {decisions[name]}")

    watchdog = current.get("watchdog") or {}
    if watchdog.get("simulationAuthorityPreserved") is not True:
        raise AssertionError(f"watchdog authority isolation missing: {watchdog}")
    if not watchdog.get("lastProgressAtMs"):
        raise AssertionError(f"last-progress telemetry missing: {watchdog}")
    if float(prep.get("terrainWallMs") or 0) <= 0:
        raise AssertionError(f"startup terrain wall telemetry missing: {prep}")
    if int(prep.get("terrainProgressEvents") or 0) < 1:
        raise AssertionError(f"startup terrain progress events missing: {prep}")
    if int(prep.get("terrainRequiredChunks") or 0) < 1:
        raise AssertionError(f"required first-playable chunk count missing: {prep}")
    if int(prep.get("terrainCompletedChunks") or 0) < int(prep.get("terrainRequiredChunks") or 0):
        raise AssertionError(f"startup terrain did not complete required chunks: {prep}")

    controlled_metrics = {
        "destinationMaxSliceMs": float(preload.get("destinationMaxSliceMs") or 0),
        "destinationDataMaxMs": float(preload.get("destinationDataMaxMs") or 0),
        "maxWorkMs": float(preload.get("maxWorkMs") or 0),
    }
    for name, value in controlled_metrics.items():
        if value >= 50:
            raise AssertionError(f"{name} exceeded 50 ms: {value}")
    if int(preload.get("destinationLongTask50") or 0) != 0:
        raise AssertionError(f"controlled destination slices crossed 50 ms: {preload}")
    if int(preload.get("destinationPaintHeartbeats") or 0) < 1:
        raise AssertionError(f"startup preparation did not yield through paint boundaries: {preload}")
    if float(preload.get("destinationWallMs") or 0) <= 0:
        raise AssertionError(f"destination wall timing missing: {preload}")

    js("return window.AppUI.setStartupWatchdogProofForEvidence('slow',{elapsedMs:12000,noProgressMs:9000,progress:68});")
    slow_overlay = js("return window.AppUI.sceneLoadingSnapshot().overlay;")
    if "Still working" not in str(slow_overlay.get("message") or ""):
        raise AssertionError(f"slow state is not communicated: {slow_overlay}")
    if "elapsed" not in str(slow_overlay.get("progressText") or ""):
        raise AssertionError(f"slow state lacks elapsed telemetry: {slow_overlay}")

    js("return window.AppUI.setStartupWatchdogProofForEvidence('stalled',{elapsedMs:34000,noProgressMs:31000,progress:68});")
    stalled_overlay = js("return window.AppUI.sceneLoadingSnapshot().overlay;")
    if stalled_overlay.get("retryVisible") is not True:
        raise AssertionError(f"verified no-progress state lacks retry: {stalled_overlay}")
    if "No measurable progress" not in str(stalled_overlay.get("message") or ""):
        raise AssertionError(f"verified no-progress state lacks diagnostic: {stalled_overlay}")

    before_seed = str(initial["campaign"]["seed"])
    before_active = int(preload.get("Active") or 0)
    driver.find_element(By.ID, "sceneLoadingRetry").click()
    wait_app_ready()
    wait_loader_settled()

    after = js("""
      return {
        ui: window.AppUI.sceneLoadingSnapshot(),
        renderer: window.GameRenderer.snapshot(),
        campaign: window.SeedSystem.getCampaign()
      };
    """)
    after_preload = after["renderer"].get("terrainPreload") or {}
    after_seed = str(after["campaign"]["seed"])
    if after_seed != before_seed:
        raise AssertionError(f"reload retry changed Campaign SEED: {before_seed} -> {after_seed}")
    if after_preload.get("simulationAuthorityPreserved") is not True:
        raise AssertionError(f"reload retry lost Simulation isolation: {after_preload}")
    active_target = int(after_preload.get("activeTargetCount") or after_preload.get("Active") or 0)
    if int(after_preload.get("Active") or 0) > active_target:
        raise AssertionError(f"reload retry duplicated active terrain resources: {after_preload}")

    severe = [
        row for row in driver.get_log("browser")
        if row.get("level") == "SEVERE" and "favicon" not in str(row.get("message", "")).lower()
    ]
    if severe:
        raise AssertionError(f"severe browser errors: {severe[-10:]}")

    evidence.update({
        "pass": True,
        "watchdogDecisions": decisions,
        "startupWatchdog": watchdog,
        "startupPreparation": prep,
        "controlledPreparation": {
            **controlled_metrics,
            "destinationWallMs": preload.get("destinationWallMs"),
            "destinationPaintHeartbeats": preload.get("destinationPaintHeartbeats"),
            "destinationLongTask50": preload.get("destinationLongTask50"),
        },
        "slowOverlay": slow_overlay,
        "stalledOverlay": stalled_overlay,
        "retry": {
            "seedStable": after_seed == before_seed,
            "activeBefore": before_active,
            "activeAfter": after_preload.get("Active"),
            "activeTargetAfter": active_target,
            "simulationAuthorityPreserved": after_preload.get("simulationAuthorityPreserved"),
        },
    })
except Exception as exc:
    evidence["pass"] = False
    evidence["error"] = repr(exc)
    raise
finally:
    (OUT / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    driver.quit()

print(json.dumps(evidence, indent=2))
