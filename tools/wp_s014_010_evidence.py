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
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s014-010"));OUT.mkdir(parents=True,exist_ok=True)
VIEWPORTS={"phone-portrait":(390,844),"phone-landscape":(844,390),"desktop":(1280,720)}
MATRIX={"phone-portrait":["active","recovered"],"phone-landscape":["retreat","terminal"],"desktop":["active","retreat","terminal","recovered"]}

def evidence_url():
    p=urlsplit(TARGET);q=dict(parse_qsl(p.query,keep_blank_values=True));q.update({"evidence_fast_start":"1","conflictPresentationEvidence":"active"})
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q),p.fragment))

opt=Options()
for arg in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-angle=swiftshader","--disable-search-engine-choice-screen","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding","--window-size=1280,720"]:opt.add_argument(arg)
opt.set_capability("goog:loggingPrefs",{"browser":"ALL"})
driver=webdriver.Chrome(options=opt);driver.set_script_timeout(180);wait=WebDriverWait(driver,240)

def ready():
    try:
        return driver.execute_script("""
          const stage=window.PlanetStage?.snapshot?.(),root=document.getElementById('planetStageRoot');
          // PlanetStage's playable snapshot is authoritative. Headless Chrome can defer the
          // later DOM data-ready paint decoration indefinitely, so do not gate evidence on it.
          return Boolean(stage?.ready&&root&&document.getElementById('planetCanvas')&&window.LocalConflictPresentation?.snapshot?.()?.mounted);
        """)
    except Exception:return False

def visual_state(mode,profile):
    return driver.execute_script("""
      const mode=arguments[0],profile=arguments[1],r=n=>{if(!n)return null;const b=n.getBoundingClientRect();return{left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}},over=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const layer=document.getElementById('localConflictPresentation'),marker=layer?.querySelector('.local-conflict-anchor'),card=layer?.querySelector('.local-conflict-card'),canvas=document.getElementById('planetCanvas'),stage=window.PlanetStage.snapshot(),snap=window.LocalConflictPresentation.snapshot();
      const mr=r(marker),cr=r(card),cv=r(canvas),focus=stage.canonicalFocus?.screenSpaceFocus;
      const expected=focus?.valid&&cv?{x:cv.left+Number(focus.screenX),y:cv.top+Number(focus.screenY)}:null,actual=mr?{x:(mr.left+mr.right)/2,y:(mr.top+mr.bottom)/2}:null;
      const chrome={map:r(document.querySelector('.planet-map-context')),places:r(document.querySelector('.planet-places-button')),scale:r(document.querySelector('.planet-scale-ruler')),chat:r(document.querySelector('.advisor-chat-launcher')),toolbelt:r(document.querySelector('.advisor-toolbelt-launcher')),economy:r(document.querySelector('.advisor-economy-launcher'))};
      return {mode,profile,viewport:{width:innerWidth,height:innerHeight},layerHidden:Boolean(layer?.hidden),marker:mr,card:cr,insideMarker:Boolean(mr&&mr.left>=0&&mr.top>=0&&mr.right<=innerWidth&&mr.bottom<=innerHeight),insideCard:Boolean(cr&&cr.left>=0&&cr.top>=0&&cr.right<=innerWidth&&cr.bottom<=innerHeight),anchorDelta:expected&&actual?Math.hypot(expected.x-actual.x,expected.y-actual.y):null,expected,actual,worldTile:stage.canonicalFocus?.worldTile||null,lat:stage.canonicalFocus?.latitudeDegrees,lon:stage.canonicalFocus?.longitudeDegrees,scaleIndex:stage.zoom?.scaleIndex,revealTier:stage.projection?.localStatic?.revealTier||null,tangent:Boolean(stage.projection?.tangentPatchActive),overlap:Object.fromEntries(Object.entries(chrome).map(([k,v])=>[k,over(cr,v)])),markerCount:document.querySelectorAll('#localConflictPresentation .local-conflict-anchor').length,cardCount:document.querySelectorAll('#localConflictPresentation .local-conflict-card').length,snapshot:snap};
    """,mode,profile)

def assert_visual(s):
    if s["layerHidden"]:raise RuntimeError("visible state unexpectedly hidden "+json.dumps(s))
    if not s["insideMarker"] or not s["insideCard"]:raise RuntimeError("conflict presentation escaped viewport "+json.dumps(s))
    if s["anchorDelta"] is None or s["anchorDelta"]>2.5:raise RuntimeError("world anchor mismatch "+json.dumps(s))
    if s["markerCount"]!=1 or s["cardCount"]!=1:raise RuntimeError("duplicate conflict presentation nodes "+json.dumps(s))
    if s["scaleIndex"]!=9 or not s["tangent"]:raise RuntimeError("ground/local evidence not active "+json.dumps(s))
    for k,v in s["overlap"].items():
        if v>2:raise RuntimeError("conflict card overlaps required chrome "+k+" "+json.dumps(s))
    snap=s.get("snapshot") or {};auth=snap.get("authority") or {}
    for key in ["readOnly","presentationOnly","eventDriven","anchorPresentationTickOnly"]:
        if auth.get(key) is not True:raise RuntimeError("presentation authority flag missing "+key+" "+json.dumps(s))
    for key in ["fullWorldScan","wholeSettlementScan","wholeHistoryScan","perFrameSourceScan","directWorldMutation","directActionExecution","combatResolution","healthMutation","standingMutation","movementMutation","simulationAuthority"]:
        if auth.get(key) is not False:raise RuntimeError("authority boundary regression "+key+" "+json.dumps(s))

def move_probe():
    before=driver.execute_script("const s=window.PlanetStage.snapshot();return {lat:s.canonicalFocus.latitudeDegrees,lon:s.canonicalFocus.longitudeDegrees,tile:s.canonicalFocus.worldTile}")
    driver.execute_script("window.PlanetStage.rotateByScreenPixels(36,-18);window.LocalConflictPresentation.syncAnchor();")
    time.sleep(.18)
    after=driver.execute_script("window.LocalConflictPresentation.syncAnchor();const s=window.PlanetStage.snapshot(),a=window.LocalConflictPresentation.snapshot().anchor,c=document.getElementById('planetCanvas').getBoundingClientRect(),f=s.canonicalFocus.screenSpaceFocus;return{lat:s.canonicalFocus.latitudeDegrees,lon:s.canonicalFocus.longitudeDegrees,tile:s.canonicalFocus.worldTile,delta:Math.hypot(a.x-(c.left+f.screenX),a.y-(c.top+f.screenY)),source:a.source}")
    if abs(float(after["lat"])-float(before["lat"]))<1e-7 and abs(float(after["lon"])-float(before["lon"]))<1e-7:raise RuntimeError("camera/navigation probe did not move canonical focus")
    if float(after["delta"])>2.5:raise RuntimeError("conflict anchor failed to track navigation")
    return {"before":before,"after":after}

def grounded_anchor_probe():
    result=driver.execute_script("""
      const targets=(window.PlanetStage.inspectionTargets?.()||[]).filter(x=>x.type==='building'&&x.bounds);
      const target=targets[0];if(!target)return {ok:false,reason:'no-visible-building-target'};
      const out=window.LocalConflictPresentation.setEvidenceMode('active',{kind:'building',id:target.id});
      window.LocalConflictPresentation.syncAnchor();
      const a=window.LocalConflictPresentation.snapshot().anchor,b=target.bounds,expected={x:(b.left+b.right)/2,y:(b.top+b.bottom)/2};
      return {ok:Boolean(out?.visible),targetId:target.id,targetType:target.type,source:a?.source||null,expected,actual:a?{x:a.x,y:a.y}:null,delta:a?Math.hypot(a.x-expected.x,a.y-expected.y):null};
    """)
    if not result.get("ok"):raise RuntimeError("grounded anchor probe unavailable "+json.dumps(result))
    if result.get("source")!="PlanetStage.inspectionTargets":raise RuntimeError("grounded location did not use active world projection "+json.dumps(result))
    if float(result.get("delta") or 999)>2.5:raise RuntimeError("grounded location anchor mismatch "+json.dumps(result))
    return result

records=[]
try:
    driver.get(evidence_url())
    try:
        wait.until(lambda d:ready())
    except TimeoutException:
        diag=driver.execute_script("""return {documentReady:document.readyState,domReady:document.getElementById('planetStageRoot')?.dataset?.ready||null,stage:window.PlanetStage?.snapshot?.()||null,conflict:window.LocalConflictPresentation?.snapshot?.()||null,canvas:Boolean(document.getElementById('planetCanvas')),body:String(document.body?.innerText||'').slice(0,1200)}""")
        diag["browserLogs"]=driver.get_log("browser")[-30:]
        (OUT/"startup-timeout.json").write_text(json.dumps(diag,indent=2),encoding="utf-8")
        driver.save_screenshot(str(OUT/"startup-timeout.png"))
        raise RuntimeError("playable-stage startup timeout: "+json.dumps(diag))
    driver.execute_script("window.PlanetStage.setScaleIndex(9)")
    wait.until(lambda d:d.execute_script("const s=window.PlanetStage.snapshot();return s.zoom?.scaleIndex===9&&s.projection?.tangentPatchActive===true"))
    wait.until(lambda d:d.execute_script("return (window.PlanetStage.inspectionTargets?.()||[]).some(x=>x.type==='building'&&x.bounds)"))
    time.sleep(.35)
    grounded=grounded_anchor_probe()
    driver.save_screenshot(str(OUT/"desktop-grounded-location.png"))
    driver.execute_script("window.LocalConflictPresentation.setEvidenceMode('active')")
    probe=move_probe()
    for profile,(w,h) in VIEWPORTS.items():
        set_exact_viewport(driver,w,h);time.sleep(.25)
        for mode in MATRIX[profile]:
            driver.execute_script("window.LocalConflictPresentation.setEvidenceMode(arguments[0]);window.LocalConflictPresentation.syncAnchor();",mode);time.sleep(.14)
            s=visual_state(mode,profile);assert_visual(s)
            name=f"{profile}-{mode}.png";driver.save_screenshot(str(OUT/name));s["screenshot"]=name;records.append(s)
    cleared_records=[]
    for profile in ["phone-portrait","desktop"]:
        w,h=VIEWPORTS[profile];set_exact_viewport(driver,w,h);driver.execute_script("window.LocalConflictPresentation.setEvidenceMode('cleared')");time.sleep(.12)
        row=driver.execute_script("const l=document.getElementById('localConflictPresentation');return{hidden:l.hidden,visible:window.LocalConflictPresentation.snapshot().visible,markerVisible:Boolean(l.querySelector('.local-conflict-anchor')&&!l.querySelector('.local-conflict-anchor').hidden),cardVisible:Boolean(l.querySelector('.local-conflict-card')&&!l.querySelector('.local-conflict-card').hidden)}")
        if not row["hidden"] or row["visible"] or row["markerVisible"] or row["cardVisible"]:raise RuntimeError("cleared state left visible conflict presentation "+json.dumps(row))
        name=f"{profile}-cleared.png";driver.save_screenshot(str(OUT/name));row.update({"profile":profile,"screenshot":name});cleared_records.append(row)
    driver.execute_script("window.LocalConflictPresentation.setEvidenceMode('cleared')");time.sleep(.1)
    cleared=driver.execute_script("const l=document.getElementById('localConflictPresentation');return{hidden:l.hidden,visible:window.LocalConflictPresentation.snapshot().visible,markerCount:l.querySelectorAll('.local-conflict-anchor').length,cardCount:l.querySelectorAll('.local-conflict-card').length}")
    if not cleared["hidden"] or cleared["visible"]:raise RuntimeError("cleared state left a visible conflict cue "+json.dumps(cleared))
    driver.execute_script("window.LocalConflictPresentation.setEvidenceMode('active')");time.sleep(.1)
    resumed=driver.execute_script("const l=document.getElementById('localConflictPresentation');return{markerCount:l.querySelectorAll('.local-conflict-anchor').length,cardCount:l.querySelectorAll('.local-conflict-card').length,visible:window.LocalConflictPresentation.snapshot().visible}")
    if resumed!={"markerCount":1,"cardCount":1,"visible":True}:raise RuntimeError("state transition duplicated or lost presentation nodes "+json.dumps(resumed))
    logs=[x for x in driver.get_log("browser") if x.get("level") in ("SEVERE","ERROR")]
    if logs:raise RuntimeError("browser console errors "+json.dumps(logs))
    result={"pass":True,"wp":"WP-S014-010","classification":"MIXED","records":records,"clearedRecords":cleared_records,"groundedScreenshot":"desktop-grounded-location.png","movementProbe":probe,"groundedAnchorProbe":grounded,"cleared":cleared,"resumed":resumed}
    (OUT/"evidence.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({"pass":True,"wp":"WP-S014-010","screenshots":len(records)+len(cleared_records)+1,"movementAnchorDelta":probe["after"]["delta"],"groundedAnchorDelta":grounded["delta"]},indent=2))
finally:
    driver.quit()
