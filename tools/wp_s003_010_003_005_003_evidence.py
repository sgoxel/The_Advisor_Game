#!/usr/bin/env python3
import json, os, time
from pathlib import Path
from PIL import Image
from screenshot_tool import _driver, _wait, set_exact_viewport

TARGET=os.environ.get("TARGET","http://127.0.0.1:8000/")
OUT=Path(os.environ.get("OUT","tools/screenshots/wp-s003-010-003-005-003"))
OUT.mkdir(parents=True,exist_ok=True)
SEEDS=("FOCUS-UX-005003-A","FOCUS-UX-005003-B")


def url():
    sep="&" if "?" in TARGET else "?"
    return TARGET+sep+"evidence_fast_start=1&dev=1&gpu=webgl2&wp005003_focus_evidence=1&wp005003_manual_start=1"


def install_seed(driver,seed):
    campaign=json.dumps({
        "seed":seed,"realStartMs":int(time.time()*1000),
        "fantasyStart":{"year":1201,"month":5,"day":14,"hour":10,"minute":20,"second":0,"millisecond":0},
        "protagonist":{"x":"0","y":"0"},"restartCount":0
    },separators=(",",":"))
    settings=json.dumps({"seed":seed},separators=(",",":"))
    source=f"""
      try{{
        localStorage.setItem('theAdvisorGame.wp001.campaign.v2',{json.dumps(campaign)});
        localStorage.setItem('theAdvisorGame.wp001.settings.v2',{json.dumps(settings)});
        localStorage.setItem('advisor.planet.seed.v1',{json.dumps(seed)});
      }}catch(_){{}}
    """
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument",{"source":source})


def ready(driver,timeout=240):
    _wait(driver,"""
      const root=document.getElementById('planetStageRoot'),s=window.PlanetStage?.snapshot?.();
      return Boolean(root?.dataset?.ready==='true'&&s?.ready&&s?.activeSeed&&window.ProtagonistFocusUI?.snapshot?.()?.mounted&&window.StartingVillage);
    """,timeout,"PlanetStage + ProtagonistFocusUI readiness")


def js(driver,script,*args):return driver.execute_script(script,*args)

def snap(driver):
    return js(driver,"""
      const s=window.PlanetStage?.snapshot?.()||{},u=window.ProtagonistFocusUI?.snapshot?.()||{},p=window.Protagonist?.getPosition?.()||null;
      return {
        focusUI:u,canonicalFocus:s.canonicalFocus||null,zoom:s.zoom||null,navigation:s.explicitFocusNavigation||null,
        npcPresentation:s.npcPresentation||null,resourceBudget:s.projection?.resourceBudget||null,spatialLod:s.projection?.spatialLod||null,
        navigationPerformance:s.navigationPerformance||null,protagonist:p?{x:String(p.x),y:String(p.y)}:null,
        activeSeed:s.activeSeed||null,frameCount:s.frameCount||0
      };
    """)


def shot(driver,seed,name,records,expected=None):
    path=OUT/f"{seed}-{name}.png"
    driver.save_screenshot(str(path))
    metrics=js(driver,"""
      const vv=window.visualViewport;
      return {
        cssWidth:window.innerWidth,cssHeight:window.innerHeight,
        visualWidth:vv?.width||window.innerWidth,visualHeight:vv?.height||window.innerHeight,
        dpr:window.devicePixelRatio||1,
        orientation:window.innerHeight>window.innerWidth?'portrait':'landscape'
      };
    """)
    with Image.open(path) as image:
        screenshot_width,screenshot_height=image.size
    metrics["screenshotWidth"]=screenshot_width
    metrics["screenshotHeight"]=screenshot_height
    if expected:
        expected_width,expected_height=expected
        expected_orientation="portrait" if expected_height>expected_width else "landscape"
        if int(metrics.get("cssWidth") or 0)!=expected_width or int(metrics.get("cssHeight") or 0)!=expected_height:
            raise RuntimeError(f"{name}: CSS viewport mismatch: {metrics}, expected={expected}")
        if screenshot_width!=expected_width or screenshot_height!=expected_height:
            raise RuntimeError(f"{name}: screenshot dimension mismatch: {metrics}, expected={expected}")
        if metrics.get("orientation")!=expected_orientation:
            raise RuntimeError(f"{name}: orientation mismatch: {metrics}, expected={expected_orientation}")
        if float(metrics.get("dpr") or 0)<=0:
            raise RuntimeError(f"{name}: invalid DPR telemetry: {metrics}")
    state=snap(driver);state["seed"]=seed;state["shot"]=name;state["file"]=path.name;state["viewport"]=metrics;records.append(state);return state


def point_add(p,dx,dy):return {"x":str(int(p["x"])+dx),"y":str(int(p["y"])+dy)}
def point_distance(a,b):return ((int(a["x"])-int(b["x"]))**2+(int(a["y"])-int(b["y"]))**2)**0.5


def align_protagonist_to_village(driver):
    result=js(driver,"""
      const s=PlanetStage.snapshot(),v=StartingVillage.plan(s.activeSeed),c=v?.center,campaign=SeedSystem.getCampaign();
      if(!c||!campaign)return {ok:false};
      campaign.protagonist=WorldCoordinates.position(String(c.x),String(c.y));
      PlanetStage.setWorldTileFocus(String(c.x),String(c.y));PlanetStage.setScaleIndex(2);PlanetStage.refreshPlaces?.();
      const p=Protagonist.getPosition();return {ok:true,name:v.name||null,center:{x:String(c.x),y:String(c.y)},protagonist:{x:String(p.x),y:String(p.y)}};
    """)
    if not result or not result.get("ok"):raise RuntimeError("could not align evidence protagonist: "+json.dumps(result))
    _wait(driver,"return !window.PlanetStage.snapshot().zoom?.animation?.active;",120,"wide-view zoom settle")
    return result


def assert_safe(state,label):
    ui=state.get("focusUI") or {};safe=ui.get("safeRect") or {};box=ui.get("contextWidgetBounds") or {};proj=ui.get("projectedProtagonist") or {}
    if not safe or not box:raise RuntimeError(f"{label}: missing safe-area/widget telemetry: {ui}")
    if box.get("left",-1)<safe.get("left",0)-2 or box.get("right",99999)>safe.get("right",0)+2 or box.get("top",-1)<safe.get("top",0)-2 or box.get("bottom",99999)>safe.get("bottom",0)+2:
        raise RuntimeError(f"{label}: focus widget outside unobscured gameplay rect: {ui}")
    if ui.get("mode")=="protagonist" and proj and proj.get("insideSafeRect") is not True:
        raise RuntimeError(f"{label}: protagonist projection outside unobscured gameplay rect: {ui}")


def wait_protagonist_focus(driver,timeout=240):
    _wait(driver,"""
      const s=PlanetStage.snapshot(),u=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(u.mode==='protagonist'&&u.followEnabled&&n?.targetType==='protagonist'&&(n.state==='committed'||n.committedAtMs!=null)&&s.zoom?.visibleLevel==='ground');
    """,timeout,"committed protagonist ground focus")


def choose_remote(driver,village):
    return js(driver,"""
      const base=arguments[0];PlanetStage.setScaleIndex(4);PlanetStage.refreshPlaces?.();
      const rows=PlanetStage.placeDescriptors?.()||[];
      let best=null,bestD=-1;
      for(const d of rows){
        if(!d?.id||!d?.center)continue;
        let dist=0;try{const dx=Number(BigInt(String(d.center.x))-BigInt(String(base.x))),dy=Number(BigInt(String(d.center.y))-BigInt(String(base.y)));dist=Math.hypot(dx,dy)}catch(_){continue}
        if(dist>bestD){best=d;bestD=dist}
      }
      if(!best)return {ok:false,count:rows.length};
      const before=Protagonist.getPosition(),result=PlanetStage.selectPlace(String(best.id));
      return {ok:true,id:String(best.id),name:String(best.name||best.id),type:String(best.type||''),distanceMeters:bestD,before:{x:String(before.x),y:String(before.y)},requestId:result?.explicitFocusNavigation?.active?.requestId||PlanetStage.snapshot().explicitFocusNavigation?.active?.requestId||null};
    """,village)


def wait_remote(driver,target_id,timeout=180):
    target=json.dumps(str(target_id))
    _wait(driver,f"""
      const s=PlanetStage.snapshot(),u=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
      return Boolean(u.mode==='remote'&&u.forcedReturnCount===0&&n?.targetType==='place'&&String(n.targetId)==={target}&&(n.state==='committed'||n.committedAtMs!=null));
    """,timeout,"stable remote canonical exploration")


def mutate_protagonist(driver,dx,dy):
    return js(driver,"""
      const c=SeedSystem.getCampaign(),p=Protagonist.getPosition();if(!c||!p)return null;
      const nx=String(BigInt(String(p.x))+BigInt(arguments[0])),ny=String(BigInt(String(p.y))+BigInt(arguments[1]));
      c.protagonist=WorldCoordinates.position(nx,ny);const a=Protagonist.getPosition();return {x:String(a.x),y:String(a.y)};
    """,dx,dy)


def core_run(seed,full):
    driver=_driver();records=[];functional={"seed":seed}
    try:
        set_exact_viewport(driver,1440,900);install_seed(driver,seed);driver.get(url());ready(driver)
        setup=align_protagonist_to_village(driver);functional["setup"]=setup
        wide=shot(driver,seed,"01-wide-before-focus",records,(1440,900));functional["wideBeforeFocus"]=wide
        before=wide["protagonist"].copy();
        if js(driver,"return window.ProtagonistFocusUI.startDefaultFocus();") is not True:raise RuntimeError("default protagonist focus did not start")
        wait_protagonist_focus(driver)
        focused=shot(driver,seed,"02-protagonist-ground",records,(1440,900));assert_safe(focused,"default ground focus")
        if focused["protagonist"]!=before:raise RuntimeError("camera focus mutated Simulation protagonist position")
        ui=focused["focusUI"]
        if ui.get("defaultFocusCount")!=1 or ui.get("forcedReturnCount")!=0 or ui.get("hardSnapCount")!=0:raise RuntimeError("invalid default-focus telemetry: "+json.dumps(ui))

        remote=choose_remote(driver,setup["center"])
        if not remote or not remote.get("ok"):raise RuntimeError("no remote canonical place available: "+json.dumps(remote))
        wait_remote(driver,remote["id"])
        remote_state=shot(driver,seed,"03-remote-exploration",records,(1440,900))
        if remote_state["protagonist"]!=remote["before"]:raise RuntimeError("remote camera navigation mutated protagonist")
        time.sleep(1.0);stable=snap(driver)
        if (stable.get("focusUI") or {}).get("mode")!="remote" or (stable.get("focusUI") or {}).get("forcedReturnCount")!=0:
            raise RuntimeError("remote exploration was force-returned: "+json.dumps(stable))

        latest=mutate_protagonist(driver,28,12);time.sleep(.7);remote_after_move=snap(driver)
        if (remote_after_move.get("focusUI") or {}).get("mode")!="remote":raise RuntimeError("protagonist movement forced camera return during remote exploration")
        if js(driver,"return window.ProtagonistFocusUI.returnToProtagonist('evidence-return');") is not True:raise RuntimeError("Return to Protagonist failed to start")
        wait_protagonist_focus(driver)
        returned=shot(driver,seed,"04-return-latest-position",records,(1440,900));assert_safe(returned,"return latest")
        if returned["protagonist"]!=latest:raise RuntimeError("Return did not preserve latest authoritative position")
        if (returned["focusUI"] or {}).get("explicitReturnCount")!=1:raise RuntimeError("explicit return telemetry missing")

        before_follow=(returned.get("focusUI") or {}).get("followCorrections",0);moved=mutate_protagonist(driver,74,18)
        _wait(driver,f"return (window.ProtagonistFocusUI?.snapshot?.()?.followCorrections||0)>{int(before_follow)};",15,"soft follow correction")
        time.sleep(.45);followed=shot(driver,seed,"05-soft-follow",records,(1440,900));assert_safe(followed,"soft follow")
        if followed["protagonist"]!=moved:raise RuntimeError("soft follow mutated protagonist authoritative position")
        fui=followed["focusUI"]
        if fui.get("hardSnapCount")!=0 or fui.get("forcedReturnCount")!=0 or fui.get("followCorrections",0)<=before_follow:
            raise RuntimeError("soft-follow telemetry invalid: "+json.dumps(fui))

        js(driver,"window.PlanetStage.setScaleIndex(8);")
        _wait(driver,"return !PlanetStage.snapshot().zoom?.animation?.active;",120,"LOD handoff settle")
        _wait(driver,"""
          window.ProtagonistFocusUI.refresh();
          const s=PlanetStage.snapshot(),u=ProtagonistFocusUI.snapshot(),n=s.explicitFocusNavigation?.active;
          return Boolean(n?.targetType==='protagonist'&&u.mode==='protagonist'&&u.focusMarkerVisible===true&&s.zoom?.visibleLevel!=='ground');
        """,8,"refreshed protagonist identity after LOD handoff")
        handoff=shot(driver,seed,"06-lod-focus-identity",records,(1440,900))
        nav=(handoff.get("navigation") or {}).get("active") or {};hui=handoff.get("focusUI") or {}
        if nav.get("targetType")!="protagonist" or hui.get("mode")!="protagonist" or hui.get("focusMarkerVisible") is not True:raise RuntimeError("protagonist focus identity lost through LOD handoff")
        js(driver,"window.PlanetStage.setScaleIndex(9);")
        _wait(driver,"return !PlanetStage.snapshot().zoom?.animation?.active;",120,"ground restore settle")

        if full:
            for name,w,h in (("07-tablet",1024,768),("08-phone-portrait",390,844),("09-phone-landscape",844,390)):
                set_exact_viewport(driver,w,h);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(1.25)
                responsive=shot(driver,seed,name,records,(w,h));assert_safe(responsive,name)
                if (responsive.get("focusUI") or {}).get("responsiveRefocusCount",0)<1:raise RuntimeError(name+": responsive canonical refocus did not run")
        else:
            set_exact_viewport(driver,390,844);js(driver,"window.ProtagonistFocusUI.refresh();");time.sleep(1.25)
            responsive=shot(driver,seed,"07-second-seed-phone",records,(390,844));assert_safe(responsive,"second seed phone")
            if (responsive.get("focusUI") or {}).get("responsiveRefocusCount",0)<1:raise RuntimeError("second seed phone: responsive canonical refocus did not run")

        end=snap(driver);functional.update({"remote":remote,"remoteAfterMove":remote_after_move,"returned":returned,"followed":followed,"final":end})
        if (end.get("focusUI") or {}).get("forcedReturnCount")!=0:raise RuntimeError("forced camera return detected")
        if (end.get("focusUI") or {}).get("lastError"):raise RuntimeError("focus UI reported error: "+str((end.get("focusUI") or {}).get("lastError")))
        return {"functional":functional,"frames":records}
    finally:
        driver.quit()


def main():
    for p in OUT.glob("*.png"):p.unlink()
    all_runs=[]
    for idx,seed in enumerate(SEEDS):all_runs.append(core_run(seed,idx==0))
    frames=[f for run in all_runs for f in run["frames"]]
    payload={"wp":"WP-S003-010-003-005-003","pass":True,"seeds":list(SEEDS),"frameCount":len(frames),"runs":[r["functional"] for r in all_runs],"frames":frames}
    (OUT/"evidence.json").write_text(json.dumps(payload,indent=2,sort_keys=True),encoding="utf-8")
    print(json.dumps({"pass":True,"wp":payload["wp"],"frameCount":len(frames),"seeds":list(SEEDS)},sort_keys=True))

if __name__=="__main__":main()
