#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s009-010"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"tablet":(768,1024),"desktop":(1280,720)}
MATRIX={"phone-portrait":["healthy","pressure","injured","unavailable"],"phone-landscape":["pressure","injured"],"tablet":["healthy","authority"],"desktop":["authority","unavailable"]}

def url(mode):
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1","advisorEvidence":"ordinary","advisorStatusEvidence":mode})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))
opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);wait=WebDriverWait(driver,240)

def ready(mode):
    try:
        return driver.execute_script("""
          const m=arguments[0],stage=document.getElementById('planetStageRoot'),panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-status-readout');
          const ss=window.ProtagonistStatusUI?.snapshot?.(),cs=window.AdvisorConversationUI?.snapshot?.();
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&panel&&!panel.hidden&&readout&&readout.open&&ss?.evidenceMode===m&&cs?.evidenceMode==='ordinary');
        """,mode)
    except Exception:return False

def state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-status-readout'),launcher=document.querySelector('.advisor-chat-launcher'),map=document.querySelector('.planet-map-context'),places=document.querySelector('.planet-places-button'),scale=document.querySelector('.planet-scale-ruler');
      const p=rect(panel),r=rect(readout),inside=x=>Boolean(x&&x.left>=-.5&&x.top>=-.5&&x.right<=innerWidth+.5&&x.bottom<=innerHeight+.5);
      return {mode,profile,viewport:{width:innerWidth,height:innerHeight},panel:p,readout:r,panelInside:inside(p),readoutInside:inside(r),documentWidth:document.documentElement.scrollWidth,
        overlap:{map:ov(p,rect(map)),places:ov(p,rect(places)),scale:ov(p,rect(scale)),launcher:ov(r,rect(launcher))},
        cards:[...document.querySelectorAll('.advisor-status-card')].map(n=>({title:n.querySelector('strong')?.textContent?.trim(),text:n.textContent.trim().slice(0,260),rect:rect(n)})),
        cardsVisible:[...document.querySelectorAll('.advisor-status-card')].every(n=>{const x=rect(n);return x&&r&&x.left>=r.left-.5&&x.right<=r.right+.5&&x.top>=r.top-.5&&x.bottom<=r.bottom+.5}),
        chips:[...document.querySelectorAll('.advisor-status-chip')].map(n=>n.textContent.trim()),
        status:window.ProtagonistStatusUI?.snapshot?.()||null,chat:window.AdvisorConversationUI?.snapshot?.()||null};
    """,mode,profile)

def assert_state(s):
    if not s["panelInside"] or not s["readoutInside"]:raise RuntimeError("status panel escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if s["overlap"]["map"]>1 or s["overlap"]["places"]>1 or s["overlap"]["scale"]>1:raise RuntimeError("Advisor panel overlaps map chrome "+json.dumps(s))
    if s["overlap"]["launcher"]>1:raise RuntimeError("status readout overlaps Advisor launcher "+json.dumps(s))
    if not s.get("cardsVisible"):raise RuntimeError("one or more status cards are clipped outside the readout viewport "+json.dumps(s))
    a=s["status"].get("authority",{})
    if a.get("directWorldMutation") is not False or a.get("directExecution") is not False or a.get("wholeWorldScan") is not False or a.get("perFrameRender") is not False:raise RuntimeError("authority/event-driven contract failed "+json.dumps(s))
    titles={c.get("title") for c in s["cards"]}
    for required in ["Needs / pressure","Health","Goals","Inventory","Role / authority","Long-term guidance"]:
        if required not in titles:raise RuntimeError("missing status card "+required+" "+json.dumps(s))
    if s["mode"]=="unavailable" and not any("unavailable" in c.get("text","").lower() for c in s["cards"]):raise RuntimeError("unavailable state not explicit "+json.dumps(s))

records=[]
try:
    driver.set_window_size(*VIEWPORTS["phone-portrait"]);driver.get(url("healthy"))
    try:wait.until(lambda d:ready("healthy"))
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size);time.sleep(.35)
        for mode in MATRIX[profile]:
            driver.execute_script("window.ProtagonistStatusUI.setEvidenceMode(arguments[0]);window.AdvisorConversationUI.setEvidenceMode('ordinary');",mode)
            WebDriverWait(driver,30).until(lambda d,m=mode:ready(m));time.sleep(.18)
            s=state(mode,profile);path=OUT/f"{profile}-{mode}.png";driver.save_screenshot(str(path));assert_state(s);records.append({"profile":profile,"mode":mode,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S009-010","classification":"MIXED","screenshots":len(records),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":len(records),"matrix":MATRIX},indent=2))
finally:driver.quit()
