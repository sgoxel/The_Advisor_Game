#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL=os.environ.get('TARGET','http://127.0.0.1:8000/settlement-morphology-proof.html')
OUT=Path(os.environ.get('EVIDENCE_DIR','tools/screenshots/wp-s006-005-001'))
OUT.mkdir(parents=True, exist_ok=True)

PROFILES=[('landscape',1440,1000),('portrait',430,932)]

def opts():
    o=Options()
    o.add_argument('--headless=new')
    o.add_argument('--no-sandbox')
    o.add_argument('--disable-dev-shm-usage')
    o.add_argument('--disable-gpu')
    o.add_argument('--hide-scrollbars')
    o.add_argument('--window-position=0,0')
    o.set_capability('goog:loggingPrefs', {'browser':'ALL'})
    return o

def capture_full(driver,path):
    metrics=driver.execute_cdp_cmd('Page.getLayoutMetrics',{})
    size=metrics.get('cssContentSize') or metrics.get('contentSize') or {}
    width=max(1,int(size.get('width',driver.get_window_size()['width'])))
    height=max(1,int(size.get('height',driver.get_window_size()['height'])))
    result=driver.execute_cdp_cmd('Page.captureScreenshot',{
        'format':'png','captureBeyondViewport':True,'fromSurface':True,
        'clip':{'x':0,'y':0,'width':width,'height':height,'scale':1}
    })
    import base64
    path.write_bytes(base64.b64decode(result['data']))

def normalized(proof):
    return {
      'pass': bool(proof.get('pass')),
      'seed': proof.get('seed'),
      'classCoverage': list(proof.get('classCoverage') or []),
      'checks': {k:bool(proof.get(k)) for k in [
          'deterministic','scaleOrdered','capacityValid','ordinaryMajority','bounded',
          'roadsScale','morphologyDiversity','geographyResponsive','routeAnchors']},
      'representatives': [{
          'classId': item.get('classId'),
          'name': (item.get('plan') or {}).get('name'),
          'population': ((item.get('morphology') or {}).get('population') or {}).get('planned'),
          'morphology': ((item.get('morphology') or {}).get('morphology') or {}).get('id'),
          'footprint': (item.get('morphology') or {}).get('footprint'),
          'buildings': (item.get('morphology') or {}).get('buildings'),
          'roads': (item.get('morphology') or {}).get('roads'),
          'districtCount': len((item.get('morphology') or {}).get('districts') or []),
          'terrainAdaptation': (item.get('morphology') or {}).get('terrainAdaptation'),
          'lazy': (item.get('morphology') or {}).get('lazy')
      } for item in (proof.get('representatives') or [])]
    }

def validate(ev):
    expected=['hamlet','village','town','city','national-capital']
    if ev['classCoverage'] != expected:
        raise AssertionError(f'class coverage mismatch: {ev["classCoverage"]}')
    if not ev['pass']:
        bad=[k for k,v in ev['checks'].items() if not v]
        raise AssertionError(f'proof failed checks={bad}')
    if not all(ev['checks'].values()):
        raise AssertionError(f'failed checks: {[k for k,v in ev["checks"].items() if not v]}')
    reps=ev['representatives']
    if len(reps)!=5: raise AssertionError(f'expected 5 representatives, got {len(reps)}')
    for r in reps:
        if r['buildings']['residentialCapacity'] < r['population']:
            raise AssertionError(f'capacity shortfall {r["classId"]}')
        lazy=r['lazy']
        if lazy['detailedLotsMaterialized']!=0 or lazy['activeBuildingEntities']!=0 or lazy['distantFullCityMaterialized'] or lazy['fullWorldScan']:
            raise AssertionError(f'lazy contract failed {r["classId"]}')
        if r['districtCount']>9: raise AssertionError(f'unbounded districts {r["classId"]}')

all_runs=[]
driver=webdriver.Chrome(options=opts())
try:
    driver.set_window_size(PROFILES[0][1],PROFILES[0][2])
    driver.get(BASE_URL)
    WebDriverWait(driver,120, poll_frequency=0.25).until(
        lambda d: d.execute_script("return document.documentElement.dataset.ready==='true'||document.documentElement.dataset.ready==='failed'")
    )
    for profile,w,h in PROFILES:
        driver.set_window_size(w,h)
        time.sleep(0.3)
        proof=driver.execute_script('return window.__morphologyEvidence') or {}
        ev=normalized(proof)
        logs=[x for x in driver.get_log('browser') if x.get('level') in ('SEVERE','ERROR') and not ('favicon.ico' in str(x.get('message','')) and '404' in str(x.get('message','')))]
        ev['profile']=profile; ev['browserErrors']=logs
        (OUT/f'evidence-{profile}.json').write_text(json.dumps(ev,indent=2),encoding='utf-8')
        capture_full(driver,OUT/f'{profile}-full.png')
        driver.execute_script("document.querySelector('.common-scale')?.scrollIntoView({block:'start'})")
        time.sleep(0.2)
        driver.save_screenshot(str(OUT/f'{profile}-common-scale.png'))
        driver.execute_script("window.scrollTo(0,0)")
        if logs: raise AssertionError(f'browser errors in {profile}: {logs[:3]}')
        validate(ev)
        all_runs.append(ev)
finally:
    driver.quit()

def sig(ev):
    return json.dumps({k:v for k,v in ev.items() if k not in ('profile','browserErrors')},sort_keys=True,separators=(',',':'))
if len(all_runs)==2 and sig(all_runs[0])!=sig(all_runs[1]):
    raise AssertionError('viewport changed authoritative morphology proof')

summary={'pass':True,'profiles':[e['profile'] for e in all_runs],'evidence':all_runs[0]}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
