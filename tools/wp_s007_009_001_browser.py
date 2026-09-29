#!/usr/bin/env python3
import json, os, shutil, tempfile, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE=os.environ.get("TARGET","http://127.0.0.1:8000/generated-world-store-proof.html")
OUT=Path(os.environ.get("EVIDENCE_DIR","tools/evidence/wp-s007-009-001"))
OUT.mkdir(parents=True,exist_ok=True)
profile=Path(tempfile.mkdtemp(prefix="advisor-idb-profile-"))

def options():
    o=Options()
    o.add_argument("--headless=new")
    o.add_argument("--no-sandbox")
    o.add_argument("--disable-dev-shm-usage")
    o.add_argument("--disable-gpu")
    o.add_argument(f"--user-data-dir={profile}")
    o.add_argument("--window-size=1280,720")
    o.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    return o

def run_phase(phase):
    driver=webdriver.Chrome(options=options())
    try:
        driver.get(BASE+"?phase="+phase)
        WebDriverWait(driver,120,poll_frequency=.2).until(
            lambda d:d.execute_script("return document.documentElement.dataset.ready==='true'||document.documentElement.dataset.ready==='failed'")
        )
        evidence=driver.execute_script("return window.__generatedStoreBrowserEvidence")
        logs=[x for x in driver.get_log("browser") if x.get("level") in ("SEVERE","ERROR") and "favicon.ico" not in str(x.get("message",""))]
        if not evidence or not evidence.get("pass"):
            raise AssertionError(f"{phase} failed: {evidence}")
        if logs:
            raise AssertionError(f"{phase} browser errors: {logs[:5]}")
        return evidence
    finally:
        driver.quit()

try:
    first=run_phase("write")
    time.sleep(.5)
    second=run_phase("read")
    assert first["backend"]=="indexeddb" and second["backend"]=="indexeddb"
    assert first["durable"] and second["durable"]
    assert first["generatorCalls"]==6
    assert second["generatorCalls"]==0
    assert second["persistentCacheRecords"]>=6
    assert all(x["source"]=="persistent" and not x["generated"] for x in second["sources"])
    assert first["signatures"]==second["signatures"]
    result={
      "pass":True,
      "browserRestart":True,
      "backend":"indexeddb",
      "firstSession":first,
      "secondSession":second,
      "zeroSecondSessionRegeneration":True,
      "signaturesStableAcrossBrowserRestart":True
    }
    (OUT/"browser-restart.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps(result,indent=2))
finally:
    shutil.rmtree(profile,ignore_errors=True)
