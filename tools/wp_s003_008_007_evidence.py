#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
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

opts=Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--disable-gpu")
opts.add_argument("--use-gl=swiftshader")
opts.add_argument("--window-size=1280,800")
opts.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opts)
records=[]
try:
    exact(driver,1280,800)
    driver.get(TARGET)
    wait_js(driver,"document.getElementById('planetStageRoot')?.dataset?.ready==='true'&&window.PlanetStage?.snapshot?.()?.ready&&window.WindowShell",180)

    activation=driver.execute_script("""
      const seed=window.PlanetStage.snapshot().activeSeed;
      const result=window.LocalEventVignettes.proofActivate(seed,'village-gathering','1201-02-01 12:00:00');
      window.WindowShell.scan();
      return {seed,eventId:result.event?.id||null,active:window.LocalEventVignettes.snapshot(seed)};
    """)
    wait_js(driver,"document.getElementById('localEventVignette')&&!document.getElementById('localEventVignette').hidden&&document.querySelector('#localEventVignette .window-shell-minimize')&&document.querySelector('#localEventVignette .window-shell-close')",30)
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
    wait_js(driver,"document.getElementById('localEventVignette').hidden&&document.querySelector('#windowShellDock .window-shell-dock-item[data-window-key="local-event"]')",10)
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
    wait_js(driver,"document.getElementById('advisorChatPanel').hidden&&document.querySelector('#windowShellDock .window-shell-dock-item[data-window-key="advisor-chat"]')",10)
    driver.find_element(By.CSS_SELECTOR,'#windowShellDock .window-shell-dock-item[data-window-key="advisor-chat"]').click()
    wait_js(driver,"!document.getElementById('advisorChatPanel').hidden",10)
    # Drag Places to prove the same shared handle path.
    ph=driver.find_element(By.CSS_SELECTOR,".planet-places-panel .window-shell-handle")
    pb=rect(driver,".planet-places-panel")
    ActionChains(driver).move_to_element_with_offset(ph,18,14).click_and_hold().move_by_offset(-120,60).release().perform()
    time.sleep(.2)
    pa=rect(driver,".planet-places-panel")
    if abs(pa["left"]-pb["left"])<30 and abs(pa["top"]-pb["top"])<30:
        raise RuntimeError("Places did not use shared drag behavior")
    snap=ws(driver)
    if not (snap["windows"]["places"]["visible"] and snap["windows"]["advisor-chat"]["visible"]):
        raise RuntimeError("simultaneous windows not visible")
    records.append({"name":"desktop-shared-places-advisor","file":shot(driver,"04-desktop-shared-places-advisor.png"),"placesBefore":pb,"placesAfter":pa,"shell":snap})

    # Close presentation only; authoritative local event remains active.
    before_close=driver.execute_script("return window.LocalEventVignettes.snapshot(arguments[0]);",activation["seed"])
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
    wait_js(driver,"document.querySelector('#windowShellDock .window-shell-dock-item[data-window-key="local-event"]')",10)
    driver.execute_script("window.LocalEventVignettes.clearActive(arguments[0]);",activation["seed"])
    wait_js(driver,"!document.querySelector('#windowShellDock .window-shell-dock-item[data-window-key="local-event"]')",10)
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
