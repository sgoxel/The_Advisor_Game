#!/usr/bin/env python3
"""Capture visual-review screenshots for The Advisor Game.

Adapted from the project's previous screenshot utility for the current browser
build while retaining backward-compatible scenario names.

Current-build behavior:
- Selenium + headless Chrome/Chromium.
- Automatically starts a fresh campaign when the current DOM exposes
  #newCampaignButton and no campaign is active.
- Captures landscape/portrait profiles and runtime JSON evidence.
- Stores captures under tools/screenshots/.
- Can publish screenshots to GitHub main unless --no-publish is passed.

GitHub Actions should normally use --no-publish and upload tools/screenshots/
as a workflow artifact. Manual/trusted runs may opt into publishing.

Examples:
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ landscape --profile landscape --shots 1 --timestamp-names --no-publish
  python tools/screenshot_tool.py https://sgoxel.github.io/The_Advisor_Game/ phone --profile portrait --scenario responsive-cycle --evidence-json responsive.json --no-publish
  python tools/screenshot_tool.py index.html local-check.png --no-publish

Issue-comment trigger used by .github/workflows/visual-evidence.yml:
  /visual-evidence <scenario>
"""

from __future__ import annotations

import argparse
import json
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
    "tablet": (1920, 1080),
    "phone": (1080, 1920),
}

DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
MAX_SCREENSHOT_HISTORY = 20
MAX_METADATA_HISTORY = 20

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
    "terrain-natural",
    "main-road",
    "starting-village",
}

SCENARIO_MIN_SHOTS = {
    "static": 1,
    "panel-cycle": 4,
    "camera-pan": 3,
    "camera-zoom": 5,
    "camera-pan-zoom": 4,
    "responsive-cycle": 3,
    "motion-sequence": 6,
    "time-of-day": 3,
    "village-reference": 3,
    "region-transition": 3,
    "save-load": 3,
    "npc-conversation-state": 5,
    "npc-edge-crossing": 5,
    "terrain-natural": 2,
    "main-road": 2,
    "starting-village": 2,
}

CURRENT_BUILD_PREP_SCRIPT = r"""
return (() => {
  const state = document.querySelector('#campaignState')?.textContent?.trim() || '';
  const button = document.querySelector('#newCampaignButton');
  if (state !== 'ACTIVE' && button) {
    button.click();
    return {ok: true, action: 'started-current-campaign'};
  }
  return {ok: true, action: state === 'ACTIVE' ? 'campaign-already-active' : 'current-ui-not-detected'};
})();
"""

MAX_ZOOM_OUT_SCRIPT = r"""
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const game = window.Game;
    const camera = game?.State?.camera;
    const renderer = game?.Renderer;
    if (!camera || typeof camera.minZoom !== 'number') {
      done({ok: false, reason: 'legacy-camera-not-found'});
      return;
    }
    camera.zoom = camera.minZoom;
    try { renderer?.centerCamera?.(); } catch (_) {}
    try { renderer?.markDirty?.(true, true); } catch (_) {}
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    done({ok: true, zoom: camera.zoom, minZoom: camera.minZoom});
  } catch (error) {
    done({ok: false, reason: String(error)});
  }
})();
"""

RUNTIME_SNAPSHOT_SCRIPT = r"""
return (() => {
  try {
    const tiles = [...document.querySelectorAll('.terrain-tile')];
    const terrainTypes = {};
    for (const tile of tiles) {
      const type = tile.dataset?.terrain || 'unknown';
      terrainTypes[type] = (terrainTypes[type] || 0) + 1;
    }
    const sprite = document.querySelector('#protagonistSprite');
    const legacy = window.Game || null;
    const camera = legacy?.State?.camera || null;
    const canvas = document.querySelector('#gameCanvas');
    const canvasRect = canvas?.getBoundingClientRect?.() || null;
    return {
      ok: true,
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      currentBuild: {
        campaignState: document.querySelector('#campaignState')?.textContent?.trim() || null,
        gameDate: document.querySelector('#gameDate')?.textContent?.trim() || null,
        gameTime: document.querySelector('#gameTime')?.textContent?.trim() || null,
        protagonistLocation: document.querySelector('#protagonistLocation')?.textContent?.trim() || null,
        cameraCoordinate: document.querySelector('#cameraCoordinate')?.textContent?.trim() || null,
        cameraX: document.querySelector('#cameraX')?.textContent?.trim() || null,
        cameraY: document.querySelector('#cameraY')?.textContent?.trim() || null,
        cameraZoom: document.querySelector('#cameraZoom')?.textContent?.trim() || null,
        protagonistSpriteLoaded: Boolean(sprite?.complete && sprite?.naturalWidth > 0),
        protagonistSpriteSize: sprite ? {
          naturalWidth: sprite.naturalWidth || 0,
          naturalHeight: sprite.naturalHeight || 0,
        } : null,
        terrainTileCount: tiles.length,
        terrainTypes,
        terrainGrid: (() => {
          const grid = document.querySelector('#terrainGrid');
          if (!grid) return null;
          const data = grid.dataset || {};
          return {
            columns: Number(data.columns || 0),
            rows: Number(data.rows || 0),
            tileSize: Number(data.tileSize || 0),
            viewportWidth: Number(data.viewportWidth || 0),
            viewportHeight: Number(data.viewportHeight || 0),
            gridWidth: Number(data.gridWidth || 0),
            gridHeight: Number(data.gridHeight || 0),
            coveragePass: data.coveragePass === 'true',
            centerPass: data.centerPass === 'true',
          };
        })(),
        terrainNaturalness: (() => {
          const grid = document.querySelector('#terrainGrid');
          if (!grid) return null;
          const columns = Number(grid.dataset?.columns || 0);
          const rows = Number(grid.dataset?.rows || 0);
          const cells = [...grid.children].map(node => node.dataset?.terrain || 'unknown');
          if (!columns || !rows || cells.length !== columns * rows) return null;

          const naturalTypes = new Set(['water','forest','mud','rock','sand','dirt','farmland']);
          const visited = new Uint8Array(cells.length);
          const components = [];
          const directions = [[-1,0],[1,0],[0,-1],[0,1]];

          for (let index = 0; index < cells.length; index++) {
            const type = cells[index];
            if (visited[index] || !naturalTypes.has(type)) continue;

            const queue = [index];
            visited[index] = 1;
            let size = 0;
            let minX = columns, maxX = -1, minY = rows, maxY = -1;

            while (queue.length) {
              const current = queue.pop();
              const x = current % columns;
              const y = Math.floor(current / columns);
              size++;
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minY = Math.min(minY, y); maxY = Math.max(maxY, y);

              for (const [dx,dy] of directions) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
                const next = ny * columns + nx;
                if (!visited[next] && cells[next] === type) {
                  visited[next] = 1;
                  queue.push(next);
                }
              }
            }

            const width = maxX - minX + 1;
            const height = maxY - minY + 1;
            const area = width * height;
            const fillRatio = area ? size / area : 0;
            const interior = minX > 0 && minY > 0 && maxX < columns - 1 && maxY < rows - 1;
            components.push({type,size,width,height,fillRatio,interior});
          }

          const largeInterior = components.filter(c => c.interior && c.size >= 12 && c.width >= 3 && c.height >= 3);
          const suspicious = largeInterior.filter(c => c.fillRatio >= 0.92);
          return {
            componentCount: components.length,
            largeInteriorCount: largeInterior.length,
            suspiciousRectangleCount: suspicious.length,
            maxLargeInteriorFillRatio: largeInterior.length
              ? Math.max(...largeInterior.map(c => c.fillRatio))
              : 0,
            suspicious,
          };
        })(),
        startingVillage: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const village = window.StartingVillage;
            if (!campaign || !village?.proof) return null;
            return village.proof(campaign.seed);
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        roadNetwork: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const foundation = window.GeographyFoundation;
            if (!campaign || !foundation?.mainRoadProof) return null;
            return foundation.mainRoadProof(campaign.seed, 96);
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        geography: {
          continent: document.querySelector('#geoContinent')?.textContent?.trim() || null,
          country: document.querySelector('#geoCountry')?.textContent?.trim() || null,
          region: document.querySelector('#geoRegion')?.textContent?.trim() || null,
          city: document.querySelector('#geoCity')?.textContent?.trim() || null,
          district: document.querySelector('#geoDistrict')?.textContent?.trim() || null,
          village: document.querySelector('#geoVillage')?.textContent?.trim() || null,
          biome: document.querySelector('#geoBiome')?.textContent?.trim() || null,
          climate: document.querySelector('#geoClimate')?.textContent?.trim() || null,
        },
      },
      legacyGame: legacy ? {
        camera: camera ? {
          x: Number.isFinite(camera.x) ? camera.x : null,
          y: Number.isFinite(camera.y) ? camera.y : null,
          zoom: Number.isFinite(camera.zoom) ? camera.zoom : null,
          minZoom: Number.isFinite(camera.minZoom) ? camera.minZoom : null,
          maxZoom: Number.isFinite(camera.maxZoom) ? camera.maxZoom : null,
        } : null,
        canvas: canvasRect ? {
          x: canvasRect.x,
          y: canvasRect.y,
          width: canvasRect.width,
          height: canvasRect.height,
        } : null,
      } : null,
    };
  } catch (error) {
    return {ok: false, reason: String(error)};
  }
})();
"""


def normalize_target(target: str) -> str:
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
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise RuntimeError("Selenium is required: pip install -r tools/requirements.txt") from exc

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--hide-scrollbars")
    options.add_argument(f"--window-size={width},{height}")
    return webdriver.Chrome(options=options)


def screenshots_directory() -> Path:
    directory = Path(__file__).resolve().parent / "screenshots"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def prune_capture_history(
    directory: Path | None = None,
    *,
    max_screenshots: int = MAX_SCREENSHOT_HISTORY,
    max_metadata: int = MAX_METADATA_HISTORY,
) -> dict[str, object]:
    if max_screenshots < 1 or max_metadata < 1:
        raise ValueError("Retention limits must be >= 1")
    root = (directory or screenshots_directory()).resolve()
    root.mkdir(parents=True, exist_ok=True)

    screenshots = sorted(
        (path for path in root.glob("*.png") if path.is_file()),
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )
    metadata = sorted(
        {
            path
            for pattern in ("metadata*.txt", "*.json")
            for path in root.glob(pattern)
            if path.is_file()
        },
        key=lambda path: (path.stat().st_mtime_ns, path.name),
        reverse=True,
    )

    removed_screenshots = []
    for path in screenshots[max_screenshots:]:
        path.unlink()
        removed_screenshots.append(path.name)

    removed_metadata = []
    for path in metadata[max_metadata:]:
        path.unlink()
        removed_metadata.append(path.name)

    return {
        "screenshots": sum(1 for path in root.glob("*.png") if path.is_file()),
        "metadata": len(
            {
                path.resolve()
                for pattern in ("metadata*.txt", "*.json")
                for path in root.glob(pattern)
                if path.is_file()
            }
        ),
        "removed_screenshots": removed_screenshots,
        "removed_metadata": removed_metadata,
    }


def utc_timestamp_ms() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")[:-3] + "Z"


def output_paths(filename: str, shots: int, timestamp_names: bool = False) -> list[Path]:
    directory = screenshots_directory()
    name = Path(filename).name
    if not name:
        raise ValueError("Output filename is empty")
    path = Path(name)
    stem = path.stem if path.suffix else path.name
    if timestamp_names:
        stamp = utc_timestamp_ms()
        return [directory / f"{stem}-{index}-{stamp}.png" for index in range(1, shots + 1)]
    if shots == 1:
        if path.suffix.lower() != ".png":
            path = path.with_suffix(".png")
        return [directory / path.name]
    return [directory / f"{stem}_{index:02d}.png" for index in range(1, shots + 1)]


def force_max_zoom_out(driver, settle_seconds: float = 0.15) -> None:
    result = driver.execute_async_script(MAX_ZOOM_OUT_SCRIPT)
    if isinstance(result, dict) and result.get("ok"):
        print(f"Forced legacy maximum zoom-out: {result}")
        time.sleep(max(0.0, settle_seconds))
    else:
        reason = result.get("reason", "unknown") if isinstance(result, dict) else "unexpected-result"
        print(f"Zoom-out skipped: {reason}")


def prepare_current_build(driver, timeout: float = 10.0) -> str:
    result = driver.execute_script(CURRENT_BUILD_PREP_SCRIPT)
    action = result.get("action", "unknown") if isinstance(result, dict) else "unknown"

    if action in {"started-current-campaign", "campaign-already-active"}:
        try:
            from selenium.webdriver.support.ui import WebDriverWait

            WebDriverWait(driver, timeout).until(
                lambda d: d.execute_script(
                    """
                    const grid = document.querySelector('#terrainGrid');
                    const sprite = document.querySelector('#protagonistSprite');
                    return Boolean(
                      grid && !grid.hidden &&
                      sprite && sprite.complete && sprite.naturalWidth > 0
                    );
                    """
                )
            )
        except Exception as exc:
            raise RuntimeError(
                "Current build detected but terrain/protagonist readiness did not complete"
            ) from exc
    return action


def runtime_snapshot(driver) -> dict:
    result = driver.execute_script(RUNTIME_SNAPSHOT_SCRIPT)
    if not isinstance(result, dict):
        return {"ok": False, "reason": "unexpected-runtime-snapshot"}
    return result


def validate_current_build_snapshot(snapshot: dict) -> None:
    current = snapshot.get("currentBuild") if isinstance(snapshot, dict) else None
    if not isinstance(current, dict):
        return
    grid = current.get("terrainGrid")
    if not isinstance(grid, dict):
        raise RuntimeError("Current build terrain-grid evidence is missing")
    if not grid.get("coveragePass"):
        raise RuntimeError(f"Terrain grid does not cover viewport: {grid}")
    if not grid.get("centerPass"):
        raise RuntimeError(f"Terrain grid lost centered world tile: {grid}")
    expected = int(grid.get("columns") or 0) * int(grid.get("rows") or 0)
    actual = int(current.get("terrainTileCount") or 0)
    if expected <= 0 or actual != expected:
        raise RuntimeError(
            f"Terrain tile count mismatch: expected {expected}, captured {actual}"
        )


def _scenario_required_shots(scenario: str, requested: int) -> int:
    return max(requested, SCENARIO_MIN_SHOTS.get(scenario, 1))


def _safe_click(driver, selector: str) -> str:
    from selenium.webdriver.common.by import By

    elements = driver.find_elements(By.CSS_SELECTOR, selector)
    if not elements:
        return f"click-skipped:{selector}"
    driver.execute_script("arguments[0].click()", elements[0])
    return f"click:{selector}"


def _cycle_details(driver, frame_index: int) -> str:
    count = driver.execute_script("return document.querySelectorAll('details').length")
    if not count:
        return "details-cycle-skipped"
    index = (frame_index - 1) % int(count)
    driver.execute_script(
        """
        const index = arguments[0];
        const all = [...document.querySelectorAll('details')];
        all.forEach((node, i) => node.open = i === index);
        all[index]?.scrollIntoView({block: 'nearest'});
        """,
        index,
    )
    return f"details-open:{index}"


def _drag_canvas(driver, dx: int, dy: int) -> str:
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.by import By

    elements = driver.find_elements(By.ID, "gameCanvas")
    target = elements[0] if elements else None
    target_name = "gameCanvas"
    if target is None:
        current = driver.find_elements(By.ID, "gameplayArea")
        target = current[0] if current else None
        target_name = "gameplayArea"
    if target is None:
        return "camera-drag-skipped:no-camera-surface"
    ActionChains(driver).move_to_element(target).click_and_hold().move_by_offset(dx, dy).release().perform()
    return f"drag-{target_name}:{dx},{dy}"


def _wheel_canvas(driver, delta_y: int) -> str:
    from selenium.webdriver.common.by import By

    elements = driver.find_elements(By.ID, "gameCanvas")
    target = elements[0] if elements else None
    target_name = "gameCanvas"
    if target is None:
        current = driver.find_elements(By.ID, "gameplayArea")
        target = current[0] if current else None
        target_name = "gameplayArea"
    if target is None:
        return "camera-wheel-skipped:no-camera-surface"
    driver.execute_script(
        """
        arguments[0].dispatchEvent(new WheelEvent('wheel', {
          deltaY: arguments[1],
          bubbles: true,
          cancelable: true,
          clientX: Math.round(innerWidth / 2),
          clientY: Math.round(innerHeight / 2)
        }));
        """,
        target,
        delta_y,
    )
    return f"wheel-{target_name}:{delta_y}"



def _pinch_gameplay(driver, scale: float) -> str:
    from selenium.webdriver.common.by import By

    elements = driver.find_elements(By.ID, "gameplayArea")
    if not elements:
        return "pinch-skipped:no-gameplayArea"

    target = elements[0]
    result = driver.execute_script(
        """
        const target = arguments[0];
        const scale = Number(arguments[1]);
        const rect = target.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const startHalf = 50;
        const endHalf = startHalf * scale;

        const fire = (type, id, x, y) => target.dispatchEvent(new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: id === 101,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1
        }));

        fire('pointerdown', 101, cx - startHalf, cy);
        fire('pointerdown', 102, cx + startHalf, cy);
        fire('pointermove', 101, cx - endHalf, cy);
        fire('pointermove', 102, cx + endHalf, cy);
        fire('pointerup', 101, cx - endHalf, cy);
        fire('pointerup', 102, cx + endHalf, cy);
        return true;
        """,
        target,
        scale,
    )
    return f"pinch-gameplay:{scale:.3f}" if result else "pinch-failed"


def _legacy_control(driver, action: str) -> str:
    result = driver.execute_script(
        """
        const action = arguments[0];
        const game = window.Game;
        if (!game) return {ok:false, reason:'legacy-game-not-found'};
        try {
          if (action === 'time-day' && typeof game.GameTime?.setForTest === 'function') {
            game.GameTime.setForTest(8 * 60); return {ok:true};
          }
          if (action === 'time-night' && typeof game.GameTime?.setForTest === 'function') {
            game.GameTime.setForTest(23 * 60); return {ok:true};
          }
          if (action === 'time-dawn' && typeof game.GameTime?.setForTest === 'function') {
            game.GameTime.setForTest(6 * 60); return {ok:true};
          }
          return {ok:false, reason:'legacy-action-unavailable'};
        } catch (error) {
          return {ok:false, reason:String(error)};
        }
        """,
        action,
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"legacy:{action}"
    reason = result.get("reason", "unavailable") if isinstance(result, dict) else "unexpected"
    return f"legacy-skipped:{action}:{reason}"


def _run_scenario_step(driver, scenario: str, frame_index: int, base_width: int, base_height: int) -> str:
    if scenario == "static" or frame_index == 0:
        return "initial"
    if scenario == "panel-cycle":
        return _cycle_details(driver, frame_index)
    if scenario == "camera-pan":
        return _drag_canvas(driver, 120 if frame_index % 2 else -120, 0)
    if scenario == "camera-zoom":
        actions = (
            lambda: _wheel_canvas(driver, -500),
            lambda: _wheel_canvas(driver, 500),
            lambda: _pinch_gameplay(driver, 1.5),
            lambda: _pinch_gameplay(driver, 2.0 / 3.0),
        )
        return actions[(frame_index - 1) % len(actions)]()
    if scenario == "camera-pan-zoom":
        actions = (
            lambda: _drag_canvas(driver, 120, 0),
            lambda: _wheel_canvas(driver, -500),
            lambda: _wheel_canvas(driver, 500),
        )
        return actions[(frame_index - 1) % len(actions)]()
    if scenario == "terrain-natural":
        for _ in range(5):
            _wheel_canvas(driver, 500)
        return "zoom-out-naturalness:0.5x"
    if scenario == "main-road":
        for _ in range(5):
            _wheel_canvas(driver, 500)
        return "zoom-out-main-road:0.5x"
    if scenario == "starting-village":
        for _ in range(5):
            _wheel_canvas(driver, 500)
        return "zoom-out-starting-village:0.5x"
    if scenario == "responsive-cycle":
        sizes = [(1080, 1920), (1920, 1080), (base_width, base_height)]
        width, height = sizes[(frame_index - 1) % len(sizes)]
        driver.set_window_size(width, height)
        return f"resize:{width}x{height}"
    if scenario == "motion-sequence":
        return _drag_canvas(driver, 72 if frame_index % 2 else -72, 0)
    if scenario == "time-of-day":
        actions = ("time-night", "time-dawn")
        return _legacy_control(driver, actions[(frame_index - 1) % len(actions)])
    if scenario in {"village-reference", "region-transition", "save-load", "npc-conversation-state"}:
        return f"scenario-compatible-placeholder:{scenario}"
    if scenario == "npc-edge-crossing":
        drags = (480, 140, -140, -480)
        return _drag_canvas(driver, drags[(frame_index - 1) % len(drags)], 0)
    return "no-op"


def validate_scenario_frames(scenario: str, frames: list[dict]) -> None:
    if scenario == "starting-village":
        if len(frames) < 2:
            raise RuntimeError("starting-village requires two evidence frames")
        current = frames[1].get("runtime", {}).get("currentBuild", {})
        proof = current.get("startingVillage") or {}
        if not proof.get("deterministic"):
            raise RuntimeError(f"Starting Village is not deterministic: {proof}")
        if not proof.get("originInsideVillage"):
            raise RuntimeError(f"Protagonist origin is not inside Starting Village: {proof}")
        if not proof.get("mainlandConnected") or int(proof.get("roadGapCount") or 1) != 0:
            raise RuntimeError(f"Starting Village has no continuous mainland connection: {proof}")
        if not proof.get("bridgePass"):
            raise RuntimeError(f"Starting Village bridge limit failed: {proof}")
        if int(proof.get("plotCount") or 0) < 6:
            raise RuntimeError(f"Starting Village lacks reserved plots: {proof}")
        grid = current.get("terrainGrid") or {}
        if not grid.get("coveragePass"):
            raise RuntimeError(f"Starting Village frame lost viewport coverage: {grid}")
        return

    if scenario == "main-road":
        if len(frames) < 2:
            raise RuntimeError("main-road requires two evidence frames")
        current = frames[1].get("runtime", {}).get("currentBuild", {})
        proof = current.get("roadNetwork") or {}
        if not proof.get("continuous"):
            raise RuntimeError(f"main road continuity failed: {proof}")
        if not proof.get("bridgePass"):
            raise RuntimeError(f"main road bridge limit failed: {proof}")
        if int(proof.get("maxWidth") or 0) > int(proof.get("capitalWidthCap") or 10):
            raise RuntimeError(f"main road width exceeds capital cap: {proof}")
        if int(proof.get("villageWidthCap") or 0) > 3:
            raise RuntimeError(f"village road width cap invalid: {proof}")
        grid = current.get("terrainGrid") or {}
        if not grid.get("coveragePass"):
            raise RuntimeError(f"main-road frame lost viewport coverage: {grid}")
        return

    if scenario == "terrain-natural":
        if len(frames) < 2:
            raise RuntimeError("terrain-natural requires two evidence frames")
        current = frames[1].get("runtime", {}).get("currentBuild", {})
        naturalness = current.get("terrainNaturalness") or {}
        zoom = current.get("cameraZoom")
        if zoom != "0.50×":
            raise RuntimeError(f"terrain-natural expected 0.50× zoom, got {zoom}")
        if naturalness.get("suspiciousRectangleCount", 1) != 0:
            raise RuntimeError(f"large rectangular natural-terrain component detected: {naturalness}")
        return

    if scenario == "camera-zoom":
        if len(frames) < 5:
            raise RuntimeError("camera-zoom requires five evidence frames")

        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:5]]
        start, wheel_zoomed, wheel_returned, pinch_zoomed, pinch_returned = builds

        start_zoom = start.get("cameraZoom")
        wheel_zoom = wheel_zoomed.get("cameraZoom")
        wheel_return = wheel_returned.get("cameraZoom")
        pinch_zoom = pinch_zoomed.get("cameraZoom")
        pinch_return = pinch_returned.get("cameraZoom")

        if not start_zoom or wheel_zoom == start_zoom:
            raise RuntimeError(
                f"mouse wheel did not change zoom: start={start_zoom}, zoomed={wheel_zoom}"
            )
        if wheel_return != start_zoom:
            raise RuntimeError(
                f"mouse wheel did not return to start zoom: start={start_zoom}, returned={wheel_return}"
            )
        def parse_zoom(value: str | None) -> float:
            if not value:
                raise RuntimeError(f"Missing zoom evidence: {value}")
            return float(value.replace("×", "").strip())

        start_zoom_value = parse_zoom(start_zoom)
        pinch_zoom_value = parse_zoom(pinch_zoom)
        pinch_return_value = parse_zoom(pinch_return)

        if pinch_zoom_value <= start_zoom_value:
            raise RuntimeError(
                f"touch pinch-open did not zoom in: start={start_zoom}, zoomed={pinch_zoom}"
            )
        if pinch_return_value >= pinch_zoom_value:
            raise RuntimeError(
                f"touch pinch-close did not zoom out: zoomed={pinch_zoom}, returned={pinch_return}"
            )
        if abs(pinch_return_value - start_zoom_value) > 0.15:
            raise RuntimeError(
                f"touch pinch-close did not return near start scale: start={start_zoom}, returned={pinch_return}"
            )

        positions = [item.get("protagonistLocation") for item in builds]
        cameras = [item.get("cameraCoordinate") for item in builds]
        if len(set(positions)) != 1 or len(set(cameras)) != 1:
            raise RuntimeError(
                f"camera zoom changed world coordinates: protagonist={positions}, camera={cameras}"
            )

        for index, item in enumerate(builds, start=1):
            grid = item.get("terrainGrid") or {}
            if not grid.get("coveragePass"):
                raise RuntimeError(f"zoom frame {index} lost terrain coverage: {grid}")
        return

    if scenario != "camera-pan":
        return
    if len(frames) < 3:
        raise RuntimeError("camera-pan requires at least three evidence frames")

    builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:3]]
    start, moved, returned = builds
    start_camera = start.get("cameraCoordinate")
    moved_camera = moved.get("cameraCoordinate")
    returned_camera = returned.get("cameraCoordinate")
    protagonist_positions = [item.get("protagonistLocation") for item in builds]

    if not start_camera or moved_camera == start_camera:
        raise RuntimeError(
            f"camera-pan did not move camera: start={start_camera}, moved={moved_camera}"
        )
    if returned_camera != start_camera:
        raise RuntimeError(
            f"camera-pan did not return to start: start={start_camera}, returned={returned_camera}"
        )
    if len(set(protagonist_positions)) != 1:
        raise RuntimeError(
            f"camera-pan moved Protagonist Simulation coordinate: {protagonist_positions}"
        )

    start_types = start.get("terrainTypes") or {}
    returned_types = returned.get("terrainTypes") or {}
    if start_types != returned_types:
        raise RuntimeError(
            "camera-pan returned to the start coordinate but terrain evidence changed"
        )


def _write_evidence_manifest(
    path: Path,
    *,
    target: str,
    scenario: str,
    issue: str | None,
    frames: list[dict],
) -> None:
    payload = {
        "schema": 2,
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
    wait_min: float = 1.0,
    wait_max: float = 1.0,
    ready_timeout: float = 20.0,
    timestamp_names: bool = False,
    force_max_zoom: bool = True,
    auto_start: bool = True,
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
    if interval < 0 or wait_min < 0 or wait_max < 0 or wait_min > wait_max:
        print("Error: invalid interval/wait range.", file=sys.stderr)
        return False

    shots = _scenario_required_shots(scenario, shots)

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
            WebDriverWait(driver, ready_timeout).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
            WebDriverWait(driver, ready_timeout).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )

            # Deterministic delay. The old utility used a random delay; CI evidence
            # should be reproducible, so use the midpoint of the supplied range.
            delay = (wait_min + wait_max) / 2.0
            print(f"Opening: {browser_url}")
            print(f"Viewport: {width}x{height}")
            print(f"Waiting {delay:.2f}s before capture")
            time.sleep(delay)

            prep_action = prepare_current_build(driver, min(ready_timeout, 10.0)) if auto_start else "auto-start-disabled"

            if force_max_zoom:
                force_max_zoom_out(driver)

            frames: list[dict] = []
            for index, path in enumerate(paths):
                if index:
                    action = _run_scenario_step(driver, scenario, index, width, height)
                    time.sleep(interval)
                else:
                    action = prep_action
                if not driver.save_screenshot(str(path)):
                    raise RuntimeError(f"Screenshot capture failed: {path}")
                snapshot = runtime_snapshot(driver)
                validate_current_build_snapshot(snapshot)
                frames.append(
                    {
                        "index": index + 1,
                        "file": path.name,
                        "action": action,
                        "captured_at": datetime.now(timezone.utc).isoformat(),
                        "runtime": snapshot,
                    }
                )
                print(f"Saved: {path} [{scenario}:{action}]")

            validate_scenario_frames(scenario, frames)

            if evidence_json:
                manifest_path = screenshots_directory() / Path(evidence_json).name
                _write_evidence_manifest(
                    manifest_path,
                    target=browser_url,
                    scenario=scenario,
                    issue=issue,
                    frames=frames,
                )

            prune_capture_history()
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
        raise RuntimeError("Cannot publish screenshots because this tool is not inside a Git checkout")
    return Path(result.stdout.strip()).resolve()


def _validate_publish_checkout(repo_root: Path, branch: str) -> None:
    expected = (repo_root / "tools" / "screenshots").resolve()
    if screenshots_directory().resolve() != expected:
        raise RuntimeError("Refusing to publish outside repository tools/screenshots")

    remote = _run_git(repo_root, "remote", "get-url", "origin").stdout.strip()
    normalized = remote.removesuffix(".git").rstrip("/")
    valid = (
        normalized.endswith(f"github.com/{REPOSITORY_SLUG}")
        or normalized.endswith(f"github.com:{REPOSITORY_SLUG}")
    )
    if not valid:
        raise RuntimeError(f"Refusing to publish to unexpected origin remote: {remote or '<empty>'}")

    current_branch = _run_git(repo_root, "branch", "--show-current").stdout.strip()
    if current_branch != branch:
        raise RuntimeError(f"Refusing to publish from {current_branch or 'detached HEAD'}; expected {branch!r}")


def _github_file_url(relative_path: Path, branch: str) -> str:
    encoded = "/".join(quote(part) for part in relative_path.parts)
    return f"{GITHUB_BASE_URL}/blob/{quote(branch)}/{encoded}"


def publish_screenshots(
    paths: list[Path],
    *,
    branch: str = DEFAULT_PUBLISH_BRANCH,
    commit_message: str = "chore: publish visual review screenshots",
) -> bool:
    if not paths:
        print("Error publishing screenshots: no screenshot paths.", file=sys.stderr)
        return False
    try:
        repo_root = _repository_root()
        _validate_publish_checkout(repo_root, branch)
        screenshots_dir = (repo_root / "tools" / "screenshots").resolve()
        relative_paths = []
        for path in paths:
            resolved = path.resolve()
            resolved.relative_to(screenshots_dir)
            if not resolved.is_file():
                raise FileNotFoundError(f"Screenshot does not exist: {resolved}")
            relative_paths.append(resolved.relative_to(repo_root))

        prune_capture_history(screenshots_dir)
        rel_dir = Path("tools") / "screenshots"
        _run_git(repo_root, "add", "-A", "--", rel_dir.as_posix())
        staged = _run_git(
            repo_root, "diff", "--cached", "--quiet", "--", rel_dir.as_posix(), check=False
        )
        if staged.returncode == 1:
            _run_git(
                repo_root,
                "commit",
                "--only",
                "-m",
                commit_message,
                "--",
                rel_dir.as_posix(),
            )
            _run_git(repo_root, "push", "origin", f"HEAD:{branch}")
            print(f"Published {len(relative_paths)} screenshot(s) to GitHub.")
        elif staged.returncode == 0:
            print("Screenshot content unchanged; no commit needed.")
        else:
            raise RuntimeError("git diff --cached failed")

        print(f"GitHub screenshots: {GITHUB_BASE_URL}/tree/{quote(branch)}/tools/screenshots")
        for relative_path in relative_paths:
            print(f"GitHub file: {_github_file_url(relative_path, branch)}")
        return True
    except Exception as exc:
        print(f"Error publishing screenshots: {exc}", file=sys.stderr)
        return False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture The Advisor Game visual evidence under tools/screenshots/."
    )
    parser.add_argument("target", help="Local HTML path, file:// URL, or http(s) URL")
    parser.add_argument("filename", help="PNG filename or base stem")
    parser.add_argument("--profile", choices=sorted(PROFILES), help="Viewport profile")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT)
    parser.add_argument("--shots", type=int, default=1)
    parser.add_argument("--interval", type=float, default=0.2)
    parser.add_argument("--timestamp-names", action="store_true")
    parser.add_argument("--wait-min", type=float, default=1.0)
    parser.add_argument("--wait-max", type=float, default=1.0)
    parser.add_argument("--ready-timeout", type=float, default=20.0)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="static")
    parser.add_argument("--evidence-json", help="JSON evidence filename under tools/screenshots/")
    parser.add_argument("--issue", help="Optional GitHub Issue reference stored in evidence JSON")
    parser.add_argument(
        "--no-force-max-zoom",
        action="store_false",
        dest="force_max_zoom",
        help="Do not attempt legacy game-camera maximum zoom-out",
    )
    parser.add_argument(
        "--no-auto-start",
        action="store_false",
        dest="auto_start",
        help="Do not auto-start a campaign on the current DOM build",
    )
    parser.add_argument("--publish-branch", default=DEFAULT_PUBLISH_BRANCH)
    parser.add_argument(
        "--commit-message",
        default="chore: publish visual review screenshots",
    )
    parser.add_argument(
        "--no-publish",
        action="store_false",
        dest="publish",
        help="Capture without committing/pushing screenshots",
    )
    parser.set_defaults(publish=True, force_max_zoom=True, auto_start=True)
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
        auto_start=args.auto_start,
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
