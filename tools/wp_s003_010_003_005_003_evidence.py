#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path

from screenshot_tool import _driver, _wait, set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-010-003-005-003"))
OUT.mkdir(parents=True,exist_ok=True)
SEEDS=("PROTAGONIST-FOCUS-005003-A","PROTAGONIST-FOCUS-005003-B")
SETTLEMENT_TYPES={"hamlet","village","town","city","capital"}


def target_url():
    sep="&" if "?" in TARGET else "?"
    return TARGET+sep+"evidence_fast_start=1&dev=1&gpu=webgl2"


def install_seed(driver,seed):
    campaign=json.dumps({
        "seed":seed,
        "realStartMs":int(time.time()*1000),
        "fantasyStart":{"year":1100,"month":1,"day":1,"hour":11,"minute":30,"second":0,"millisecond":0},
        "protagonist":{"x":"0","y":"0"},
        "restartCount":0,
    },separators=(",",":"))
    settings=json.dumps({"seed":seed},separators=(",",":"))
    source=f"""
      try {{
        localStorage.setItem('theAdvisorGame.wp001.campaign.v2', {json.dumps(campaign)});
        localStorage.setItem('theAdvisorGame.wp001.settings.v2', {json.dumps(settings)});
        localStorage.setItem('advisor.planet.seed.v1', {json.dumps(seed)});
      }} catch (_) {{}}
    """
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":source})


def js(driver,script,*args):
    return driver.execute_script(script,*args)


def ready(driver,timeout=240):
    return _wait(driver,"""
      const root=document.getElementById('planetStageRoot'),s=window.PlanetStage?.snapshot?.();
      return Boolean(root?.dataset?.ready==='true'&&s?.ready&&s?.activeSeed&&window.ProtagonistFocusUI?.snapshot?.().ready);
    """,timeout,"protagonist focus stage readiness")


def shot(driver,name):
    path=OUT/name
    driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));")
    if not driver.save_screenshot(str(path)):
        raise RuntimeError("failed to capture "+str(path))
    return str(path)


def state(driver):
    return js(driver,"""
      const s=PlanetStage.snapshot(),f=ProtagonistFocusUI.snapshot(),p=Protagonist?.getPosition?.()||null;
      return {
        activeSeed:s.activeSeed,canonicalFocus:s.canonicalFocus,zoom:s.zoom,
        explicitFocusNavigation:s.explicitFocusNavigation,destinationNavigator:s.destinationNavigator,
        npcPresentation:s.npcPresentation,projection:s.projection,navigationPerformance:s.navigationPerformance,
        focus:f,protagonist:p?{x:String(p.x),y:String(p.y)}:null,
        fantasyTimestamp:GameTime?.getTimestampKey?.()||null
      };
    """)


def align_to_starting_village(driver):
    value=js(driver,"""
      const s=PlanetStage.snapshot(),v=StartingVillage.plan(s.activeSeed),c=v?.center,campaign=SeedSystem?.getCampaign?.();
      if(!c||!campaign)return null;
      campaign.protagonist=WorldCoordinates.position(String(c.x),String(c.y));
      PlanetStage.setWorldTileFocus(String(c.x),String(c.y));
      PlanetStage.setScaleIndex(2);
      PlanetStage.refreshPlaces();
      const p=Protagonist?.getPosition?.()||campaign.protagonist;
      return {name:String(v.name||'Starting Village'),center:{x:String(c.x),y:String(c.y)},position:{x:String(p.x),y:String(p.y)}};
    """)
    if not value:
        raise RuntimeError("starting village unavailable")
    return value


def wait_mode(driver,mode,timeout=220):
    return _wait(driver,f"return ProtagonistFocusUI?.snapshot?.().focusMode==={json.dumps(mode)};",timeout,"focus mode "+mode)


def wait_ground_focus(driver,timeout=220):
    return _wait(driver,"""
      const s=PlanetStage.snapshot(),f=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(f.focusMode==='protagonist-local'&&n?.targetType==='protagonist'&&n?.state==='committed'&&Number(n.focusErrorMeters)<=1.1&&s.zoom?.scalar>=.999&&s.projection?.resourceBudget?.visibleLevel==='ground');
    """,timeout,"ground protagonist focus")


def wait_remote(driver,target_id,timeout=220):
    target=json.dumps(str(target_id))
    return _wait(driver,f"""
      const s=PlanetStage.snapshot(),f=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(f.focusMode==='world-exploration'&&n?.targetType==='place'&&String(n.targetId)==={target}&&n?.state==='committed'&&Number(n.focusErrorMeters)<=1.1);
    """,timeout,"remote canonical focus")


def descriptors(driver):
    return js(driver,"""
      return (PlanetStage.placeDescriptors()||[]).map(d=>({
        id:String(d.id),name:String(d.name||d.id),type:String(d.type||''),category:String(d.category||''),
        latitudeRadians:Number(d.latitudeRadians),longitudeRadians:Number(d.longitudeRadians),
        center:d.center?{x:String(d.center.x),y:String(d.center.y)}:null,
        coordinateValid:d.canonicalCoordinateValid!==false
      }));
    """) or []


def choose_targets(items):
    valid=[x for x in items if x.get("coordinateValid") and x.get("id")]
    settlements=[x for x in valid if x.get("type","").lower() in SETTLEMENT_TYPES or x.get("category")=="settlements"]
    others=[x for x in valid if x not in settlements]
    if not settlements:
        settlements=valid[:1]
    if not settlements:
        raise RuntimeError("no canonical remote target available")
    remote=settlements[-1]
    poi=others[-1] if others else (settlements[-2] if len(settlements)>1 else remote)
    return remote,poi


def assert_camera_only(row,label):
    focus=(row or {}).get("focus") or {}
    if int(focus.get("cameraNavigationMutationCount") or 0)!=0:
        raise RuntimeError(f"{label}: camera navigation mutated protagonist")
    proof=focus.get("lastCameraMutationProof")
    if proof and proof.get("mutated") is not False:
        raise RuntimeError(f"{label}: camera mutation proof failed: {proof}")


def move_authoritative_actor(driver,dx,dy):
    value=js(driver,"""
      const campaign=SeedSystem?.getCampaign?.(),before=Protagonist?.getPosition?.()||campaign?.protagonist;
      if(!campaign||!before)return null;
      campaign.protagonist=WorldCoordinates.position(
        String(BigInt(String(before.x))+BigInt(arguments[0])),
        String(BigInt(String(before.y))+BigInt(arguments[1]))
      );
      const after=Protagonist?.getPosition?.()||campaign.protagonist;
      return {before:{x:String(before.x),y:String(before.y)},after:{x:String(after.x),y:String(after.y)}};
    """,int(dx),int(dy))
    if not value or value.get("before")==value.get("after"):
        raise RuntimeError("authoritative protagonist evidence movement failed")
    return value


def run_seed(driver,seed,index):
    install_seed(driver,seed)
    set_exact_viewport(driver,1440,900)
    driver.get(target_url())
    ready(driver)
    village=align_to_starting_village(driver)
    wide=state(driver)
    images=[shot(driver,f"{index:02d}-{seed}-01-wide-before-focus.png")]

    remote,poi=choose_targets(descriptors(driver))
    request=js(driver,"return ProtagonistFocusUI.ensureDefaultFocus({force:true});")
    if not request or not request.get("requestId"):
        raise RuntimeError("default protagonist focus request missing")
    wait_mode(driver,"transitioning-to-protagonist",30)
    transition=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-02-protagonist-transition.png"))
    wait_ground_focus(driver)
    local=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-03-protagonist-local.png"))
    assert_camera_only(local,"default protagonist focus")

    movement=move_authoritative_actor(driver,6,2)
    before_follow=state(driver)
    prior=int((((before_follow.get("focus") or {}).get("follow") or {}).get("stepCount")) or 0)
    _wait(driver,f"return Number(ProtagonistFocusUI.snapshot().follow.stepCount)>{prior};",30,"soft follow step")
    time.sleep(.8)
    followed=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-04-soft-follow.png"))
    assert_camera_only(followed,"soft follow")
    if (((followed.get("focus") or {}).get("follow") or {}).get("suspended")):
        raise RuntimeError("soft follow unexpectedly suspended")

    protagonist_before_remote=dict(followed.get("protagonist") or {})
    js(driver,"PlanetStage.selectPlace(arguments[0]);",remote["id"])
    wait_remote(driver,remote["id"])
    remote_settlement=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-05-remote-settlement.png"))
    assert_camera_only(remote_settlement,"remote settlement")
    if remote_settlement.get("protagonist")!=protagonist_before_remote:
        raise RuntimeError("remote camera selection moved protagonist")

    js(driver,"PlanetStage.setZoomTargetScalar(1,'wp-005-003-remote-ground');")
    _wait(driver,"return PlanetStage.snapshot().zoom?.scalar>=.999;",180,"remote ground zoom")
    time.sleep(1.0)
    remote_ground=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-06-remote-ground.png"))
    nav=(remote_ground.get("explicitFocusNavigation") or {}).get("active") or {}
    if nav.get("targetType")!="place" or str(nav.get("targetId"))!=str(remote["id"]):
        raise RuntimeError("remote exploration lost selected target")
    if int((remote_ground.get("focus") or {}).get("forcedCameraReturnCount") or 0)!=0:
        raise RuntimeError("remote exploration forced protagonist return")

    if poi["id"]!=remote["id"]:
        js(driver,"PlanetStage.selectPlace(arguments[0]);",poi["id"])
        wait_remote(driver,poi["id"])
    poi_state=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-07-remote-poi.png"))
    assert_camera_only(poi_state,"remote POI")

    clock_before=poi_state.get("fantasyTimestamp")
    js(driver,"PlanetStage.applyAuthoritativeFantasyTime({year:1100,month:1,day:1,hour:12,minute:10,second:0},'WP-S003-010-003-005-003 remote simulation',{snapshotResult:false,deferPresentation:false});")
    time.sleep(.5)
    autonomous=move_authoritative_actor(driver,9,4)
    remote_advanced=state(driver)
    clock_after=remote_advanced.get("fantasyTimestamp")
    if clock_before and clock_after and clock_before==clock_after:
        raise RuntimeError("Fantasy Game Time did not advance while remote")
    if (remote_advanced.get("focus") or {}).get("focusMode")!="world-exploration":
        raise RuntimeError("remote camera returned after Simulation advance")

    latest=remote_advanced.get("protagonist") or {}
    return_request=js(driver,"return ProtagonistFocusUI.returnToProtagonist();")
    if not return_request or not return_request.get("requestId"):
        raise RuntimeError("Return to Protagonist request missing")
    wait_ground_focus(driver)
    returned=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-08-return-latest.png"))
    assert_camera_only(returned,"return to protagonist")
    nav=(returned.get("explicitFocusNavigation") or {}).get("active") or {}
    applied=nav.get("protagonistPositionAtApply") or nav.get("protagonistPositionCurrent") or {}
    if str(applied.get("x"))!=str(latest.get("x")) or str(applied.get("y"))!=str(latest.get("y")):
        raise RuntimeError(f"return target was stale: latest={latest} applied={applied}")

    js(driver,"PlanetStage.setScaleIndex(3);")
    time.sleep(.8)
    regional=state(driver)
    images.append(shot(driver,f"{index:02d}-{seed}-09-regional-after-time.png"))

    mobile=[]
    if index==1:
        js(driver,"ProtagonistFocusUI.returnToProtagonist();")
        wait_ground_focus(driver)
        for label,width,height in (("phone-portrait",430,900),("phone-landscape",900,430)):
            set_exact_viewport(driver,width,height)
            time.sleep(.3)
            row=state(driver)
            path=shot(driver,f"{index:02d}-{seed}-{10+len(mobile):02d}-{label}.png")
            if (row.get("focus") or {}).get("focusMode")!="protagonist-local":
                raise RuntimeError(label+": focus mode lost after resize")
            assert_camera_only(row,label)
            mobile.append({"profile":label,"path":path,"state":row})
        set_exact_viewport(driver,1440,900)

    return {
        "seed":seed,"village":village,"remoteTarget":remote,"poiTarget":poi,
        "defaultRequest":request,"authoritativeFollowMotion":movement,"remoteAutonomousMotion":autonomous,
        "states":{"wide":wide,"transition":transition,"local":local,"followed":followed,"remoteSettlement":remote_settlement,"remoteGround":remote_ground,"remotePoi":poi_state,"remoteAdvanced":remote_advanced,"returned":returned,"regional":regional},
        "screenshots":images,"mobile":mobile
    }


def main():
    driver=_driver()
    records=[]
    try:
        for index,seed in enumerate(SEEDS,start=1):
            records.append(run_seed(driver,seed,index))
        logs=[]
        try:
            logs=driver.get_log("browser")
        except Exception:
            pass
        severe=[row for row in logs if str(row.get("level","")).upper()=="SEVERE" and "favicon" not in str(row.get("message","")).lower()]
        if severe:
            raise RuntimeError("browser console severe errors: "+json.dumps(severe[-12:]))
        mutations=sum(int((r["states"]["returned"].get("focus") or {}).get("cameraNavigationMutationCount") or 0) for r in records)
        forced=sum(int((r["states"]["remoteAdvanced"].get("focus") or {}).get("forcedCameraReturnCount") or 0) for r in records)
        summary={
            "pass":mutations==0 and forced==0,
            "wp":"WP-S003-010-003-005-003","classification":"MIXED","seeds":list(SEEDS),
            "recordCount":len(records),"screenshotCount":sum(len(r["screenshots"])+len(r["mobile"]) for r in records),
            "cameraNavigationMutationCount":mutations,"forcedCameraReturnCount":forced,"records":records
        }
        if not summary["pass"]:
            raise RuntimeError("camera authority invariant failed")
        (OUT/"evidence.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
        print(json.dumps({k:v for k,v in summary.items() if k!="records"},indent=2))
    except Exception as exc:
        (OUT/"failure.json").write_text(json.dumps({"pass":False,"error":str(exc),"records":records},indent=2),encoding="utf-8")
        raise
    finally:
        driver.quit()

if __name__=="__main__":
    main()
