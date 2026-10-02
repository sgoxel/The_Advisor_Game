#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 anchor, found {count}")
    return text.replace(old, new, 1)


runtime_path = Path("scripts/world/planet-stage.js")
runtime = runtime_path.read_text(encoding="utf-8")

if "const ZOOM_INTERPOLATION_LADDER=" not in runtime:
    runtime = replace_once(
        runtime,
        '''// Player-facing smooth zoom adds deterministic transition milestones without
// redefining the canonical ten-step semantic scale ladder above.
const ZOOM_DISPLAY_LADDER=Object.freeze(["1/10","1/15","1/20","1/30","1/50","1/75","1/100","1/150","1/250","1/375","1/500","1/750","1/1000","1/1500","1/2500","1/3750","1/5000","1/7500","1/10000"]);
const ZOOM_DISPLAY_DENOMINATORS=Object.freeze([10,15,20,30,50,75,100,150,250,375,500,750,1000,1500,2500,3750,5000,7500,10000]);''',
        '''// Smooth zoom may use deterministic internal interpolation milestones, but
// README keeps the player-facing scale contract to SCALE_LADDER only.
const ZOOM_INTERPOLATION_LADDER=Object.freeze(["1/10","1/15","1/20","1/30","1/50","1/75","1/100","1/150","1/250","1/375","1/500","1/750","1/1000","1/1500","1/2500","1/3750","1/5000","1/7500","1/10000"]);
const ZOOM_INTERPOLATION_DENOMINATORS=Object.freeze([10,15,20,30,50,75,100,150,250,375,500,750,1000,1500,2500,3750,5000,7500,10000]);''',
        "interpolation constants",
    )
    for old, new in (
        ("ZOOM_DISPLAY_LADDER", "ZOOM_INTERPOLATION_LADDER"),
        ("ZOOM_DISPLAY_DENOMINATORS", "ZOOM_INTERPOLATION_DENOMINATORS"),
        ("displayScaleIndexForScalar", "interpolationScaleIndexForScalar"),
        ("scalarForDisplayScaleIndex", "scalarForInterpolationScaleIndex"),
        ("displayScaleStateForScalar", "interpolationScaleStateForScalar"),
        ("lastDisplayScaleIndex", "lastInterpolationScaleIndex"),
    ):
        if old not in runtime:
            raise SystemExit(f"missing runtime token before rename: {old}")
        runtime = runtime.replace(old, new)

    runtime = replace_once(
        runtime,
        '''  const scaleState=scaleStateForScalar(),displayScaleState=interpolationScaleStateForScalar(),targetDisplayScaleState=interpolationScaleStateForScalar(Number.isFinite(zoomState.targetScalar)?zoomState.targetScalar:zoomState.scalar),localLayers=semanticLocalLayerDiagnostics(semantic),ruler=scaleRulerForViewport(zoomState.visibleFootprintWidthMeters,rect?.width||1);
  const scale=layer.querySelector(".planet-scale-ruler");scale.querySelector(".planet-scale-meta strong").textContent=displayScaleState.label;scale.querySelector(".planet-scale-meta span").textContent=zoomState.animating?(displayScaleState.label+" → "+targetDisplayScaleState.label):semantic.displayBand;scale.querySelector(".planet-scale-line").style.width=ruler.pixelLength.toFixed(2)+"px";scale.querySelector("small").textContent=formatDistanceMeters(ruler.distanceMeters);''',
        '''  const scaleState=scaleStateForScalar(),targetScaleState=scaleStateForScalar(Number.isFinite(zoomState.targetScalar)?zoomState.targetScalar:zoomState.scalar),interpolationScaleState=interpolationScaleStateForScalar(),targetInterpolationScaleState=interpolationScaleStateForScalar(Number.isFinite(zoomState.targetScalar)?zoomState.targetScalar:zoomState.scalar),localLayers=semanticLocalLayerDiagnostics(semantic),ruler=scaleRulerForViewport(zoomState.visibleFootprintWidthMeters,rect?.width||1);
  const scale=layer.querySelector(".planet-scale-ruler");scale.querySelector(".planet-scale-meta strong").textContent=scaleState.label;scale.querySelector(".planet-scale-meta span").textContent=zoomState.animating?(scaleState.label+" → "+targetScaleState.label):semantic.displayBand;scale.querySelector(".planet-scale-line").style.width=ruler.pixelLength.toFixed(2)+"px";scale.querySelector("small").textContent=formatDistanceMeters(ruler.distanceMeters);''',
        "map scale UI",
    )
    runtime = replace_once(
        runtime,
        '''    displayScaleIndex:displayScaleState.index,displayScaleLabel:displayScaleState.label,targetDisplayScaleIndex:targetDisplayScaleState.index,targetDisplayScaleLabel:targetDisplayScaleState.label,''',
        '''    displayScaleIndex:scaleState.index,displayScaleLabel:scaleState.label,targetDisplayScaleIndex:targetScaleState.index,targetDisplayScaleLabel:targetScaleState.label,
    interpolationScaleIndex:interpolationScaleState.index,interpolationScaleLabel:interpolationScaleState.label,targetInterpolationScaleIndex:targetInterpolationScaleState.index,targetInterpolationScaleLabel:targetInterpolationScaleState.label,''',
        "map scale telemetry",
    )
    runtime = replace_once(
        runtime,
        '''      displayScaleIndex:interpolationScaleStateForScalar().index,displayScaleLabel:interpolationScaleStateForScalar().label,displayScaleLadder:ZOOM_INTERPOLATION_LADDER.slice(),
      targetDisplayScaleIndex:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).index,targetDisplayScaleLabel:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,''',
        '''      displayScaleIndex:scaleStateForScalar().index,displayScaleLabel:scaleStateForScalar().label,displayScaleLadder:SCALE_LADDER.slice(),
      targetDisplayScaleIndex:scaleStateForScalar(zoomState.targetScalar??zoomState.scalar).index,targetDisplayScaleLabel:scaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,
      interpolationScaleIndex:interpolationScaleStateForScalar().index,interpolationScaleLabel:interpolationScaleStateForScalar().label,interpolationScaleLadder:ZOOM_INTERPOLATION_LADDER.slice(),
      targetInterpolationScaleIndex:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).index,targetInterpolationScaleLabel:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,''',
        "snapshot scale telemetry",
    )
    runtime = replace_once(
        runtime,
        '''animation:Object.freeze({active:Boolean(zoomState.animating),velocityScalarPerSecond:Number(zoomState.zoomVelocity.toFixed(6)),timeConstantSeconds:ZOOM_ANIMATION_TIME_CONSTANT_SECONDS,settleEpsilon:ZOOM_ANIMATION_SETTLE_EPSILON,frameCount:zoomState.animationFrameCount,totalFrames:zoomState.totalAnimationFrames,retargetCount:zoomState.animationRetargetCount,settledCount:zoomState.animationSettledCount,lastDurationMs:zoomState.lastAnimationDurationMs,inputSource:zoomState.lastAnimationInputSource,currentDisplayScale:interpolationScaleStateForScalar().label,targetDisplayScale:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,prefetchState:''',
        '''animation:Object.freeze({active:Boolean(zoomState.animating),velocityScalarPerSecond:Number(zoomState.zoomVelocity.toFixed(6)),timeConstantSeconds:ZOOM_ANIMATION_TIME_CONSTANT_SECONDS,settleEpsilon:ZOOM_ANIMATION_SETTLE_EPSILON,frameCount:zoomState.animationFrameCount,totalFrames:zoomState.totalAnimationFrames,retargetCount:zoomState.animationRetargetCount,settledCount:zoomState.animationSettledCount,lastDurationMs:zoomState.lastAnimationDurationMs,inputSource:zoomState.lastAnimationInputSource,currentDisplayScale:scaleStateForScalar().label,targetDisplayScale:scaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,currentInterpolationScale:interpolationScaleStateForScalar().label,targetInterpolationScale:interpolationScaleStateForScalar(zoomState.targetScalar??zoomState.scalar).label,prefetchState:''',
        "animation public/internal scale telemetry",
    )
    runtime = replace_once(
        runtime,
        '''ladder:Object.freeze({labels:SCALE_LADDER.slice(),displayLabels:ZOOM_INTERPOLATION_LADDER.slice(),displayDenominators:ZOOM_INTERPOLATION_DENOMINATORS.slice(),startScalar:''',
        '''ladder:Object.freeze({labels:SCALE_LADDER.slice(),displayLabels:SCALE_LADDER.slice(),displayDenominators:SCALE_DENOMINATORS.slice(),interpolationLabels:ZOOM_INTERPOLATION_LADDER.slice(),interpolationDenominators:ZOOM_INTERPOLATION_DENOMINATORS.slice(),startScalar:''',
        "ladder telemetry",
    )

    runtime_path.write_text(runtime, encoding="utf-8")
else:
    print("runtime scale contract already patched")

# Keep WP-018 smooth-zoom coverage, but make its 19-point ladder explicitly
# internal. Public display telemetry must remain on README's canonical ten labels.
test_path = Path("tools/test_wp_s003_010_003_018.py")
test = test_path.read_text(encoding="utf-8")
if "INTERPOLATION_LADDER = [" not in test:
    test = test.replace("DISPLAY_LADDER = [", "INTERPOLATION_LADDER = [", 1)
    test = test.replace("DISPLAY_LADDER", "INTERPOLATION_LADDER")
    test = test.replace('["targetDisplayScaleIndex"]', '["targetInterpolationScaleIndex"]')
    test = test.replace('["targetDisplayScaleLabel"]', '["targetInterpolationScaleLabel"]')
    test = test.replace('["displayScaleLabel"]', '["interpolationScaleLabel"]')
    test = replace_once(
        test,
        '''    if stage["zoom"].get("displayScaleLadder") != INTERPOLATION_LADDER:
        raise AssertionError(f"display ladder mismatch: {stage['zoom'].get('displayScaleLadder')}")''',
        '''    canonical = ["1/10","1/20","1/50","1/100","1/250","1/500","1/1000","1/2500","1/5000","1/10000"]
    if stage["zoom"].get("displayScaleLadder") != canonical:
        raise AssertionError(f"canonical display ladder mismatch: {stage['zoom'].get('displayScaleLadder')}")
    if stage["zoom"].get("interpolationScaleLadder") != INTERPOLATION_LADDER:
        raise AssertionError(f"interpolation ladder mismatch: {stage['zoom'].get('interpolationScaleLadder')}")''',
        "WP018 ladder assertions",
    )
    test = replace_once(
        test,
        '''        evidence["displayLadder"] = base["zoom"]["displayScaleLadder"]''',
        '''        evidence["displayLadder"] = base["zoom"]["displayScaleLadder"]
        evidence["interpolationLadder"] = base["zoom"]["interpolationScaleLadder"]''',
        "WP018 evidence ladders",
    )
    test = replace_once(
        test,
        '''        if wheel_commanded["zoom"]["targetInterpolationScaleLabel"] != "1/15":
            raise AssertionError(f"wheel did not target 1/15: {wheel_commanded['zoom']}")''',
        '''        if wheel_commanded["zoom"]["targetInterpolationScaleLabel"] != "1/15":
            raise AssertionError(f"wheel did not target internal 1/15 milestone: {wheel_commanded['zoom']}")
        if wheel_commanded["zoom"]["targetDisplayScaleLabel"] not in base["zoom"]["displayScaleLadder"]:
            raise AssertionError(f"wheel exposed non-canonical player scale: {wheel_commanded['zoom']}")''',
        "WP018 wheel canonical display guard",
    )
    test_path.write_text(test, encoding="utf-8")
else:
    print("WP018 interpolation telemetry test already patched")

print("patched WP-S003-010-003-011 canonical player scale contract")
