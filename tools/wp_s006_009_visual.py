#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE=os.environ.get("TARGET","http://127.0.0.1:8000/world-road-graph-proof.html")
OUT=Path(os.environ.get("EVIDENCE_DIR","tools/screenshots/wp-s006-009"))
OUT.mkdir(parents=True,exist_ok=True)
CASES=[("seed-a","WP_S006_009_ACCEPTANCE"),("seed-b","WP_S006_009_ACCEPTANCE_ALT")]
PROFILES=[("landscape",1440,1000),("portrait",430,932)]

def options():
    o=Options()
    o.add_argument("--headless=new");o.add_argument("--no-sandbox");o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--disable-gpu");o.add_argument("--hide-scrollbars");o.add_argument("--window-position=0,0")
    o.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    return o

records=[]
driver=webdriver.Chrome(options=options())
try:
    for profile,w,h in PROFILES:
        driver.set_window_size(w,h)
        for case,seed in CASES:
            driver.get(BASE+"?seed="+seed)
            WebDriverWait(driver,120,poll_frequency=.25).until(lambda d:d.execute_script("return document.documentElement.dataset.ready==='true'||document.documentElement.dataset.ready==='failed'"))
            ready=driver.execute_script("return document.documentElement.dataset.ready")
            evidence=driver.execute_script("return window.__roadGraphEvidence")
            logs=[x for x in driver.get_log("browser") if x.get("level") in ("SEVERE","ERROR") and "favicon.ico" not in str(x.get("message",""))]
            if ready!="true" or not evidence or not evidence.get("proof",{}).get("pass"):
                raise AssertionError(f"road graph page failed profile={profile} case={case} ready={ready} evidence={evidence}")
            if logs: raise AssertionError(f"browser errors profile={profile} case={case}: {logs[:3]}")
            summary=evidence["graphSummary"]
            if summary["connectedComponents"]!=1 or summary["fullWorldScan"] or summary["localChunkMaterialization"] or summary["detailedSegmentsMaterialized"]!=0 or summary["perFramePlanning"]:
                raise AssertionError(f"bounded/lazy road contract failed: {summary}")
            if summary["geographyInfluencedEdgeCount"]!=summary["edgeCount"]:
                raise AssertionError(f"not every edge geography-aware: {summary}")
            driver.execute_script("document.querySelector('.map-wrap').scrollIntoView({block:'center'})")
            time.sleep(.2)
            path=OUT/f"{profile}-{case}-network.png"
            if not driver.save_screenshot(str(path)): raise RuntimeError(f"screenshot failed {path}")
            records.append({"profile":profile,"case":case,"seed":seed,"file":str(path),"evidence":evidence})
finally:
    driver.quit()

sig={}
for r in records:
    sig.setdefault(r["case"],set()).add(r["evidence"]["signature"])
if any(len(v)!=1 for v in sig.values()): raise AssertionError("viewport changed road graph identity")
if len({records[0]["evidence"]["signature"],records[1]["evidence"]["signature"]})<2: raise AssertionError("alternate seed did not change graph identity")
summary={"pass":True,"screenshots":[r["file"] for r in records],"records":records}
(OUT/"summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
print(json.dumps({"pass":True,"screenshots":summary["screenshots"],"signatures":{k:list(v)[0] for k,v in sig.items()}},indent=2))
