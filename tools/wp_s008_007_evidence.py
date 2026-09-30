#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s008-007"))
OUT.mkdir(parents=True,exist_ok=True)

VIEWPORTS={
    "phone-portrait":(390,844),
    "phone-landscape":(844,390),
    "tablet":(768,1024),
    "desktop":(1280,720),
}
MODE_MATRIX={
    "phone-portrait":["ordinary","ambiguous","rejected","completed"],
    "phone-landscape":["ordinary","ambiguous","rejected","completed"],
    "tablet":["ordinary"],
    "desktop":["completed"],
}
EXPECTED={
    "ordinary":{"Local reply","Considering"},
    "ambiguous":{"Clarify"},
    "rejected":{"Rejected","Deferred"},
    "completed":{"Completed","Accepted"},
}

def target_url(mode):
    parts=urlsplit(TARGET)
    query=dict(parse_qsl(parts.query,keep_blank_values=True))
    query["evidence_fast_start"]="1"
    query["advisorEvidence"]=mode
    return urlunsplit((parts.scheme,parts.netloc,parts.path,urlencode(query),parts.fragment))

options=Options()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--enable-webgl")
options.add_argument("--ignore-gpu-blocklist")
options.add_argument("--use-angle=swiftshader")
options.add_argument("--disable-search-engine-choice-screen")
options.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=options)
driver.set_script_timeout(180)
wait=WebDriverWait(driver,240)

def ready(mode):
    try:
        return driver.execute_script("""
          const mode=arguments[0];
          const stage=document.getElementById("planetStageRoot");
          const panel=document.getElementById("advisorChatPanel");
          const shell=document.getElementById("advisorConversationUI");
          const snap=window.AdvisorConversationUI?.snapshot?.();
          return Boolean(
            stage?.dataset?.ready==="true" &&
            window.PlanetStage?.snapshot?.()?.ready &&
            panel && !panel.hidden &&
            shell?.dataset?.evidenceMode===mode &&
            snap?.evidenceMode===mode
          );
        """,mode)
    except Exception:
        return False

def geometry_state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1];
      const rect=(node)=>{
        if(!node)return null;
        const r=node.getBoundingClientRect();
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
      };
      const overlap=(a,b)=>{
        if(!a||!b)return 0;
        return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
               Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      };
      const panel=document.getElementById("advisorChatPanel");
      const transcript=document.querySelector(".advisor-chat-transcript");
      const compose=document.querySelector(".advisor-chat-compose");
      const counsel=document.querySelector(".advisor-counsel");
      const map=document.querySelector(".planet-map-context");
      const places=document.querySelector(".planet-places-button");
      const scale=document.querySelector(".planet-scale-ruler");
      const p=rect(panel),t=rect(transcript),c=rect(compose),co=rect(counsel);
      const statusTexts=[...document.querySelectorAll(".advisor-chat-status")].map(n=>n.textContent.trim());
      const bubbles=[...document.querySelectorAll(".advisor-chat-bubble")].map(n=>({
        kind:n.classList.contains("player")?"player":"protagonist",
        text:n.textContent.trim(),
        rect:rect(n)
      }));
      const snap=window.AdvisorConversationUI?.snapshot?.()||null;
      const proof=window.AdvisorConversationUI?.proof?.()||null;
      const style=panel?getComputedStyle(panel):null;
      const inside=(r)=>Boolean(r&&r.left>=-0.5&&r.top>=-0.5&&r.right<=innerWidth+0.5&&r.bottom<=innerHeight+0.5);
      return {
        mode,profile,
        viewport:{width:innerWidth,height:innerHeight},
        panel:p,transcript:t,compose:c,counsel:co,
        panelInside:inside(p),composeInside:inside(c),
        panelDisplay:style?.display||null,
        statusTexts,bubbles,
        overlap:{
          map:overlap(p,rect(map)),
          places:overlap(p,rect(places)),
          scale:overlap(p,rect(scale))
        },
        scroll:{
          documentWidth:document.documentElement.scrollWidth,
          documentHeight:document.documentElement.scrollHeight,
          transcriptClientHeight:transcript?.clientHeight||0,
          transcriptScrollHeight:transcript?.scrollHeight||0
        },
        snapshot:snap,
        proof,
        stageReady:document.getElementById("planetStageRoot")?.dataset?.ready||null,
        mapContextVisible:Boolean(map&&getComputedStyle(map).display!=="none"),
        placesVisible:Boolean(places&&getComputedStyle(places).display!=="none"),
        scaleVisible:Boolean(scale&&getComputedStyle(scale).display!=="none")
      };
    """,mode,profile)

def assert_state(st):
    if not st["panelInside"]:
        raise RuntimeError("Advisor panel escaped viewport: "+json.dumps(st))
    if not st["composeInside"]:
        raise RuntimeError("Advisor composer escaped viewport: "+json.dumps(st))
    if st["overlap"]["map"]>1 or st["overlap"]["places"]>1 or st["overlap"]["scale"]>1:
        raise RuntimeError("Advisor panel overlaps map chrome: "+json.dumps(st))
    if st["scroll"]["documentWidth"]>st["viewport"]["width"]+1:
        raise RuntimeError("horizontal document clipping/overflow: "+json.dumps(st))
    if not st.get("snapshot",{}).get("authority",{}).get("eventDriven"):
        raise RuntimeError("Advisor UI is not event-driven: "+json.dumps(st))
    if st.get("snapshot",{}).get("authority",{}).get("perFrameConversationRender") is not False:
        raise RuntimeError("per-frame Advisor rendering regression: "+json.dumps(st))
    if st.get("snapshot",{}).get("authority",{}).get("directExecution") is not False:
        raise RuntimeError("Advisor UI direct execution regression: "+json.dumps(st))
    if not st.get("proof",{}).get("pass"):
        raise RuntimeError("Advisor UI proof failed: "+json.dumps(st))
    expected=EXPECTED[st["mode"]]
    if not expected.issubset(set(st["statusTexts"])):
        raise RuntimeError("expected status labels missing: "+json.dumps(st))

records=[]
try:
    for profile,size in VIEWPORTS.items():
        driver.set_window_size(*size)
        for mode in MODE_MATRIX[profile]:
            driver.get(target_url(mode))
            try:
                wait.until(lambda _d,m=mode: ready(m))
            except TimeoutException:
                failure=OUT/f"{profile}-{mode}-startup-failure.png"
                driver.save_screenshot(str(failure))
                details=driver.execute_script("""
                  return {
                    body:String(document.body?.innerText||"").slice(0,1400),
                    stage:window.PlanetStage?.snapshot?.()||null,
                    ui:window.AdvisorConversationUI?.snapshot?.()||null
                  };
                """)
                raise RuntimeError("startup/evidence timeout: "+json.dumps(details))
            driver.execute_script("const t=document.querySelector('.advisor-chat-transcript');if(t)t.scrollTop=0;")
            time.sleep(.35)
            st=geometry_state(mode,profile)
            assert_state(st)
            path=OUT/f"{profile}-{mode}.png"
            driver.save_screenshot(str(path))
            records.append({"profile":profile,"mode":mode,"file":str(path),"state":st})

    severe=[
        entry for entry in driver.get_log("browser")
        if entry.get("level")=="SEVERE" and "favicon.ico" not in str(entry.get("message",""))
    ]
    if severe:
        raise RuntimeError("browser console severe errors: "+json.dumps(severe[-12:]))

    result={
        "pass":True,
        "wp":"WP-S008-007",
        "classification":"MIXED",
        "screenshots":len(records),
        "modes":["ordinary","ambiguous","rejected","completed"],
        "viewports":VIEWPORTS,
        "authority":{
            "completionRequiresSimulation":True,
            "directExecution":False,
            "eventDriven":True,
            "fullWorldScan":False
        },
        "records":records
    }
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({
        "pass":True,
        "wp":"WP-S008-007",
        "screenshots":len(records),
        "viewports":VIEWPORTS,
        "modes":result["modes"]
    },indent=2))
finally:
    driver.quit()
