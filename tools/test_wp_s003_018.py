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
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_018_artifact")


def evidence_url(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["weatherEvidence"] = "1"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


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


def weather_snap(driver):
    return driver.execute_script("return window.RegionalWeather?.snapshot?.()||null")


def stage_snap(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def set_focus(driver, x, y, scalar, require_settlement=False):
    driver.execute_script(
        "window.PlanetStage.setWorldTileFocus(String(arguments[0]),String(arguments[1]));"
        "window.PlanetStage.setZoomScalar(Number(arguments[2]));"
        "window.RegionalWeather.refresh();",
        str(x), str(y), float(scalar)
    )
    wait(driver, """
        const s=window.PlanetStage?.snapshot?.()||{},r=s.projection?.resourceBudget||{};
        return s.ready===true&&Number(r.pendingPreparationCount||0)===0&&
               (!r.requestedSignature||String(r.activeSignature||'')===String(r.requestedSignature||''));
    """, 180)
    if require_settlement:
        wait(driver, """
            const s=window.PlanetStage?.snapshot?.()||{},ls=s.projection?.localStatic||{};
            return ls.revealTier==='full'&&Number(ls.buildingCount||0)>=8;
        """, 120)
    time.sleep(.35)
    return stage_snap(driver)


def find_times(driver, tile):
    result = driver.execute_script(
        "return window.RegionalWeather.findEvidenceTimes(['clear','rain','fog'],arguments[0],null,240);",
        tile,
    )
    if not isinstance(result, dict) or not all(result.get(k) for k in ("clear", "rain", "fog")):
        raise AssertionError(f"Missing deterministic clear/rain/fog evidence times: {result}")
    if result["rain"]["weather"].get("shelterPreferred") is not True:
        raise AssertionError(f"Rain evidence is not shelter-relevant: {result['rain']}")
    return result


def apply_weather(driver, item):
    stamp = item["stamp"]
    expected = item["weather"]["state"]
    driver.execute_script("return window.RegionalWeather.setEvidenceStamp(arguments[0]);", stamp)
    wait(driver, "return window.RegionalWeather.snapshot().weatherState===arguments[0]", 20, expected)
    time.sleep(.25)
    result = weather_snap(driver)
    if result.get("weatherState") != expected:
        raise AssertionError(f"Weather state mismatch: expected {expected}, got {result}")
    return result


def assert_runtime(label, snap):
    if not isinstance(snap, dict) or snap.get("ready") is not True or snap.get("active") is not True:
        raise AssertionError(f"{label}: weather runtime not active: {snap}")
    if snap.get("presentationOnly") is not True or snap.get("simulationAuthority") is not False:
        raise AssertionError(f"{label}: authority isolation failed: {snap}")
    if snap.get("terrainMutation") is not False or snap.get("scheduleMutation") is not False:
        raise AssertionError(f"{label}: weather mutated authoritative systems: {snap}")
    if snap.get("fullWorldScan") is not False or snap.get("perFrameWorldScan") is not False:
        raise AssertionError(f"{label}: bounded-work contract failed: {snap}")
    if snap.get("pooledParticles") is not True or snap.get("cameraLocalParticles") is not True:
        raise AssertionError(f"{label}: pooled camera-local presentation missing: {snap}")
    if int(snap.get("activeParticleCount") or 0) > int(snap.get("particleLimit") or 0):
        raise AssertionError(f"{label}: particle budget exceeded: {snap}")
    # The first canonical RegionProfile resolution is a one-time cold preparation
    # outside the render loop; subsequent refreshes are cached. Keep that cold
    # preparation bounded while enforcing a much tighter steady refresh budget.
    if float(snap.get("maxUpdateMs") or 0) > 40.0:
        raise AssertionError(f"{label}: cold weather preparation too expensive: {snap}")
    if float(snap.get("lastUpdateMs") or 0) > 15.0:
        raise AssertionError(f"{label}: steady weather refresh too expensive: {snap}")
    if float(snap.get("maxFrameMs") or 0) > 24.0:
        raise AssertionError(f"{label}: weather draw frame too expensive: {snap}")
    if snap.get("deterministicState") is not True or snap.get("regional") is not True:
        raise AssertionError(f"{label}: deterministic regional contract missing: {snap}")


def capture(driver, name):
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"Screenshot failed: {path}")
    return path.name


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp": "WP-S003-018", "target": TARGET, "frames": [], "pass": False}
    driver = driver_for()
    try:
        driver.get(evidence_url(TARGET))
        wait(driver, "return document.readyState==='complete'", 60)
        driver.execute_script(
            "const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim();"
            "if(s!=='ACTIVE'&&b)b.click();"
        )
        wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true", 180)
        wait(driver, "return Boolean(window.RegionalWeather?.snapshot)", 30)

        seed = driver.execute_script("return window.PlanetStage.snapshot().activeSeed")
        if not seed:
            raise AssertionError("Active campaign SEED unavailable")

        settlement_stage = set_focus(driver, "0", "0", 1.0, require_settlement=True)
        settlement_tile = settlement_stage.get("canonicalFocus", {}).get("worldTile") or {"x": "0", "y": "0"}
        settlement_times = find_times(driver, settlement_tile)
        signatures = {}
        for state in ("clear", "rain", "fog"):
            snap = apply_weather(driver, settlement_times[state])
            assert_runtime(f"settlement-{state}", snap)
            if state == "clear" and int(snap.get("activeParticleCount") or 0) != 0:
                raise AssertionError(f"Clear weather should not allocate active particles: {snap}")
            if state == "rain":
                if int(snap.get("activeParticleCount") or 0) < 12 or float(snap.get("wetness") or 0) <= .4:
                    raise AssertionError(f"Rain presentation is too weak: {snap}")
                hook = snap.get("scheduleHook") or {}
                if hook.get("preferShelter") is not True or hook.get("mutation") is not False or hook.get("fallbackSafe") is not True:
                    raise AssertionError(f"Rain shelter hook failed: {hook}")
            if state == "fog" and float(snap.get("fogAlpha") or 0) < .4:
                raise AssertionError(f"Fog presentation is too weak: {snap}")
            repeat = driver.execute_script("return window.RegionalWeather.refresh()")
            if repeat.get("weatherSignature") != snap.get("weatherSignature"):
                raise AssertionError(f"Deterministic refresh changed signature for settlement {state}")
            signatures["settlement-"+state] = snap.get("weatherSignature")
            evidence["frames"].append({"name": capture(driver, f"01-settlement-{state}"), "scene": "settlement", "state": state, "weather": snap})

        target = driver.execute_script("""
            const seed=window.PlanetStage.snapshot().activeSeed,reps=window.RegionProfile.representatives(seed)||[];
            const candidates=reps.map(r=>({id:r.id,name:r.name,x:String(r.administrativeSeat?.x||'0'),y:String(r.administrativeSeat?.y||'0')}));
            candidates.sort((a,b)=>Math.hypot(Number(b.x),Number(b.y))-Math.hypot(Number(a.x),Number(a.y))||a.id.localeCompare(b.id));
            return candidates.find(x=>x.x!=='0'||x.y!=='0')||null;
        """)
        if not isinstance(target, dict):
            raise AssertionError("No deterministic wilderness region target available")
        wilderness_scalar = driver.execute_script("return Number(window.PlanetStage.scalarForFootprintHeight(80))")
        wilderness_stage = set_focus(driver, target["x"], target["y"], wilderness_scalar, require_settlement=False)
        wilderness_tile = wilderness_stage.get("canonicalFocus", {}).get("worldTile") or {"x": target["x"], "y": target["y"]}
        wilderness_times = find_times(driver, wilderness_tile)
        for state in ("clear", "rain", "fog"):
            snap = apply_weather(driver, wilderness_times[state])
            assert_runtime(f"wilderness-{state}", snap)
            signatures["wilderness-"+state] = snap.get("weatherSignature")
            evidence["frames"].append({"name": capture(driver, f"02-wilderness-{state}"), "scene": "wilderness", "state": state, "target": target, "weather": snap})

        settlement_region = evidence["frames"][0]["weather"].get("region", {}).get("id")
        wilderness_region = evidence["frames"][3]["weather"].get("region", {}).get("id")
        if not settlement_region or not wilderness_region or settlement_region == wilderness_region:
            raise AssertionError(f"Regional evidence did not reach different region IDs: {settlement_region} vs {wilderness_region}")

        driver.set_window_size(390, 844)
        time.sleep(.3)
        set_focus(driver, "0", "0", 1.0, require_settlement=True)
        phone_rain = apply_weather(driver, settlement_times["rain"])
        assert_runtime("phone-rain", phone_rain)
        if phone_rain.get("deviceClass") != "phone" or int(phone_rain.get("particleLimit") or 0) > 40:
            raise AssertionError(f"Mobile fallback particle budget failed: {phone_rain}")
        evidence["frames"].append({"name": capture(driver, "03-phone-rain"), "scene": "settlement-phone", "state": "rain", "weather": phone_rain})

        driver.set_window_size(1280, 800)
        clear_snap = driver.execute_script("return window.RegionalWeather.clearEvidenceStamp()")
        assert_runtime("authoritative-time-resume", clear_snap)
        if clear_snap.get("evidenceTimeOverride") is not False:
            raise AssertionError(f"Evidence override did not clear: {clear_snap}")

        evidence["pass"] = True
        evidence["summary"] = {
            "seed": seed,
            "settlementRegion": settlement_region,
            "wildernessRegion": wilderness_region,
            "states": ["clear", "rain", "fog"],
            "frameCount": len(evidence["frames"]),
            "maxObservedUpdateMs": max(float(f["weather"].get("maxUpdateMs") or 0) for f in evidence["frames"]),
            "maxObservedFrameMs": max(float(f["weather"].get("maxFrameMs") or 0) for f in evidence["frames"]),
            "maxParticleCount": max(int(f["weather"].get("activeParticleCount") or 0) for f in evidence["frames"]),
            "rainShelterHook": evidence["frames"][1]["weather"].get("scheduleHook"),
            "differentRegionalSignatures": signatures.get("settlement-rain") != signatures.get("wilderness-rain"),
            "mobileParticleLimit": int(phone_rain.get("particleLimit") or 0),
        }
        (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(evidence["summary"], indent=2, sort_keys=True))
    except Exception as exc:
        evidence["error"] = repr(exc)
        evidence["browserLogs"] = driver.get_log("browser")[-160:]
        (OUT_DIR / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        raise
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
