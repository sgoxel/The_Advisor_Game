#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s013-009"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"tablet":(768,1024),"desktop":(1280,720)}
MODES=("healthy","authority")

def url(mode):
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True))
    q.update({"evidence_fast_start":"1","advisorEvidence":"ordinary","advisorStatusEvidence":mode})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:
    opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt)
wait=WebDriverWait(driver,240)

def ready(mode):
    try:
        return driver.execute_script("""
          const m=arguments[0],stage=document.getElementById('planetStageRoot'),panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-status-readout');
          const ss=window.ProtagonistStatusUI?.snapshot?.(),cs=window.AdvisorConversationUI?.snapshot?.();
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&panel&&!panel.hidden&&readout&&readout.open&&ss?.evidenceMode===m&&cs?.evidenceMode==='ordinary');
        """,mode)
    except Exception:
        return False

def state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1];
      const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const visible=n=>{if(!n)return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-status-readout'),body=document.querySelector('.advisor-status-body');
      const controls={
        map:document.querySelector('.planet-map-context'),
        places:document.querySelector('.planet-places-button'),
        scale:document.querySelector('.planet-scale-ruler'),
        launcher:document.querySelector('.advisor-chat-launcher'),
        toolbelt:document.querySelector('.advisor-toolbelt-launcher,.advisor-toolbelt-button')
      };
      const p=rect(panel),r=rect(readout),inside=x=>Boolean(x&&x.left>=-.5&&x.top>=-.5&&x.right<=innerWidth+.5&&x.bottom<=innerHeight+.5);
      const cards=[...document.querySelectorAll('.advisor-status-card')].map(n=>({title:n.querySelector('.advisor-status-card-head strong')?.textContent?.trim(),text:n.textContent.trim().replace(/\s+/g,' ').slice(0,520),rect:rect(n)}));
      const overlaps={};for(const [k,n] of Object.entries(controls))overlaps[k]=visible(n)?ov(p,rect(n)):0;
      return {
        mode,profile,viewport:{width:innerWidth,height:innerHeight},panel:p,readout:r,panelInside:inside(p),readoutInside:inside(r),
        documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
        overlaps,cards,body:{scrollTop:body?.scrollTop||0,scrollHeight:body?.scrollHeight||0,clientHeight:body?.clientHeight||0},
        summary:document.querySelector('.advisor-status-readout>summary')?.textContent?.trim().replace(/\s+/g,' '),
        status:window.ProtagonistStatusUI?.snapshot?.()||null,chat:window.AdvisorConversationUI?.snapshot?.()||null
      };
    """,mode,profile)

def assert_state(s):
    if not s["panelInside"] or not s["readoutInside"]:
        raise RuntimeError("status panel escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:
        raise RuntimeError("horizontal overflow "+json.dumps(s))
    for name,value in s["overlaps"].items():
        if value>1:
            raise RuntimeError(f"Advisor panel overlaps {name} control "+json.dumps(s))
    a=s["status"].get("authority",{})
    rt=s["status"].get("readTelemetry",{})
    if a.get("directWorldMutation") is not False or a.get("directExecution") is not False or a.get("wholeWorldScan") is not False or a.get("perFrameRender") is not False:
        raise RuntimeError("authority contract failed "+json.dumps(s))
    if rt.get("fullWorldScan") is not False or rt.get("wholeHistoryScan") is not False or rt.get("perFrameScan") is not False:
        raise RuntimeError("bounded read contract failed "+json.dumps(s))
    titles={c.get("title") for c in s["cards"]}
    for required in ["Role / authority","Duties / commitments","Advancement / patronage","Long-term guidance"]:
        if required not in titles:
            raise RuntimeError("missing status card "+required+" "+json.dumps(s))
    text=" ".join(c.get("text","") for c in s["cards"])
    if s["mode"]=="healthy":
        for required in ["Village resident","authoritative-employment-required"]:
            if required not in text and required not in str(s.get("summary","")):
                raise RuntimeError("ordinary/blocked evidence missing "+required+" "+json.dumps(s))
        if "Village steward" in text:
            raise RuntimeError("ordinary evidence leaked higher rank "+json.dumps(s))
    if s["mode"]=="authority":
        for required in ["Village steward","Squire service","Formal guild oath","Guild member","Recent appointment"]:
            if required not in text and required not in str(s.get("summary","")):
                raise RuntimeError("rich authority evidence missing "+required+" "+json.dumps(s))

records=[]
try:
    driver.set_window_size(*VIEWPORTS["phone-portrait"])
    driver.get(url("healthy"))
    try:
        wait.until(lambda d:ready("healthy"))
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size);time.sleep(.35)
        for mode in MODES:
            driver.execute_script("window.ProtagonistStatusUI.setEvidenceMode(arguments[0]);window.AdvisorConversationUI.setEvidenceMode('ordinary');",mode)
            WebDriverWait(driver,30).until(lambda d,m=mode:ready(m));time.sleep(.18)
            driver.execute_script("const b=document.querySelector('.advisor-status-body');if(b)b.scrollTop=0;")
            top=state(mode,profile);assert_state(top)
            top_path=OUT/f"{profile}-{mode}-top.png";driver.save_screenshot(str(top_path))
            bottom=None;bottom_path=None
            if mode=="authority":
                driver.execute_script("const b=document.querySelector('.advisor-status-body');if(b)b.scrollTop=b.scrollHeight;")
                time.sleep(.12)
                bottom=state(mode,profile);assert_state(bottom)
                bottom_path=OUT/f"{profile}-{mode}-bottom.png";driver.save_screenshot(str(bottom_path))
            records.append({"profile":profile,"mode":mode,"topFile":str(top_path),"bottomFile":str(bottom_path) if bottom_path else None,"top":top,"bottom":bottom})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:
        raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S013-009","classification":"MIXED","screenshots":sum(1+(1 if r["bottomFile"] else 0) for r in records),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":result["screenshots"],"viewports":VIEWPORTS,"modes":MODES},indent=2))
finally:
    driver.quit()
