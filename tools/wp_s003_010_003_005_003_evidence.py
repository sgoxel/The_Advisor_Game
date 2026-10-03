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


def js(driver,script,*args):
    return driver.execute_script(script,*args)


def stage(driver):
    return js(driver,"""
      const s=window.PlanetStage.snapshot(),f=window.ProtagonistFocusUI.snapshot(),p=window.Protagonist?.getPosition?.()||null;
      return {
        activeSeed:s.activeSeed,canonicalFocus:s.canonicalFocus,zoom:s.zoom,
        explicitFocusNavigation:s.explicitFocusNavigation,destinationNavigator:s.destinationNavigator,
        npcPresentation:s.npcPresentation,projection:s.projection,navigationPerformance:s.navigationPerformance,
        focus:f,protagonist:p?{x:String(p.x),y:String(p.y)}:null,
        fantasyTimestamp:window.GameTime?.getTimestampKey?.()||null
      };
    """)


def align_protagonist_to_village(driver):
    result=js(driver,"""
      const s=PlanetStage.snapshot(),v=StartingVillage.plan(s.activeSeed),c=v?.center,campaign=SeedSystem?.getCampaign?.();
      if(!c||!campaign)return null;
      campaign.protagonist=WorldCoordinates.position(String(c.x),String(c.y));
      PlanetStage.setWorldTileFocus(String(c.x),String(c.y));
      PlanetStage.setScaleIndex(2);
      PlanetStage.refreshPlaces();
      const p=Protagonist?.getPosition?.()||campaign.protagonist;
      return {name:String(v.name||'Starting Village'),center:{x:String(c.x),y:String(c.y)},position:{x:String(p.x),y:String(p.y)}};
    """)
    if not result:
        raise RuntimeError("starting village focus unavailable")
    return result


def wait_focus(driver,mode,timeout=200):
    return _wait(driver,f"return window.ProtagonistFocusUI?.snapshot?.().focusMode==={json.dumps(mode)};",timeout,f"focus mode {mode}")


def wait_ground_protagonist(driver,timeout=220):
    return _wait(driver,"""
      const s=PlanetStage.snapshot(),f=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(f.focusMode==='protagonist-local'&&n?.targetType==='protagonist'&&n?.state==='committed'&&Number(n.focusErrorMeters)<=1.1&&s.zoom?.scalar>=.999&&s.projection?.resourceBudget?.visibleLevel==='ground');
    """,timeout,"protagonist ground focus")


def wait_remote(driver,target_id,timeout=220):
    quoted=json.dumps(str(target_id))
    return _wait(driver,f"""
      const s=PlanetStage.snapshot(),f=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(f.focusMode==='world-exploration'&&n?.targetType==='place'&&String(n.targetId)==={quoted}&&n?.state==='committed'&&Number(n.focusErrorMeters)<=1.1);
    """,timeout,"remote canonical focus")


def descriptor_set(driver):
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
    local=[x for x in valid if x not in settlements]
    if not settlements:
        settlements=valid[:1]
    if not settlements:
        raise RuntimeError("no canonical remote target available")
    remote=settlements[-1]
    poi=local[-1] if local else (settlements[-2] if len(settlements)>1 else remote)
    return remote,poi


def assert_zero_camera_mutation(record,label):
    focus=(record or {}).get("focus") or {}
    if int(focus.get("cameraNavigationMutationCount") or 0)!=0:
        raise RuntimeError(f"{label}: camera navigation mutated protagonist: {focus}")
    proof=focus.get("lastCameraMutationProof")
    if proof and proof.get("mutated") is not False:
        raise RuntimeError(f"{label}: last camera-only transaction mutation proof failed: {proof}")


def advance_actor_as_authoritative_simulation(driver,dx=8,dy=3):
    result=js(driver,"""
      const campaign=SeedSystem?.getCampaign?.(),before=Protagonist?.getPosition?.()||campaign?.protagonist;
      if(!campaign||!before)return null;
      const next=WorldCoordinates.position(String(BigInt(String(before.x))+BigInt(arguments[0])),String(BigInt(String(before.y))+BigInt(arguments[1])));
      campaign.protagonist=next;
      const after=Protagonist?.getPosition?.()||campaign.protagonist;
      return {before:{x:String(before.x),y:String(before.y)},after:{x:String(after.x),y:String(after.y)}};
    """,int(dx),int(dy))
    if not result or result.get("before")==result.get("after"):
        raise RuntimeError("authoritative protagonist evidence motion did not advance")
    return result


def run_seed(driver,seed,index):
    install_seed(driver,seed)
    set_exact_viewport(driver,1440,900)
    driver.get(target_url())
    ready(driver)
    village=align_protagonist_to_village(driver)
    wide_before=stage(driver)
    wide_path=shot(driver,f"{index:02d}-{seed}-01-wide-before-focus.png")

    descriptors=descriptor_set(driver)
    remote,poi=choose_targets(descriptors)
    default_request=js(driver,"return ProtagonistFocusUI.ensureDefaultFocus({force:true});")
    if not default_request or not default_request.get("requestId"):
        raise RuntimeError("default protagonist focus did not create canonical request")
    wait_focus(driver,"transitioning-to-protagonist",30)
    transition=stage(driver)
    transition_path=shot(driver,f"{index:02d}-{seed}-02-protagonist-transition.png")
    wait_ground_protagonist(driver)
    local_before=stage(driver)
    local_path=shot(driver,f"{index:02d}-{seed}-03-protagonist-local.png")
    assert_zero_camera_mutation(local_before,"default focus")

    movement=advance_actor_as_authoritative_simulation(driver,6,2)
    follow_before=stage(driver)
    prior_steps=int(((follow_before.get("focus") or {}).get("follow") or {}).get("stepCount") or 0)
    _wait(driver,f"return Number(ProtagonistFocusUI.snapshot().follow.stepCount)>{prior_steps};",30,"soft follow step")
    time.sleep(.8)
    follow_after=stage(driver)
    follow_path=shot(driver,f"{index:02d}-{seed}-04-soft-follow.png")
    assert_zero_camera_mutation(follow_after,"soft follow")
    if ((follow_after.get("focus") or {}).get("follow") or {}).get("suspended"):
        raise RuntimeError("soft follow unexpectedly suspended after authoritative movement")

    before_remote_pos=(follow_after.get("protagonist") or {}).copy()
    js(driver,"PlanetStage.selectPlace(arguments[0]);",remote["id"])
    wait_remote(driver,remote["id"])
    remote_settle=stage(driver)
    remote_path=shot(driver,f"{index:02d}-{seed}-05-remote-settlement.png")
    assert_zero_camera_mutation(remote_settle,"remote settlement")
    if remote_settle.get("protagonist")!=before_remote_pos:
        raise RuntimeError("remote camera selection moved protagonist")

    # Stay remote and enter its deepest supported local representation. The
    # controller must not force a return while the place owns camera focus.
    js(driver,"PlanetStage.setZoomTargetScalar(1,'wp-005-003-remote-ground');")
    _wait(driver,"return PlanetStage.snapshot().zoom?.scalar>=.999;",180,"remote local zoom")
    time.sleep(1.2)
    remote_ground=stage(driver)
    remote_ground_path=shot(driver,f"{index:02d}-{seed}-06-remote-ground.png")
    nav=(remote_ground.get("explicitFocusNavigation") or {}).get("active") or {}
    if nav.get("targetType")!="place" or str(nav.get("targetId"))!=str(remote["id"]):
        raise RuntimeError("remote exploration was forced away from selected place")
    if int((remote_ground.get("focus") or {}).get("forcedCameraReturnCount") or 0)!=0:
        raise RuntimeError("forced camera return occurred during remote exploration")

    if poi["id"]!=remote["id"]:
        js(driver,"PlanetStage.selectPlace(arguments[0]);",poi["id"])
        wait_remote(driver,poi["id"])
    poi_state=stage(driver)
    poi_path=shot(driver,f"{index:02d}-{seed}-07-remote-poi.png")
    assert_zero_camera_mutation(poi_state,"remote POI")

    clock_before=poi_state.get("fantasyTimestamp")
    js(driver,"PlanetStage.applyAuthoritativeFantasyTime({year:1100,month:1,day:1,hour:12,minute:10,second:0},'WP-S003-010-003-005-003 remote simulation',{snapshotResult:false,deferPresentation:false});")
    time.sleep(.5)
    autonomous_motion=advance_actor_as_authoritative_simulation(driver,9,4)
    remote_advanced=stage(driver)
    clock_after=remote_advanced.get("fantasyTimestamp")
    if clock_before and clock_after and clock_before==clock_after:
        raise RuntimeError("Fantasy Game Time did not advance while remote")
    if ((remote_advanced.get("focus") or {}).get("focusMode")!="world-exploration":
        raise RuntimeError("remote camera returned after simulation advance")

    latest=remote_advanced.get("protagonist")
    return_result=js(driver,"return ProtagonistFocusUI.returnToProtagonist();")
    if not return_result or not return_result.get("requestId"):
        raise RuntimeError("Return to Protagonist did not create canonical focus request")
    wait_ground_protagonist(driver)
    returned=stage(driver)
    returned_path=shot(driver,f"{index:02d}-{seed}-08-return-latest.png")
    assert_zero_camera_mutation(returned,"return to protagonist")
    nav=(returned.get("explicitFocusNavigation") or {}).get("active") or {}
    apply_pos=nav.get("protagonistPositionAtApply") or nav.get("protagonistPositionCurrent") or {}
    if str(apply_pos.get("x"))!=str(latest.get("x")) or str(apply_pos.get("y"))!=str(latest.get("y")):
        raise RuntimeError(f"return did not resolve latest authoritative protagonist position: latest={latest} nav={nav}")

    # Regional/world continuity after time advancement.
    js(driver,"PlanetStage.setScaleIndex(3);")
    time.sleep(.8)
    regional_after=stage(driver)
    regional_path=shot(driver,f"{index:02d}-{seed}-09-regional-after-time.png")

    mobile=[]
    if index==1:
        js(driver,"ProtagonistFocusUI.returnToProtagonist();")
        wait_ground_protagonist(driver)
        set_exact_viewport(driver,430,900)
        time.sleep(.3)
        portrait=stage(driver);portrait_path=shot(driver,f"{index:02d}-{seed}-10-phone-portrait.png")
        set_exact_viewport(driver,900,430)
        time.sleep(.3)
        landscape=stage(driver);landscape_path=shot(driver,f"{index:02d}-{seed}-11-phone-landscape.png")
        for label,row in (("portrait",portrait),("landscape",landscape)):
            focus=row.get("focus") or {}
            if focus.get("focusMode")!="protagonist-local":
                raise RuntimeError(f"{label}: protagonist focus lost after responsive resize: {focus}")
            assert_zero_camera_mutation(row,label)
        mobile=[{"profile":"phone-portrait","path":portrait_path,"state":portrait},{"profile":"phone-landscape","path":landscape_path,"state":landscape}]
        set_exact_viewport(driver,1440,900)

    return {
        "seed":seed,"village":village,"remoteTarget":remote,"poiTarget":poi,
        "defaultRequest":default_request,"authoritativeFollowMotion":movement,"remoteAutonomousMotion":autonomous_motion,
        "states":{
            "wideBefore":wide_before,"transition":transition,"local":local_before,"followAfter":follow_after,
            "remoteSettlement":remote_settle,"remoteGround":remote_ground,"remotePoi":poi_state,"remoteAdvanced":remote_advanced,
            "returned":returned,"regionalAfter":regional_after
        },
        "screenshots":[wide_path,transition_path,local_path,follow_path,remote_path,remote_ground_path,poi_path,returned_path,regional_path],
        "mobile":mobile
    }


def main():
    driver=_driver()
    records=[]
    try:
        for index,seed in enumerate(SEEDS,start=1):
            records.append(run_seed(driver,seed,index))
        logs=[]
        try: logs=driver.get_log("browser")
        except Exception: pass
        severe=[row for row in logs if str(row.get("level","")).upper()=="SEVERE" and "favicon" not in str(row.get("message","")).lower()]
        if severe:
            raise RuntimeError("browser console severe errors: "+json.dumps(severe[-12:]))
        summary={
            "pass":True,"wp":"WP-S003-010-003-005-003","classification":"MIXED","seeds":list(SEEDS),
            "recordCount":len(records),"screenshotCount":sum(len(r["screenshots"])+len(r["mobile"]) for r in records),
            "cameraNavigationMutationCount":sum(int((((r["states"]["returned"].get("focus") or {}).get("cameraNavigationMutationCount")) or 0)) for r in records),
            "forcedCameraReturnCount":sum(int((((r["states"]["remoteAdvanced"].get("focus") or {}).get("forcedCameraReturnCount")) or 0)) for r in records),
            "records":records
        }
        if summary["cameraNavigationMutationCount"]!=0 or summary["forcedCameraReturnCount"]!=0:
            raise RuntimeError("camera authority invariants failed: "+json.dumps({k:summary[k] for k in ("cameraNavigationMutationCount","forcedCameraReturnCount")}))
        (OUT/"evidence.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
        print(json.dumps({k:v for k,v in summary.items() if k!="records"},indent=2))
    except Exception as exc:
        failure={"pass":False,"error":str(exc),"records":records}
        (OUT/"failure.json").write_text(json.dumps(failure,indent=2),encoding="utf-8")
        raise
    finally:
        driver.quit()

if __name__=="__main__":
    main()
