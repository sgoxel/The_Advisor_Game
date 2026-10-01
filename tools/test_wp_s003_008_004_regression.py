#!/usr/bin/env python3
"""WP-S003-008-004 planet-first startup responsiveness regression evidence."""
import json
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_008_004_regression_artifact")
OUT.mkdir(parents=True, exist_ok=True)

options = Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-unsafe-swiftshader")
options.add_argument("--window-size=412,915")
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
driver = webdriver.Chrome(options=options)
driver.set_page_load_timeout(120)
driver.set_script_timeout(300)

evidence = {
    "wp": "WP-S003-008-004",
    "classification": "FUNCTIONAL / PERFORMANCE",
    "visual": "N/A — startup responsiveness, bounded cooperative work, and no-progress recovery are timing/state requirements.",
    "viewport": {"width": 412, "height": 915, "profile": "Android-equivalent portrait"},
}

def js(script, *args):
    return driver.execute_script(script, *args)

def wait_planet_api(timeout=30):
    WebDriverWait(driver, timeout).until(lambda d: d.execute_script("return !!window.PlanetStage;"))

def observe_until_ready(timeout=210):
    deadline = time.monotonic() + timeout
    observations = []
    last_key = None
    while time.monotonic() < deadline:
        snapshot = js("return window.PlanetStage.snapshot();")
        progress = snapshot.get("startupProgress") or {}
        key = (
            progress.get("phaseId"),
            round(float(progress.get("measuredPercent") or 0), 3),
            int(progress.get("surfaceSamplesCompleted") or 0),
            progress.get("watchdogStatus"),
        )
        if key != last_key:
            observations.append({
                "wallSeconds": round(time.monotonic(), 3),
                "phaseId": key[0],
                "percent": key[1],
                "surfaceSamplesCompleted": key[2],
                "surfaceSamplesTotal": int(progress.get("surfaceSamplesTotal") or 0),
                "watchdogStatus": key[3],
            })
            last_key = key
        if snapshot.get("ready") is True and progress.get("mode") == "ready":
            return snapshot, observations
        if progress.get("mode") == "failed":
            raise AssertionError("startup entered failed state: " + json.dumps(progress, sort_keys=True))
        time.sleep(0.2)
    raise AssertionError("planet-first startup did not reach ready within evidence timeout")

def severe_logs():
    return [
        row for row in driver.get_log("browser")
        if row.get("level") == "SEVERE" and "favicon" not in str(row.get("message", "")).lower()
    ]

try:
    driver.get(URL)
    wait_planet_api()
    first, observations = observe_until_ready()
    progress = first.get("startupProgress") or {}
    scheduler = first.get("startupScheduler") or {}

    surface_obs = [o for o in observations if o.get("phaseId") == "surface"]
    distinct_surface = sorted({float(o.get("percent") or 0) for o in surface_obs})
    if len(distinct_surface) < 3 or (max(distinct_surface) - min(distinct_surface)) < 5:
        raise AssertionError("surface loading did not expose truthful incremental progress: " + repr(surface_obs))
    if int(scheduler.get("surfaceProgressUpdates") or 0) < 3:
        raise AssertionError("surface progress telemetry did not update incrementally: " + repr(scheduler))
    if int(progress.get("surfaceSamplesTotal") or 0) <= 0:
        raise AssertionError("surface sample total is missing: " + repr(progress))
    if int(progress.get("surfaceSamplesCompleted") or 0) != int(progress.get("surfaceSamplesTotal") or 0):
        raise AssertionError("surface samples did not complete: " + repr(progress))
    if int(scheduler.get("yieldCount") or 0) < 1 or int(scheduler.get("paintHeartbeatCount") or 0) < 1 or int(scheduler.get("heartbeatCount") or 0) < 1:
        raise AssertionError("browser heartbeat/yield evidence is missing: " + repr(scheduler))
    if float(scheduler.get("maxSliceMs") or 0) >= 50:
        raise AssertionError("controlled cooperative slice exceeded 50 ms: " + repr(scheduler.get("maxSliceMs")))
    if int(scheduler.get("controlledLongTaskOver200") or 0) != 0:
        raise AssertionError("severe >200 ms controlled startup task observed: " + repr(scheduler))
    if float(scheduler.get("controlledLongestLongTaskMs") or 0) >= 200:
        raise AssertionError("controlled startup long task reached 200 ms: " + repr(scheduler))
    if int(scheduler.get("watchdogStallCount") or 0) != 0:
        raise AssertionError("healthy startup tripped no-progress watchdog: " + repr(scheduler))
    if float(scheduler.get("watchdogMaxNoProgressMs") or 0) >= 30000:
        raise AssertionError("healthy startup reached watchdog stall threshold: " + repr(scheduler))
    if scheduler.get("simulationAuthorityPreserved") is not True:
        raise AssertionError("startup watchdog/scheduler authority isolation missing: " + repr(scheduler))
    for metric in ("surfaceSamplingWallMs", "surfaceCanvasCommitMs", "surfaceTextureUploadMs"):
        if float(scheduler.get(metric) or 0) <= 0:
            raise AssertionError(f"{metric} telemetry missing: {scheduler}")

    decisions = {
        "healthy": js("return window.PlanetStage.evaluateStartupWatchdogForEvidence(0);"),
        "slow": js("return window.PlanetStage.evaluateStartupWatchdogForEvidence(9000);"),
        "stalled": js("return window.PlanetStage.evaluateStartupWatchdogForEvidence(31000);"),
    }
    expected = {"healthy": "healthy", "slow": "slow", "stalled": "stalled"}
    for name, status in expected.items():
        if decisions[name].get("status") != status:
            raise AssertionError(f"watchdog threshold mismatch for {name}: {decisions[name]}")
        if decisions[name].get("simulationAuthorityPreserved") is not True:
            raise AssertionError(f"watchdog authority isolation missing for {name}: {decisions[name]}")

    js("return window.PlanetStage.setStartupWatchdogProofForEvidence('slow',{elapsedMs:12000,lastProgressAgeMs:9000,percent:68,surfaceRatio:.4});")
    slow_ui = js("""
      const root=document.querySelector('#planetStageRoot'),overlay=root.querySelector('.planet-stage-loading');
      return {
        phase:overlay.querySelector('.planet-stage-loading-phase')?.textContent||'',
        percent:overlay.querySelector('.planet-stage-loading-percent')?.textContent||'',
        retryHidden:overlay.querySelector('.planet-stage-loading-retry')?.hidden,
        mode:overlay.dataset.mode,proof:overlay.dataset.proof
      };
    """)
    if "Still working" not in slow_ui.get("phase", "") or "elapsed" not in slow_ui.get("percent", ""):
        raise AssertionError("slow-start presentation lacks useful live diagnostics: " + repr(slow_ui))
    if slow_ui.get("retryHidden") is not True:
        raise AssertionError("retry should stay hidden while measurable work can continue: " + repr(slow_ui))

    js("return window.PlanetStage.setStartupWatchdogProofForEvidence('stalled',{elapsedMs:34000,lastProgressAgeMs:31000,percent:68});")
    stalled_ui = js("""
      const root=document.querySelector('#planetStageRoot'),overlay=root.querySelector('.planet-stage-loading');
      return {
        phase:overlay.querySelector('.planet-stage-loading-phase')?.textContent||'',
        percent:overlay.querySelector('.planet-stage-loading-percent')?.textContent||'',
        retryHidden:overlay.querySelector('.planet-stage-loading-retry')?.hidden,
        mode:overlay.dataset.mode,proof:overlay.dataset.proof
      };
    """)
    if stalled_ui.get("retryHidden") is not False or stalled_ui.get("mode") != "failed":
        raise AssertionError("verified no-progress state lacks retry recovery: " + repr(stalled_ui))
    if "No measurable progress" not in stalled_ui.get("phase", ""):
        raise AssertionError("verified no-progress state lacks clear diagnostic: " + repr(stalled_ui))

    before_seed = str(first.get("activeSeed"))
    before_hash = str(first.get("geographyHash"))
    driver.find_element(By.CLASS_NAME, "planet-stage-loading-retry").click()
    wait_planet_api()
    second, retry_observations = observe_until_ready()
    if str(second.get("activeSeed")) != before_seed:
        raise AssertionError("Retry reload changed active SEED")
    if str(second.get("geographyHash")) != before_hash:
        raise AssertionError("Retry reload changed deterministic geography identity")
    retry_scheduler = second.get("startupScheduler") or {}
    if int(retry_scheduler.get("watchdogStallCount") or 0) != 0:
        raise AssertionError("healthy retry tripped watchdog: " + repr(retry_scheduler))
    if retry_scheduler.get("simulationAuthorityPreserved") is not True:
        raise AssertionError("retry path lost Simulation authority isolation")

    severe = severe_logs()
    if severe:
        raise AssertionError("severe browser errors: " + repr(severe[-10:]))

    evidence.update({
        "pass": True,
        "firstStartup": {
            "seed": before_seed,
            "geographyHash": before_hash,
            "observations": observations,
            "surfaceObservationCount": len(surface_obs),
            "distinctSurfacePercentCount": len(distinct_surface),
            "startupProgress": progress,
            "startupScheduler": scheduler,
        },
        "watchdogDecisions": decisions,
        "slowPresentation": slow_ui,
        "stalledPresentation": stalled_ui,
        "retry": {
            "seedStable": str(second.get("activeSeed")) == before_seed,
            "geographyHashStable": str(second.get("geographyHash")) == before_hash,
            "observationCount": len(retry_observations),
            "startupScheduler": retry_scheduler,
        },
    })
except Exception as exc:
    evidence["pass"] = False
    evidence["error"] = repr(exc)
    try:
        evidence["failureSnapshot"] = js("return window.PlanetStage?.snapshot?.() || null;")
        evidence["browserLogs"] = driver.get_log("browser")[-80:]
    except Exception as diagnostic_exc:
        evidence["diagnosticError"] = repr(diagnostic_exc)
    raise
finally:
    (OUT / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    driver.quit()

print(json.dumps(evidence, indent=2))
