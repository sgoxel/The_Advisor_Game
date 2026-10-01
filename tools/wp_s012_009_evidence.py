#!/usr/bin/env python3
import json,os,time
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException
TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/");OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s012-009"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"tablet":(768,1024),"desktop":(1280,720)}
MATRIX={"phone-portrait":["success","insufficient","unavailable","no-offers"],"phone-landscape":["success","insufficient"],"tablet":["unavailable","no-offers"],"desktop":["success","no-offers"]}
EXPECTED={"success":("42 cp","Affordable"),"insufficient":("2 cp","Insufficient funds"),"unavailable":("42 cp","Unavailable"),"no-offers":("21 cp","No local offer")}
def target_url(mode):
 p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q["evidence_fast_start"]="1";q["advisorEconomyEvidence"]=mode;return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))
opt=Options()
for a in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen"]:opt.add_argument(a)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"});driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,240)
def ready(mode):
 try:return bool(driver.execute_script("""const m=arguments[0],stage=document.getElementById('planetStageRoot'),panel=document.getElementById('advisorEconomyPanel'),shell=document.getElementById('advisorEconomyUI'),snap=window.AdvisorEconomyUI?.snapshot?.();return stage?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&panel&&!panel.hidden&&shell?.dataset?.evidenceMode===m&&snap?.evidenceMode===m;""",mode))
 except Exception:return False
def geometry(mode,profile):
 return driver.execute_script("""const mode=arguments[0],profile=arguments[1],rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();if(r.width===0&&r.height===0)return null;return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}},ov=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),inside=r=>!!r&&r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5;const p=rect(document.getElementById('advisorEconomyPanel')),balance=document.querySelector('.advisor-econ-summary article strong')?.textContent?.trim()||'',selected=document.querySelector('.advisor-econ-selected header strong')?.textContent?.trim()||'',status=document.querySelector('.advisor-econ-selected header b')?.textContent?.trim()||'',fixture=document.querySelector('.advisor-econ-fixture')?.textContent?.trim()||'',summary=[...document.querySelectorAll('.advisor-econ-summary article')].map(n=>n.innerText.trim()),offers=[...document.querySelectorAll('.advisor-econ-offer')].map(n=>n.innerText.trim()),snap=window.AdvisorEconomyUI?.snapshot?.(),proof=window.AdvisorEconomyUI?.proof?.(),recent=rect(document.querySelector('.advisor-econ-recent')),panelFoot=rect(document.querySelector('.advisor-econ-foot')),recentRows=[...document.querySelectorAll('.advisor-econ-outcomes article')].map(n=>({rect:rect(n),text:n.innerText.trim()})),chrome={map:rect(document.querySelector('.planet-map-context')),places:rect(document.querySelector('.planet-places-button')),scale:rect(document.querySelector('.planet-scale-ruler')),chat:rect(document.querySelector('.advisor-chat-launcher')),toolbelt:rect(document.querySelector('.advisor-toolbelt-launcher'))};return {mode,profile,viewport:{width:innerWidth,height:innerHeight},panel:p,panelInside:inside(p),balance,selected,status,fixture,summary,offers,recent,panelFoot,recentRows,documentWidth:document.documentElement.scrollWidth,overlap:Object.fromEntries(Object.entries(chrome).map(([k,v])=>[k,ov(p,v)])),snapshot:snap,proof,stageReady:document.getElementById('planetStageRoot')?.dataset?.ready||null};""",mode,profile)
def check(st):
 if not st["panelInside"]:raise RuntimeError("panel escaped viewport "+json.dumps(st))
 if st["documentWidth"]>st["viewport"]["width"]+1:raise RuntimeError("horizontal overflow "+json.dumps(st))
 for k,v in st["overlap"].items():
  if v>1:raise RuntimeError("overlap "+k+" "+json.dumps(st))
 if len(st["summary"])!=3:raise RuntimeError("balance/work/shelter summary missing "+json.dumps(st))
 exp=EXPECTED[st["mode"]]
 if st["balance"]!=exp[0]:raise RuntimeError("balance mismatch "+json.dumps(st))
 if st["mode"]=="no-offers":
  if st["selected"]!="No local offer":raise RuntimeError("no-offer state missing "+json.dumps(st))
 elif st["status"]!=exp[1]:raise RuntimeError("offer status mismatch "+json.dumps(st))
 if "PRESENTATION ONLY" not in st["fixture"]:raise RuntimeError("fixture label missing "+json.dumps(st))
 if st["mode"]=="success":
  rows=st.get("recentRows") or [];recent=st.get("recent");foot=st.get("panelFoot")
  if len(rows)!=1:raise RuntimeError("completed outcome row missing "+json.dumps(st))
  rr=rows[0].get("rect") or {};txt=str(rows[0].get("text") or "").lower()
  min_h=9 if st.get("profile")=="phone-landscape" else 20
  if not recent or not foot or rr.get("height",0)<min_h or rr.get("top",-1)<recent.get("top",0)-.5 or rr.get("bottom",10**9)>recent.get("bottom",0)+.5 or rr.get("bottom",10**9)>foot.get("top",0)-1:raise RuntimeError("completed outcome row clipped "+json.dumps(st))
  for token in ["buy","completed","exc-evid-01"]:
   if token not in txt:raise RuntimeError("completed outcome content missing "+token+" "+json.dumps(st))
 a=(st.get("snapshot") or {}).get("authority") or {}
 for k in ["eventDriven","boundedReads","presentationOnly"]:
  if a.get(k) is not True:raise RuntimeError("authority true marker "+k+" missing")
 for k in ["perFrameRender","fullWorldScan","wholeMarketScan","directWorldMutation","directCurrencyMutation","directInventoryMutation","directMarketMutation","directEmploymentMutation","directHousingMutation","directPurchaseExecution","transactionCompletionMutation","fixtureAuthority","protagonistDecisionAuthority","simulationValidationBypass"]:
  if a.get(k) is not False:raise RuntimeError("authority false marker "+k+" regressed")
 if not (st.get("proof") or {}).get("pass"):raise RuntimeError("proof failed "+json.dumps(st))
records=[]
try:
 driver.set_window_size(*VIEWPORTS["phone-portrait"]);driver.get(target_url("success"))
 try:wait.until(lambda _d:ready("success"))
 except TimeoutException:driver.save_screenshot(str(OUT/"startup-failure.png"));raise
 for profile,size in VIEWPORTS.items():
  driver.set_window_size(*size);time.sleep(.35)
  for mode in MATRIX[profile]:
   driver.execute_script("window.AdvisorEconomyUI.setEvidenceMode(arguments[0]);",mode);WebDriverWait(driver,30).until(lambda _d,m=mode:ready(m));time.sleep(.15);st=geometry(mode,profile);p=OUT/f"{profile}-{mode}.png";driver.save_screenshot(str(p));check(st);records.append({"profile":profile,"mode":mode,"file":str(p),"state":st})
 severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon.ico" not in str(x.get("message",""))]
 if severe:raise RuntimeError("browser severe "+json.dumps(severe[-10:]))
 result={"pass":True,"wp":"WP-S012-009","classification":"MIXED","screenshots":len(records),"viewports":VIEWPORTS,"records":records};(OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8");print(json.dumps({"pass":True,"wp":"WP-S012-009","screenshots":len(records)},indent=2))
finally:driver.quit()
