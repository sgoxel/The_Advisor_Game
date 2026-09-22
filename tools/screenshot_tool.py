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
    "building-presentation",
    "wp-s001-001",
    "wp-s001-004",
}

SCENARIO_MIN_SHOTS = {
    "static": 1,
    "panel-cycle": 4,
    "camera-pan": 3,
    "camera-zoom": 5,
    "camera-pan-zoom": 4,
    "responsive-cycle": 5,
    "motion-sequence": 6,
    "time-of-day": 3,
    "village-reference": 3,
    "region-transition": 3,
    "save-load": 3,
    "npc-conversation-state": 5,
    "npc-edge-crossing": 5,
    "terrain-natural": 2,
    "main-road": 2,
    "starting-village": 3,
    "building-presentation": 5,
    "wp-s001-001": 5,
    "wp-s001-004": 2,
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
    const renderer = window.GameRenderer?.snapshot?.() || {};
    const assets = window.TextureAssets?.stats?.() || {};
    const cells = Array.isArray(renderer.cells) ? renderer.cells : [];
    const terrainTypes = renderer.terrainTypes || {};
    const grid = renderer.grid || null;
    const protagonistTexture = window.TextureAssets?.get?.('character:protagonist-male') || null;
    const legacy = window.Game || null;
    const camera = legacy?.State?.camera || null;
    const canvas = document.querySelector('#gameCanvas');
    const canvasRect = canvas?.getBoundingClientRect?.() || null;

    const naturalness = (() => {
      if (!grid) return null;
      const columns = Number(grid.columns || 0);
      const rows = Number(grid.rows || 0);
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
    })();

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
        campaignSeed: window.SeedSystem?.getCampaign?.()?.seed || null,
        campaignRealStartMs: Number(window.SeedSystem?.getCampaign?.()?.realStartMs || 0) || null,
        campaignFantasyStart: window.SeedSystem?.getCampaign?.()?.fantasyStart || null,
        settingsSeed: window.SeedSystem?.getSettings?.()?.seed || null,
        gameTimestampMs: Number(window.GameTime?.getTimestampMs?.() || 0) || null,
        gameTimeMultiplier: Number(window.GameConfig?.gameTimeMultiplier || 0),
        startYearValid: Boolean(window.GameTime?.validateStartYear?.()),
        persistenceStatus: document.querySelector('#vPersist')?.textContent?.trim() || null,
        layout: (() => {
          const rect = selector => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return {
              left:Number(r.left), top:Number(r.top), right:Number(r.right), bottom:Number(r.bottom),
              width:Number(r.width), height:Number(r.height)
            };
          };
          const settings = document.querySelector('#settingsPopup');
          return {
            viewportWidth:Number(innerWidth),
            viewportHeight:Number(innerHeight),
            bodyScrollWidth:Number(document.documentElement.scrollWidth || document.body?.scrollWidth || 0),
            bodyClientWidth:Number(document.documentElement.clientWidth || innerWidth),
            screenShell:rect('.screen-shell'),
            topRibbon:rect('.top-ribbon'),
            gameplay:rect('#gameplayArea'),
            status:rect('.status-area'),
            settingsHidden:settings ? Boolean(settings.hidden) : null,
            settingsRect:rect('#settingsPopup')
          };
        })(),
        responsiveControlDeck: window.ResponsiveControlDeck?.snapshot?.() || null,
        gameDate: document.querySelector('#gameDate')?.textContent?.trim() || null,
        gameTime: document.querySelector('#gameTime')?.textContent?.trim() || null,
        protagonistLocation: document.querySelector('#protagonistLocation')?.textContent?.trim() || null,
        cameraCoordinate: document.querySelector('#cameraCoordinate')?.textContent?.trim() || null,
        cameraX: document.querySelector('#cameraX')?.textContent?.trim() || null,
        cameraY: document.querySelector('#cameraY')?.textContent?.trim() || null,
        cameraZoom: document.querySelector('#cameraZoom')?.textContent?.trim() || null,
        protagonistSpriteLoaded: Boolean(protagonistTexture),
        protagonistSpriteSize: protagonistTexture ? {
          naturalWidth: Number(protagonistTexture.width || 0),
          naturalHeight: Number(protagonistTexture.height || 0),
        } : null,
        terrainTileCount: Number(renderer.tileCount || 0),
        terrainTypes,
        terrainGrid: grid,
        gpuRenderer: {
          ready: Boolean(renderer.ready),
          backend: renderer.backend || null,
          webgl: Boolean(renderer.webgl),
          canvasCount: Number(renderer.canvasCount || 0),
          domTerrainTileCount: Number(renderer.domTerrainTileCount || 0),
          logicalTextureKeyPass: Boolean(renderer.logicalTextureKeyPass),
          protagonistVisible: Boolean(renderer.protagonistVisible),
          standardTerrainTexturePx: Number(renderer.standardTerrainTexturePx || 0),
          visibleRegionKey: renderer.regionKey || document.querySelector('#terrainGrid')?.dataset?.regionKey || null,
          preparedRegionKey: assets.preparedRegionKey || null,
          preparedKeyCount: Number(assets.preparedKeyCount || 0),
          buildingPresentation: renderer.buildingPresentation || null,
          textureCache: assets,
          terrainChunks: renderer.terrainChunks || null,
        },
        terrainNaturalness: naturalness,
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
        housePlans: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const houses = window.HousePlans;
            const textures = window.TileTextures;
            if (!campaign || !houses?.proof || !textures) return null;
            const proof = houses.proof(campaign.seed);
            const renderProof = renderer.housePlans || {};
            const sampleNeighbors = {n:"water",e:"grass",s:"grass",w:"grass"};
            const stableOne = textures.blendSpecs(
              "grass", sampleNeighbors,
              {seed:campaign.seed,x:"17",y:"23"}
            );
            const stableTwo = textures.blendSpecs(
              "grass", sampleNeighbors,
              {seed:campaign.seed,x:"17",y:"23"}
            );
            const registryVariants = new Set();
            for (let y=0;y<12;y++) {
              for (let x=0;x<12;x++) {
                const sample = textures.blendSpecs(
                  "grass", sampleNeighbors,
                  {seed:campaign.seed,x:String(x),y:String(y)}
                );
                if (sample[0]?.variant) registryVariants.add(sample[0].variant);
              }
            }
            const diagonalOnly = textures.blendSpecs("grass",{
              n:"grass",e:"grass",s:"grass",w:"grass",
              ne:"water",se:"grass",sw:"grass",nw:"grass"
            },{seed:campaign.seed,x:"31",y:"41"});
            const highPriorityJunction = textures.blendSpecs("grass",{
              n:"dirt",e:"forest",s:"grass",w:"grass",
              ne:"water",se:"grass",sw:"grass",nw:"grass"
            },{seed:campaign.seed,x:"32",y:"41"});
            const lowPriorityJunction = textures.blendSpecs("grass",{
              n:"water",e:"dirt",s:"grass",w:"grass",
              ne:"forest",se:"grass",sw:"grass",nw:"grass"
            },{seed:campaign.seed,x:"33",y:"41"});
            const shapeProof = [
              textures.blendSpecs("grass",{n:"water",e:"grass",s:"grass",w:"grass"})[0]?.shape,
              textures.blendSpecs("grass",{n:"water",e:"water",s:"grass",w:"grass"})[0]?.shape,
              textures.blendSpecs("grass",{n:"water",e:"water",s:"water",w:"grass"})[0]?.shape,
              textures.blendSpecs("grass",{n:"water",e:"water",s:"water",w:"water"})[0]?.shape,
              diagonalOnly[0]?.shape,
            ].filter(Boolean).sort();
            return {
              ...proof,
              ...renderProof,
              registryVariants:[...registryVariants].sort(),
              blendDeterministic:JSON.stringify(stableOne)===JSON.stringify(stableTwo),
              diagonalRegistryPass:diagonalOnly.some(spec=>spec.shape==="diagonal"&&spec.orientation==="ne"&&spec.terrain==="water"),
              junctionPriorityPass:
                highPriorityJunction.some(spec=>spec.shape==="diagonal"&&spec.terrain==="water")&&
                !lowPriorityJunction.some(spec=>spec.shape==="diagonal"&&spec.terrain==="forest"),
              shapeProof,
            };
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        specialLots: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const lots = window.SpecialLots;
            if (!campaign || !lots?.proof) return null;
            return {...lots.proof(campaign.seed), ...(renderer.specialLots || {})};
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        walkability: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const walkability = window.Walkability;
            if (!campaign || !walkability?.proof) return null;
            return {...walkability.proof(campaign.seed), ...(renderer.walkability || {})};
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        routePlanner: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const planner = window.RoutePlanner;
            if (!campaign || !planner?.proof) return null;
            return {...planner.proof(campaign.seed), ...(renderer.route || {})};
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        buildingInteriors: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const interiors = window.BuildingInteriors;
            if (!campaign || !interiors?.proof) return null;
            return interiors.proof(campaign.seed);
          } catch (error) {
            return {error: String(error)};
          }
        })(),
        interiorObjects: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const objects = window.InteriorObjects;
            if (!campaign || !objects?.proof) return null;
            return objects.proof(campaign.seed);
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
        geographyProof: (() => {
          try {
            const campaign = window.SeedSystem?.getCampaign?.();
            const position = window.Protagonist?.getPosition?.();
            const foundation = window.GeographyFoundation;
            const standards = window.WorldStandards;
            if (!campaign || !position || !foundation || !standards) return null;
            const first = foundation.location(campaign.seed, position.x, position.y);
            const repeat = foundation.location(campaign.seed, position.x, position.y);
            const spacing = foundation.villageSpacingProof(campaign.seed);
            const minAdjacentTiles =
              Number(standards.VILLAGE_CELL_SIZE_TILES || 0) -
              2 * Number(standards.VILLAGE_JITTER_TILES || 0);
            const minAdjacentMeters = minAdjacentTiles * Number(standards.TILE_METERS || 0);
            const minAdjacentMinutes = standards.walkMinutes(
              minAdjacentMeters,
              Number(standards.FASTEST_NORMAL_WALK_KMH || 0)
            );
            return {
              location:first,
              repeatable:JSON.stringify(first) === JSON.stringify(repeat),
              spacing,
              tileMeters:Number(standards.TILE_METERS || 0),
              fastestWalkKmh:Number(standards.FASTEST_NORMAL_WALK_KMH || 0),
              minVillageWalkMinutes:Number(standards.MIN_VILLAGE_WALK_MINUTES || 0),
              villageCellSizeTiles:Number(standards.VILLAGE_CELL_SIZE_TILES || 0),
              villageJitterTiles:Number(standards.VILLAGE_JITTER_TILES || 0),
              minAdjacentTiles,
              minAdjacentMeters,
              minAdjacentMinutes,
            };
          } catch (error) {
            return {error:String(error)};
          }
        })(),
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
    options.add_argument("--enable-webgl")
    options.add_argument("--ignore-gpu-blocklist")
    options.add_argument("--use-angle=swiftshader")
    options.add_argument("--hide-scrollbars")
    options.add_argument(f"--window-size={width},{height}")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
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
                    const renderer = window.GameRenderer?.snapshot?.();
                    const assets = window.TextureAssets?.stats?.();
                    return Boolean(
                      grid && !grid.hidden &&
                      renderer?.ready && renderer?.webgl &&
                      Number(renderer?.tileCount || 0) > 0 &&
                      renderer?.protagonistVisible &&
                      assets?.ready
                    );
                    """
                )
            )
        except Exception as exc:
            diagnostic = {}
            try:
                diagnostic = driver.execute_script(
                    """
                    return {
                      campaignState: document.querySelector('#campaignState')?.textContent?.trim() || null,
                      statusMessage: document.querySelector('#statusMessage')?.textContent?.trim() || null,
                      pixi: Boolean(window.PIXI),
                      renderer: window.GameRenderer?.snapshot?.() || null,
                      assets: window.TextureAssets?.stats?.() || null,
                      terrainHidden: document.querySelector('#terrainGrid')?.hidden ?? null,
                      canvasCount: document.querySelectorAll('#gameCanvas').length
                    };
                    """
                )
            except Exception as diag_exc:
                diagnostic = {"diagnosticError": str(diag_exc)}
            try:
                browser_logs = driver.get_log("browser")
            except Exception as log_exc:
                browser_logs = [{"message": f"browser-log-error: {log_exc}"}]
            raise RuntimeError(
                "Current build detected but terrain/protagonist readiness did not complete. "
                f"diagnostic={diagnostic}; browserLogs={browser_logs[-20:]}"
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


def _reload_current_build(driver, timeout: float = 20.0) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    before = driver.execute_script(
        """
        const campaign = window.SeedSystem?.getCampaign?.();
        return campaign ? {seed: campaign.seed, realStartMs: campaign.realStartMs} : null;
        """
    )
    if not isinstance(before, dict) or not before.get("seed") or not before.get("realStartMs"):
        raise RuntimeError(f"save-load pre-reload campaign missing: {before}")

    driver.refresh()
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            const campaign = window.SeedSystem?.getCampaign?.();
            const state = document.querySelector('#campaignState')?.textContent?.trim();
            const renderer = window.GameRenderer?.snapshot?.();
            return Boolean(campaign && state === 'ACTIVE' && renderer?.ready && renderer?.webgl);
            """
        )
    )

    after = driver.execute_script(
        """
        const campaign = window.SeedSystem?.getCampaign?.();
        return campaign ? {seed: campaign.seed, realStartMs: campaign.realStartMs} : null;
        """
    )
    if not isinstance(after, dict):
        raise RuntimeError("save-load campaign missing after reload")
    if after.get("seed") != before.get("seed") or after.get("realStartMs") != before.get("realStartMs"):
        raise RuntimeError(f"save-load campaign identity changed across reload: before={before}, after={after}")
    return "reload:persisted-campaign"


def _open_settings_popup(driver) -> str:
    from selenium.webdriver.common.by import By

    buttons = driver.find_elements(By.ID, "settingsButton")
    if not buttons:
        raise RuntimeError("WP-S001-001 Settings button not found")
    driver.execute_script("arguments[0].click()", buttons[0])
    return "open:settings"


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



def _focus_starting_village_gateway(driver) -> str:
    result = driver.execute_script(
        """
        const campaign = window.SeedSystem?.getCampaign?.();
        const village = window.StartingVillage;
        const camera = window.Camera;
        if (!campaign || !village?.plan || !camera?.pan) {
          return {ok:false, reason:'starting-village-runtime-unavailable'};
        }
        const plan = village.plan(campaign.seed);
        const moves = {
          East:[18,0],
          South:[0,18],
          West:[-18,0],
          North:[0,-18]
        };
        const move = moves[plan.gatewayDirection] || [0,0];
        camera.pan(String(move[0]), String(move[1]));
        window.dispatchEvent(new Event('resize'));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift'}));
        return {ok:true, direction:plan.gatewayDirection, move};
        """);
    if isinstance(result, dict) and result.get("ok"):
        # Force the current UI renderer to react through a harmless center-key path:
        # one arrow step and its reverse redraw the camera window deterministically.
        direction = result.get("direction")
        key_pairs = {
            "East": ("ArrowRight", "ArrowLeft"),
            "South": ("ArrowDown", "ArrowUp"),
            "West": ("ArrowLeft", "ArrowRight"),
            "North": ("ArrowUp", "ArrowDown"),
        }
        first, second = key_pairs.get(direction, ("ArrowDown", "ArrowUp"))
        driver.execute_script(
            """
            const first = arguments[0], second = arguments[1];
            document.dispatchEvent(new KeyboardEvent('keydown',{key:first,bubbles:true}));
            document.dispatchEvent(new KeyboardEvent('keydown',{key:second,bubbles:true}));
            """,
            first,
            second,
        )
        return f"focus-gateway:{direction}"
    return f"focus-gateway-skipped:{result}"


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


def _set_building_proof_state(driver, state: str) -> str:
    result = driver.execute_script(
        """
        const state = arguments[0];
        try {
          const renderer = window.GameRenderer;
          if (!renderer?.setBuildingProofState) {
            return {ok:false, reason:'building-proof-api-missing'};
          }
          const snapshot = renderer.setBuildingProofState(state);
          try { window.AppUI?.refreshBuildingPresentation?.(); } catch (_) {}
          return {ok:true, presentation:snapshot?.buildingPresentation || null};
        } catch (error) {
          return {ok:false, reason:String(error)};
        }
        """,
        state,
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"building-proof:{state}"
    reason = result.get("reason", "unavailable") if isinstance(result, dict) else "unexpected"
    return f"building-proof-failed:{state}:{reason}"


def _run_scenario_step(driver, scenario: str, frame_index: int, base_width: int, base_height: int) -> str:
    if scenario == "building-presentation":
        states = ("outside", "entering", "inside", "behind", "leaving")
        if frame_index == 0:
            for _ in range(5):
                _wheel_canvas(driver, 500)
        return _set_building_proof_state(driver, states[min(frame_index, len(states) - 1)])
    if scenario == "static" or frame_index == 0:
        return "initial"
    if scenario == "save-load":
        if frame_index == 1:
            return _reload_current_build(driver)
        return "post-reload-observe"
    if scenario == "wp-s001-001":
        if frame_index == 1:
            return _reload_current_build(driver)
        if frame_index == 2:
            driver.set_window_size(1080, 1920)
            return "resize:1080x1920"
        if frame_index == 3:
            driver.set_window_size(1920, 1080)
            return "resize:1920x1080"
        if frame_index == 4:
            return _open_settings_popup(driver)
        return "wp-s001-001:no-op"
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
        if frame_index == 1:
            for _ in range(5):
                _wheel_canvas(driver, 500)
            return "zoom-out-starting-village:0.5x"
        return _focus_starting_village_gateway(driver)
    if scenario == "responsive-cycle":
        if frame_index == 1:
            driver.set_window_size(1080, 1920)
            driver.execute_script("window.scrollTo(0, 0)")
            return "portrait:gameplay-top"
        if frame_index == 2:
            driver.execute_script("""
                const button=document.querySelector('#controlsDownButton');
                if(!button)throw new Error('controlsDownButton missing');
                button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:201,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,button:0,buttons:1}));
                button.dispatchEvent(new PointerEvent('pointerup',{pointerId:201,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,button:0,buttons:0}));
                button.click();
            """)
            return "touch:navigate-controls"
        if frame_index == 3:
            driver.execute_script("""
                const button=document.querySelector('#characterInfoToggle');
                if(!button)throw new Error('characterInfoToggle missing');
                button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:301,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true,button:0,buttons:1}));
                button.dispatchEvent(new PointerEvent('pointerup',{pointerId:301,pointerType:'mouse',isPrimary:true,bubbles:true,cancelable:true,button:0,buttons:0}));
                button.click();
            """)
            return "mouse:toggle-character-info"
        if frame_index == 4:
            driver.set_window_size(1920, 1080)
            driver.execute_script("""
                window.scrollTo(0,0);
                document.dispatchEvent(new KeyboardEvent('keydown',{key:'x',code:'KeyX',bubbles:true,cancelable:true}));
            """)
            return "landscape:keyboard-interactions"
        return "responsive:no-op"
    if scenario == "motion-sequence":
        return _drag_canvas(driver, 72 if frame_index % 2 else -72, 0)
    if scenario == "time-of-day":
        actions = ("time-night", "time-dawn")
        return _legacy_control(driver, actions[(frame_index - 1) % len(actions)])
    if scenario in {"village-reference", "region-transition", "npc-conversation-state"}:
        return f"scenario-compatible-placeholder:{scenario}"
    if scenario == "npc-edge-crossing":
        drags = (480, 140, -140, -480)
        return _drag_canvas(driver, drags[(frame_index - 1) % len(drags)], 0)
    return "no-op"


def validate_scenario_frames(scenario: str, frames: list[dict]) -> None:
    if scenario == "wp-s001-004":
        if len(frames) < 2:
            raise RuntimeError("wp-s001-004 requires two evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:2]]
        proofs = [item.get("geographyProof") or {} for item in builds]

        if any(proof.get("error") for proof in proofs):
            raise RuntimeError(f"WP-S001-004 geography proof errored: {proofs}")
        if not all(proof.get("repeatable") for proof in proofs):
            raise RuntimeError(f"WP-S001-004 same-SEED geography was not repeatable: {proofs}")

        first_locations = [proof.get("location") for proof in proofs]
        if not first_locations[0] or first_locations[0] != first_locations[1]:
            raise RuntimeError(
                f"WP-S001-004 foundation changed while fantasy time advanced: {first_locations}"
            )

        timestamps = [item.get("gameTimestampMs") for item in builds]
        if any(value is None for value in timestamps):
            raise RuntimeError(f"WP-S001-004 missing fantasy-time evidence: {timestamps}")
        timestamps = [float(value) for value in timestamps]
        if not timestamps[1] > timestamps[0]:
            raise RuntimeError(
                f"WP-S001-004 test did not observe fantasy time advancing: {timestamps}"
            )

        location = first_locations[0] or {}
        hierarchy = location.get("hierarchy") or {}
        required_hierarchy = (
            "continent","country","region","city","district","village","avenue","street"
        )
        missing = [key for key in required_hierarchy if not str(hierarchy.get(key) or "").strip()]
        if missing:
            raise RuntimeError(
                f"WP-S001-004 geographic hierarchy is incomplete ({missing}): {hierarchy}"
            )

        environment = location.get("environment") or {}
        if not str(environment.get("biome") or "").strip() or not str(environment.get("climate") or "").strip():
            raise RuntimeError(f"WP-S001-004 environment foundation is incomplete: {environment}")
        if not isinstance(environment.get("elevationMeters"), (int, float)):
            raise RuntimeError(f"WP-S001-004 elevation evidence is missing: {environment}")
        if not str(location.get("terrain") or "").strip():
            raise RuntimeError(f"WP-S001-004 terrain foundation is missing: {location}")

        proof = proofs[0]
        spacing = proof.get("spacing") or {}
        if not spacing.get("pass") or not spacing.get("nearest"):
            raise RuntimeError(f"WP-S001-004 nearest-village spacing proof failed: {spacing}")
        if float(spacing.get("fastestPossibleMinutes") or 0) < float(proof.get("minVillageWalkMinutes") or 60):
            raise RuntimeError(f"WP-S001-004 nearest village is under one fantasy hour: {spacing}")

        if float(proof.get("tileMeters") or 0) != 2:
            raise RuntimeError(f"WP-S001-004 authoritative tile scale is not 2 m: {proof}")
        if float(proof.get("fastestWalkKmh") or 0) != 3.6:
            raise RuntimeError(f"WP-S001-004 fastest normal walk is not 3.6 km/h: {proof}")
        if float(proof.get("minAdjacentMinutes") or 0) < 60:
            raise RuntimeError(
                f"WP-S001-004 village cell+jitter policy can violate one-hour spacing: {proof}"
            )
        return

    if scenario == "wp-s001-001":
        if len(frames) < 5:
            raise RuntimeError("wp-s001-001 requires five evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:5]]

        if any(item.get("campaignState") != "ACTIVE" for item in builds):
            raise RuntimeError(f"WP-S001-001 campaign not ACTIVE in all proof frames: {builds}")

        seeds = [item.get("campaignSeed") for item in builds]
        if not seeds[0] or len(set(seeds)) != 1 or seeds[0] != "The_Advisor_Game_20260924":
            raise RuntimeError(f"WP-S001-001 default/persisted SEED failed: {seeds}")

        starts = [item.get("campaignRealStartMs") for item in builds]
        if not starts[0] or len(set(starts)) != 1:
            raise RuntimeError(f"WP-S001-001 campaign start state changed: {starts}")

        if any(int(item.get("gameTimeMultiplier") or 0) != 24 for item in builds):
            raise RuntimeError(f"WP-S001-001 game-time multiplier is not 24x: {builds}")
        if not all(item.get("startYearValid") for item in builds):
            raise RuntimeError(f"WP-S001-001 fantasy start year validation failed: {builds}")

        timestamps = [float(item.get("gameTimestampMs")) for item in builds if item.get("gameTimestampMs") is not None]
        if len(timestamps) != 5 or not all(ts == ts for ts in timestamps):
            raise RuntimeError(f"WP-S001-001 timestamp evidence invalid: {timestamps}")
        if not (timestamps[1] > timestamps[0] and timestamps[2] >= timestamps[1]):
            raise RuntimeError(f"WP-S001-001 time did not continue across reload: {timestamps}")

        def assert_shell(build, orientation):
            layout = build.get("layout") or {}
            shell = layout.get("screenShell") or {}
            top = layout.get("topRibbon") or {}
            game = layout.get("gameplay") or {}
            status = layout.get("status") or {}
            width = float(layout.get("viewportWidth") or 0)
            height = float(layout.get("viewportHeight") or 0)
            if width <= 0 or height <= 0:
                raise RuntimeError(f"WP-S001-001 missing viewport evidence: {build}")
            if orientation == "portrait" and not height > width:
                raise RuntimeError(f"WP-S001-001 expected portrait viewport: {layout}")
            if orientation == "landscape" and not width > height:
                raise RuntimeError(f"WP-S001-001 expected landscape viewport: {layout}")
            if abs(float(shell.get("height") or 0) - height) > 3:
                raise RuntimeError(f"WP-S001-001 three-row shell does not fill first viewport: {layout}")
            if float(top.get("top") or 0) < -1 or abs(float(status.get("bottom") or 0) - height) > 4:
                raise RuntimeError(f"WP-S001-001 top/status rows do not bound viewport: {layout}")
            if abs(float(game.get("top") or 0) - float(top.get("bottom") or 0)) > 3:
                raise RuntimeError(f"WP-S001-001 gameplay row does not follow ribbon: {layout}")
            if abs(float(game.get("bottom") or 0) - float(status.get("top") or 0)) > 3:
                raise RuntimeError(f"WP-S001-001 status row does not follow gameplay: {layout}")
            if float(layout.get("bodyScrollWidth") or 0) > float(layout.get("bodyClientWidth") or width) + 2:
                raise RuntimeError(f"WP-S001-001 horizontal overflow detected: {layout}")

        assert_shell(builds[2], "portrait")
        assert_shell(builds[3], "landscape")

        settings_layout = builds[4].get("layout") or {}
        settings_rect = settings_layout.get("settingsRect") or {}
        settings_viewport = {
            "width": settings_layout.get("viewportWidth"),
            "height": settings_layout.get("viewportHeight"),
        }
        if settings_layout.get("settingsHidden") is not False:
            raise RuntimeError(f"WP-S001-001 Settings did not open: {settings_layout}")
        if (
            abs(float(settings_rect.get("left") or 0)) > 2
            or abs(float(settings_rect.get("top") or 0)) > 2
            or abs(float(settings_rect.get("width") or 0) - float(settings_viewport.get("width") or 0)) > 4
            or abs(float(settings_rect.get("height") or 0) - float(settings_viewport.get("height") or 0)) > 4
        ):
            raise RuntimeError(f"WP-S001-001 Settings is not full-screen: {settings_layout}")
        return

    if scenario == "save-load":
        if len(frames) < 3:
            raise RuntimeError("save-load requires three evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:3]]
        if any(item.get("campaignState") != "ACTIVE" for item in builds):
            raise RuntimeError(f"WP-S001-001 campaign was not ACTIVE across save/load proof: {builds}")
        seeds = [item.get("campaignSeed") for item in builds]
        if not seeds[0] or len(set(seeds)) != 1:
            raise RuntimeError(f"WP-S001-001 campaign SEED changed across reload: {seeds}")
        if seeds[0] != "The_Advisor_Game_20260924":
            raise RuntimeError(f"WP-S001-001 default SEED mismatch: {seeds[0]}")
        starts = [item.get("campaignRealStartMs") for item in builds]
        if not starts[0] or len(set(starts)) != 1:
            raise RuntimeError(f"WP-S001-001 campaign start state changed across reload: {starts}")
        if any(int(item.get("gameTimeMultiplier") or 0) != 24 for item in builds):
            raise RuntimeError(f"WP-S001-001 game-time multiplier is not 24x: {builds}")
        if not all(item.get("startYearValid") for item in builds):
            raise RuntimeError(f"WP-S001-001 fantasy start year is not real year - 900: {builds}")
        timestamps = [float(item.get("gameTimestampMs") or 0) for item in builds]
        if not all(ts == ts for ts in timestamps):
            raise RuntimeError(f"WP-S001-001 fantasy time returned an invalid timestamp across reload: {timestamps}")
        if not (timestamps[1] > timestamps[0] and timestamps[2] >= timestamps[1]):
            raise RuntimeError(f"WP-S001-001 fantasy time did not continue across reload: {timestamps}")
        if builds[1].get("persistenceStatus") != "PASS" or builds[2].get("persistenceStatus") != "PASS":
            raise RuntimeError(f"WP-S001-001 UI did not confirm restored campaign persistence: {builds}")
        return

    if scenario == "building-presentation":
        if len(frames) < 5:
            raise RuntimeError("building-presentation requires five evidence frames")
        objects = frames[2].get("runtime", {}).get("currentBuild", {}).get("interiorObjects") or {}
        required = ("pass", "deterministic", "uniqueIds", "legalPlacement", "interactionsValid", "blockingPass", "allBuildingsCovered")
        if not all(objects.get(key) for key in required):
            raise RuntimeError(f"WP-S003-003 interior-object proof failed: {objects}")
        if int(objects.get("objectCount") or 0) <= 0 or int(objects.get("buildingCount") or 0) <= 0:
            raise RuntimeError(f"WP-S003-003 interior-object coverage missing: {objects}")
        expected_states = ["outside", "entering", "inside", "behind", "leaving"]
        expected_layers = [
            "ground-floor",
            "lower-structure-objects",
            "shadows",
            "characters-entities",
            "upper-walls-foreground",
            "roof-ceiling",
            "verification-route",
        ]
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:5]]
        protagonist_positions = [item.get("protagonistLocation") for item in builds]
        camera_positions = [item.get("cameraCoordinate") for item in builds]
        if len(set(protagonist_positions)) != 1:
            raise RuntimeError(
                f"WP-S003-004 presentation mutated Protagonist coordinates: {protagonist_positions}"
            )
        if len(set(camera_positions)) != 1:
            raise RuntimeError(
                f"WP-S003-004 presentation mutated camera coordinates: {camera_positions}"
            )

        for index, (item, expected_state) in enumerate(zip(builds, expected_states), start=1):
            gpu = item.get("gpuRenderer") or {}
            presentation = gpu.get("buildingPresentation") or {}
            if presentation.get("proofState") != expected_state:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} proof state mismatch: {presentation}"
                )
            if presentation.get("layerOrder") != expected_layers:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} layer order failed: {presentation}"
                )
            if not presentation.get("simulationAuthorityPreserved"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} lost Simulation authority: {presentation}"
                )
            if int(presentation.get("roofCount") or 0) <= 0:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} has no visible roof presentation: {presentation}"
                )
            if int(presentation.get("visibleWallCapCount") or 0) <= 0:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} has no raised wall presentation: {presentation}"
                )
            if not presentation.get("ySortedEntities"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} entity Y sorting is disabled: {presentation}"
                )

        outside = (builds[0].get("gpuRenderer") or {}).get("buildingPresentation") or {}
        entering = (builds[1].get("gpuRenderer") or {}).get("buildingPresentation") or {}
        inside = (builds[2].get("gpuRenderer") or {}).get("buildingPresentation") or {}
        behind = (builds[3].get("gpuRenderer") or {}).get("buildingPresentation") or {}
        leaving = (builds[4].get("gpuRenderer") or {}).get("buildingPresentation") or {}

        if float(outside.get("roofAlpha") or 0) < 0.5 or outside.get("cutawayActive"):
            raise RuntimeError(f"WP-S003-004 outside roof must be visible: {outside}")
        if float(entering.get("roofAlpha") or 1) >= 0.5 or not entering.get("cutawayActive"):
            raise RuntimeError(f"WP-S003-004 entering roof transition failed: {entering}")
        for state_name, presentation in (("inside", inside), ("behind", behind)):
            if float(presentation.get("roofAlpha") or 1) >= 0.5 or not presentation.get("cutawayActive"):
                raise RuntimeError(
                    f"WP-S003-004 {state_name} roof cutaway failed: {presentation}"
                )
        if not behind.get("proofObjectId") or int(behind.get("foregroundObjectCount") or 0) <= 0:
            raise RuntimeError(
                f"WP-S003-004 foreground-object occlusion proof failed: {behind}"
            )
        if float(leaving.get("roofAlpha") or 0) < 0.5 or leaving.get("cutawayActive"):
            raise RuntimeError(f"WP-S003-004 leaving roof restore failed: {leaving}")
        return

    if scenario == "starting-village":
        if len(frames) < 3:
            raise RuntimeError("starting-village requires three evidence frames")
        current = frames[1].get("runtime", {}).get("currentBuild", {})
        gateway_frame = frames[2].get("runtime", {}).get("currentBuild", {})
        gpu = current.get("gpuRenderer") or {}
        cache = gpu.get("textureCache") or {}
        if not gpu.get("webgl"):
            raise RuntimeError(f"WP-S003-001 is not using WebGL: {gpu}")
        if int(gpu.get("canvasCount") or 0) != 1:
            raise RuntimeError(f"WP-S003-001 expected one gameplay canvas: {gpu}")
        if int(gpu.get("domTerrainTileCount") or 0) != 0:
            raise RuntimeError(f"WP-S003-001 still renders DOM terrain tiles: {gpu}")
        if not gpu.get("logicalTextureKeyPass"):
            raise RuntimeError(f"WP-S003-001 logical texture-key resolution failed: {gpu}")
        if int(gpu.get("standardTerrainTexturePx") or 0) != 100:
            raise RuntimeError(f"WP-S003-001 terrain texture standard is not 100px: {gpu}")
        if not cache.get("ready") or int(cache.get("svgSourceCount") or 0) <= 0:
            raise RuntimeError(f"WP-S003-001 SVG draft texture cache is not ready: {gpu}")
        proof = current.get("startingVillage") or {}
        if not proof.get("deterministic"):
            raise RuntimeError(f"Starting Village is not deterministic: {proof}")
        if not proof.get("originInsideVillage"):
            raise RuntimeError(f"Protagonist origin is not inside Starting Village: {proof}")
        if not proof.get("mainlandConnected") or int(proof.get("roadGapCount", -1)) != 0:
            raise RuntimeError(f"Starting Village has no continuous mainland connection: {proof}")
        if not proof.get("bridgePass"):
            raise RuntimeError(f"Starting Village bridge limit failed: {proof}")
        if int(proof.get("plotCount") or 0) < 6:
            raise RuntimeError(f"Starting Village lacks reserved plots: {proof}")
        if proof.get("planningOrder") != ["roads", "buildings", "important-objects", "terrain"]:
            raise RuntimeError(f"World planning order is invalid: {proof}")
        if not proof.get("buildingReservationPass"):
            raise RuntimeError(f"Building/road reservation overlap detected: {proof}")
        if int(proof.get("plotRoadOverlapCount") or 0) != 0:
            raise RuntimeError(f"Road destroys building plot cells: {proof}")
        if int(proof.get("plotSquareOverlapCount") or 0) != 0:
            raise RuntimeError(f"Public square overlaps building plot cells: {proof}")
        if int(proof.get("plotPathOverlapCount") or 0) != 0:
            raise RuntimeError(f"Local path overlaps building plot cells: {proof}")
        house = current.get("housePlans") or {}
        if not house.get("pass") or not house.get("deterministic"):
            raise RuntimeError(f"WP-007B house plan proof failed: {house}")
        if int(house.get("buildingCount") or 0) < 6:
            raise RuntimeError(f"WP-007B building count is incomplete: {house}")
        if int(house.get("minimumRoomTiles") or 0) < 6:
            raise RuntimeError(f"WP-007B room minimum failed: {house}")
        if not house.get("outerWallsPass") or not house.get("interiorWallsPass"):
            raise RuntimeError(f"WP-007B wall plan failed: {house}")
        if not house.get("entrancesPass"):
            raise RuntimeError(f"WP-007B entrance access failed: {house}")
        if int(house.get("svgTileCount") or 0) <= 0 or int(house.get("pngTileCount") or 0) != 0:
            raise RuntimeError(f"WP-007B vector tile rendering failed: {house}")
        if int(house.get("blendLayerCount") or 0) <= 0:
            raise RuntimeError(f"WP-007C rounded terrain blending did not render: {house}")
        if house.get("shapeProof") != ["corner", "diagonal", "edge", "island", "peninsula"]:
            raise RuntimeError(f"WP-007E rounded blend shape registry failed: {house}")
        if not house.get("diagonalRegistryPass") or not house.get("junctionPriorityPass"):
            raise RuntimeError(f"WP-007E diagonal/junction smoothing proof failed: {house}")
        if not house.get("blendDeterministic"):
            raise RuntimeError(f"WP-007D deterministic blend variation failed: {house}")
        if house.get("registryVariants") != ["a", "b"]:
            raise RuntimeError(f"WP-007D A/B blend variants are not both reachable: {house}")
        special = current.get("specialLots") or {}
        if not special.get("pass") or not special.get("deterministic"):
            raise RuntimeError(f"WP-008 special lot proof failed: {special}")
        if int(special.get("lotCount") or 0) != 7:
            raise RuntimeError(f"WP-008 special lot count is invalid: {special}")
        if int(special.get("enterableCount") or 0) != 6 or int(special.get("outdoorCount") or 0) != 1:
            raise RuntimeError(f"WP-008 enterable/outdoor mix is invalid: {special}")
        if not special.get("typeCoveragePass") or not special.get("entrancesPass") or not special.get("overlapPass"):
            raise RuntimeError(f"WP-008 lot coverage/access/overlap proof failed: {special}")
        for key in ("roadOverlapCount","waterOverlapCount","houseOverlapCount","lotOverlapCount"):
            if int(special.get(key) or 0) != 0:
                raise RuntimeError(f"WP-008 invalid overlap {key}: {special}")
        if int(special.get("visibleSpecialCellCount") or 0) <= 0:
            raise RuntimeError(f"WP-008 special lots are not visible in broad village evidence: {special}")
        walk = current.get("walkability") or {}
        if not walk.get("pass") or not walk.get("deterministic"):
            raise RuntimeError(f"WP-009 walkability proof failed: {walk}")
        if not walk.get("classificationCoverage") or not walk.get("visibleCoveragePass"):
            raise RuntimeError(f"WP-009 classification coverage failed: {walk}")
        if int(walk.get("visibleClassifiedCount") or 0) != int(walk.get("visibleTileCount") or 0):
            raise RuntimeError(f"WP-009 visible tile classification mismatch: {walk}")
        structure = walk.get("structure") or {}
        required_structure_checks = (
            "outerWallsPass",
            "exteriorDoorsPass",
            "interiorsPass",
            "interiorWallsPass",
            "interiorDoorsPass",
            "workyardPass",
            "accessTargetsPass",
        )
        if not all(structure.get(key) for key in required_structure_checks):
            raise RuntimeError(f"WP-009 building collision rules failed: {walk}")
        if int(structure.get("interiorWallSamples") or 0) <= 0:
            raise RuntimeError(f"WP-009 did not verify interior wall barriers: {walk}")
        if int(structure.get("interiorDoorSamples") or 0) <= 0:
            raise RuntimeError(f"WP-009 did not verify interior door passages: {walk}")
        if not walk.get("waterRulePass") or not walk.get("routeRulesPass") or not walk.get("difficultRulesPass"):
            raise RuntimeError(f"WP-009 terrain movement rules failed: {walk}")
        route = current.get("routePlanner") or {}
        if not route.get("pass") or not route.get("deterministic"):
            raise RuntimeError(f"WP-S002-004 route-planning proof failed: {route}")
        if not route.get("obeysWalkability") or not route.get("movementCostPass"):
            raise RuntimeError(f"WP-S002-004 route violates authoritative walkability/costs: {route}")
        if not route.get("blockedDestinationRejected"):
            raise RuntimeError(f"WP-S002-004 blocked destination was not rejected: {route}")
        if not route.get("usesExteriorEntrance") or not route.get("destinationInterior"):
            raise RuntimeError(f"WP-S002-004 proof route did not enter a building correctly: {route}")
        if not route.get("localEvaluationPass"):
            raise RuntimeError(f"WP-S002-004 route search exceeded local bounded-search rules: {route}")
        if int(route.get("stepCount") or 0) <= 0 or int(route.get("evaluatedCount") or 0) <= 0:
            raise RuntimeError(f"WP-S002-004 route evidence is empty: {route}")
        if int(route.get("visibleRouteTileCount") or 0) <= 0:
            raise RuntimeError(f"WP-S002-004 route is not visible in broad village evidence: {route}")
        interiors = current.get("buildingInteriors") or {}
        if not interiors.get("pass") or not interiors.get("deterministic"):
            raise RuntimeError(f"WP-S003-002 authoritative interior proof failed: {interiors}")
        if int(interiors.get("buildingCount") or 0) != 12:
            raise RuntimeError(f"WP-S003-002 expected 12 accessible interiors: {interiors}")
        if int(interiors.get("houseCount") or 0) != 6 or int(interiors.get("specialBuildingCount") or 0) != 6:
            raise RuntimeError(f"WP-S003-002 house/special interior coverage failed: {interiors}")
        if int(interiors.get("level") if interiors.get("level") is not None else -1) != 0 or not interiors.get("allLevelZero"):
            raise RuntimeError(f"WP-S003-002 discrete navigation level failed: {interiors}")
        if not interiors.get("allConnected"):
            raise RuntimeError(f"WP-S003-002 exterior-door continuity failed: {interiors}")
        if not interiors.get("allFloorsDoorsWalkable") or not interiors.get("allWallsBlocked"):
            raise RuntimeError(f"WP-S003-002 interior collision/walkability failed: {interiors}")
        if not interiors.get("allForward") or not interiors.get("allReverse"):
            raise RuntimeError(f"WP-S003-002 bidirectional interior routing failed: {interiors}")
        for building in interiors.get("buildings") or []:
            if not building.get("pass"):
                raise RuntimeError(f"WP-S003-002 building interior failed: {building}")
            if not building.get("forwardPass") or not building.get("reversePass"):
                raise RuntimeError(f"WP-S003-002 building route failed: {building}")
            if not building.get("continuousDoor"):
                raise RuntimeError(f"WP-S003-002 building door continuity failed: {building}")
            if not building.get("wallsBlocked") or not building.get("floorsWalkable") or not building.get("doorsWalkable"):
                raise RuntimeError(f"WP-S003-002 building collision proof failed: {building}")
        grid = current.get("terrainGrid") or {}
        gateway_grid = gateway_frame.get("terrainGrid") or {}
        if not grid.get("coveragePass") or not gateway_grid.get("coveragePass"):
            raise RuntimeError(
                f"Starting Village frame lost viewport coverage: center={grid}, gateway={gateway_grid}"
            )
        if gateway_frame.get("cameraCoordinate") == current.get("cameraCoordinate"):
            raise RuntimeError("Starting Village gateway evidence did not move the camera")
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

    if scenario == "responsive-cycle":
        if len(frames) < 5:
            raise RuntimeError("responsive-cycle requires five evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:5]]
        decks = [item.get("responsiveControlDeck") or {} for item in builds]

        landscape_start, portrait_top, portrait_touch, portrait_mouse, landscape_keyboard = decks

        if landscape_start.get("portrait") is not False:
            raise RuntimeError(f"WP-S003-008 frame 1 is not landscape: {landscape_start}")
        ratio = float(landscape_start.get("deckHeightRatio") or 0)
        if abs(ratio - 0.25) > 0.025:
            raise RuntimeError(f"WP-S003-008 landscape deck is not 25vh: {landscape_start}")
        if not landscape_start.get("sideBySide"):
            raise RuntimeError(f"WP-S003-008 landscape panels are not side by side: {landscape_start}")
        if not landscape_start.get("advisorInInteractions"):
            raise RuntimeError(f"WP-S003-008 Advisor is not inside Character Interactions: {landscape_start}")

        if not portrait_top.get("portrait") or not portrait_top.get("controlsBelowGameplay"):
            raise RuntimeError(f"WP-S003-008 portrait control deck is not below gameplay: {portrait_top}")
        if float(portrait_top.get("scrollY") or 0) > 8:
            raise RuntimeError(f"WP-S003-008 portrait proof did not begin at gameplay: {portrait_top}")
        if not portrait_top.get("downVisible"):
            raise RuntimeError(f"WP-S003-008 portrait down navigation is not visible: {portrait_top}")

        if not portrait_touch.get("portrait") or not portrait_touch.get("deckVisible"):
            raise RuntimeError(f"WP-S003-008 touch navigation did not reveal controls: {portrait_touch}")
        if not portrait_touch.get("touchUsed"):
            raise RuntimeError(f"WP-S003-008 touch input path was not recorded: {portrait_touch}")
        if not portrait_touch.get("upVisible"):
            raise RuntimeError(f"WP-S003-008 portrait up navigation is not visible over controls: {portrait_touch}")

        info = (portrait_mouse.get("panels") or {}).get("info") or {}
        if not portrait_mouse.get("mouseUsed") or not info.get("collapsed"):
            raise RuntimeError(f"WP-S003-008 mouse accordion interaction failed: {portrait_mouse}")

        ratio = float(landscape_keyboard.get("deckHeightRatio") or 0)
        if landscape_keyboard.get("portrait") or abs(ratio - 0.25) > 0.025:
            raise RuntimeError(f"WP-S003-008 did not restore 25vh landscape deck: {landscape_keyboard}")
        if not landscape_keyboard.get("sideBySide") or not landscape_keyboard.get("keyboardUsed"):
            raise RuntimeError(f"WP-S003-008 landscape keyboard/panel proof failed: {landscape_keyboard}")

        for index, deck in enumerate(decks, start=1):
            if deck.get("horizontalOverflow"):
                raise RuntimeError(f"WP-S003-008 horizontal overflow in frame {index}: {deck}")
            if not deck.get("advisorInInteractions"):
                raise RuntimeError(f"WP-S003-008 Advisor placement failed in frame {index}: {deck}")
            if int(deck.get("gameplayCanvasCount") or 0) != 1:
                raise RuntimeError(f"WP-S003-008 gameplay canvas count changed in frame {index}: {deck}")

        protagonist_positions = [item.get("protagonistLocation") for item in builds]
        camera_positions = [item.get("cameraCoordinate") for item in builds]
        if len(set(protagonist_positions)) != 1 or len(set(camera_positions)) != 1:
            raise RuntimeError(
                f"WP-S003-008 UI navigation mutated authoritative coordinates: protagonist={protagonist_positions}, camera={camera_positions}"
            )
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
    pause_seconds: float = 0.0,
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
                if scenario == "building-presentation":
                    action = _run_scenario_step(driver, scenario, index, width, height)
                    time.sleep(interval)
                elif index:
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

            if pause_seconds > 0:
                print(f"Pausing browser for {pause_seconds:.1f}s before close")
                time.sleep(pause_seconds)

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
        "--pause-seconds",
        type=float,
        default=0.0,
        help="Keep the browser open for manual inspection before it closes.",
    )
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
        pause_seconds=max(0.0, args.pause_seconds),
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
