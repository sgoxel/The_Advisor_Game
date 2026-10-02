#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common.exceptions import TimeoutException

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
SEED="AGENT6-WINDOW-SHELL-A"
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-008-007"))
OUT.mkdir(parents=True,exist_ok=True)

def exact(driver,w,h):
    try:
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride",{"width":w,"height":h,"deviceScaleFactor":1,"mobile":False})
    except Exception:
        driver.set_window_size(w,h)
    time.sleep(.15)

def wait_js(driver,script,timeout=180):
    return WebDriverWait(driver,timeout,.2).until(lambda d: d.execute_script("return Boolean("+script+");"))

def shot(driver,name):
    path=OUT/name
    if not driver.save_screenshot(str(path)) or path.stat().st_size<8000:
        raise RuntimeError("screenshot failed: "+str(path))
    return path.name

def rect(driver,sel):
    return driver.execute_script("""
      const n=document.querySelector(arguments[0]);if(!n)return null;const r=n.getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hidden:n.hidden};
    """,sel)

def inside(r,w,h):
    return bool(r and r["left"]>=-0.5 and r["top"]>=-0.5 and r["right"]<=w+0.5 and r["bottom"]<=h+0.5)

def ws(driver):
    return driver.execute_script("return window.WindowShell?.snapshot?.()||null;")

def focus(driver):
    return driver.execute_script("""
      const s=window.PlanetStage?.snapshot?.(),t=s?.canonicalFocus?.worldTile||{};
      return {x:String(t.x??''),y:String(t.y??''),lat:s?.canonicalFocus?.latitudeDegrees,lon:s?.canonicalFocus?.longitudeDegrees};
    """)

def open_places(driver):
    driver.execute_script("""
      const b=document.querySelector('.planet-places-button');
      if(b&&b.getAttribute('aria-expanded')!=='true')b.click();
    """)
    wait_js(driver,"document.querySelector('.planet-places-panel')&&!document.querySelector('.planet-places-panel').hidden",30)

def open_advisor(driver):
    driver.execute_script("window.AdvisorConversationUI?.setOpen?.(true);")
    wait_js(driver,"document.getElementById('advisorChatPanel')&&!document.getElementById('advisorChatPanel').hidden",30)

def hit_tested_window_drag(driver,panel_sel,handle_sel,distance_x=120,distance_y=60):
    plan=driver.execute_script("""
      const panel=document.querySelector(arguments[0]),handle=document.querySelector(arguments[1]);
      if(!panel||!handle)return null;
      const pr=panel.getBoundingClientRect(),hr=handle.getBoundingClientRect(),safe=10;
      const xs=[hr.left+24,(hr.left+hr.right)/2,hr.right-24];
      const ys=[hr.top+10,(hr.top+hr.bottom)/2,hr.bottom-10];
      let point=null;
      for(const y of ys){
        for(const x of xs){
          const hit=document.elementFromPoint(x,y);
          if(!hit||hit.closest('button,input,textarea,select,a,summary'))continue;
          if(hit===handle||handle.contains(hit)){point={x,y};break;}
        }
        if(point)break;
      }
      if(!point)return {error:'no-exposed-handle-point',panel:{left:pr.left,top:pr.top,right:pr.right,bottom:pr.bottom,width:pr.width,height:pr.height}};
      const leftRoom=Math.max(0,pr.left-safe),rightRoom=Math.max(0,innerWidth-safe-pr.right);
      const topRoom=Math.max(0,pr.top-safe),bottomRoom=Math.max(0,innerHeight-safe-pr.bottom);
      const dx=(rightRoom>=leftRoom?1:-1)*Math.min(arguments[2],Math.max(0,(rightRoom>=leftRoom?rightRoom:leftRoom)-8));
      const dy=(bottomRoom>=topRoom?1:-1)*Math.min(arguments[3],Math.max(0,(bottomRoom>=topRoom?bottomRoom:topRoom)-8));
      return {point,dx,dy,panel:{left:pr.left,top:pr.top,right:pr.right,bottom:pr.bottom,width:pr.width,height:pr.height},
        handle:{left:hr.left,top:hr.top,right:hr.right,bottom:hr.bottom,width:hr.width,height:hr.height},
        rooms:{left:leftRoom,right:rightRoom,top:topRoom,bottom:bottomRoom},
        hitTag:document.elementFromPoint(point.x,point.y)?.tagName||null};
    """,panel_sel,handle_sel,distance_x,distance_y)
    if not plan or plan.get("error"):
        raise RuntimeError("no exposed hit-tested drag surface for "+panel_sel+": "+json.dumps(plan))
    if abs(plan["dx"])<35 and abs(plan["dy"])<35:
        raise RuntimeError("no usable in-viewport drag direction for "+panel_sel+": "+json.dumps(plan))
    before_shell=ws(driver)
    handle=driver.find_element(By.CSS_SELECTOR,handle_sel)
    hr=plan["handle"]
    ox=plan["point"]["x"]-(hr["left"]+hr["width"]/2)
    oy=plan["point"]["y"]-(hr["top"]+hr["height"]/2)
    ActionChains(driver).move_to_element_with_offset(handle,ox,oy).click_and_hold().move_by_offset(plan["dx"],plan["dy"]).release().perform()
    time.sleep(.25)
    after_shell=ws(driver)
    bt=before_shell["telemetry"];at=after_shell["telemetry"]
    if at["dragStartCount"]<bt["dragStartCount"]+1 or at["dragEndCount"]<bt["dragEndCount"]+1:
        raise RuntimeError("shared drag telemetry did not advance for "+panel_sel+": "+json.dumps({"plan":plan,"before":bt,"after":at}))
    if at["worldInputSuppressions"]<=bt["worldInputSuppressions"]:
        raise RuntimeError("world input was not suppressed during drag for "+panel_sel)
    return {"plan":plan,"telemetryBefore":bt,"telemetryAfter":at}

opts=Options()
for arg in [
    "--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl",
    "--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen",
    "--disable-background-timer-throttling","--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding","--window-size=1280,800"
]:
    opts.add_argument(arg)
opts.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opts)
driver.set_page_load_timeout(300)
driver.set_script_timeout(240)
try:
    driver.command_executor.set_timeout(360)
except Exception:
    pass
# Dedicated UI acceptance uses the supported developer WebGL2 path. Cross-backend
# parity is owned by the renderer WP; this WP validates presentation mechanics.
campaign_bootstrap=json.dumps({
    "seed":SEED,
    "realStartMs":int(time.time()*1000),
    "fantasyStart":{"year":1201,"month":2,"day":1,"hour":12,"minute":0,"second":0,"millisecond":0},
    "protagonist":{"x":"0","y":"0"},
    "restartCount":0,
},separators=(",",":"))
settings_bootstrap=json.dumps({"seed":SEED},separators=(",",":"))
driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":f"""
try {{
  localStorage.setItem('the-advisor-game:development-mode','true');
  localStorage.setItem('theAdvisorGame.wp001.campaign.v2', {json.dumps(campaign_bootstrap)});
  localStorage.setItem('theAdvisorGame.wp001.settings.v2', {json.dumps(settings_bootstrap)});
  localStorage.setItem('advisor.planet.seed.v1', {json.dumps(SEED)});
}} catch (_) {{}}
"""})
records=[]
try:
    exact(driver,1280,800)
    evidence_target=TARGET+("&" if "?" in TARGET else "?")+"evidence_fast_start=1&evidence_skip_destinations=1&dev=1&gpu=webgl2"
    driver.get(evidence_target)
    try:
        # PlanetStage's playable snapshot is authoritative for evidence readiness.
        # Headless Chrome may defer the later DOM data-ready paint decoration.
        wait_js(driver,"window.PlanetStage?.snapshot?.()?.ready===true&&document.getElementById('planetStageRoot')&&document.getElementById('planetCanvas')&&window.WindowShell&&window.LocalEventVignettes",300)
    except TimeoutException:
        diag=driver.execute_script("""return {
          documentReady:document.readyState,
          domReady:document.getElementById('planetStageRoot')?.dataset?.ready||null,
          stage:window.PlanetStage?.snapshot?.()||null,
          windowShell:window.WindowShell?.snapshot?.()||null,
          localEvents:Boolean(window.LocalEventVignettes),
          canvas:Boolean(document.getElementById('planetCanvas')),
          body:String(document.body?.innerText||'').slice(0,1400)
        }""")
        diag["browserLogs"]=driver.get_log("browser")[-40:]
        (OUT/"startup-timeout.json").write_text(json.dumps(diag,indent=2),encoding="utf-8")
        driver.save_screenshot(str(OUT/"startup-timeout.png"))
        raise RuntimeError("playable-stage startup timeout: "+json.dumps(diag))

    activation=driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed;
      const proofNow=window.GameTime?.getTimestampKey?.();
      if(!proofNow)throw new Error('Fantasy Game Time unavailable for Local Event proof activation');
      const result=window.LocalEventVignettes.proofActivate(seed,'village-gathering',proofNow);
      window.WindowShell.scan();
      const node=document.getElementById('localEventVignette'),r=node?.getBoundingClientRect?.();
      return {seed,proofNow,eventId:result.event?.id||null,active:window.LocalEventVignettes.snapshot(seed),
        geometry:r?{left:r.left,top:r.top,width:r.width,height:r.height,hidden:node.hidden}:null};
    """)
    wait_js(driver,"(()=>{const n=document.getElementById('localEventVignette');if(!n||n.hidden)return false;const r=n.getBoundingClientRect();return r.width>40&&r.height>40&&getComputedStyle(n).display!=='none'&&document.querySelector('#localEventVignette .window-shell-minimize')&&document.querySelector('#localEventVignette .window-shell-close');})()",30)
    initial_active_ids=list(activation["active"].get("activeEventIds",[]))
    initial_focus=focus(driver)
    records.append({"name":"desktop-local-event-open","file":shot(driver,"01-desktop-local-event-open.png"),"rect":rect(driver,"#localEventVignette"),"shell":ws(driver)})

    handle=driver.find_element(By.CSS_SELECTOR,"#localEventVignette .window-shell-handle")
    before=rect(driver,"#localEventVignette")
    ActionChains(driver).move_to_element_with_offset(handle,12,12).click_and_hold().move_by_offset(-180,90).release().perform()
    time.sleep(.25)
    after=rect(driver,"#localEventVignette")
    after_focus=focus(driver)
    if abs(after["left"]-before["left"])<40 and abs(after["top"]-before["top"])<40:
        raise RuntimeError("local event did not move during drag")
    if after_focus!=initial_focus:
        raise RuntimeError(f"world focus changed under window drag: {initial_focus} -> {after_focus}")
    records.append({"name":"desktop-local-event-dragged","file":shot(driver,"02-desktop-local-event-dragged.png"),"before":before,"after":after,"focus":after_focus,"shell":ws(driver)})

    driver.find_element(By.CSS_SELECTOR,"#localEventVignette .window-shell-minimize").click()
    wait_js(driver,'document.getElementById("localEventVignette").hidden&&document.querySelector(\'#windowShellDock .window-shell-dock-item[data-window-key="local-event"]\')',10)
    records.append({"name":"desktop-local-event-minimized","file":shot(driver,"03-desktop-local-event-minimized.png"),"shell":ws(driver)})

    driver.find_element(By.CSS_SELECTOR,'#windowShellDock .window-shell-dock-item[data-window-key="local-event"]').click()
    wait_js(driver,"!document.getElementById('localEventVignette').hidden",10)
    restored=rect(driver,"#localEventVignette")
    if abs(restored["left"]-after["left"])>2 or abs(restored["top"]-after["top"])>2:
        raise RuntimeError(f"restored position drifted: {after} -> {restored}")

    open_places(driver)
    open_advisor(driver)
    driver.execute_script("window.WindowShell.scan();")
    wait_js(driver,"document.querySelector('.planet-places-panel .window-shell-minimize')&&document.querySelector('#advisorChatPanel .window-shell-minimize')",10)
    # Prove shared minimize/restore on Advisor.
    driver.find_element(By.CSS_SELECTOR,"#advisorChatPanel .window-shell-minimize").click()
    wait_js(driver,'document.getElementById("advisorChatPanel").hidden&&document.querySelector(\'#windowShellDock .window-shell-dock-item[data-window-key="advisor-chat"]\')',10)
    driver.find_element(By.CSS_SELECTOR,'#windowShellDock .window-shell-dock-item[data-window-key="advisor-chat"]').click()
    wait_js(driver,"!document.getElementById('advisorChatPanel').hidden",10)
    # Drag Places through an actually exposed title point and choose a direction
    # with available viewport room so clamping cannot turn the evidence gesture
    # into a false negative when the panel starts near an edge.
    pb=rect(driver,".planet-places-panel")
    places_drag=hit_tested_window_drag(driver,".planet-places-panel",".planet-places-panel .window-shell-handle")
    pa=rect(driver,".planet-places-panel")
    if abs(pa["left"]-pb["left"])<30 and abs(pa["top"]-pb["top"])<30:
        raise RuntimeError("Places did not use shared drag behavior: "+json.dumps({"before":pb,"after":pa,"drag":places_drag}))
    snap=ws(driver)
    if not (snap["windows"]["places"]["visible"] and snap["windows"]["advisor-chat"]["visible"]):
        raise RuntimeError("simultaneous windows not visible")
    if snap["windows"]["places"]["z"]<=snap["windows"]["advisor-chat"]["z"]:
        raise RuntimeError("Places drag did not raise focused window above Advisor")
    records.append({"name":"desktop-shared-places-advisor","file":shot(driver,"04-desktop-shared-places-advisor.png"),"placesBefore":pb,"placesAfter":pa,"placesDrag":places_drag,"shell":snap})

    # Close presentation only; authoritative local event remains active. The Places
    # drag above already proves deterministic focus/z-order while sibling windows
    # are simultaneously visible. Use the actual Minimize controls to reveal the
    # Local Event X rather than assuming an arbitrary overlapped strip is exposed.
    before_close=driver.execute_script("return window.LocalEventVignettes.snapshot(arguments[0]);",activation["seed"])
    driver.find_element(By.CSS_SELECTOR,"#advisorChatPanel .window-shell-minimize").click()
    wait_js(driver,"document.getElementById('advisorChatPanel').hidden",10)
    driver.find_element(By.CSS_SELECTOR,".planet-places-panel .window-shell-minimize").click()
    wait_js(driver,"document.querySelector('.planet-places-panel').hidden",10)
    wait_js(driver,"(()=>{const n=document.getElementById('localEventVignette');if(!n||n.hidden)return false;const r=n.getBoundingClientRect();const c=document.querySelector('#localEventVignette .window-shell-close');if(!c)return false;const cr=c.getBoundingClientRect();const hit=document.elementFromPoint(cr.left+cr.width/2,cr.top+cr.height/2);return Boolean(hit&&(hit===c||c.contains(hit)));})()",10)
    driver.find_element(By.CSS_SELECTOR,"#localEventVignette .window-shell-close").click()
    wait_js(driver,"document.getElementById('localEventVignette').hidden",10)
    after_close=driver.execute_script("return window.LocalEventVignettes.snapshot(arguments[0]);",activation["seed"])
    if list(before_close.get("activeEventIds",[]))!=list(after_close.get("activeEventIds",[])):
        raise RuntimeError("closing Local Event mutated authoritative event state")

    # Re-open same presentation for responsive proof via WindowShell restore.
    driver.execute_script("window.WindowShell.restore('local-event');")
    wait_js(driver,"!document.getElementById('localEventVignette').hidden",10)
    exact(driver,390,844);driver.execute_script("window.dispatchEvent(new Event('resize'));window.WindowShell.scan();");time.sleep(.3)
    pr=rect(driver,"#localEventVignette")
    if not inside(pr,390,844): raise RuntimeError(f"portrait local event unreachable: {pr}")
    records.append({"name":"phone-portrait","file":shot(driver,"05-phone-portrait.png"),"localEvent":pr,"shell":ws(driver)})

    exact(driver,844,390);driver.execute_script("window.dispatchEvent(new Event('resize'));window.WindowShell.scan();");time.sleep(.3)
    lr=rect(driver,"#localEventVignette")
    if not inside(lr,844,390): raise RuntimeError(f"landscape local event unreachable: {lr}")
    records.append({"name":"phone-landscape","file":shot(driver,"06-phone-landscape.png"),"localEvent":lr,"shell":ws(driver)})

    # Lifecycle cleanup: minimized time-limited event must not leave a stale dock icon.
    driver.find_element(By.CSS_SELECTOR,"#localEventVignette .window-shell-minimize").click()
    wait_js(driver,'document.querySelector(\'#windowShellDock .window-shell-dock-item[data-window-key="local-event"]\')',10)
    driver.execute_script("window.LocalEventVignettes.clearActive(arguments[0]);",activation["seed"])
    wait_js(driver,'!document.querySelector(\'#windowShellDock .window-shell-dock-item[data-window-key="local-event"]\')',10)
    records.append({"name":"event-expired-cleanup","file":shot(driver,"07-event-expired-cleanup.png"),"shell":ws(driver)})

    final=ws(driver)
    tele=final["telemetry"]
    required=("local-event","places","advisor-chat","advisor-toolbelt","advisor-economy")
    missing=[k for k in required if not final["windows"][k]["registered"]]
    if missing: raise RuntimeError("eligible windows not registered: "+",".join(missing))
    if tele["dragStartCount"]<2 or tele["dragEndCount"]<2: raise RuntimeError("shared drag telemetry incomplete")
    if tele["worldInputSuppressions"]<2: raise RuntimeError("world-input suppression telemetry missing")
    if tele["restoreCount"]<3: raise RuntimeError("restore telemetry incomplete")
    if initial_active_ids!=list(before_close.get("activeEventIds",[])): raise RuntimeError("active event changed before close proof")

    severe=[x for x in driver.get_log("browser") if x.get("level")=="SEVERE" and "favicon" not in x.get("message","").lower()]
    if severe: raise RuntimeError("browser severe errors: "+json.dumps(severe[-8:]))

    result={"pass":True,"wp":"WP-S003-008-007","classification":"MIXED","screenshots":len(records),"records":records,"final":final,
            "authority":{"localEventIdsBeforeClose":initial_active_ids,"localEventIdsAfterClose":after_close.get("activeEventIds",[]),"worldFocusBeforeDrag":initial_focus,"worldFocusAfterDrag":after_focus}}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"screenshots":len(records),"telemetry":tele},indent=2))
finally:
    driver.quit()
