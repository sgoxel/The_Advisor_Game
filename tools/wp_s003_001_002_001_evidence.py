#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import statistics
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from PIL import Image, ImageChops, ImageStat

TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/wp_s003_001_002_001_artifact")
SEED = "WP-S003-001-002-001-SEED"
TESTED_HEAD = os.environ.get("WP_EVIDENCE_HEAD")
BASELINE_ENGINE = "2.22.3"
CURRENT_ENGINE = "2.23.0"
EVIDENCE_TIME = "1100-01-01 11:30:00"


def verify_retained_bootstrap_policy():
    path=Path("scripts/render/renderer-bootstrap.js")
    source=path.read_text(encoding="utf-8")
    required=[
        'const DEVELOPMENT_MODE_KEY="the-advisor-game:development-mode"',
        'function developerModeEnabled()',
        'requested==="auto"||developer',
        'if(developer){',
        'return "auto";',
    ]
    missing=[token for token in required if token not in source]
    if missing:
        raise AssertionError(f"retained renderer bootstrap is not developer-gated: missing {missing}")
    return {
        "path":str(path),
        "developerOnlyForcedBackends":True,
        "normalDefault":"auto",
        "activePublicEntrypoint":False,
        "reason":"Canonical public index uses planet-stage directly; retained bootstrap is source-verified for policy consistency."
    }


def url_with(params):
    p = urlsplit(TARGET)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q.update({k: str(v) for k, v in params.items() if v is not None})
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def driver_for(disable_webgpu=False, viewport=(1280,800), saved_backend=None):
    width,height=viewport
    o = Options()
    for arg in [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-search-engine-choice-screen",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-webgpu",
        "--use-webgpu-adapter=swiftshader",
        "--enable-gpu",
        "--enable-features=Vulkan",
        "--use-vulkan=swiftshader",
        "--use-gpu-in-tests",
        f"--window-size={width},{height}",
    ]:
        o.add_argument(arg)
    o.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    d = webdriver.Chrome(options=o)
    d.set_script_timeout(240)
    backend_bootstrap = "localStorage.removeItem('advisor.renderer.backend');" if saved_backend is None else f"localStorage.setItem('advisor.renderer.backend', {json.dumps(saved_backend)});"
    bootstrap = f"""
      try {{
        localStorage.setItem('advisor.planet.seed.v1', {json.dumps(SEED)});
        {backend_bootstrap}
        localStorage.setItem('the-advisor-game:development-mode','false');
        localStorage.setItem('the-advisor-game:render-quality-mode','standard');
        localStorage.setItem('the-advisor-game:texture-quality-profile','standard');
        localStorage.removeItem('the-advisor-game:tile-texture-resolution');
      }} catch (_) {{}}
    """
    if disable_webgpu:
        bootstrap += """
          try { Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}); } catch (_) {}
          try { Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined,configurable:true}); } catch (_) {}
        """
    d.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": bootstrap})
    return d


def wait(d, script, timeout=180, *args):
    return WebDriverWait(d, timeout).until(lambda x: x.execute_script(script, *args))


def snap(d):
    return d.execute_script("return window.PlanetStage?.snapshot?.()||null")


def wait_for_presentation_frames(d, frames=4):
    """Wait for actual browser presentation frames before screenshot capture.

    SwiftShader/WebGPU CI can render at only a few frames per second. A fixed
    sub-second sleep can therefore capture the previous material/resource frame
    even though deterministic state is already updated. Waiting on rAF keeps the
    visual A/B comparison tied to freshly presented frames without changing game
    state, renderer policy, or authoritative world data.
    """
    previous_timeout = d.timeouts.script
    try:
        d.set_script_timeout(30)
        return d.execute_async_script("""
          const requested=Math.max(2,Number(arguments[0])||4);
          const done=arguments[arguments.length-1];
          let count=0;
          const tick=()=>{
            count++;
            if(count>=requested){done({frames:count});return;}
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        """, frames)
    finally:
        try:
            d.set_script_timeout(previous_timeout)
        except Exception:
            pass




def browser_logs(d):
    try:
        return [
            {
                "level": row.get("level"),
                "message": row.get("message"),
                "source": row.get("source"),
                "timestamp": row.get("timestamp"),
            }
            for row in d.get_log("browser")
        ]
    except Exception as error:
        return [{"level": "HARNESS", "message": f"browser-log-read-failed: {error!r}", "source": "evidence-harness", "timestamp": None}]


def render_surface_diagnostics(d):
    try:
        return d.execute_script("""
          const c=document.getElementById('planetCanvas');
          const root=document.getElementById('planetStageRoot');
          const s=window.PlanetStage?.snapshot?.()||{};
          const rect=c?.getBoundingClientRect?.()||null;
          const rootRect=root?.getBoundingClientRect?.()||null;
          const style=c?getComputedStyle(c):null;
          const rootStyle=root?getComputedStyle(root):null;
          const cx=rect?rect.left+rect.width*.5:0,cy=rect?rect.top+rect.height*.5:0;
          const top=document.elementFromPoint?.(cx,cy)||null;
          return {
            ready:Boolean(s.ready),
            frameCount:Number(s.frameCount||0),
            rendererBackend:s.rendererBackend||null,
            atmosphere:s.atmosphere||null,
            zoom:s.zoom?{scaleIndex:s.zoom.scaleIndex,scaleLabel:s.zoom.scaleLabel,visibleFootprintHeightMeters:s.zoom.visibleFootprintHeightMeters}:null,
            projection:s.projection?{
              mode:s.projection.mode,
              representationOwner:s.projection.representationOwner||null,
              resourceBudget:s.projection.resourceBudget||null
            }:null,
            canvas:c?{
              id:c.id,
              cssWidth:Number(rect?.width||0),
              cssHeight:Number(rect?.height||0),
              backingWidth:Number(c.width||0),
              backingHeight:Number(c.height||0),
              opacity:style?.opacity||null,
              display:style?.display||null,
              visibility:style?.visibility||null,
              backgroundColor:style?.backgroundColor||null,
              backgroundImage:style?.backgroundImage||null
            }:null,
            root:root?{
              cssWidth:Number(rootRect?.width||0),
              cssHeight:Number(rootRect?.height||0),
              backgroundColor:rootStyle?.backgroundColor||null,
              backgroundImage:rootStyle?.backgroundImage||null
            }:null,
            centerTopElement:top?{tag:top.tagName,id:top.id||null,className:String(top.className||'')}:null,
            devicePixelRatio:Number(window.devicePixelRatio||1),
            viewport:{innerWidth:Number(window.innerWidth||0),innerHeight:Number(window.innerHeight||0)}
          };
        """)
    except Exception as error:
        return {"diagnosticError": repr(error)}


def persist_run_diagnostics(label, payload):
    OUT.mkdir(parents=True, exist_ok=True)
    path=OUT/f"{label}.diagnostics.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return path.name


def apply_evidence_time(d):
    d.execute_script("""
      window.PlanetStage.applyAuthoritativeFantasyTime(
        arguments[0],
        "WP-S003-001-002-001 backend comparison",
        {snapshotResult:false}
      );
    """, EVIDENCE_TIME)


def settle_ground(d):
    d.execute_script("""
      const s=window.PlanetStage.snapshot(),p=window.StartingVillage?.plan?.(s.activeSeed),c=p?.center||{x:'0',y:'0'};
      window.PlanetStage.applyAuthoritativeFantasyTime(
        arguments[0],
        "WP-S003-001-002-001 backend comparison",
        {snapshotResult:false}
      );
      window.PlanetStage.setWorldTileFocus(String(c.x),String(c.y));
      window.PlanetStage.setScaleIndex(9);
    """, EVIDENCE_TIME)
    wait(d, """
      const s=window.PlanetStage?.snapshot?.(),r=s?.projection?.resourceBudget||{},ls=s?.projection?.localStatic||{};
      return Boolean(s?.ready && Number(s?.zoom?.scaleIndex)===9 &&
        Number(r.pendingPreparationCount||0)===0 &&
        (!r.requestedSignature || r.standInActive || String(r.activeSignature||'')===String(r.requestedSignature||'')) &&
        (ls.revealTier==='full'||ls.revealTier==='refined'));
    """, 240)
    time.sleep(.8)


def fixed_navigation_sequence(d):
    # Same deterministic camera/scale sequence for every engine/backend run.
    d.execute_script("window.PlanetStage.setScaleIndex(7);")
    time.sleep(.35)
    d.execute_script("window.PlanetStage.setRotation(-15,-8);")
    time.sleep(.35)
    d.execute_script("window.PlanetStage.setRotation(-18,-10);")
    time.sleep(.35)
    d.execute_script("window.PlanetStage.setScaleIndex(9);")
    time.sleep(.55)
    settle_ground(d)


def fixed_engine_comparison_sequence(d):
    # Lightweight identical map-scale path for the 2.22.3 -> 2.23.0 engine A/B.
    # Older-engine SwiftShader WebGPU can crash Chrome when the full ground-detail
    # scene is materialized. Current-engine backend visual parity still uses ground.
    apply_evidence_time(d)
    d.execute_script("""
      window.PlanetStage.setScaleIndex(3);
      window.PlanetStage.setRotation(-15,-8);
    """)
    wait(d, "return Number(window.PlanetStage?.snapshot?.()?.zoom?.scaleIndex)===3", 120)
    time.sleep(.45)
    d.execute_script("""
      window.PlanetStage.setRotation(-18,-10);
      window.PlanetStage.setScaleIndex(4);
    """)
    wait(d, "return Number(window.PlanetStage?.snapshot?.()?.zoom?.scaleIndex)===4", 120)
    # A fair engine/backend map A/B must compare the same ready terrain resource,
    # not whichever parent/child happens to have finished on a slower adapter.
    wait(d, """
      const s=window.PlanetStage?.snapshot?.()||{},r=s.projection?.resourceBudget||{};
      return Number(s.zoom?.scaleIndex)===4 &&
        Number(r.pendingPreparationCount||0)===0 &&
        (!r.requestedSignature ||
          (Boolean(r.activeSignature) && String(r.activeSignature)===String(r.requestedSignature)));
    """, 240)
    wait_for_presentation_frames(d, 4)


def percentile(values, p):
    if not values:
        return None
    vals = sorted(float(v) for v in values)
    idx = min(len(vals)-1, max(0, int((len(vals)*p + .999999)) - 1))
    return vals[idx]


def sample_performance(d, count=30):
    rows=[]
    for _ in range(count):
        row=d.execute_script("return window.PlanetStage?.snapshot?.()?.rendererBackend?.performance||null")
        if row:
            rows.append(row)
        time.sleep(.05)
    def nums(key):
        out=[]
        for row in rows:
            v=row.get(key)
            if isinstance(v,(int,float)):
                out.append(float(v))
        return out
    frame=nums("latestFrameMs")
    if not frame:
        frame=nums("medianFrameMs")
    update=nums("cpuUpdateMs")
    render=nums("cpuRenderMs")
    gpu=nums("gpuFrameMs")
    draw=nums("drawCalls")
    return {
        "samples":len(rows),
        "source": rows[-1].get("source") if rows else None,
        "appStatsPublicApi": bool(rows and rows[-1].get("appStatsPublicApi")),
        "frameMedianMs": statistics.median(frame) if frame else None,
        "frameP95Ms": percentile(frame,.95),
        "frameWorstMs": max(frame) if frame else None,
        "cpuUpdateMedianMs": statistics.median(update) if update else None,
        "cpuRenderMedianMs": statistics.median(render) if render else None,
        "gpuFrameMedianMs": statistics.median(gpu) if gpu else None,
        "drawCallsMedian": statistics.median(draw) if draw else None,
        "primitiveCountLatest": rows[-1].get("primitiveCount") if rows else None,
        "vramTotalBytes": rows[-1].get("vramTotalBytes") if rows else None,
        "vramTextureBytes": rows[-1].get("vramTextureBytes") if rows else None,
        "vramVertexBufferBytes": rows[-1].get("vramVertexBufferBytes") if rows else None,
        "vramIndexBufferBytes": rows[-1].get("vramIndexBufferBytes") if rows else None,
        "vramUniformBufferBytes": rows[-1].get("vramUniformBufferBytes") if rows else None,
        "vramStorageBufferBytes": rows[-1].get("vramStorageBufferBytes") if rows else None,
        "shaderSwitchesLatest": rows[-1].get("shaderSwitches") if rows else None,
        "materialSwitchesLatest": rows[-1].get("materialSwitches") if rows else None,
        "gpuPassTotalMs": rows[-1].get("gpuPassTotalMs") if rows else None,
        "gpuTimestampTimingsAvailable": bool(rows and rows[-1].get("gpuTimestampTimingsAvailable")),
        "viewport": rows[-1].get("viewport") if rows else None,
    }


def navigation_streaming_snapshot(d):
    return d.execute_script("""
      const s=window.PlanetStage?.snapshot?.()||{},n=s.navigationPerformance||{},r=s.projection?.resourceBudget||{};
      return {
        navigation:{
          maxFrameUpdateMs:n.maxFrameUpdateMs??null,
          maxRenderCpuMs:n.maxRenderCpuMs??null,
          maxSemanticUpdateMs:n.maxSemanticUpdateMs??null,
          liveProjectionMaxMs:n.liveProjectionMaxMs??null,
          liveProjectionOver8MsCount:n.liveProjectionOver8MsCount??null,
          frameUpdateOver50Count:n.frameUpdateOver50Count??null,
          renderCpuOver50Count:n.renderCpuOver50Count??null,
          streamingRequestDeferredCount:n.streamingRequestDeferredCount??null,
          pointerSettleStreamingRefreshCount:n.pointerSettleStreamingRefreshCount??null
        },
        streaming:{
          lastBuildMs:r.lastBuildMs??null,
          lastPreparationWallMs:r.lastPreparationWallMs??null,
          maxPreparationSliceMs:r.maxPreparationSliceMs??null,
          maxFinalizeMs:r.maxFinalizeMs??null,
          maxSwapMs:r.maxSwapMs??null,
          maxFrameMsDuringPreparation:r.maxFrameMsDuringPreparation??null,
          recentMaxFrameMs:r.recentMaxFrameMs??null,
          cacheHits:r.cacheHits??null,
          cacheMisses:r.cacheMisses??null,
          prewarmHits:r.prewarmHits??null,
          prewarmCompleted:r.prewarmCompleted??null,
          pendingPreparationCount:r.pendingPreparationCount??null,
          missingCoverageCount:r.missingCoverageCount??null,
          longestHandoffLatencyMs:r.longestHandoffLatencyMs??null
        }
      };
    """)


def backend_record(d, label):
    s = snap(d)
    rb = s.get("rendererBackend") or {}
    badge = d.execute_script("""
      const n=document.querySelector('.renderer-backend-debug');
      return n?{text:n.textContent,active:n.dataset.active,requested:n.dataset.requested,selection:n.dataset.selection,rect:(()=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}})()}:null;
    """)
    root = d.execute_script("""
      const r=document.getElementById('planetStageRoot');
      return r?{requested:r.dataset.rendererRequestedBackend,active:r.dataset.rendererActiveBackend,selection:r.dataset.rendererBackendSelection,fallback:r.dataset.rendererFallbackReason||null,webgpu:r.dataset.rendererWebgpuAvailable}:null;
    """)
    atmosphere=s.get("atmosphere") or {}
    quality=d.execute_script("""
      const r=window.RuntimeRenderQuality?.snapshot?.()||null,t=window.RuntimeTextureQuality?.snapshot?.()||null;
      let storedRender=null,storedTexture=null;
      try{
        storedRender=localStorage.getItem('the-advisor-game:render-quality-mode');
        storedTexture=localStorage.getItem('the-advisor-game:texture-quality-profile');
      }catch(_){}
      return {
        render:r
          ?{mode:r.mode||storedRender||null,activeLevel:r.activeLevel||null,maxPixelRatio:r.maxPixelRatio??null,renderScale:r.renderScale??null,targetFps:r.targetFps??null,apiAvailable:true,source:"runtime-api"}
          :{mode:storedRender||null,activeLevel:storedRender||null,maxPixelRatio:null,renderScale:null,targetFps:null,apiAvailable:false,source:"persisted-test-input"},
        texture:t
          ?{qualityProfile:t.qualityProfile||storedTexture||null,cacheSignature:t.cacheSignature||null,maxMaterialTextureResolution:t.maxMaterialTextureResolution??null,anisotropy:t.anisotropy??null,apiAvailable:true,source:"runtime-api"}
          :{qualityProfile:storedTexture||null,cacheSignature:null,maxMaterialTextureResolution:null,anisotropy:null,apiAvailable:false,source:"persisted-test-input"}
      };
    """)
    return {
        "label": label,
        "engineVersion": s.get("engineVersion"),
        "activeSeed": s.get("activeSeed"),
        "geographyHash": s.get("geographyHash"),
        "focusTile": (s.get("canonicalFocus") or {}).get("worldTile"),
        "rotation": s.get("rotation"),
        "zoom": {
            "scaleIndex": (s.get("zoom") or {}).get("scaleIndex"),
            "scaleLabel": (s.get("zoom") or {}).get("scaleLabel"),
            "visibleFootprintHeightMeters": (s.get("zoom") or {}).get("visibleFootprintHeightMeters"),
        },
        "terrainSignature": ((s.get("projection") or {}).get("resourceBudget") or {}).get("activeSignature"),
        "terrainRequestedSignature": ((s.get("projection") or {}).get("resourceBudget") or {}).get("requestedSignature"),
        "terrainVisibleLevel": ((s.get("projection") or {}).get("resourceBudget") or {}).get("visibleLevel"),
        "terrainRequestedLevel": ((s.get("projection") or {}).get("resourceBudget") or {}).get("requestedLevel"),
        "terrainPendingPreparationCount": ((s.get("projection") or {}).get("resourceBudget") or {}).get("pendingPreparationCount"),
        "localSignature": ((s.get("projection") or {}).get("localStatic") or {}).get("signature"),
        "localRevealTier": ((s.get("projection") or {}).get("localStatic") or {}).get("revealTier"),
        "localStaticActive": bool(((s.get("projection") or {}).get("localStatic") or {}).get("active")),
        "backend": rb,
        "badge": badge,
        "rootDataset": root,
        "comparisonContext": {
            "evidenceTime": EVIDENCE_TIME,
            "atmosphere": {
                "authoritativeHour": atmosphere.get("authoritativeHour"),
                "phase": atmosphere.get("phase"),
                "keyIntensity": atmosphere.get("keyIntensity"),
                "fillIntensity": atmosphere.get("fillIntensity"),
                "ambient": atmosphere.get("ambient"),
                "sky": atmosphere.get("sky"),
            },
            "quality": quality,
            "viewport": (rb.get("performance") or {}).get("viewport"),
        },
        "worldVisualStyle": s.get("worldVisualStyleIntegration"),
        "simulationAuthorityPreserved": bool(rb.get("simulationAuthority") is False),
    }


def run_success(label, gpu_mode, expected, engine=CURRENT_ENGINE, ground=True, disable_webgpu=False, build="release", viewport=(1280,800), lightweight_engine_compare=False):
    d = driver_for(disable_webgpu=disable_webgpu, viewport=viewport)
    try:
        d.get(url_with({
            "gpu": gpu_mode,
            "dev": "1",
            "pc_version": engine if engine == BASELINE_ENGINE else None,
            "pc_build": build if build != "release" else None,
            "evidence_fast_start": "1",
            "evidence_skip_destinations": "1",
        }))
        wait(d, "return document.readyState==='complete'", 60)
        wait(d, "return window.PlanetStage?.snapshot?.()?.ready===true", 240)
        wait(d, "return Boolean(document.querySelector('.renderer-backend-debug'))", 30)
        if lightweight_engine_compare:
            navigation_before=navigation_streaming_snapshot(d)
            fixed_engine_comparison_sequence(d)
        else:
            if ground:
                settle_ground(d)
            navigation_before=navigation_streaming_snapshot(d)
            fixed_navigation_sequence(d)
        navigation_after=navigation_streaming_snapshot(d)
        perf=sample_performance(d)
        apply_evidence_time(d)
        wait_for_presentation_frames(d, 4)
        rec = backend_record(d, label)
        rec["performanceSequence"]=perf
        rec["navigationStreamingSequence"]={"before":navigation_before,"after":navigation_after}
        active = (rec["backend"] or {}).get("active")
        if active != expected:
            raise AssertionError(f"{label}: expected {expected}, got {active}: {rec}")
        if rec["engineVersion"] != engine:
            raise AssertionError(f"{label}: expected engine {engine}, got {rec['engineVersion']}")
        if rec["activeSeed"] != SEED:
            raise AssertionError(f"{label}: seed mismatch {rec['activeSeed']}")
        if rec["simulationAuthorityPreserved"] is not True:
            raise AssertionError(f"{label}: renderer backend escaped presentation-only authority: {rec['backend']}")
        if not rec["badge"] or expected.upper() not in rec["badge"]["text"].upper():
            raise AssertionError(f"{label}: developer backend badge missing active backend: {rec['badge']}")
        if engine == CURRENT_ENGINE and CURRENT_ENGINE not in rec["badge"]["text"]:
            raise AssertionError(f"{label}: developer badge missing engine version: {rec['badge']}")
        if gpu_mode == "auto" and expected == "webgpu" and (rec["backend"] or {}).get("selection") != "preferred":
            raise AssertionError(f"{label}: auto WebGPU was not marked preferred: {rec}")
        if gpu_mode == "auto" and expected == "webgl2" and not (rec["backend"] or {}).get("fallbackReason"):
            raise AssertionError(f"{label}: fallback reason missing: {rec}")
        if gpu_mode != "auto" and (rec["backend"] or {}).get("selection") != "developer-forced test":
            raise AssertionError(f"{label}: forced backend not marked developer-forced: {rec}")
        if int((rec["backend"].get("performance") or {}).get("sampleCount") or 0) < 10:
            raise AssertionError(f"{label}: insufficient performance samples: {rec['backend'].get('performance')}")
        quality=(rec.get("comparisonContext") or {}).get("quality") or {}
        render_quality=quality.get("render") or {}
        texture_quality=quality.get("texture") or {}
        if render_quality.get("mode") != "standard" or render_quality.get("activeLevel") != "standard":
            raise AssertionError(f"{label}: render quality test input was not pinned to standard: {render_quality}")
        if texture_quality.get("qualityProfile") != "standard":
            raise AssertionError(f"{label}: texture quality test input was not pinned to standard: {texture_quality}")
        viewport=(rec.get("backend") or {}).get("performance",{}).get("viewport") or {}
        if not viewport or viewport.get("maxPixelRatio") is None or viewport.get("renderScale") is None:
            raise AssertionError(f"{label}: effective renderer quality telemetry missing: {viewport}")
        if engine == CURRENT_ENGINE and perf.get("appStatsPublicApi") is not True:
            raise AssertionError(f"{label}: PlayCanvas 2.23 public AppStats not active: {perf}")
        path = OUT / f"{label}.png"
        if not d.save_screenshot(str(path)):
            raise RuntimeError(f"screenshot failed: {path}")
        rec["screenshot"] = path.name
        rec["surfaceDiagnostics"] = render_surface_diagnostics(d)
        rec["browserLogs"] = browser_logs(d)
        rec["diagnostics"] = persist_run_diagnostics(label, rec)
        return rec
    except Exception as error:
        diagnostic={
            "label":label,
            "error":repr(error),
            "surfaceDiagnostics":render_surface_diagnostics(d),
            "browserLogs":browser_logs(d),
        }
        try:
            failure_path=OUT/f"{label}-failure.png"
            if d.save_screenshot(str(failure_path)):
                diagnostic["failureScreenshot"]=failure_path.name
        except Exception as screenshot_error:
            diagnostic["failureScreenshotError"]=repr(screenshot_error)
        persist_run_diagnostics(label, diagnostic)
        raise
    finally:
        d.quit()


def run_forced_webgpu_failure():
    d = driver_for(disable_webgpu=True)
    try:
        d.get(url_with({
            "gpu": "webgpu",
            "dev": "1",
            "evidence_fast_start": "1",
            "evidence_skip_destinations": "1",
        }))
        wait(d, """
          const r=document.getElementById('planetStageRoot');
          return Boolean(r?.dataset?.error || (r?.dataset?.rendererBackendSelection||'').includes('failed'));
        """, 180)
        state = d.execute_script("""
          const r=document.getElementById('planetStageRoot'),n=document.querySelector('.renderer-backend-debug');
          return {error:r?.dataset?.error||null,selection:r?.dataset?.rendererBackendSelection||null,fallback:r?.dataset?.rendererFallbackReason||null,badge:n?.textContent||null};
        """)
        if "forced WebGPU" not in str(state.get("error")) and "forced WebGPU" not in str(state.get("fallback")):
            raise AssertionError(f"forced-WebGPU failure was not explicit: {state}")
        path = OUT / "07-forced-webgpu-unavailable.png"
        d.save_screenshot(str(path))
        state["screenshot"] = path.name
        return state
    finally:
        d.quit()


def run_normal_mode_saved_force_ignored():
    d = driver_for(saved_backend="webgl2")
    try:
        d.get(url_with({
            "evidence_fast_start": "1",
            "evidence_skip_destinations": "1",
        }))
        wait(d, "return window.PlanetStage?.snapshot?.()?.ready===true", 240)
        state=d.execute_script("""
          const s=window.PlanetStage.snapshot(),rb=s.rendererBackend||{};
          return {
            requested:rb.requested||null,
            active:rb.active||null,
            forced:Boolean(rb.forced),
            requestSource:rb.requestSource||null,
            developerMode:Boolean(rb.developerMode),
            badge:Boolean(document.querySelector('.renderer-backend-debug')),
            seed:s.activeSeed||null,
            geographyHash:s.geographyHash||null
          };
        """)
        if state.get("active") != "webgpu" or state.get("requested") != "auto" or state.get("forced") is not False:
            raise AssertionError(f"normal mode did not restore Auto/WebGPU-first after saved developer force: {state}")
        if state.get("developerMode") is not False or state.get("badge") is not False:
            raise AssertionError(f"normal mode exposed developer backend UI: {state}")
        path=OUT/"12-normal-mode-auto-after-saved-force.png"
        d.save_screenshot(str(path))
        state["screenshot"]=path.name
        return state
    finally:
        d.quit()


def run_device_loss():
    d=driver_for()
    try:
        d.get(url_with({
            "gpu":"webgpu","dev":"1","pc_build":"debug",
            "evidence_fast_start":"1","evidence_skip_destinations":"1"
        }))
        ready_started=time.time()
        try:
            wait(d,"return window.PlanetStage?.snapshot?.()?.ready===true",240)
        except Exception as error:
            timeout_state=d.execute_script("""
              const root=document.getElementById('planetStageRoot');
              const loading=root?.querySelector?.('.planet-stage-loading');
              return {
                elapsedSeconds: arguments[0],
                documentReadyState: document.readyState,
                rootDataset: root ? {...root.dataset} : null,
                loadingText: loading?.innerText||null,
                backendPolicy: window.RendererBackendPolicy?.snapshot?.()||null,
                planetSnapshot: window.PlanetStage?.snapshot?.()||null
              };
            """, round(time.time()-ready_started,3))
            timeout_state["renderSurface"]=render_surface_diagnostics(d)
            timeout_state["browserLogs"]=browser_logs(d)
            timeout_state["error"]=repr(error)
            timeout_state["engineUrl"]="bundled debug ESM"
            persist_run_diagnostics("08-device-loss-pre-ready-timeout", timeout_state)
            try:
                d.save_screenshot(str(OUT/"08-device-loss-pre-ready-timeout.png"))
            except Exception:
                pass
            raise
        settle_ground(d)
        before=backend_record(d,"device-loss-before")
        if before["engineVersion"] != CURRENT_ENGINE or before["backend"].get("active")!="webgpu":
            raise AssertionError(f"device-loss debug run not on 2.23 WebGPU: {before}")
        pre=OUT/"08-device-loss-before.png"
        d.save_screenshot(str(pre))
        result=d.execute_async_script("""
          const done=arguments[arguments.length-1];
          window.RendererBackendPolicy.testDeviceLoss(650).then(done).catch(e=>done({error:String(e)}));
        """)
        if not result or result.get("supported") is not True or result.get("recovered") is not True:
            raise AssertionError(f"device-loss recovery failed/unavailable: {result}")
        wait(d,"return window.PlanetStage?.snapshot?.()?.ready===true",60)
        time.sleep(.75)
        after=backend_record(d,"device-loss-after")
        if after["activeSeed"]!=before["activeSeed"] or after["geographyHash"]!=before["geographyHash"] or after["focusTile"]!=before["focusTile"]:
            raise AssertionError(f"device loss changed deterministic world truth: before={before} after={after}")
        post=OUT/"09-device-loss-after.png"
        d.save_screenshot(str(post))
        return {"result":result,"before":before,"after":after,"beforeScreenshot":pre.name,"afterScreenshot":post.name}
    finally:
        d.quit()



def run_baseline_webgpu():
    crashes=[]
    for attempt in range(1,3):
        try:
            record=run_success("02-baseline-2223-map-webgpu", "webgpu", "webgpu", engine=BASELINE_ENGINE, ground=False, lightweight_engine_compare=True)
            return {
                "attempted":True,
                "available":True,
                "status":"completed",
                "attempts":attempt,
                "record":record,
                "failure":None,
            }
        except WebDriverException as exc:
            message=str(exc)
            if "tab crashed" not in message.lower() and "page crash" not in message.lower():
                raise
            crashes.append({"attempt":attempt,"error":message})
    return {
        "attempted":True,
        "available":False,
        "status":"historical-baseline-browser-crash",
        "attempts":len(crashes),
        "record":None,
        "failure":{
            "kind":"chrome-webgpu-tab-crash",
            "engineVersion":BASELINE_ENGINE,
            "backend":"webgpu",
            "ciAdapter":"SwiftShader",
            "crashes":crashes,
            "interpretation":"The historical PlayCanvas 2.22.3 WebGPU baseline could not complete the identical CI workload because the browser tab crashed twice. This is recorded as a baseline stability result, not silently converted into performance data; current 2.23.0 WebGPU remains mandatory.",
        },
    }

def compare_truth(records, require_local_static=False):
    base = records[0]
    for r in records[1:]:
        if r["activeSeed"] != base["activeSeed"] or r["geographyHash"] != base["geographyHash"]:
            raise AssertionError(f"backend/engine changed world identity: {base['label']} vs {r['label']}")
        if (
            r.get("terrainSignature") != base.get("terrainSignature") or
            r.get("terrainVisibleLevel") != base.get("terrainVisibleLevel") or
            r.get("terrainRequestedLevel") != base.get("terrainRequestedLevel")
        ):
            raise AssertionError(f"backend/engine changed terrain presentation identity: {base['label']} vs {r['label']}")
        if require_local_static and (
            r["localSignature"] != base["localSignature"] or
            r["localRevealTier"] != base["localRevealTier"] or
            r.get("localStaticActive") != base.get("localStaticActive")
        ):
            raise AssertionError(f"backend/engine changed required static-world presentation identity: {base['label']} vs {r['label']}")
        if r["focusTile"] != base["focusTile"] or r["zoom"] != base["zoom"] or r["rotation"] != base["rotation"]:
            raise AssertionError(f"backend/engine comparison scene mismatch: {base['label']} vs {r['label']}")
        bc=base.get("comparisonContext") or {}
        rc=r.get("comparisonContext") or {}
        if rc.get("evidenceTime") != bc.get("evidenceTime") or rc.get("atmosphere") != bc.get("atmosphere"):
            raise AssertionError(f"backend/engine comparison lighting mismatch: {base['label']} vs {r['label']}")
        if rc.get("viewport") != bc.get("viewport") or rc.get("quality") != bc.get("quality"):
            raise AssertionError(f"backend/engine comparison viewport/quality mismatch: {base['label']} vs {r['label']}")


def screenshot_parity_metrics(path_a, path_b):
    with Image.open(path_a) as source_a, Image.open(path_b) as source_b:
        a=source_a.convert("RGB")
        b=source_b.convert("RGB")
        if a.size != b.size:
            raise AssertionError(f"visual parity screenshot size mismatch: {a.size} vs {b.size}")
        width,height=a.size
        # Compare the gameplay surface while excluding intentional backend badge
        # text and the densest edge UI. This is an automated regression guard;
        # direct screenshot inspection remains the source of the visual score.
        crop_box=(round(width*.15),round(height*.12),round(width*.85),round(height*.82))
        diff=ImageChops.difference(a.crop(crop_box),b.crop(crop_box))
        stat=ImageStat.Stat(diff)
        mean_abs=sum(stat.mean)/len(stat.mean)
        rms=(sum(value*value for value in stat.rms)/len(stat.rms))**.5
        return {
            "cropBox":list(crop_box),
            "meanAbs":round(mean_abs,4),
            "rms":round(rms,4),
            "thresholdMeanAbs":1.0,
        }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"wp":"WP-S003-001-002-001","testedHead":TESTED_HEAD,"seed":SEED,"pass":False,"records":[]}
    try:
        report["retainedBootstrapPolicy"]=verify_retained_bootstrap_policy()
        # Fail fast on the one remaining acceptance gate. If this succeeds,
        # the unchanged full engine/backend/mobile matrix still runs below.
        device_loss = run_device_loss()
        baseline_gl = run_success("01-baseline-2223-map-webgl2", "webgl2", "webgl2", engine=BASELINE_ENGINE, ground=False, lightweight_engine_compare=True)
        baseline_gpu_result = run_baseline_webgpu()
        baseline_gpu = baseline_gpu_result.get("record")
        current_engine_gl = run_success("03-current-2230-map-webgl2", "webgl2", "webgl2", ground=False, lightweight_engine_compare=True)
        current_engine_gpu = run_success("04-current-2230-map-webgpu", "webgpu", "webgpu", ground=False, lightweight_engine_compare=True)
        map_visual_parity=screenshot_parity_metrics(OUT/current_engine_gl["screenshot"],OUT/current_engine_gpu["screenshot"])
        report["visualParityMetrics"]={"mapWebgl2VsWebgpu":map_visual_parity}
        if map_visual_parity["meanAbs"] > map_visual_parity["thresholdMeanAbs"]:
            raise AssertionError(f"regional-map backend visual parity exceeded threshold: {map_visual_parity}")
        auto = run_success("05-current-2230-auto-webgpu-ground", "auto", "webgpu")
        forced_gpu = run_success("06-current-2230-webgpu-ground", "webgpu", "webgpu")
        forced_gl = run_success("07-current-2230-webgl2-ground", "webgl2", "webgl2")
        ground_visual_parity=screenshot_parity_metrics(OUT/forced_gpu["screenshot"],OUT/forced_gl["screenshot"])
        report["visualParityMetrics"]["groundWebgpuVsWebgl2"]=ground_visual_parity
        if ground_visual_parity["meanAbs"] > ground_visual_parity["thresholdMeanAbs"]:
            raise AssertionError(f"ground backend visual parity exceeded threshold: {ground_visual_parity}")
        fallback = run_success("08-current-2230-auto-fallback-ground", "auto", "webgl2", disable_webgpu=True)
        failure = run_forced_webgpu_failure()
        normal_mode = run_normal_mode_saved_force_ignored()
        mobile_gpu = run_success("10-current-2230-mobile-webgpu", "webgpu", "webgpu", viewport=(844,390))
        mobile_gl = run_success("11-current-2230-mobile-webgl2", "webgl2", "webgl2", viewport=(844,390))
        engine_records=[baseline_gl]
        if baseline_gpu:
            engine_records.append(baseline_gpu)
        engine_records.extend([current_engine_gl,current_engine_gpu])
        ground_records=[auto,forced_gpu,forced_gl,fallback]
        records=engine_records+ground_records
        compare_truth(engine_records, require_local_static=False)
        compare_truth(ground_records, require_local_static=True)
        compare_truth([mobile_gpu,mobile_gl], require_local_static=True)
        report["records"]=records
        report["baselineWebgpu"]=baseline_gpu_result
        report["mobileRecords"]=[mobile_gpu,mobile_gl]
        report["forcedWebgpuFailure"]=failure
        report["normalModeSavedForceReset"]=normal_mode
        report["deviceLoss"]=device_loss
        report["engineComparison"]={
            "scene":"identical deterministic map-scale engine comparison",
            "webgl2":{"baseline":baseline_gl["performanceSequence"],"current":current_engine_gl["performanceSequence"]},
            "webgpu":{
                "baseline":baseline_gpu["performanceSequence"] if baseline_gpu else None,
                "baselineStatus":baseline_gpu_result.get("status"),
                "baselineFailure":baseline_gpu_result.get("failure"),
                "current":current_engine_gpu["performanceSequence"],
            },
            "noAssumedWinner":True,
        }
        report["comparisonContext"]=baseline_gl["comparisonContext"]
        report["backendParity"]={
            "sameSeed":True,
            "sameGeographyHash":True,
            "sameFocusTile":True,
            "sameRotation":True,
            "sameZoom":True,
            "sameLocalPresentationIdentity":True,
            "simulationAuthorityPreserved":all(r["simulationAuthorityPreserved"] for r in records+[mobile_gpu,mobile_gl]),
            "engineComparisonSceneParity":True,
            "groundBackendSceneParity":True,
            "baselineWebgpuAccountedFor":baseline_gpu_result.get("status") in {"completed","historical-baseline-browser-crash"},
            "sameViewportAndQuality":True,
            "sameLightingState":True,
            "webgpuActive":auto["backend"]["active"]=="webgpu" and forced_gpu["backend"]["active"]=="webgpu",
            "webgl2Active":forced_gl["backend"]["active"]=="webgl2",
            "fallbackActive":fallback["backend"]["active"]=="webgl2" and bool(fallback["backend"].get("fallbackReason")),
            "normalModeIgnoresSavedDeveloperForce":normal_mode.get("active")=="webgpu" and normal_mode.get("requested")=="auto" and normal_mode.get("badge") is False,
            "deviceLossRecovered":bool(device_loss["result"].get("recovered")),
            "mobileViewportBackendParity":mobile_gpu["comparisonContext"]==mobile_gl["comparisonContext"] and mobile_gpu["activeSeed"]==mobile_gl["activeSeed"] and mobile_gpu["geographyHash"]==mobile_gl["geographyHash"],
        }
        report["mobileConfigurationEvidence"]={
            "viewportCssTarget":{"width":844,"height":390},
            "browserEngine":"desktop Chrome mobile-sized viewport",
            "realMobileGpu":False,
            "limitation":"CI evidence validates mobile-layout/backend parity only; it is not a substitute for real mobile/tablet GPU performance measurements.",
            "webgpuScreenshot":mobile_gpu.get("screenshot"),
            "webgl2Screenshot":mobile_gl.get("screenshot"),
        }
        report["entitylessEvaluation"]={
            "adopted":False,
            "reason":"No new entityless rewrite in this WP: existing high-count wilderness uses one batched MeshInstance and fauna is bounded; changing low-count interactive/static entities without a measured candidate would add complexity without evidence.",
            "followUpOnlyIfMeasuredHotspot":True,
        }
        report["pass"]=all(report["backendParity"].values())
    except Exception as exc:
        report["error"]=repr(exc)
        raise
    finally:
        (OUT/"evidence.json").write_text(json.dumps(report,indent=2,sort_keys=True),encoding="utf-8")
        print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
