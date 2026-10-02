#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_001_002_001_artifact")
SEED = "WP-S003-001-002-001-SEED"
TESTED_HEAD = os.environ.get("WP_EVIDENCE_HEAD")


def url_with(params):
    p = urlsplit(TARGET)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q.update(params)
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def driver_for(disable_webgpu=False):
    o = Options()
    for arg in [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-search-engine-choice-screen",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-webgpu",
        "--use-webgpu-adapter=swiftshader",
        "--use-gpu-in-tests",
        "--window-size=1280,800",
    ]:
        o.add_argument(arg)
    o.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    d = webdriver.Chrome(options=o)
    bootstrap = f"""
      try {{
        localStorage.setItem('advisor.planet.seed.v1', {json.dumps(SEED)});
        localStorage.removeItem('advisor.renderer.backend');
        localStorage.setItem('the-advisor-game:development-mode','false');
      }} catch (_) {{}}
    """
    if disable_webgpu:
        bootstrap += """
          try { Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}); } catch (_) {}
          try { Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined,configurable:true}); } catch (_) {}
        """
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": bootstrap})
    return d


def wait(d, script, timeout=180, *args):
    return WebDriverWait(d, timeout).until(lambda x: x.execute_script(script, *args))


def snap(d):
    return d.execute_script("return window.PlanetStage?.snapshot?.()||null")


def settle_ground(d):
    d.execute_script("""
      const s=window.PlanetStage.snapshot(),p=window.StartingVillage?.plan?.(s.activeSeed),c=p?.center||{x:'0',y:'0'};
      window.PlanetStage.setWorldTileFocus(String(c.x),String(c.y));
      window.PlanetStage.setScaleIndex(9);
    """)
    wait(d, """
      const s=window.PlanetStage?.snapshot?.(),r=s?.projection?.resourceBudget||{},ls=s?.projection?.localStatic||{};
      return Boolean(s?.ready && Number(s?.zoom?.scaleIndex)===9 &&
        Number(r.pendingPreparationCount||0)===0 &&
        (!r.requestedSignature || r.standInActive || String(r.activeSignature||'')===String(r.requestedSignature||'')) &&
        (ls.revealTier==='full'||ls.revealTier==='refined'));
    """, 240)
    time.sleep(1.0)


def backend_record(d, label):
    s = snap(d)
    rb = s.get("rendererBackend") or {}
    badge = d.execute_script("""
      const n=document.querySelector('.renderer-backend-debug');
      return n?{text:n.textContent,active:n.dataset.active,requested:n.dataset.requested,selection:n.dataset.selection,rect:(()=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()}:null;
    """)
    root = d.execute_script("""
      const r=document.getElementById('planetStageRoot');
      return r?{requested:r.dataset.rendererRequestedBackend,active:r.dataset.rendererActiveBackend,selection:r.dataset.rendererBackendSelection,fallback:r.dataset.rendererFallbackReason||null,webgpu:r.dataset.rendererWebgpuAvailable}:null;
    """)
    return {
        "label": label,
        "activeSeed": s.get("activeSeed"),
        "geographyHash": s.get("geographyHash"),
        "focusTile": (s.get("canonicalFocus") or {}).get("worldTile"),
        "rotation": s.get("rotation"),
        "zoom": {
            "scaleIndex": (s.get("zoom") or {}).get("scaleIndex"),
            "scaleLabel": (s.get("zoom") or {}).get("scaleLabel"),
            "visibleFootprintHeightMeters": (s.get("zoom") or {}).get("visibleFootprintHeightMeters"),
        },
        "localSignature": ((s.get("projection") or {}).get("localStatic") or {}).get("signature"),
        "localRevealTier": ((s.get("projection") or {}).get("localStatic") or {}).get("revealTier"),
        "backend": rb,
        "badge": badge,
        "rootDataset": root,
        "worldVisualStyle": s.get("worldVisualStyleIntegration"),
        "simulationAuthorityPreserved": bool(rb.get("simulationAuthority") is False),
    }


def run_success(label, gpu_mode, expected, ground=False, disable_webgpu=False):
    d = driver_for(disable_webgpu=disable_webgpu)
    try:
        d.get(url_with({
            "gpu": gpu_mode,
            "dev": "1",
            "evidence_fast_start": "1",
            "evidence_skip_destinations": "1",
        }))
        wait(d, "return document.readyState==='complete'", 60)
        wait(d, "return window.PlanetStage?.snapshot?.()?.ready===true", 240)
        wait(d, "return Boolean(document.querySelector('.renderer-backend-debug'))", 30)
        if ground:
            settle_ground(d)
        time.sleep(2.0)
        rec = backend_record(d, label)
        active = (rec["backend"] or {}).get("active")
        if active != expected:
            raise AssertionError(f"{label}: expected {expected}, got {active}: {rec}")
        if rec["activeSeed"] != SEED:
            raise AssertionError(f"{label}: seed mismatch {rec['activeSeed']}")
        if not rec["badge"] or expected.upper() not in rec["badge"]["text"].upper():
            raise AssertionError(f"{label}: developer backend badge missing active backend: {rec['badge']}")
        if gpu_mode == "auto" and expected == "webgpu" and (rec["backend"] or {}).get("selection") != "preferred":
            raise AssertionError(f"{label}: auto WebGPU was not marked preferred: {rec}")
        if gpu_mode == "auto" and expected == "webgl2" and not (rec["backend"] or {}).get("fallbackReason"):
            raise AssertionError(f"{label}: fallback reason missing: {rec}")
        if gpu_mode != "auto" and (rec["backend"] or {}).get("selection") != "developer-forced test":
            raise AssertionError(f"{label}: forced backend not marked developer-forced: {rec}")
        perf=(rec["backend"] or {}).get("performance") or {}
        if int(perf.get("sampleCount") or 0) < 10:
            raise AssertionError(f"{label}: insufficient performance samples: {perf}")
        path = OUT / f"{label}.png"
        if not d.save_screenshot(str(path)):
            raise RuntimeError(f"screenshot failed: {path}")
        rec["screenshot"] = path.name
        return rec
    finally:
        d.quit()


def run_forced_webgpu_failure():
    d = driver_for(disable_webgpu=True)
    try:
        d.get(url_with({
            "gpu": "webgpu",
            "dev": "1",
            "evidence_fast_start": "1",
            "evidence_skip_destinations": "1",
        }))
        wait(d, """
          const r=document.getElementById('planetStageRoot');
          return Boolean(r?.dataset?.error || (r?.dataset?.rendererBackendSelection||'').includes('failed'));
        """, 180)
        state = d.execute_script("""
          const r=document.getElementById('planetStageRoot'),n=document.querySelector('.renderer-backend-debug');
          return {error:r?.dataset?.error||null,selection:r?.dataset?.rendererBackendSelection||null,fallback:r?.dataset?.rendererFallbackReason||null,badge:n?.textContent||null};
        """)
        if "forced WebGPU" not in str(state.get("error")) and "forced WebGPU" not in str(state.get("fallback")):
            raise AssertionError(f"forced-WebGPU failure was not explicit: {state}")
        path = OUT / "forced-webgpu-unavailable.png"
        d.save_screenshot(str(path))
        state["screenshot"] = path.name
        return state
    finally:
        d.quit()


def compare_truth(records):
    base = records[0]
    for r in records[1:]:
        if r["activeSeed"] != base["activeSeed"] or r["geographyHash"] != base["geographyHash"]:
            raise AssertionError(f"backend changed world identity: {base['label']} vs {r['label']}")
        if r["focusTile"] != base["focusTile"] or r["zoom"] != base["zoom"] or r["rotation"] != base["rotation"]:
            raise AssertionError(f"backend comparison scene mismatch: {base['label']} vs {r['label']}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"wp":"WP-S003-001-002-001","testedHead":TESTED_HEAD,"seed":SEED,"pass":False,"records":[]}
    try:
        auto = run_success("01-auto-webgpu", "auto", "webgpu", ground=True)
        forced_gpu = run_success("02-forced-webgpu", "webgpu", "webgpu", ground=True)
        forced_gl = run_success("03-forced-webgl2", "webgl2", "webgl2", ground=True)
        fallback = run_success("04-auto-fallback-webgl2", "auto", "webgl2", ground=True, disable_webgpu=True)
        failure = run_forced_webgpu_failure()
        records=[auto,forced_gpu,forced_gl,fallback]
        compare_truth(records)
        report["records"]=records
        report["forcedWebgpuFailure"]=failure
        report["backendParity"]={
            "sameSeed":True,
            "sameGeographyHash":True,
            "sameFocusTile":True,
            "sameRotation":True,
            "sameZoom":True,
            "webgpuActive":auto["backend"]["active"]=="webgpu" and forced_gpu["backend"]["active"]=="webgpu",
            "webgl2Active":forced_gl["backend"]["active"]=="webgl2",
            "fallbackActive":fallback["backend"]["active"]=="webgl2" and bool(fallback["backend"].get("fallbackReason")),
        }
        report["pass"]=all(report["backendParity"].values())
    except Exception as exc:
        report["error"]=repr(exc)
        raise
    finally:
        (OUT/"evidence.json").write_text(json.dumps(report,indent=2,sort_keys=True),encoding="utf-8")
        print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
