#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_017_evidence.json")

def driver_for():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--enable-webgl")
    options.add_argument("--ignore-gpu-blocklist")
    options.add_argument("--use-angle=swiftshader")
    options.add_argument("--window-size=1280,800")
    options.add_argument("--autoplay-policy=user-gesture-required")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return webdriver.Chrome(options=options)

def wait(driver, script, timeout=120, *args):
    return WebDriverWait(driver, timeout).until(lambda d: d.execute_script(script, *args))

def snap(driver):
    return driver.execute_script("return window.AmbientAudio?.snapshot?.()||null")

def set_focus(driver, x, y, scalar=1.0):
    driver.execute_script(
        "window.PlanetStage.setWorldTileFocus(String(arguments[0]),String(arguments[1]));"
        "window.PlanetStage.setZoomScalar(Number(arguments[2]));"
        "window.AmbientAudio.refresh();",
        str(x), str(y), float(scalar)
    )
    time.sleep(0.7)
    return snap(driver)

def set_target(driver, lat, lon, scalar=0.9):
    driver.execute_script(
        "window.PlanetStage.setViewTarget({latitudeRadians:Number(arguments[0]),longitudeRadians:Number(arguments[1])});"
        "window.PlanetStage.setZoomScalar(Number(arguments[2]));"
        "window.AmbientAudio.refresh();",
        float(lat), float(lon), float(scalar)
    )
    time.sleep(0.7)
    return snap(driver)

def assert_budget(label, s):
    if not isinstance(s, dict):
        raise AssertionError(f"{label}: missing AmbientAudio snapshot")
    if s.get("presentationOnly") is not True or s.get("simulationAuthority") is not False:
        raise AssertionError(f"{label}: authority isolation failed: {s}")
    if s.get("fullWorldScan") is not False or s.get("perFrameScan") is not False:
        raise AssertionError(f"{label}: bounded-update contract failed: {s}")
    if int(s.get("voiceLimit") or 0) != 4 or int(s.get("oneShotLimit") or 0) != 2:
        raise AssertionError(f"{label}: voice budget contract changed: {s}")
    if int(s.get("activeVoiceCount") or 0) > 4 or int(s.get("activeOneShotCount") or 0) > 2:
        raise AssertionError(f"{label}: active voice budget exceeded: {s}")
    if int(s.get("updateIntervalMs") or 0) < 400:
        raise AssertionError(f"{label}: audio manager polling too aggressively: {s}")
    if float(s.get("maxUpdateMs") or 0) > 20.0:
        raise AssertionError(f"{label}: audio context update cost too high: {s}")

def main():
    evidence = {"wp": "WP-S003-017", "target": TARGET, "contexts": {}}
    driver = driver_for()
    try:
        driver.get(TARGET)
        wait(driver, "return document.readyState==='complete'", 60)
        driver.execute_script(
            "const b=document.querySelector('#newCampaignButton'),s=document.querySelector('#campaignState')?.textContent?.trim();"
            "if(s!=='ACTIVE'&&b)b.click();"
        )
        wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true", 180)
        wait(driver, "return Boolean(window.AmbientAudio?.snapshot)", 30)

        pre = snap(driver)
        evidence["preGesture"] = pre
        if pre.get("unlocked") is not False or int(pre.get("activeVoiceCount") or 0) != 0:
            raise AssertionError(f"Autoplay guard failed before trusted gesture: {pre}")

        canvas = WebDriverWait(driver, 30).until(lambda d: d.find_element(By.ID, "planetCanvas"))
        canvas.click()
        wait(driver, "const s=window.AmbientAudio.snapshot();return s.unlocked===true&&s.contextState==='running';", 30)
        unlocked = snap(driver)
        evidence["unlocked"] = unlocked
        assert_budget("unlock", unlocked)
        if unlocked.get("autoplayPolicy") != "trusted-user-gesture":
            raise AssertionError(f"Autoplay policy telemetry missing: {unlocked}")

        village = set_focus(driver, "0", "0", 1.0)
        assert_budget("village", village)
        if int(village.get("activeVoiceCount") or 0) < 1:
            raise AssertionError(f"Village context produced no active voice: {village}")
        if not any(t in set(village.get("selectedZoneTypes") or []) for t in {
            "village-chatter","smithy-hammer","market-murmur","tavern-ambience","farm-work","plains-wind","woodland-birds","night-insects"
        }):
            raise AssertionError(f"Village context lacks authoritative village/environment sound: {village}")
        evidence["contexts"]["village"] = village

        road = driver.execute_script("""
            const seed=window.PlanetStage.snapshot().activeSeed;
            let best=null;
            for(let y=-45;y<=45;y++)for(let x=-45;x<=45;x++){
              const l=window.StartingVillage.local(seed,String(x),String(y));
              if(!l||!window.StartingVillage.isRoadReserved(seed,l))continue;
              const d=Math.hypot(x,y);
              if(!best||d>best.d)best={x:String(x),y:String(y),d};
            }
            return best;
        """)
        if not isinstance(road, dict):
            raise AssertionError("No canonical StartingVillage road target found")
        road_snap = set_focus(driver, road["x"], road["y"], 1.0)
        assert_budget("road", road_snap)
        if int(road_snap.get("activeVoiceCount") or 0) < 1:
            raise AssertionError(f"Road context produced no active voice: {road_snap}")
        evidence["contexts"]["road"] = {"target": road, "audio": road_snap}

        targets = driver.execute_script("""
            const s=window.PlanetStage.snapshot(),g=window.PlanetGeography.create(s.activeSeed),out={};
            for(let lat=-68;lat<=68;lat+=4)for(let lon=-176;lon<180;lon+=4){
              const la=lat*Math.PI/180,lo=lon*Math.PI/180,p=g.sampleLatLon(la,lo);
              if(!out.water&&!p.land)out.water={lat:la,lon:lo,surfaceClass:p.surfaceClass};
              if(!out.wooded&&p.land&&p.surfaceClass!=='coast'&&Number(p.elevationMeters)<1550&&Number(p.mountainInfluence)<=.22&&Number(p.moisture)>.54)
                out.wooded={lat:la,lon:lo,moisture:p.moisture,surfaceClass:p.surfaceClass};
              if(out.water&&out.wooded)return out;
            }
            return out;
        """)
        if not isinstance(targets, dict) or not targets.get("wooded") or not targets.get("water"):
            raise AssertionError(f"Could not find bounded woodland/water targets: {targets}")

        wooded = set_target(driver, targets["wooded"]["lat"], targets["wooded"]["lon"], 0.9)
        assert_budget("wooded", wooded)
        wooded_types = set(wooded.get("selectedZoneTypes") or [])
        hour = float(wooded.get("fantasyHour") or 0)
        expected_wooded = "woodland-birds" if 5 <= hour < 19 else "night-insects"
        if expected_wooded not in wooded_types:
            raise AssertionError(f"Woodland context missing {expected_wooded}: {wooded}")
        if int(wooded.get("activeVoiceCount") or 0) < 1:
            raise AssertionError(f"Woodland context produced no active voice: {wooded}")
        evidence["contexts"]["wooded"] = {"target": targets["wooded"], "audio": wooded}

        water = set_target(driver, targets["water"]["lat"], targets["water"]["lon"], 0.9)
        assert_budget("water", water)
        if "water-ambience" not in set(water.get("selectedZoneTypes") or []):
            raise AssertionError(f"Water context missing water ambience: {water}")
        if int(water.get("activeVoiceCount") or 0) < 1:
            raise AssertionError(f"Water context produced no active voice: {water}")
        evidence["contexts"]["water"] = {"target": targets["water"], "audio": water}

        sets = [
            tuple(village.get("selectedZoneTypes") or []),
            tuple(road_snap.get("selectedZoneTypes") or []),
            tuple(wooded.get("selectedZoneTypes") or []),
            tuple(water.get("selectedZoneTypes") or []),
        ]
        if len(set(sets)) < 3:
            raise AssertionError(f"Soundscape did not change enough across traversal: {sets}")

        muted = driver.execute_script("return window.AmbientAudio.setMasterVolume(.35),window.AmbientAudio.setMuted(true)")
        if muted.get("muted") is not True or abs(float(muted.get("masterVolume") or 0)-.35) > .001:
            raise AssertionError(f"Mute/volume control failed: {muted}")
        driver.execute_script("window.AmbientAudio.setMuted(false)")

        driver.execute_script("window.PlanetStage.setZoomScalar(.5);window.AmbientAudio.refresh();")
        wait(driver, "const s=window.AmbientAudio.snapshot();return Number(s.activeVoiceCount||0)===0&&Number(s.candidateZoneCount||0)===0;", 20)
        culled = snap(driver)
        assert_budget("distant-cull", culled)
        evidence["distantCull"] = culled

        evidence["pass"] = True
        evidence["summary"] = {
            "voiceLimit": 4,
            "maxObservedUpdateMs": max(float(x.get("maxUpdateMs") or 0) for x in [village, road_snap, wooded, water, culled]),
            "contextTypeSets": [list(x) for x in sets],
            "trustedGestureUnlock": True,
            "distantCull": int(culled.get("activeVoiceCount") or 0) == 0,
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(evidence["summary"], indent=2, sort_keys=True))
    except Exception as exc:
        evidence["pass"] = False
        evidence["error"] = repr(exc)
        evidence["browserLogs"] = driver.get_log("browser")[-120:]
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
        raise
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
