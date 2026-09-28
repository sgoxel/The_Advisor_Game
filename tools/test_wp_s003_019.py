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
OUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_019_artifact")


def evidence_url(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["seasonEvidence"] = "1"
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


def stage_snap(driver):
    return driver.execute_script("return window.PlanetStage?.snapshot?.()||null")


def season_snap(driver):
    return driver.execute_script("return window.SeasonalPresentation?.snapshot?.()||null")


def set_focus(driver):
    driver.execute_script(
        "window.PlanetStage.setWorldTileFocus('0','0');"
        "window.PlanetStage.setZoomScalar(1.0);"
    )
    wait(driver, """
        const s=window.PlanetStage?.snapshot?.()||{},r=s.projection?.resourceBudget||{};
        return s.ready===true&&Number(r.pendingPreparationCount||0)===0&&
               (!r.requestedSignature||String(r.activeSignature||'')===String(r.requestedSignature||''));
    """, 180)
    wait(driver, """
        const root=document.getElementById('planetStageRoot');
        return Boolean(root?.querySelector('.planet-world-center')?.dataset?.tile);
    """, 60)
    time.sleep(.35)
    return stage_snap(driver)


def set_season(driver, stamp, expected):
    snap = driver.execute_script("return window.SeasonalPresentation.setEvidenceStamp(arguments[0]);", stamp)
    wait(driver, "return window.SeasonalPresentation.snapshot().season===arguments[0]", 15, expected)
    time.sleep(.2)
    snap = season_snap(driver)
    if snap.get("season") != expected:
        raise AssertionError(f"Season mismatch {expected}: {snap}")
    return snap


def assert_runtime(label, snap):
    if not isinstance(snap, dict) or snap.get("ready") is not True or snap.get("active") is not True:
        raise AssertionError(f"{label}: seasonal runtime inactive: {snap}")
    if snap.get("presentationOnly") is not True or snap.get("simulationAuthority") is not False:
        raise AssertionError(f"{label}: authority isolation failed: {snap}")
    if snap.get("climateMutation") is not False or snap.get("resourceMutation") is not False:
        raise AssertionError(f"{label}: seasonal presentation mutated authority: {snap}")
    if snap.get("fullWorldScan") is not False or snap.get("perFrameWorldScan") is not False or snap.get("lazyRelevantOnly") is not True:
        raise AssertionError(f"{label}: bounded lazy contract failed: {snap}")
    if snap.get("pooledAccents") is not True or snap.get("cameraLocalPresentation") is not True:
        raise AssertionError(f"{label}: pooled/camera-local presentation missing: {snap}")
    if int(snap.get("accentCount") or 0) > int(snap.get("accentLimit") or 0):
        raise AssertionError(f"{label}: accent limit exceeded: {snap}")
    if int(snap.get("profileCacheEntries") or 0) > int(snap.get("profileCacheLimit") or 0):
        raise AssertionError(f"{label}: profile cache unbounded: {snap}")
    if float(snap.get("maxUpdateMs") or 0) > 40.0:
        raise AssertionError(f"{label}: cold seasonal refresh too expensive: {snap}")
    if float(snap.get("lastUpdateMs") or 0) > 15.0:
        raise AssertionError(f"{label}: steady seasonal refresh too expensive: {snap}")
    if float(snap.get("maxDrawMs") or 0) > 15.0:
        raise AssertionError(f"{label}: seasonal overlay draw too expensive: {snap}")
    if snap.get("deterministic") is not True:
        raise AssertionError(f"{label}: deterministic contract missing: {snap}")


def capture(driver, name):
    path = OUT_DIR / f"{name}.png"
    if not driver.save_screenshot(str(path)):
        raise RuntimeError(f"Screenshot failed: {path}")
    return path.name


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    evidence = {"wp": "WP-S003-019", "target": TARGET, "frames": [], "pass": False}
    driver = driver_for()
    try:
        driver.get(evidence_url(TARGET))
        wait(driver, "return document.readyState==='complete'", 60)
        wait(driver, "return window.PlanetStage?.snapshot?.()?.ready===true", 180)
        wait(driver, "return Boolean(window.SeasonalPresentation?.setEvidenceStamp)", 30)
        stage = set_focus(driver)
        seed = stage.get("activeSeed")
        tile = stage.get("canonicalFocus", {}).get("worldTile") or {"x": "0", "y": "0"}
        if not seed:
            raise AssertionError("Active planet SEED unavailable")

        dates = {
            "spring": {"year": 1100, "month": 4, "day": 15, "hour": 12, "minute": 0, "second": 0},
            "summer": {"year": 1100, "month": 7, "day": 15, "hour": 12, "minute": 0, "second": 0},
            "autumn": {"year": 1100, "month": 10, "day": 15, "hour": 12, "minute": 0, "second": 0},
            "winter": {"year": 1101, "month": 1, "day": 15, "hour": 12, "minute": 0, "second": 0},
        }
        signatures = {}
        region_id = None
        profile_summary = {}
        for idx, season in enumerate(("spring", "summer", "autumn", "winter"), start=1):
            snap = set_season(driver, dates[season], season)
            assert_runtime(season, snap)
            if region_id is None:
                region_id = snap.get("region", {}).get("id")
            elif snap.get("region", {}).get("id") != region_id:
                raise AssertionError(f"Fixed location changed region between seasons: {region_id} vs {snap.get('region')}")
            if (snap.get("focusTile") or {}) != tile:
                raise AssertionError(f"Fixed location changed canonical tile during {season}: {snap.get('focusTile')} vs {tile}")
            repeat = driver.execute_script("return window.SeasonalPresentation.refresh()")
            if repeat.get("seasonSignature") != snap.get("seasonSignature"):
                raise AssertionError(f"Deterministic repeat signature changed for {season}")
            signatures[season] = snap.get("seasonSignature")
            profile = snap.get("profile") or {}
            profile_summary[season] = {
                "foliageDensity": profile.get("foliageDensity"),
                "flowerDensity": profile.get("flowerDensity"),
                "dryGrass": profile.get("dryGrass"),
                "autumnFoliage": profile.get("autumnFoliage"),
                "leafFall": profile.get("leafFall"),
                "frost": profile.get("frost"),
                "snow": profile.get("snow"),
                "accentCount": snap.get("accentCount"),
            }
            evidence["frames"].append({
                "name": capture(driver, f"0{idx}-{season}"),
                "season": season,
                "seasonal": snap,
            })

        if len(set(signatures.values())) != 4:
            raise AssertionError(f"Season signatures are not distinct: {signatures}")
        if float(profile_summary["spring"]["flowerDensity"] or 0) <= float(profile_summary["summer"]["flowerDensity"] or 0):
            raise AssertionError(f"Spring flower state is not stronger than summer: {profile_summary}")
        if float(profile_summary["autumn"]["leafFall"] or 0) < .24:
            raise AssertionError(f"Autumn leaf state too weak: {profile_summary}")
        if float(profile_summary["winter"]["frost"] or 0) <= 0:
            raise AssertionError(f"Winter climate has no frost response at the fixed location: {profile_summary}")

        climate = driver.execute_script("""
            const seed=window.PlanetStage.snapshot().activeSeed,reps=window.RegionProfile.representatives(seed)||[];
            const rows=reps.map(r=>({id:r.id,x:String(r.administrativeSeat?.x||'0'),y:String(r.administrativeSeat?.y||'0'),temp:Number(r.identity?.averageTemperatureC||0),climate:String(r.identity?.climate||'')}));
            rows.sort((a,b)=>a.temp-b.temp||a.id.localeCompare(b.id));
            return {cold:rows[0]||null,warm:rows[rows.length-1]||null};
        """)
        if not climate.get("cold") or not climate.get("warm"):
            raise AssertionError(f"Climate representatives unavailable: {climate}")
        winter_stamp = dates["winter"]
        cold_profile = driver.execute_script(
            "return window.SeasonalPresentation.previewAt({x:arguments[0],y:arguments[1]},arguments[2]);",
            climate["cold"]["x"], climate["cold"]["y"], winter_stamp,
        )
        warm_profile = driver.execute_script(
            "return window.SeasonalPresentation.previewAt({x:arguments[0],y:arguments[1]},arguments[2]);",
            climate["warm"]["x"], climate["warm"]["y"], winter_stamp,
        )
        cold_winter = float(cold_profile.get("snow") or 0) + float(cold_profile.get("frost") or 0)
        warm_winter = float(warm_profile.get("snow") or 0) + float(warm_profile.get("frost") or 0)
        if climate["cold"]["temp"] < climate["warm"]["temp"] and cold_winter < warm_winter:
            raise AssertionError(f"Climate override inverted winter intensity: {climate} cold={cold_profile} warm={warm_profile}")

        driver.set_window_size(390, 844)
        time.sleep(.3)
        phone = set_season(driver, dates["autumn"], "autumn")
        assert_runtime("phone-autumn", phone)
        if phone.get("deviceClass") != "phone" or int(phone.get("accentLimit") or 0) > 24:
            raise AssertionError(f"Phone seasonal budget failed: {phone}")
        evidence["frames"].append({
            "name": capture(driver, "05-phone-autumn"),
            "season": "autumn",
            "seasonal": phone,
        })

        evidence["pass"] = True
        evidence["summary"] = {
            "seed": seed,
            "fixedTile": tile,
            "fixedRegion": region_id,
            "signatures": signatures,
            "profiles": profile_summary,
            "climateProof": {
                "cold": climate["cold"],
                "warm": climate["warm"],
                "coldWinterIntensity": cold_winter,
                "warmWinterIntensity": warm_winter,
            },
            "frameCount": len(evidence["frames"]),
            "maxUpdateMs": max(float(f["seasonal"].get("maxUpdateMs") or 0) for f in evidence["frames"]),
            "maxDrawMs": max(float(f["seasonal"].get("maxDrawMs") or 0) for f in evidence["frames"]),
            "phoneAccentLimit": int(phone.get("accentLimit") or 0),
            "phoneAccentCount": int(phone.get("accentCount") or 0),
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
