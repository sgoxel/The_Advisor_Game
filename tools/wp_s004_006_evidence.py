#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE=os.environ.get("TARGET","http://127.0.0.1:8000/").rstrip("/")+"/"
OUT=Path("tools/screenshots/wp-s004-006")
OUT.mkdir(parents=True,exist_ok=True)

def driver():
    opts=Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--hide-scrollbars")
    opts.set_capability("goog:loggingPrefs",{"browser":"ALL"})
    return webdriver.Chrome(options=opts)

cases=[
    ("gathering-landscape","gathering",1365,768),
    ("conversation-landscape","conversation",1365,768),
    ("greeting-landscape","greeting",1365,768),
    ("gathering-portrait","gathering",430,932),
]

results=[]
d=driver()
try:
    for name,kind,w,h in cases:
        d.set_window_size(w,h)
        d.get(f"{BASE}wp-s004-006-proof.html?type={kind}&evidence={int(time.time())}")
        WebDriverWait(d,45).until(lambda x: x.execute_script("return !!window.wpS004006Evidence"))
        evidence=d.execute_script("return window.wpS004006Evidence")
        if not evidence or not evidence.get("pass"):
            raise RuntimeError(f"{name}: functional evidence failed: {evidence}")
        encounter=evidence.get("encounter") or {}
        verification=evidence.get("verification") or {}
        expected=3 if kind=="gathering" else 2
        assert len(encounter.get("participantIds") or [])==expected, (name,encounter)
        assert verification.get("deterministic") is True
        assert verification.get("busySkipped") is True
        assert verification.get("scheduleRecovered") is True
        assert verification.get("noRoadBlocking") is True
        assert verification.get("fullPopulationPairwiseScan") is False
        proof=evidence.get("proof") or {}
        assert proof.get("proofActive") is True
        path=OUT/f"{name}.png"
        d.save_screenshot(str(path))
        results.append({
            "name":name,"type":kind,"width":w,"height":h,"path":str(path),
            "participantCount":len(encounter.get("participantIds") or []),
            "holdsPosition":bool(encounter.get("holdsPosition")),
            "verification":{
                "deterministic":verification.get("deterministic"),
                "busySkipped":verification.get("busySkipped"),
                "scheduleRecovered":verification.get("scheduleRecovered"),
                "noRoadBlocking":verification.get("noRoadBlocking"),
                "fullPopulationPairwiseScan":verification.get("fullPopulationPairwiseScan"),
                "maxCandidateChecks":verification.get("maxCandidateChecks"),
            }
        })
    logs=d.get_log("browser")
    severe=[x for x in logs if x.get("level")=="SEVERE" and "favicon" not in str(x.get("message","")).lower()]
    if severe:
        raise RuntimeError("Browser console errors: "+json.dumps(severe,indent=2))
finally:
    d.quit()

report={
    "wp":"WP-S004-006","pass":True,"classification":"MIXED",
    "cases":results,
    "rules":{
        "selectionAuthority":"SEED + fantasy 5-minute slot + authoritative resident state",
        "spatialBuckets":True,
        "maxCandidateChecks":32,
        "maxActiveEncounters":2,
        "maxGroupSize":3,
        "fullPopulationPairwiseScan":False,
        "externalLlm":False
    }
}
Path("tools/screenshots/wp-s004-006/evidence.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
