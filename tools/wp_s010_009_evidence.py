#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s010-009"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"tablet":(768,1024),"desktop":(1280,720)}
MATRIX={
  "phone-portrait":["traveling","deferred","self-care","completed"],
  "phone-landscape":["working","completed"],
  "tablet":["traveling","deferred"],
  "desktop":["working","self-care","completed"]
}
EXPECTED={"traveling":"active","working":"active","deferred":"deferred","self-care":"planned","completed":"completed"}

def url(mode):
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True))
    q.update({"evidence_fast_start":"1","advisorEvidence":"ordinary","advisorActivityEvidence":mode})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:
    opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);wait=WebDriverWait(driver,240)

def ready(mode):
    try:
        return driver.execute_script("""
          const m=arguments[0],stage=document.getElementById('planetStageRoot'),panel=document.getElementById('advisorChatPanel'),strip=document.querySelector('.advisor-activity-strip');
          const as=window.ProtagonistActivityUI?.snapshot?.(),cs=window.AdvisorConversationUI?.snapshot?.();
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&panel&&!panel.hidden&&strip&&as?.evidenceMode===m&&cs?.evidenceMode==='ordinary');
        """,mode)
    except Exception:return False

def state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1];
      const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const visible=n=>Boolean(n&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden');
      const panel=document.getElementById('advisorChatPanel'),strip=document.querySelector('.advisor-activity-strip'),close=document.querySelector('.advisor-chat-close'),composer=document.querySelector('.advisor-chat-compose'),transcript=document.querySelector('.advisor-chat-transcript'),map=document.querySelector('.planet-map-context'),places=document.querySelector('.planet-places-button'),scale=document.querySelector('.planet-scale-ruler');
      const p=rect(panel),a=rect(strip),c=rect(close),compose=visible(composer)?rect(composer):null,trans=visible(transcript)?rect(transcript):null;
      const inside=x=>Boolean(x&&x.left>=-.5&&x.top>=-.5&&x.right<=innerWidth+.5&&x.bottom<=innerHeight+.5);
      const snap=window.ProtagonistActivityUI?.snapshot?.()||{};
      return {mode,profile,viewport:{width:innerWidth,height:innerHeight},panel:p,activity:a,composer:compose,transcript:trans,panelInside:inside(p),activityInside:inside(a),composerInside:compose?inside(compose):true,documentWidth:document.documentElement.scrollWidth,
        overlap:{map:ov(p,rect(map)),places:ov(p,rect(places)),scale:ov(p,rect(scale)),close:ov(a,c)},
        phase:strip?.dataset?.activityPhase||null,kind:strip?.dataset?.activityKind||null,
        eyebrow:strip?.querySelector('.advisor-activity-main small')?.textContent?.trim()||'',title:strip?.querySelector('.advisor-activity-main strong')?.textContent?.trim()||'',
        detail:strip?.querySelector('.advisor-activity-main>span:not(.advisor-activity-progress)')?.textContent?.trim()||'',
        context:strip?.querySelector('.advisor-activity-context')?.textContent?.trim()||'',
        phaseLabel:strip?.querySelector('.advisor-activity-phase')?.textContent?.trim()||'',
        authorityLabel:strip?.querySelector('.advisor-activity-authority')?.textContent?.trim()||'',
        completionBacked:Boolean(snap.completionBacked),activitySnapshot:snap,chat:window.AdvisorConversationUI?.snapshot?.()||null};
    """,mode,profile)

def assert_state(s):
    if not s["panelInside"] or not s["activityInside"] or not s["composerInside"]:raise RuntimeError("activity/chat escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if s["overlap"]["map"]>1 or s["overlap"]["places"]>1 or s["overlap"]["scale"]>1:raise RuntimeError("Advisor panel overlaps required map chrome "+json.dumps(s))
    if s["overlap"]["close"]>1:raise RuntimeError("activity strip overlaps close control "+json.dumps(s))
    if s["phase"]!=EXPECTED[s["mode"]]:raise RuntimeError("wrong activity phase "+json.dumps(s))
    if not s["title"] or not s["phaseLabel"] or not s["authorityLabel"]:raise RuntimeError("activity state is not understandable "+json.dumps(s))
    if s["mode"]=="deferred" and "Why" not in s["context"]:raise RuntimeError("deferred reason missing "+json.dumps(s))
    if s["mode"] in ("traveling","working","self-care","completed") and "Target" not in s["context"]:raise RuntimeError("known target missing "+json.dumps(s))
    if s["mode"]=="completed":
        if not s["completionBacked"] or "Result" not in s["context"] or "Simulation" not in s["authorityLabel"]:raise RuntimeError("completed state lacks terminal Simulation evidence "+json.dumps(s))
    elif s["completionBacked"]:raise RuntimeError("non-completed state falsely backed as complete "+json.dumps(s))
    a=s["activitySnapshot"].get("authority",{})
    for key in ["directExecution","directWorldMutation","wholeWorldScan","wholeHistoryScan","perFrameRender"]:
        if a.get(key) is not False:raise RuntimeError("read-only/event-driven contract failed "+key+" "+json.dumps(s))
    if a.get("completionRequiresTerminalSimulation") is not True:raise RuntimeError("completion gate missing "+json.dumps(s))

records=[]
try:
    driver.set_window_size(*VIEWPORTS["phone-portrait"]);driver.get(url("traveling"))
    try:wait.until(lambda d:ready("traveling"))
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size);time.sleep(.35)
        for mode in MATRIX[profile]:
            driver.execute_script("window.ProtagonistActivityUI.setEvidenceMode(arguments[0]);window.AdvisorConversationUI.setEvidenceMode('ordinary');",mode)
            WebDriverWait(driver,30).until(lambda d,m=mode:ready(m));time.sleep(.18)
            s=state(mode,profile);path=OUT/f"{profile}-{mode}.png";driver.save_screenshot(str(path));assert_state(s);records.append({"profile":profile,"mode":mode,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S010-009","classification":"MIXED","screenshots":len(records),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":len(records),"matrix":MATRIX},indent=2))
finally:
    driver.quit()
