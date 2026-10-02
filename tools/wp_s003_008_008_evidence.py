#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from screenshot_tool import set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-008-008"))
OUT.mkdir(parents=True,exist_ok=True)
SEEDS=["FOCUS-NAV-A-008008","FOCUS-NAV-B-008008"]

options=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:
    options.add_argument(arg)
options.add_argument("--window-size=1280,800")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
wait=WebDriverWait(driver,300)

# Each navigation gets a matching campaign before app scripts execute.
driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":r"""
try{
  const p=new URLSearchParams(location.search),seed=p.get('seed');
  if(seed){
    localStorage.clear();
    const d=new Date(),fantasy={
      year:d.getFullYear()-900,month:d.getMonth()+1,day:d.getDate(),
      hour:d.getHours(),minute:d.getMinutes(),second:d.getSeconds(),millisecond:d.getMilliseconds()
    };
    localStorage.setItem('advisor.planet.seed.v1',seed);
    localStorage.setItem('theAdvisorGame.wp001.campaign.v2',JSON.stringify({
      seed,realStartMs:Date.now(),fantasyStart:fantasy,protagonist:{x:'0',y:'0'},restartCount:0
    }));
  }
}catch(_){}
"""})

def js(script,*args): return driver.execute_script(script,*args)
def snap(): return js("return window.PlanetStage?.snapshot?.()||null")
def focus(): return js("return window.PlanetStage?.focusNavigationSnapshot?.()||null")
def pos():
    return js("""const p=window.Protagonist?.getPosition?.();return p?{x:String(p.x),y:String(p.y)}:null;""")
def shot(name):
    p=OUT/(name+".png"); driver.save_screenshot(str(p)); return p.name
def ready():
    try:
        s=snap()
        return bool(s and s.get("ready") and js("return document.getElementById('planetStageRoot')?.dataset?.ready==='true'"))
    except Exception:return False
def set_scale(index):
    js("window.PlanetStage.setScaleIndex(arguments[0])",int(index))
    wait.until(lambda _d: (snap() or {}).get("zoom",{}).get("scaleIndex")==int(index))
    if index>=6:
        wait.until(lambda _d: (snap() or {}).get("projection",{}).get("resourceBudget",{}).get("pendingPreparationCount",0)==0)
    time.sleep(.35)
def wait_focus(max_zoom=False):
    def ok(_d):
        f=focus() or {}
        if f.get("status")!="reached": return False
        if max_zoom:
            s=snap() or {}; np=s.get("npcPresentation",{})
            return bool(f.get("protagonistVisible") and np.get("protagonistBillboardVisible") and f.get("visibleLevel")=="ground")
        return True
    wait.until(ok)
    return focus()
def compact_descriptor(d):
    c=d.get("coordinates") or {}
    return {"id":d.get("id"),"name":d.get("name"),"type":d.get("type"),"category":d.get("category"),
            "terrain":(d.get("evidence") or {}).get("terrain"),
            "coordinate":{"latitudeRadians":c.get("latitudeRadians"),"longitudeRadians":c.get("longitudeRadians"),
                          "latitudeDegrees":c.get("latitudeDegrees"),"longitudeDegrees":c.get("longitudeDegrees")},
            "center":d.get("center")}
def choose(descriptors,pred,exclude=None):
    exclude=set(exclude or [])
    for d in descriptors:
        if str(d.get("id")) not in exclude and pred(d): return d
    return None
def focus_case(d,label,through_ui=False):
    before=snap()
    if through_ui:
        js("window.PlanetStage.openPlaces()")
        time.sleep(.2)
        rows=driver.find_elements(By.CSS_SELECTOR,".planet-place-row")
        clicked=False
        for row in rows:
            if d.get("name") in row.text:
                buttons=row.find_elements(By.CSS_SELECTOR,"button")
                if buttons and buttons[-1].is_enabled():
                    buttons[-1].click();clicked=True;break
        if not clicked: raise RuntimeError("Could not click real Places View button for "+str(d.get("name")))
    else:
        js("window.PlanetStage.focusDestinationById(arguments[0])",str(d.get("id")))
    reached=wait_focus(False)
    after=snap()
    expected="water" if d.get("category")=="water" or (d.get("evidence") or {}).get("terrain")=="water" else "land"
    if reached.get("focusErrorMeters") is None or reached["focusErrorMeters"]>2.0:
        raise RuntimeError(label+" focus error "+json.dumps(reached))
    if reached.get("fallbackUsed") is not False: raise RuntimeError(label+" used fallback")
    if expected=="land" and reached.get("reachedSurface")=="water":
        raise RuntimeError(label+" terrestrial target reached water "+json.dumps(reached))
    return {"label":label,"throughUi":through_ui,"descriptor":compact_descriptor(d),"focus":reached,
            "finalScale":(after.get("zoom") or {}).get("scaleLabel"),"visibleLevel":reached.get("visibleLevel"),
            "streamingPending":reached.get("streamingPending"),"expectedSurface":expected}

def invalid_case():
    before=focus(); s0=snap(); z0=(s0.get("zoom") or {})
    before_coord=(z0.get("focusLatitudeDegrees"),z0.get("focusLongitudeDegrees"))
    result=js("window.PlanetStage.focusDestinationById('INTENTIONALLY-MISSING-TARGET')")
    s1=snap(); z1=s1.get("zoom") or {}
    after_coord=(z1.get("focusLatitudeDegrees"),z1.get("focusLongitudeDegrees"))
    if before_coord!=after_coord: raise RuntimeError("invalid target moved camera")
    if result.get("status")!="unavailable" or result.get("fallbackUsed") is not False:
        raise RuntimeError("invalid target did not fail safely "+json.dumps(result))
    return {"before":before_coord,"after":after_coord,"result":result}

def load_seed(seed):
    set_exact_viewport(driver,1280,800)
    url=TARGET+("? " if "?" in TARGET else "?")
    url=TARGET+("&" if "?" in TARGET else "?")+"seed="+seed+"&gpu=webgl2&dev=1&evidence_fast_start=1"
    driver.get(url)
    wait.until(lambda _d: ready())
    wait.until(lambda _d: js("return window.SeedSystem?.getCampaign?.()?.seed===arguments[0]",seed))
    set_scale(7)
    js("window.PlanetStage.refreshPlaces()")
    wait.until(lambda _d: len(js("return window.PlanetStage.placeDescriptors()"))>0)
    return js("return window.PlanetStage.placeDescriptors()")

report={"wp":"WP-S003-008-008","classification":"MIXED","seeds":[],"screenshots":[],"movementAuthorityAudit":{
  "legitimateSecondPositionAvailable":False,
  "reason":"Canonical Protagonist.getPosition reads SeedSystem campaign position; ProtagonistJourney explicitly reports worldPositionAuthority=false/directPositionMutation=false. Evidence does not mutate campaign position."
}}
try:
    for si,seed in enumerate(SEEDS):
        descriptors=load_seed(seed)
        entry={"seed":seed,"initialPosition":pos(),"cases":[]}
        settlement=choose(descriptors,lambda d:d.get("category") in ("settlements","cities"))
        other_settlement=choose(descriptors,lambda d:d.get("category") in ("settlements","cities"),[settlement.get("id")] if settlement else [])
        terrestrial=choose(descriptors,lambda d:d.get("category") not in ("settlements","cities","water") and (d.get("evidence") or {}).get("terrain")!="water")
        water=choose(descriptors,lambda d:d.get("category")=="water" or (d.get("evidence") or {}).get("terrain")=="water")
        if not settlement: raise RuntimeError("no settlement descriptor for "+seed)

        js("window.PlanetStage.openPlaces()")
        time.sleep(.3)
        report["screenshots"].append(shot(f"seed-{si+1}-places-desktop"))
        entry["cases"].append(focus_case(settlement,"settlement-primary",True))
        if other_settlement: entry["cases"].append(focus_case(other_settlement,"settlement-secondary"))
        if terrestrial: entry["cases"].append(focus_case(terrestrial,"terrestrial-poi"))
        if water: entry["cases"].append(focus_case(water,"water-poi"))
        entry["invalidTarget"]=invalid_case()

        # Return to a non-ground local scale, select the real world-anchored protagonist marker,
        # then invoke the explicit Focus button from the inspection tooltip.
        set_scale(7)
        js("window.PlanetStage.setViewTarget(window.PlanetStage.worldLatLonForTile(arguments[0].x,arguments[0].y))",entry["initialPosition"])
        time.sleep(.35)
        marker=wait.until(lambda _d: driver.find_element(By.CSS_SELECTOR,".planet-protagonist-marker:not([hidden])"))
        marker.click()
        wait.until(lambda _d: driver.find_element(By.CSS_SELECTOR,'.world-inspection-tooltip[data-actionable="true"] .world-inspection-focus'))
        if si==0:
            report["screenshots"].append(shot("protagonist-selected-wide-desktop"))
        before_actor=pos()
        driver.find_element(By.CSS_SELECTOR,'.world-inspection-tooltip[data-actionable="true"] .world-inspection-focus').click()
        reached=wait_focus(True)
        after_actor=pos()
        if before_actor!=after_actor: raise RuntimeError("camera focus mutated protagonist position")
        entry["protagonistFocus"]={"beforeActor":before_actor,"afterActor":after_actor,"focus":reached}
        report["screenshots"].append(shot(f"seed-{si+1}-protagonist-ground-desktop"))

        if si==0:
            set_exact_viewport(driver,844,390); js("window.PlanetStage.focusProtagonist()"); wait_focus(True); time.sleep(.3)
            report["screenshots"].append(shot("protagonist-ground-phone-landscape"))
            set_exact_viewport(driver,390,844); js("window.PlanetStage.focusProtagonist()"); wait_focus(True); time.sleep(.3)
            report["screenshots"].append(shot("protagonist-ground-phone-portrait"))
            set_exact_viewport(driver,1280,800)

        entry["descriptorCounts"]={
          "total":len(descriptors),
          "settlements":sum(1 for d in descriptors if d.get("category") in ("settlements","cities")),
          "terrestrial":sum(1 for d in descriptors if d.get("category")!="water" and (d.get("evidence") or {}).get("terrain")!="water"),
          "water":sum(1 for d in descriptors if d.get("category")=="water" or (d.get("evidence") or {}).get("terrain")=="water")
        }
        report["seeds"].append(entry)

    all_cases=[c for seed in report["seeds"] for c in seed["cases"]]
    report["functionalPass"]=bool(len(report["seeds"])==2 and all(c["focus"]["focusErrorMeters"]<=2 for c in all_cases)
        and all(c["focus"]["fallbackUsed"] is False for c in all_cases)
        and all(seed["protagonistFocus"]["beforeActor"]==seed["protagonistFocus"]["afterActor"] for seed in report["seeds"]))
    report["requiredCoverage"]={
      "twoSeeds":len(report["seeds"])==2,
      "primarySettlement":sum(1 for c in all_cases if c["label"]=="settlement-primary")>=2,
      "secondarySettlement":any(c["label"]=="settlement-secondary" for c in all_cases),
      "terrestrialPoi":any(c["label"]=="terrestrial-poi" for c in all_cases),
      "waterPoi":any(c["label"]=="water-poi" for c in all_cases),
      "invalidFailsSafe":all(seed["invalidTarget"]["result"]["status"]=="unavailable" for seed in report["seeds"]),
      "protagonistMaxGround":all(seed["protagonistFocus"]["focus"]["status"]=="reached" and seed["protagonistFocus"]["focus"]["visibleLevel"]=="ground" for seed in report["seeds"]),
      "cameraOnly":all(seed["protagonistFocus"]["beforeActor"]==seed["protagonistFocus"]["afterActor"] for seed in report["seeds"]),
      "legitimateSecondPosition":False
    }
finally:
    report["browserLogs"]=[x for x in driver.get_log("browser") if x.get("level") in ("SEVERE","WARNING")][-40:]
    (OUT/"summary.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    driver.quit()

if not report.get("functionalPass"): raise SystemExit("focus evidence functional validation failed")
print(json.dumps(report,indent=2))
