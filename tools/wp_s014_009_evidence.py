#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException
from screenshot_tool import set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s014-009"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"tablet":(768,1024),"desktop":(1280,720)}
MATRIX={"phone-portrait":["ordinary","threat","uncertain"],"phone-landscape":["threat","uncertain"],"tablet":["threat"],"desktop":["ordinary","threat"]}
EXPECTED_SUMMARY={"ordinary":"No known active threat","threat":"2 known threats","uncertain":"Threat picture uncertain"}

def url(mode):
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1","advisorEvidence":"ordinary","advisorSecurityEvidence":mode})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,240)

def ready(mode):
    try:
        return driver.execute_script("""
          const m=arguments[0],stage=document.getElementById('planetStageRoot'),panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-security-readout');
          const ss=window.AdvisorSecurityReadoutUI?.snapshot?.(),cs=window.AdvisorConversationUI?.snapshot?.();
          return Boolean(stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&panel&&!panel.hidden&&readout&&readout.open&&ss?.evidenceMode===m&&cs?.evidenceMode==='ordinary');
        """,mode)
    except Exception:return False

def state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const inside=r=>Boolean(r&&r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5),contained=(a,b)=>Boolean(a&&b&&b.left>=a.left-.5&&b.top>=a.top-.5&&b.right<=a.right+.5&&b.bottom<=a.bottom+.5);
      const panel=document.getElementById('advisorChatPanel'),readout=document.querySelector('.advisor-security-readout'),body=document.querySelector('.advisor-security-body'),p=rect(panel),r=rect(readout),b=rect(body);
      const chrome={map:rect(document.querySelector('.planet-map-context')),places:rect(document.querySelector('.planet-places-button')),scale:rect(document.querySelector('.planet-scale-ruler')),chat:rect(document.querySelector('.advisor-chat-launcher')),toolbelt:rect(document.querySelector('.advisor-toolbelt-launcher')),economy:rect(document.querySelector('.advisor-economy-launcher'))};
      const cards=[...document.querySelectorAll('.advisor-security-card')].map(n=>({title:n.querySelector('header strong')?.textContent?.trim()||'',text:n.innerText.trim(),rect:rect(n)}));
      const summary=document.querySelector('.advisor-security-hero strong')?.textContent?.trim()||'',score=document.querySelector('.advisor-security-score b')?.textContent?.trim()||'',badges=[...document.querySelectorAll('.advisor-security-row>span')].map(n=>n.textContent.trim());
      return{mode,profile,viewport:{width:innerWidth,height:innerHeight},panel:p,readout:r,body:b,panelInside:inside(p),readoutInside:inside(r),bodyInside:contained(r,b),cards,cardsInside:cards.every(x=>contained(b,x.rect)),summary,score,badges,documentWidth:document.documentElement.scrollWidth,
        overlap:Object.fromEntries(Object.entries(chrome).map(([k,v])=>[k,ov(r,v)])),snapshot:window.AdvisorSecurityReadoutUI?.snapshot?.()||null,proof:window.AdvisorSecurityReadoutUI?.proof?.()||null};
    """,mode,profile)

def assert_state(s):
    if not s["panelInside"] or not s["readoutInside"] or not s["bodyInside"]:raise RuntimeError("security readout escaped viewport "+json.dumps(s))
    if s["documentWidth"]>s["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(s))
    if not s["cardsInside"] or len(s["cards"])!=5:raise RuntimeError("security cards clipped/missing "+json.dumps(s))
    for k,v in s["overlap"].items():
        if v>1:raise RuntimeError("security readout overlaps required chrome "+k+" "+json.dumps(s))
    titles={x["title"] for x in s["cards"]}
    for t in ["Condition","Martial readiness","Known threats","Protection duty","Recent terminal outcomes"]:
        if t not in titles:raise RuntimeError("missing security card "+t+" "+json.dumps(s))
    snap=s.get("snapshot") or {};auth=snap.get("authority") or {}
    for key in ["eventDriven","bounded","boundedReads"]:
        if auth.get(key) is not True:raise RuntimeError("event/bounds regression "+key+" "+json.dumps(s))
    if int(snap.get("sourceReadTotal") or 0)>int((snap.get("limits") or {}).get("maxSourceReads") or 12):raise RuntimeError("source read bound exceeded "+json.dumps(s))
    for key in ["perFrameRead","fullWorldScan","wholeSettlementScan","wholeHistoryScan","directWorldMutation","directActionExecution","combatResolution","retreatExecution","healthMutation","inventoryMutation","skillMutation","standingMutation","rankMutation","relationshipMutation","legalAuthority","protagonistDecisionBypass","simulationValidationBypass"]:
        if auth.get(key) is not False:raise RuntimeError("authority regression "+key+" "+json.dumps(s))
    if auth.get("presentationOnly") is not True:raise RuntimeError("presentation-only guard missing "+json.dumps(s))
    if not (s.get("proof") or {}).get("pass"):raise RuntimeError("proof failed "+json.dumps(s))
    if s["summary"]!=EXPECTED_SUMMARY[s["mode"]]:raise RuntimeError("wrong summary "+json.dumps(s))
    if s["mode"]=="threat":
        if s["score"]!="68":raise RuntimeError("wrong threat readiness score "+json.dumps(s))
        if "Confirmed" not in s["badges"] or "Reported" not in s["badges"]:raise RuntimeError("epistemic labels missing "+json.dumps(s))
    if s["mode"]=="uncertain":
        text=" ".join(x["text"] for x in s["cards"])
        if "unavailable" not in text.lower() and "unknown" not in text.lower():raise RuntimeError("uncertainty unavailable state not readable "+json.dumps(s))

records=[]
try:
    set_exact_viewport(driver,*VIEWPORTS["phone-portrait"]);driver.get(url("ordinary"))
    try:wait.until(lambda d:ready("ordinary"))
    except TimeoutException:
        driver.save_screenshot(str(OUT/"startup-failure.png"));raise
    for profile,size in VIEWPORTS.items():
        set_exact_viewport(driver,*size);time.sleep(.35)
        for mode in MATRIX[profile]:
            driver.execute_script("window.AdvisorSecurityReadoutUI.setEvidenceMode(arguments[0]);window.AdvisorConversationUI.render('wp-s014-009-'+arguments[0]);",mode)
            WebDriverWait(driver,30).until(lambda d,m=mode:ready(m));time.sleep(.2)
            s=state(mode,profile)\n            if s["viewport"]!={"width":size[0],"height":size[1]}:raise RuntimeError("viewport calibration drift "+json.dumps(s))\n            path=OUT/f"{profile}-{mode}.png";driver.save_screenshot(str(path));assert_state(s);records.append({"profile":profile,"mode":mode,"file":str(path),"state":s})
    severe=[e for e in driver.get_log("browser") if e.get("level")=="SEVERE" and "favicon.ico" not in str(e.get("message",""))]
    if severe:raise RuntimeError("browser severe errors "+json.dumps(severe[-10:]))
    result={"pass":True,"wp":"WP-S014-009","classification":"MIXED","screenshots":len(records),"records":records}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"wp":"WP-S014-009","screenshots":len(records),"matrix":MATRIX},indent=2))
finally:driver.quit()
