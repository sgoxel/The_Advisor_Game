#!/usr/bin/env python3
"""Capture and publish visual-review screenshots for The Advisor Game.

This is the shared screenshot utility for all project AI agents.

Defaults:
- landscape: 1920x1080
- portrait: 1080x1920
- maximum camera zoom-out before capture when the game exposes
  window.Game.State.camera.minZoom
- screenshots saved under tools/screenshots/
- successful local/manual captures publish to GitHub main unless --no-publish

Multi-shot timestamp naming:
  phone-1-20260918T145912123Z.png
  phone-2-20260918T145912123Z.png

Examples:
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ landscape --profile landscape --shots 2 --interval 0.2 --timestamp-names
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ phone --profile portrait --shots 2 --interval 0.2 --timestamp-names
  python tools/screenshot_tool.py index.html local-check.png --no-publish
  python tools/screenshot_tool.py http://127.0.0.1:8000/ issue-350 --scenario camera-pan-zoom --evidence-json issue-350.json --issue 350 --no-publish

GitHub-agent trigger:
  Comment on the selected Issue: /visual-evidence <scenario>

Supported scenarios:
  static, panel-cycle, camera-pan, camera-zoom, camera-pan-zoom,
  responsive-cycle, motion-sequence, time-of-day, village-reference,
  region-transition, save-load, npc-conversation-state, npc-edge-crossing
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

REPOSITORY_SLUG = "sgoxel/The_Advisor_Game"
DEFAULT_PUBLISH_BRANCH = "main"
GITHUB_BASE_URL = f"https://github.com/{REPOSITORY_SLUG}"

PROFILES = {
    "landscape": (1920, 1080),
    "portrait": (1080, 1920),
    # Backward-compatible aliases used by existing project automation/agents.
    "tablet": (1920, 1080),
    "phone": (1080, 1920),
}

DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080

SCENARIOS = {
    "static",
    "panel-cycle",
    "camera-pan",
    "camera-zoom",
    "camera-pan-zoom",
    "responsive-cycle",
    "motion-sequence",
    "time-of-day",
    "village-reference",
    "region-transition",
    "save-load",
    "npc-conversation-state",
    "npc-edge-crossing",
}

SCENARIO_MIN_SHOTS = {
    "static": 1,
    "panel-cycle": 4,
    "camera-pan": 3,
    "camera-zoom": 3,
    "camera-pan-zoom": 4,
    "responsive-cycle": 3,
    "motion-sequence": 6,
    "time-of-day": 3,
    "village-reference": 3,
    "region-transition": 3,
    "save-load": 3,
    "npc-conversation-state": 5,
    "npc-edge-crossing": 5,
}

MAX_ZOOM_OUT_SCRIPT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const game = window.Game;
    const state = game?.State;
    const camera = state?.camera;
    const renderer = game?.Renderer;

    if (!camera) {
      done({ok: false, reason: 'camera-not-found'});
      return;
    }
    if (typeof camera.minZoom !== 'number') {
      done({ok: false, reason: 'minZoom-not-found'});
      return;
    }

    camera.zoom = camera.minZoom;
    if (typeof renderer?.centerCamera === 'function') {
      try { renderer.centerCamera(); } catch (_) {}
    }
    if (typeof renderer?.markDirty === 'function') {
      try { renderer.markDirty(true, true); } catch (_) {}
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    done({ok: true, zoom: camera.zoom, minZoom: camera.minZoom});
  } catch (error) {
    done({ok: false, reason: String(error)});
  }
})();
"""

CONTROLLED_STATE_SCRIPT = r"""
const action = arguments[0];
return (() => {
  const game = window.Game || {};
  const state = game.State || {};
  const world = state.world || {};
  const bag = window.__advisorVisualEvidence = window.__advisorVisualEvidence || {};

  const rerender = () => {
    try { game.Renderer?.invalidateAll?.(); } catch (_) {}
    try { game.Renderer?.markDirty?.(true, true); } catch (_) {}
    try { game.Renderer?.renderWorld?.(true); } catch (_) {}
    try { game.Minimap?.render?.(); } catch (_) {}
    try { game.Minimap?.renderMinimap?.(); } catch (_) {}
  };
  const time = (minutes) => {
    if (typeof game.GameTime?.setForTest !== 'function') throw new Error('GameTime.setForTest unavailable');
    const result = game.GameTime.setForTest(minutes);
    rerender();
    return result;
  };
  const setZoom = (value) => {
    const camera = state.camera;
    if (!camera) throw new Error('camera unavailable');
    camera.zoom = Math.max(
      Number(camera.minZoom ?? value),
      Math.min(Number(camera.maxZoom ?? value), Number(value))
    );
    try { game.Renderer?.centerCamera?.(); } catch (_) {}
    rerender();
    return camera.zoom;
  };
  const requireNpcs = () => {
    const npcs = Array.isArray(world.npcs) ? world.npcs.filter(n => n && n.active !== false && n.removed !== true) : [];
    if (npcs.length < 2) throw new Error('at least two active NPCs required');
    return npcs;
  };
  const conversationPair = () => {
    const npcs = requireNpcs();
    const ids = bag.conversationNpcIds || [String(npcs[0].id), String(npcs[1].id)];
    bag.conversationNpcIds = ids;
    const a = world.npcs.find(n => String(n.id) === ids[0]);
    const b = world.npcs.find(n => String(n.id) === ids[1]);
    if (!a || !b) throw new Error('controlled conversation NPCs unavailable');
    return [a, b];
  };
  const placePair = (mode) => {
    const [a, b] = conversationPair();
    const player = world.player || {};
    const rows = Math.max(6, Number(world.rows || 100));
    const cols = Math.max(8, Number(world.cols || 100));
    const row = Math.max(1, Math.min(rows - 2, Number(player.row || 10)));
    const col = Math.max(1, Math.min(cols - 5, Number(player.col || 10) + 2));
    const region = world.currentRegion || {};
    const rx = Number(region.x ?? player.regionX ?? 0);
    const ry = Number(region.y ?? player.regionY ?? 0);
    Object.assign(a, { row, col, regionX: rx, regionY: ry, active: true, removed: false });
    Object.assign(b, { row, col: col + 1, regionX: rx, regionY: ry, active: true, removed: false });
    if (mode === 'isolated') {
      b.col = col + 4;
      a.dialogueWith = null; b.dialogueWith = null;
      a.activity = 'social'; b.activity = 'social';
    } else {
      a.dialogueWith = b.id; b.dialogueWith = a.id;
      a.activity = 'talking'; b.activity = 'talking';
      if (mode === 'same-tile') b.col = a.col;
      if (mode === 'nonadjacent') b.col = Math.min(cols - 1, a.col + 3);
      if (mode === 'missing-partner') {
        a.dialogueWith = '__missing_visual_evidence_partner__';
        b.dialogueWith = null;
      }
    }
    game.NPCIndoorWorkAnchors?.reconcileConversations?.();
    rerender();
    return { ids: [a.id, b.id], mode };
  };

  try {
    switch (action) {
      case 'time-day': return { ok: true, action, time: time(8 * 60) };
      case 'time-night': return { ok: true, action, time: time(23 * 60) };
      case 'time-dawn': return { ok: true, action, time: time(6 * 60) };

      case 'reference-day-wide':
        time(8 * 60);
        return { ok: true, action, zoom: setZoom(state.camera?.minZoom ?? state.camera?.zoom ?? 2) };
      case 'reference-close':
        time(8 * 60);
        return { ok: true, action, zoom: setZoom(Number(state.camera?.minZoom ?? 2) + 1) };
      case 'reference-night-wide':
        time(23 * 60);
        return { ok: true, action, zoom: setZoom(state.camera?.minZoom ?? state.camera?.zoom ?? 2) };

      case 'region-baseline':
        if (typeof game.RegionNavigation?.capture !== 'function') throw new Error('RegionNavigation.capture unavailable');
        return { ok: true, action, region: game.RegionNavigation.capture() };
      case 'region-east':
        if (typeof game.RegionNavigation?.activateNeighbor !== 'function') throw new Error('RegionNavigation.activateNeighbor unavailable');
        return { ok: true, action, region: game.RegionNavigation.activateNeighbor('east') };
      case 'region-west':
        if (typeof game.RegionNavigation?.activateNeighbor !== 'function') throw new Error('RegionNavigation.activateNeighbor unavailable');
        return { ok: true, action, region: game.RegionNavigation.activateNeighbor('west') };

      case 'save-baseline':
        if (typeof game.CampaignPersistence?.serializeSave !== 'function') throw new Error('CampaignPersistence.serializeSave unavailable');
        bag.savedCampaign = game.CampaignPersistence.serializeSave();
        return { ok: true, action, bytes: bag.savedCampaign.length };
      case 'save-mutate':
        if (typeof game.RegionNavigation?.activateNeighbor === 'function') game.RegionNavigation.activateNeighbor('east');
        else if (typeof game.GameTime?.advanceGameMinutes === 'function') game.GameTime.advanceGameMinutes(90);
        rerender();
        return { ok: true, action };
      case 'save-restore':
        if (!bag.savedCampaign || typeof game.CampaignPersistence?.loadSave !== 'function') throw new Error('saved campaign/loadSave unavailable');
        const loaded = game.CampaignPersistence.loadSave(bag.savedCampaign);
        if (!loaded?.ok) throw new Error('CampaignPersistence.loadSave rejected controlled save');
        rerender();
        return { ok: true, action };

      case 'npc-isolated': return { ok: true, action, state: placePair('isolated') };
      case 'npc-adjacent': return { ok: true, action, state: placePair('adjacent') };
      case 'npc-same-tile': return { ok: true, action, state: placePair('same-tile') };
      case 'npc-nonadjacent': return { ok: true, action, state: placePair('nonadjacent') };
      case 'npc-missing-partner': return { ok: true, action, state: placePair('missing-partner') };

      case 'npc-edge-baseline': {
        const npcs = requireNpcs();
        const npc = npcs[0];
        const player = world.player || {};
        const rows = Math.max(6, Number(world.rows || 100));
        const cols = Math.max(8, Number(world.cols || 100));
        npc.row = Math.max(1, Math.min(rows - 2, Number(player.row || 10)));
        npc.col = Math.max(1, Math.min(cols - 2, Number(player.col || 10) + 3));
        npc.regionX = Number(world.currentRegion?.x ?? player.regionX ?? 0);
        npc.regionY = Number(world.currentRegion?.y ?? player.regionY ?? 0);
        npc.active = true;
        npc.removed = false;
        bag.edgeNpcId = String(npc.id);
        try { game.Renderer?.centerCamera?.(); } catch (_) {}
        rerender();
        return { ok: true, action, npcId: bag.edgeNpcId };
      }

      default: return { ok: true, action: 'no-controlled-setup' };
    }
  } catch (error) {
    return { ok: false, action, reason: String(error) };
  }
})();
"""

RUNTIME_SNAPSHOT_SCRIPT = r"""
return (() => {
  try {
    const game = window.Game || {};
    const state = game.State || {};
    const camera = state.camera || {};
    const activePanel = document.querySelector('.bottom-ribbon .panel.active-panel');
    const canvas = document.querySelector('#gameCanvas');
    const rect = canvas?.getBoundingClientRect?.();
    let scheduler = null;
    try {
      scheduler = game.FrameBudgetScheduler?.metrics?.() || null;
    } catch (_) {}
    let npcRuntime = null;
    try {
      npcRuntime = game.NPCRuntimeBridge?.metrics?.() || game.NPCRelevanceRuntime?.metrics?.() || null;
    } catch (_) {}
    let gameTime = null;
    try { gameTime = game.GameTime?.capture?.() || world.gameTime || null; } catch (_) {}
    let region = null;
    try { region = game.RegionNavigation?.capture?.() || world.currentRegion || null; } catch (_) {}
    const visibleNpcCount = canvas?.dataset?.visibleNpcCount ?? null;
    const npcs = Array.isArray(world.npcs) ? world.npcs.slice(0, 8).map((npc) => {
      let screen = null;
      try {
        const point = game.Renderer?.gridToScreen?.(Number(npc.row), Number(npc.col), 0, 0);
        if (point) screen = { x: Number(point.x), y: Number(point.y) };
      } catch (_) {}
      return {
        id: npc?.id ?? null,
        row: Number.isFinite(Number(npc?.row)) ? Number(npc.row) : null,
        col: Number.isFinite(Number(npc?.col)) ? Number(npc.col) : null,
        regionX: Number.isFinite(Number(npc?.regionX)) ? Number(npc.regionX) : null,
        regionY: Number.isFinite(Number(npc?.regionY)) ? Number(npc.regionY) : null,
        activity: npc?.activity ?? null,
        dialogueWith: npc?.dialogueWith ?? null,
        conversationState: npc?.conversationState ?? null,
        screen,
      };
    }) : [];
    return {
      ok: true,
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      camera: {
        x: Number.isFinite(camera.x) ? camera.x : null,
        y: Number.isFinite(camera.y) ? camera.y : null,
        zoom: Number.isFinite(camera.zoom) ? camera.zoom : null,
        minZoom: Number.isFinite(camera.minZoom) ? camera.minZoom : null,
        maxZoom: Number.isFinite(camera.maxZoom) ? camera.maxZoom : null,
        dragActive: Boolean(camera.dragActive),
      },
      activePanel: activePanel?.dataset?.panelName || null,
      gameTime,
      region,
      npcConversationGuard: world.npcConversationGuard || null,
      npcPresentation: {
        visibleNpcCount,
        totalNpcCount: Array.isArray(world.npcs) ? world.npcs.length : 0,
        edgeNpcId: window.__advisorVisualEvidence?.edgeNpcId || null,
        sample: npcs,
      },
      canvas: rect ? {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      } : null,
      scheduler,
      npcRuntime,
    };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})();
"""


def normalize_target(target: str) -> str:
    """Return a browser-ready URL for a local path or supported URL."""
    value = target.strip()
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https", "file"}:
        return value
    if parsed.scheme and len(parsed.scheme) > 1:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")
    return path.as_uri()


def create_driver(width: int, height: int):
    """Create headless Chrome."""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise RuntimeError("Selenium is required: pip install selenium") from exc

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--hide-scrollbars")
    options.add_argument(f"--window-size={width},{height}")
    return webdriver.Chrome(options=options)


def screenshots_directory() -> Path:
    directory = Path(__file__).resolve().parent / "screenshots"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def utc_timestamp_ms() -> str:
    """Return a UTC timestamp including milliseconds, filename-safe."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")[:-3] + "Z"


def output_paths(filename: str, shots: int, timestamp_names: bool = False) -> list[Path]:
    """Build output paths under tools/screenshots/."""
    directory = screenshots_directory()
    name = Path(filename).name
    if not name:
        raise ValueError("Output filename is empty")

    path = Path(name)
    stem = path.stem if path.suffix else path.name
    if not stem:
        raise ValueError("Output filename stem is empty")

    if timestamp_names:
        stamp = utc_timestamp_ms()
        return [directory / f"{stem}-{index}-{stamp}.png" for index in range(1, shots + 1)]

    if shots == 1:
        if path.suffix.lower() != ".png":
            path = path.with_suffix(".png")
        return [directory / path.name]

    return [directory / f"{stem}_{index:02d}.png" for index in range(1, shots + 1)]


def force_max_zoom_out(driver, settle_seconds: float = 0.15) -> None:
    """Force the game camera to its minimum zoom value, if supported."""
    result = driver.execute_async_script(MAX_ZOOM_OUT_SCRIPT)
    if isinstance(result, dict) and result.get("ok"):
        print(
            "Forced maximum zoom-out before capture "
            f"(zoom={result.get('zoom')}, minZoom={result.get('minZoom')})."
        )
        time.sleep(max(0.0, settle_seconds))
        return
    reason = result.get("reason", "unknown-reason") if isinstance(result, dict) else "unexpected-result"
    print(f"Zoom-out step skipped: {reason}")


def runtime_snapshot(driver) -> dict:
    """Return a JSON-safe read-only runtime evidence snapshot."""
    result = driver.execute_script(RUNTIME_SNAPSHOT_SCRIPT)
    if not isinstance(result, dict):
        return {"ok": False, "reason": "unexpected-runtime-snapshot"}
    return result


def _scenario_required_shots(scenario: str, requested: int) -> int:
    return max(requested, SCENARIO_MIN_SHOTS.get(scenario, 1))


def _controlled_state(driver, action: str) -> str:
    result = driver.execute_script(CONTROLLED_STATE_SCRIPT, action)
    if not isinstance(result, dict) or not result.get("ok"):
        reason = result.get("reason", "unexpected-result") if isinstance(result, dict) else "unexpected-result"
        raise RuntimeError(f"Controlled state action {action!r} failed: {reason}")
    return action


def _prepare_scenario(driver, scenario: str) -> str:
    setup = {
        "time-of-day": "time-day",
        "village-reference": "reference-day-wide",
        "region-transition": "region-baseline",
        "save-load": "save-baseline",
        "npc-conversation-state": "npc-isolated",
        "npc-edge-crossing": "npc-edge-baseline",
    }.get(scenario)
    return _controlled_state(driver, setup) if setup else "initial"


def _safe_click(driver, selector: str) -> str:
    from selenium.webdriver.common.by import By

    elements = driver.find_elements(By.CSS_SELECTOR, selector)
    if not elements:
        return f"click-skipped:{selector}"
    driver.execute_script("arguments[0].click()", elements[0])
    return f"click:{selector}"


def _drag_canvas(driver, dx: int, dy: int) -> str:
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.by import By

    canvas = driver.find_element(By.ID, "gameCanvas")
    ActionChains(driver).move_to_element(canvas).click_and_hold().move_by_offset(dx, dy).release().perform()
    return f"drag-canvas:{dx},{dy}"


def _wheel_canvas(driver, delta_y: int) -> str:
    from selenium.webdriver.common.by import By

    canvas = driver.find_element(By.ID, "gameCanvas")
    driver.execute_script(
        """
        const target = arguments[0];
        const deltaY = arguments[1];
        target.dispatchEvent(new WheelEvent('wheel', {
          deltaY,
          bubbles: true,
          cancelable: true,
          clientX: Math.round(innerWidth / 2),
          clientY: Math.round(innerHeight / 2)
        }));
        """,
        canvas,
        delta_y,
    )
    return f"wheel-canvas:{delta_y}"


def _run_scenario_step(driver, scenario: str, frame_index: int, base_width: int, base_height: int) -> str:
    """Run one deterministic presentation-only step before a scenario frame."""
    if scenario == "static" or frame_index == 0:
        return "initial"

    if scenario == "panel-cycle":
        selectors = [
            '.mobile-tab-btn[data-panel-target="character-panel"]',
            '.mobile-tab-btn[data-panel-target="dialog-panel"]',
            '.mobile-tab-btn[data-panel-target="minimap-panel"]',
        ]
        return _safe_click(driver, selectors[(frame_index - 1) % len(selectors)])

    if scenario == "camera-pan":
        return _drag_canvas(driver, 120 if frame_index % 2 else -120, 0)

    if scenario == "camera-zoom":
        return _wheel_canvas(driver, -500 if frame_index % 2 else 500)

    if scenario == "camera-pan-zoom":
        actions = (
            lambda: _drag_canvas(driver, 120, 0),
            lambda: _wheel_canvas(driver, -500),
            lambda: _wheel_canvas(driver, 500),
        )
        return actions[(frame_index - 1) % len(actions)]()

    if scenario == "responsive-cycle":
        sizes = [(1080, 1920), (1920, 1080), (base_width, base_height)]
        width, height = sizes[(frame_index - 1) % len(sizes)]
        driver.set_window_size(width, height)
        return f"resize:{width}x{height}"

    if scenario == "motion-sequence":
        # Alternating bounded camera drags create a short temporal sequence without
        # mutating Simulation/world authority.
        dx = 72 if frame_index % 2 else -72
        return _drag_canvas(driver, dx, 0)

    if scenario == "time-of-day":
        actions = ("time-night", "time-dawn")
        return _controlled_state(driver, actions[(frame_index - 1) % len(actions)])

    if scenario == "village-reference":
        actions = ("reference-close", "reference-night-wide")
        return _controlled_state(driver, actions[(frame_index - 1) % len(actions)])

    if scenario == "region-transition":
        actions = ("region-east", "region-west")
        return _controlled_state(driver, actions[(frame_index - 1) % len(actions)])

    if scenario == "save-load":
        actions = ("save-mutate", "save-restore")
        return _controlled_state(driver, actions[(frame_index - 1) % len(actions)])

    if scenario == "npc-conversation-state":
        actions = ("npc-adjacent", "npc-same-tile", "npc-nonadjacent", "npc-missing-partner")
        return _controlled_state(driver, actions[(frame_index - 1) % len(actions)])

    if scenario == "npc-edge-crossing":
        drags = (480, 140, -140, -480)
        return _drag_canvas(driver, drags[(frame_index - 1) % len(drags)], 0)

    return "no-op"


def _write_evidence_manifest(
    path: Path,
    *,
    target: str,
    scenario: str,
    issue: str | None,
    frames: list[dict],
) -> None:
    payload = {
        "schema": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "target": target,
        "scenario": scenario,
        "issue": issue or None,
        "frames": frames,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Evidence: {path}")


def take_screenshots(
    target: str,
    output_file: str,
    *,
    width: int,
    height: int,
    shots: int = 1,
    interval: float = 0.2,
    wait_min: float = 15.0,
    wait_max: float = 60.0,
    ready_timeout: float = 20.0,
    timestamp_names: bool = False,
    force_max_zoom: bool = True,
    scenario: str = "static",
    evidence_json: str | None = None,
    issue: str | None = None,
) -> bool:
    if width <= 0 or height <= 0:
        print("Error: width and height must be positive.", file=sys.stderr)
        return False
    if shots < 1:
        print("Error: shots must be >= 1.", file=sys.stderr)
        return False
    if scenario not in SCENARIOS:
        print(f"Error: unknown scenario: {scenario}", file=sys.stderr)
        return False
    shots = _scenario_required_shots(scenario, shots)
    if interval < 0:
        print("Error: interval must be >= 0.", file=sys.stderr)
        return False
    if wait_min < 0 or wait_max < 0 or wait_min > wait_max:
        print("Error: require 0 <= wait-min <= wait-max.", file=sys.stderr)
        return False

    try:
        browser_url = normalize_target(target)
        paths = output_paths(output_file, shots, timestamp_names)
        driver = create_driver(width, height)
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait

            driver.set_window_size(width, height)
            driver.get(browser_url)
            WebDriverWait(driver, ready_timeout).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            WebDriverWait(driver, ready_timeout).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )

            delay = random.uniform(wait_min, wait_max)
            print(f"Opening: {browser_url}")
            print(f"Viewport: {width}x{height}")
            print(f"Waiting {delay:.1f}s before capture")
            time.sleep(delay)

            if force_max_zoom:
                force_max_zoom_out(driver)

            setup_action = _prepare_scenario(driver, scenario)

            # Non-static scenarios need enough frame paths for their evidence contract.
            if len(paths) != shots:
                paths = output_paths(output_file, shots, timestamp_names)

            frames: list[dict] = []
            for index, path in enumerate(paths):
                if index:
                    action = _run_scenario_step(driver, scenario, index, width, height)
                    time.sleep(interval)
                else:
                    action = setup_action
                if not driver.save_screenshot(str(path)):
                    raise RuntimeError(f"Screenshot capture failed: {path}")
                snapshot = runtime_snapshot(driver)
                frames.append({
                    "index": index + 1,
                    "file": path.name,
                    "action": action,
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                    "runtime": snapshot,
                })
                print(f"Saved: {path} [{scenario}:{action}]")

            if evidence_json:
                manifest_path = screenshots_directory() / Path(evidence_json).name
                _write_evidence_manifest(
                    manifest_path,
                    target=browser_url,
                    scenario=scenario,
                    issue=issue,
                    frames=frames,
                )
            return True
        finally:
            driver.quit()
    except Exception as exc:
        print(f"Error taking screenshot: {exc}", file=sys.stderr)
        return False


def _run_git(repo_root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip() or f"exit code {result.returncode}"
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return result


def _repository_root() -> Path:
    script_dir = Path(__file__).resolve().parent
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=script_dir,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(
            "Cannot publish screenshots because this tool is not running inside a Git checkout"
            + (f": {detail}" if detail else "")
        )
    return Path(result.stdout.strip()).resolve()


def _validate_publish_checkout(repo_root: Path, branch: str) -> None:
    expected_screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
    if screenshots_directory().resolve() != expected_screenshots_dir:
        raise RuntimeError(
            "Refusing to publish: screenshot output is not repository tools/screenshots"
        )

    remote = _run_git(repo_root, "remote", "get-url", "origin").stdout.strip()
    normalized_remote = remote.removesuffix(".git").rstrip("/")
    valid_remote = (
        normalized_remote.endswith(f"github.com/{REPOSITORY_SLUG}")
        or normalized_remote.endswith(f"github.com:{REPOSITORY_SLUG}")
    )
    if not valid_remote:
        raise RuntimeError(f"Refusing to publish to unexpected origin remote: {remote or '<empty>'}")

    current_branch = _run_git(repo_root, "branch", "--show-current").stdout.strip()
    if current_branch != branch:
        shown = current_branch or "detached HEAD"
        raise RuntimeError(f"Refusing to publish from {shown}; checkout {branch!r} first")


def _github_file_url(relative_path: Path, branch: str) -> str:
    encoded = "/".join(quote(part) for part in relative_path.parts)
    return f"{GITHUB_BASE_URL}/blob/{quote(branch)}/{encoded}"


def publish_screenshots(
    paths: list[Path],
    *,
    branch: str = DEFAULT_PUBLISH_BRANCH,
    commit_message: str = "chore: publish visual review screenshots",
) -> bool:
    """Commit only the generated screenshots and push them to GitHub."""
    if not paths:
        print("Error publishing screenshots: no screenshot paths were provided.", file=sys.stderr)
        return False

    try:
        repo_root = _repository_root()
        _validate_publish_checkout(repo_root, branch)
        screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
        relative_paths: list[Path] = []

        for path in paths:
            resolved = path.resolve()
            try:
                resolved.relative_to(screenshots_dir)
            except ValueError as exc:
                raise RuntimeError(f"Refusing to publish outside tools/screenshots: {resolved}") from exc
            if not resolved.is_file():
                raise FileNotFoundError(f"Screenshot does not exist: {resolved}")
            relative_paths.append(resolved.relative_to(repo_root))

        git_paths = [path.as_posix() for path in relative_paths]
        _run_git(repo_root, "add", "--", *git_paths)
        staged = _run_git(
            repo_root,
            "diff",
            "--cached",
            "--quiet",
            "--",
            *git_paths,
            check=False,
        )
        if staged.returncode not in {0, 1}:
            detail = (staged.stderr or staged.stdout).strip() or f"exit code {staged.returncode}"
            raise RuntimeError(f"git diff --cached failed: {detail}")

        if staged.returncode == 1:
            _run_git(repo_root, "commit", "--only", "-m", commit_message, "--", *git_paths)
            _run_git(repo_root, "push", "origin", f"HEAD:{branch}")
            print(f"Published {len(relative_paths)} screenshot(s) to GitHub.")
        else:
            print("Screenshot content is unchanged; no new commit was needed.")

        print(f"GitHub screenshots: {GITHUB_BASE_URL}/tree/{quote(branch)}/tools/screenshots")
        for relative_path in relative_paths:
            print(f"GitHub file: {_github_file_url(relative_path, branch)}")
        return True
    except Exception as exc:
        print(f"Error publishing screenshots: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Shared AI-agent screenshot tool. Capture under tools/screenshots/ "
            "and publish to GitHub by default."
        )
    )
    parser.add_argument("target", help="Local HTML path, file:// URL, or http(s) URL")
    parser.add_argument("filename", help="PNG filename or base stem saved under tools/screenshots/")
    parser.add_argument("--profile", choices=sorted(PROFILES), help="Viewport profile")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--shots", type=int, default=1)
    parser.add_argument("--interval", type=float, default=0.2)
    parser.add_argument("--timestamp-names", action="store_true")
    parser.add_argument("--wait-min", type=float, default=15.0)
    parser.add_argument("--wait-max", type=float, default=60.0)
    parser.add_argument("--ready-timeout", type=float, default=20.0)
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS),
        default="static",
        help="Optional deterministic runtime evidence scenario; default keeps legacy static capture",
    )
    parser.add_argument(
        "--evidence-json",
        help="Optional JSON evidence manifest filename saved under tools/screenshots/",
    )
    parser.add_argument(
        "--issue",
        help="Optional GitHub Issue number/reference recorded in the evidence manifest",
    )
    parser.add_argument(
        "--no-force-max-zoom",
        action="store_false",
        dest="force_max_zoom",
        help="Do not force game camera to maximum zoom-out before capture",
    )
    parser.add_argument(
        "--publish-branch",
        default=DEFAULT_PUBLISH_BRANCH,
        help=f"GitHub branch to publish to (default: {DEFAULT_PUBLISH_BRANCH})",
    )
    parser.add_argument(
        "--commit-message",
        default="chore: publish visual review screenshots",
        help="Commit message used when publishing screenshots",
    )
    parser.add_argument(
        "--no-publish",
        action="store_false",
        dest="publish",
        help="Capture locally without committing/pushing screenshots",
    )
    parser.set_defaults(publish=True, force_max_zoom=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    width, height = PROFILES.get(args.profile, (args.width, args.height))
    effective_shots = _scenario_required_shots(args.scenario, args.shots)
    paths = output_paths(args.filename, effective_shots, args.timestamp_names)
    ok = take_screenshots(
        args.target,
        args.filename,
        width=width,
        height=height,
        shots=effective_shots,
        interval=args.interval,
        wait_min=args.wait_min,
        wait_max=args.wait_max,
        ready_timeout=args.ready_timeout,
        timestamp_names=args.timestamp_names,
        force_max_zoom=args.force_max_zoom,
        scenario=args.scenario,
        evidence_json=args.evidence_json,
        issue=args.issue,
    )
    if not ok:
        return 1

    if args.publish and not publish_screenshots(
        paths,
        branch=args.publish_branch,
        commit_message=args.commit_message,
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
