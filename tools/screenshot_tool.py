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
    "building-occlusion",
    "wp-s001-001",
    "wp-s001-004",
    "wp-s003-005",
    "playcanvas-foundation",
    "playcanvas-scene",
    "wp-s003-003",
    "wp-s003-004-002",
    "wp-s003-005-002",
    "wp-s003-006-002",
    "wp-s003-006-001",
    "wp-s003-006",
    "wp-s003-006-003",
    "playcanvas-root-cutover",
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
    "building-occlusion": 6,
    "wp-s001-001": 5,
    "wp-s001-004": 2,
    "wp-s003-005": 3,
    "playcanvas-foundation": 3,
    "playcanvas-scene": 6,
    "wp-s003-003": 3,
    "wp-s003-004-002": 8,
    "wp-s003-005-002": 4,
    "wp-s003-006-002": 8,
    "wp-s003-006-001": 14,
    "wp-s003-006": 7,
    "wp-s003-006-003": 7,
    "playcanvas-root-cutover": 3,
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
    const camera = window.Camera;
    if (!camera || typeof camera.setZoom !== 'function' || typeof camera.MIN_ZOOM !== 'number') {
      done({ok: false, reason: 'camera-api-not-found'});
      return;
    }
    const zoom = camera.setZoom(camera.MIN_ZOOM);
    if (window.AppUI?.refreshTerrain) await window.AppUI.refreshTerrain();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    done({ok: true, zoom, minZoom: camera.MIN_ZOOM});
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
    const gridNode = document.querySelector('#terrainGrid');
    const grid = renderer.grid || (gridNode ? {
      columns: Number(gridNode.dataset.columns || 0),
      rows: Number(gridNode.dataset.rows || 0),
      tileSize: Number(gridNode.dataset.tileSize || 0),
      viewportWidth: Number(gridNode.dataset.viewportWidth || 0),
      viewportHeight: Number(gridNode.dataset.viewportHeight || 0),
      gridWidth: Number(gridNode.dataset.gridWidth || 0),
      gridHeight: Number(gridNode.dataset.gridHeight || 0),
      regionKey: gridNode.dataset.regionKey || null,
      coveragePass: gridNode.dataset.coveragePass === 'true',
      centerPass: gridNode.dataset.centerPass === 'true',
    } : null);
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
      assetStandardProof: window.WP_S003_005_002_EVIDENCE || null,
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
        terrainPreloadSettings: window.TerrainChunkPreloadSettings?.get?.() || null,
        terrainChunkSizeSetting: window.TerrainChunkSizeSettings?.get?.() || null,
        terrainChunkSizeControl: (() => {
          const select=document.querySelector('#terrainChunkSizeSelect');
          const popup=document.querySelector('#settingsPopup');
          return {
            present:Boolean(select),
            value:select?.value || null,
            options:select ? Array.from(select.options).map(option => Number(option.value)) : [],
            settingsOpen:popup ? !popup.hidden : false,
          };
        })(),
        terrainChunkWorldIdentity: (() => {
          try {
            const seed=window.SeedSystem?.getCampaign?.()?.seed;
            if(!seed||!window.TerrainFoundation?.getTile)return null;
            const points=[[0,0],[7,0],[8,0],[15,0],[16,0],[31,0],[32,0],[63,0],[64,0],[127,0],[128,0]];
            return points.map(([x,y]) => {
              const tile=window.TerrainFoundation.getTile(seed,String(x),String(y));
              return {x,y,type:String(tile?.type||''),buildingId:tile?.buildingId?String(tile.buildingId):null,specialKind:tile?.specialKind?String(tile.specialKind):null};
            });
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        terrainPreloadControls: {
          preloadRadius: document.querySelector('#terrainPreloadRadiusSelect')?.value || null,
          maxCachedChunks: document.querySelector('#terrainCacheCapacitySelect')?.value || null,
          directionalPreload: document.querySelector('#directionalPreloadToggle')?.checked ?? null,
          backgroundChunkGeneration: document.querySelector('#backgroundChunkGenerationToggle')?.checked ?? null,
        },
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
            settingsRect:rect('#settingsPopup'),
            characterProofPanel:rect('.character-billboard-proof-panel')
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
          engine: renderer.engine || null,
          engineVersion: renderer.engineVersion || null,
          rendererContractVersion: renderer.rendererContractVersion || null,
          backend: renderer.backend || null,
          requestedBackend: renderer.requestedBackend || null,
          gpu: Boolean(renderer.gpu),
          webgl: Boolean(renderer.webgl),
          webgpu: Boolean(renderer.webgpu),
          webgpuAvailable: Boolean(renderer.webgpuAvailable),
          migrationFoundation: Boolean(renderer.migrationFoundation),
          sceneBaseline: Boolean(renderer.sceneBaseline),
          simulationAuthorityPreserved: renderer.simulationAuthorityPreserved !== false,
          simulationSnapshot: renderer.simulationSnapshot || null,
          canvas: renderer.canvas || null,
          quality: renderer.quality || null,
          scene: renderer.scene || null,
          performance: renderer.performance || null,
          canvasCount: Number(renderer.canvasCount || 0),
          domTerrainTileCount: Number(renderer.domTerrainTileCount || 0),
          logicalTextureKeyPass: Boolean(renderer.logicalTextureKeyPass),
          protagonistVisible: Boolean(renderer.protagonistVisible),
          characterPresentation: renderer.characterPresentation || null,
          standardTerrainTexturePx: Number(renderer.standardTerrainTexturePx || 0),
          visibleRegionKey: renderer.regionKey || document.querySelector('#terrainGrid')?.dataset?.regionKey || null,
          preparedRegionKey: assets.preparedRegionKey || null,
          preparedKeyCount: Number(assets.preparedKeyCount || 0),
          buildingPresentation: renderer.buildingPresentation || null,
          buildingOcclusion: renderer.buildingOcclusion || null,
          textureCache: assets,
          terrainChunks: renderer.terrainChunks || null,
          terrainPreload: renderer.terrainPreload || null,
          terrainCacheTelemetry: window.AppUI?.terrainCacheTelemetry?.() || null,
          interiorObjectPresentation: renderer.interiorObjectPresentation || null,
          assetPreparationProof: renderer.assetPreparationProof || null,
          worldAssetPreparation: renderer.worldAssetPreparation || null,
          worldAssetCache: renderer.worldAssetCache || null,
          worldAssetProof: renderer.worldAssetProof || null,
          characterAssetPreparation: renderer.characterAssetPreparation || null,
          characterProof: renderer.characterProof || null,
          bootstrapMode: window.RendererBootstrap?.status?.().mode || null,
          bootstrapLegacyAvailable: Boolean(window.RendererBootstrap?.status?.().legacyRendererAvailable),
          pixiLoaded: Boolean(window.PIXI),
          legacyGameRendererLoaded: Boolean(window.LegacyGameRenderer),
          pixiScriptLoaded: Array.from(document.scripts).some(script => /pixi/i.test(script.src || "")),
          legacyRendererScriptLoaded: Array.from(document.scripts).some(script => /game-renderer\.js(?:\?|$)/.test(script.src || "")),
          locationSearch: location.search || "",
          rendererParam: new URLSearchParams(location.search).get("renderer"),
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
        print(f"Forced maximum zoom-out: {result}")
        time.sleep(max(0.0, settle_seconds))
    else:
        reason = result.get("reason", "unknown") if isinstance(result, dict) else "unexpected-result"
        print(f"Zoom-out skipped: {reason}")


def prepare_current_build(driver, timeout: float = 10.0, scenario: str = "static") -> str:
    if scenario == "wp-s003-005":
        # Use a representative desktop/tablet-landscape viewport so the prepared
        # glTF/material proof is readable instead of being lost inside an ultra-wide
        # evidence canvas. Camera/world coordinates remain independently validated.
        driver.set_window_size(1280, 800)
    if scenario == "wp-s003-006-003":
        driver.set_window_size(1280, 800)
        timeout = max(timeout, 30.0)
    if scenario == "wp-s003-005-002":
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(
                "return Boolean(window.WP_S003_005_002_EVIDENCE?.ready)"
            )
        )
        return "asset-standard-proof-ready"
    result = driver.execute_script(CURRENT_BUILD_PREP_SCRIPT)
    action = result.get("action", "unknown") if isinstance(result, dict) else "unknown"

    if action in {"started-current-campaign", "campaign-already-active"}:
        try:
            from selenium.webdriver.support.ui import WebDriverWait

            if scenario == "wp-s003-006-001":
                _set_terrain_preload_settings(
                    driver, radius=1, cache=256, directional=True, background=False
                )
            if scenario == "wp-s003-006":
                _set_terrain_preload_settings(
                    driver, radius=2, cache=256, directional=True, background=True
                )
            if scenario == "wp-s003-006-003":
                _set_terrain_preload_settings(
                    driver, radius=1, cache=256, directional=True, background=True
                )

            if scenario in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-006-002", "wp-s003-006-001", "wp-s003-006", "wp-s003-006-003", "playcanvas-root-cutover"}:
                WebDriverWait(driver, timeout).until(
                    lambda d: d.execute_script(
                        """
                        const grid = document.querySelector('#terrainGrid');
                        const renderer = window.GameRenderer?.snapshot?.();
                        return Boolean(
                          grid && !grid.hidden &&
                          renderer?.ready &&
                          renderer?.engine === 'PlayCanvas' &&
                          renderer?.gpu &&
                          Number(renderer?.canvasCount || 0) === 1 &&
                          renderer?.simulationAuthorityPreserved !== false &&
                          (arguments[0] !== 'playcanvas-scene' || (
                            renderer?.sceneBaseline === true &&
                            renderer?.scene?.projection === 'orthographic'
                          )) &&
                          (arguments[0] !== 'wp-s003-006-002' || (
                            renderer?.terrainPreload &&
                            Number(renderer.terrainPreload.Active || 0) > 0 &&
                            Number(renderer.terrainPreload.queueDepth || 0) === 0
                          )) &&
                          (arguments[0] !== 'wp-s003-006' || (
                            renderer?.terrainPreload &&
                            renderer?.terrainChunks?.resourceKind === 'chunk-mesh' &&
                            Number(renderer.terrainChunks.visibleChunkCount || 0) > 0 &&
                            Number(renderer.terrainPreload.Prepared || 0) > 0 &&
                            Number(renderer.terrainPreload.queueDepth || 0) === 0
                          )) &&
                          (arguments[0] !== 'wp-s003-006-003' || (() => {
                            const preload = renderer?.terrainPreload || {};
                            const chunks = renderer?.terrainChunks || {};
                            const world = chunks?.worldData || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              chunks.completeChunkWorldData === true &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              Number(preload.Prepared || 0) > 0 &&
                              Number(preload.queueDepth || 0) === 0 &&
                              world.stableChunkIdentity === true &&
                              world.completeChunksOnly === true &&
                              world.seedDerivedPresentation === true &&
                              world.hardCodedSampleGeometry === false &&
                              chunks.seedDerivedPresentation === true &&
                              chunks.hardCodedSampleGeometry === false &&
                              chunks.normalWorldSource === 'seed-chunk-world-data' &&
                              renderer?.scene?.normalWorldSource === 'seed-chunk-world-data' &&
                              renderer?.scene?.hardCodedSampleGeometry === false &&
                              Number(renderer?.scene?.sampleVillageEntityCount || 0) === 0 &&
                              Number(chunks.buildingPresentationCount || 0) > 0 &&
                              Number(chunks.roadCellCount || 0) > 0 &&
                              Number(chunks.terrainTypeCount || 0) >= 2 &&
                              Number(world.entryCount || 0) > 0 &&
                              Number(world.completeEntryCount || 0) === Number(world.entryCount || 0) &&
                              Number(world.surfaceCellCount || 0) > 0 &&
                              Number(world.terrainFoundationCalls || 0) === Number(world.walkabilityClassifications || 0)
                            );
                          })())
                        );
                        """
                    , scenario)
                )
            else:
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


def validate_current_build_snapshot(snapshot: dict, *, require_coverage: bool = True) -> None:
    current = snapshot.get("currentBuild") if isinstance(snapshot, dict) else None
    if not isinstance(current, dict):
        return
    grid = current.get("terrainGrid")
    if not isinstance(grid, dict):
        raise RuntimeError("Current build terrain-grid evidence is missing")
    if require_coverage and not grid.get("coveragePass"):
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


def _wait_for_playcanvas_world_assets(driver, timeout: float = 15.0) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    result = WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            const snap=window.GameRenderer?.snapshot?.();
            const prep=snap?.worldAssetPreparation;
            const cache=snap?.worldAssetCache;
            const proof=snap?.worldAssetProof;
            if (!snap?.ready || snap?.engine !== 'PlayCanvas') return null;
            if (
              prep?.ready !== true ||
              Number(prep?.regionCount || 0) < 1 ||
              Number(prep?.keyCount || 0) < 1 ||
              Number(cache?.pending || 0) !== 0 ||
              Number(cache?.networkLoads || 0) < 1 ||
              Number(cache?.containerParses || 0) < 1 ||
              proof?.preparedRegions !== true
            ) return null;
            return {
              regionCount:Number(prep.regionCount || 0),
              keyCount:Number(prep.keyCount || 0),
              networkLoads:Number(cache.networkLoads || 0),
              containerParses:Number(cache.containerParses || 0),
              hits:Number(cache.hits || 0)
            };
            """
        )
    )
    return (
        "playcanvas-world-assets-ready:"
        f"regions={int(result.get('regionCount') or 0)},"
        f"keys={int(result.get('keyCount') or 0)},"
        f"loads={int(result.get('networkLoads') or 0)},"
        f"parses={int(result.get('containerParses') or 0)},"
        f"hits={int(result.get('hits') or 0)}"
    )


def _set_asset_preparation_proof(driver, enabled: bool) -> str:
    result = driver.execute_script(
        """
        const renderer=window.GameRenderer;
        if(!renderer?.setAssetPreparationProofState) return {ok:false,reason:'proof-api-missing'};
        try{
          const snap=renderer.setAssetPreparationProofState(Boolean(arguments[0]));
          return {ok:true,proof:snap?.assetPreparationProof||null};
        }catch(error){
          return {ok:false,reason:String(error)};
        }
        """,
        bool(enabled),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set WP-S003-005 asset proof state: {result}")
    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, 8).until(
        lambda d: bool(
            d.execute_script(
                "return window.GameRenderer?.snapshot?.()?.assetPreparationProof?.active === arguments[0]",
                bool(enabled),
            )
        )
    )
    return f"asset-preparation-proof:{'on' if enabled else 'off'}"


def _drag_canvas_and_wait(driver, dx: int, dy: int, timeout: float = 10.0) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    before = driver.execute_script(
        "return document.querySelector('#cameraCoordinate')?.textContent?.trim() || null"
    )
    action = _drag_canvas(driver, dx, dy)
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            "return document.querySelector('#cameraCoordinate')?.textContent?.trim() || null"
        ) != before
    )
    return action + ":prepared"


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


def _set_building_occlusion_proof_state(driver, state: str) -> str:
    result = driver.execute_script(
        """
        const state = arguments[0];
        try {
          const renderer = window.GameRenderer;
          if (!renderer?.setBuildingOcclusionProofState) {
            return {ok:false, reason:'building-occlusion-proof-api-missing'};
          }
          const snapshot = renderer.setBuildingOcclusionProofState(state);
          try { window.AppUI?.refreshBuildingPresentation?.(); } catch (_) {}
          return {
            ok:true,
            occlusion:snapshot?.buildingOcclusion || null,
            presentation:snapshot?.buildingPresentation || null
          };
        } catch (error) {
          return {ok:false, reason:String(error)};
        }
        """,
        state,
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"building-occlusion-proof:{state}"
    reason = result.get("reason", "unavailable") if isinstance(result, dict) else "unexpected"
    return f"building-occlusion-proof-failed:{state}:{reason}"




def _set_interior_object_proof_state(driver, state: str) -> str:
    result = driver.execute_script(
        """
        const state = arguments[0];
        try {
          const renderer = window.GameRenderer;
          if (!renderer?.setInteriorObjectProofState) {
            return {ok:false, reason:'interior-object-proof-api-missing'};
          }
          const snapshot = renderer.setInteriorObjectProofState(state);
          return {
            ok:true,
            presentation:snapshot?.interiorObjectPresentation || null
          };
        } catch (error) {
          return {ok:false, reason:String(error)};
        }
        """,
        state,
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"interior-object-proof:{state}"
    reason = result.get("reason", "unavailable") if isinstance(result, dict) else "unexpected"
    return f"interior-object-proof-failed:{state}:{reason}"



def _set_character_proof_state(driver, state: str) -> str:
    result = driver.execute_script(
        """
        const state = arguments[0];
        try {
          const renderer = window.GameRenderer;
          if (!renderer?.setCharacterProofState) {
            return {ok:false, reason:'character-proof-api-missing'};
          }
          const snapshot = renderer.setCharacterProofState(state);
          return {
            ok:true,
            proof:snapshot?.characterProof || null,
            presentation:snapshot?.characterPresentation || null
          };
        } catch (error) {
          return {ok:false, reason:String(error)};
        }
        """,
        state,
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"character-proof:{state}"
    reason = result.get("reason", "unavailable") if isinstance(result, dict) else "unexpected"
    return f"character-proof-failed:{state}:{reason}"



def _set_terrain_preload_settings(driver, *, radius: int, cache: int, directional: bool, background: bool) -> str:
    result = driver.execute_script(
        """
        const settings = window.TerrainChunkPreloadSettings;
        if (!settings?.set) return {ok:false, reason:'terrain-preload-settings-missing'};
        const next = settings.set({
          preloadRadius: arguments[0],
          maxCachedChunks: arguments[1],
          directionalPreload: arguments[2],
          backgroundChunkGeneration: arguments[3]
        });
        return {ok:true, settings:next};
        """,
        int(radius), int(cache), bool(directional), bool(background),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set terrain preload settings: {result}")

    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            """
            const s = window.GameRenderer?.snapshot?.()?.terrainPreload;
            return Boolean(
              s &&
              Number(s.settings?.preloadRadius) === arguments[0] &&
              Number(s.settings?.maxCachedChunks) === arguments[1] &&
              Boolean(s.settings?.directionalPreload) === arguments[2] &&
              Boolean(s.settings?.backgroundChunkGeneration) === arguments[3] &&
              Number(s.queueDepth || 0) === 0
            );
            """,
            int(radius), int(cache), bool(directional), bool(background),
        )
    )
    return f"preload:r{radius}:c{cache}:d{int(directional)}:b{int(background)}"


def _set_terrain_chunk_size(driver, size: int) -> str:
    if int(size) not in (8, 16, 32, 64):
        raise RuntimeError(f"Unsupported terrain chunk size for evidence: {size}")
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        (async () => {
          try {
            const settings=window.TerrainChunkSizeSettings;
            if(!settings?.set||!window.AppUI?.refreshTerrain){
              done({ok:false,reason:'terrain-chunk-size-api-missing'});
              return;
            }
            const before=window.GameRenderer?.snapshot?.()?.terrainPreload || null;
            const selected=settings.set(Number(arguments[0]));
            await Promise.resolve(window.AppUI.refreshTerrain());
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            done({ok:true,selected,before,after:window.GameRenderer?.snapshot?.()?.terrainPreload || null});
          } catch (error) {
            done({ok:false,reason:String(error)});
          }
        })();
        """,
        int(size),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set terrain chunk size {size}: {result}")
    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, 20).until(
        lambda d: d.execute_script(
            """
            const setting=window.TerrainChunkSizeSettings?.get?.();
            const snap=window.GameRenderer?.snapshot?.();
            const preload=snap?.terrainPreload;
            const chunks=snap?.terrainChunks;
            return Boolean(
              Number(setting?.chunkSize||0)===arguments[0] &&
              Number(preload?.chunkSize||0)===arguments[0] &&
              String(preload?.signature||'').startsWith('chunk='+arguments[0]+'|') &&
              Number(preload?.queueDepth||0)===0 &&
              chunks?.resourceKind==='chunk-mesh' &&
              Number(chunks?.visibleChunkCount||0)>0
            );
            """,
            int(size),
        )
    )
    return f"chunk-size:{size}"


def _set_camera_center_and_render(driver, x: int, y: int) -> str:
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        try {
          if (!window.Camera?.setCenter || !window.AppUI?.refreshTerrain) {
            done({ok:false, reason:'camera-refresh-api-missing'});
            return;
          }
          window.Camera.setCenter(String(arguments[0]), String(arguments[1]));
          Promise.resolve(window.AppUI.refreshTerrain())
            .then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            .then(() => done({
              ok:true,
              center:window.Camera.getCenter(),
              terrainPreload:window.GameRenderer?.snapshot?.()?.terrainPreload || null
            }))
            .catch(error => done({ok:false, reason:String(error)}));
        } catch (error) {
          done({ok:false, reason:String(error)});
        }
        """,
        int(x), int(y),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to move camera and render: {result}")

    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            """
            const camera = window.Camera?.getCenter?.();
            const frame = window.GameRenderer?.snapshot?.()?.frame;
            const preload = window.GameRenderer?.snapshot?.()?.terrainPreload;
            return Boolean(
              camera && frame?.center &&
              String(camera.x) === String(arguments[0]) &&
              String(camera.y) === String(arguments[1]) &&
              String(frame.center.x) === String(arguments[0]) &&
              String(frame.center.y) === String(arguments[1]) &&
              Number(preload?.queueDepth || 0) === 0
            );
            """,
            str(x), str(y),
        )
    )
    return f"camera-center:{x},{y}"



def _set_camera_center_and_render_active(driver, x: int, y: int) -> str:
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        try {
          if (!window.Camera?.setCenter || !window.AppUI?.refreshTerrain) {
            done({ok:false, reason:'camera-refresh-api-missing'});
            return;
          }
          window.Camera.setCenter(String(arguments[0]), String(arguments[1]));
          Promise.resolve(window.AppUI.refreshTerrain())
            .then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            .then(() => done({
              ok:true,
              center:window.Camera.getCenter(),
              terrainPreload:window.GameRenderer?.snapshot?.()?.terrainPreload || null
            }))
            .catch(error => done({ok:false, reason:String(error)}));
        } catch (error) {
          done({ok:false, reason:String(error)});
        }
        """,
        int(x), int(y),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to move camera and render: {result}")

    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            """
            const camera = window.Camera?.getCenter?.();
            const snap = window.GameRenderer?.snapshot?.();
            const frame = snap?.frame;
            const chunks = snap?.terrainChunks;
            return Boolean(
              camera && frame?.center &&
              String(camera.x) === String(arguments[0]) &&
              String(camera.y) === String(arguments[1]) &&
              String(frame.center.x) === String(arguments[0]) &&
              String(frame.center.y) === String(arguments[1]) &&
              Number(chunks?.visibleChunkCount || 0) > 0 &&
              chunks?.resourceKind === 'chunk-mesh'
            );
            """,
            str(x), str(y),
        )
    )
    return f"camera-center-active:{x},{y}"


def _keyboard_pan_tiles(driver, dx: int, dy: int, timeout: float = 60.0) -> str:
    center = driver.execute_script("return window.Camera?.getCenter?.() || null")
    if not isinstance(center, dict):
        raise RuntimeError(f"Camera center unavailable before keyboard pan: {center}")
    start_x = int(center.get("x") or 0)
    start_y = int(center.get("y") or 0)
    target_x = start_x + int(dx)
    target_y = start_y + int(dy)

    def dispatch(key: str, count: int) -> None:
        if count <= 0:
            return
        driver.execute_script(
            """
            const key = arguments[0];
            const count = Number(arguments[1] || 0);
            for (let i = 0; i < count; i++) {
              document.dispatchEvent(new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true
              }));
            }
            """,
            key,
            count,
        )

    if dx > 0:
        dispatch("ArrowRight", dx)
    elif dx < 0:
        dispatch("ArrowLeft", -dx)
    if dy > 0:
        dispatch("ArrowDown", dy)
    elif dy < 0:
        dispatch("ArrowUp", -dy)

    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            const camera = window.Camera?.getCenter?.();
            const snap = window.GameRenderer?.snapshot?.();
            const frame = snap?.frame;
            const cache = window.AppUI?.terrainCacheTelemetry?.();
            return Boolean(
              camera && frame?.center &&
              String(camera.x) === String(arguments[0]) &&
              String(camera.y) === String(arguments[1]) &&
              String(frame.center.x) === String(arguments[0]) &&
              String(frame.center.y) === String(arguments[1]) &&
              cache?.lastRenderSource === 'chunk-cache'
            );
            """,
            str(target_x), str(target_y),
        )
    )
    return f"keyboard-pan:{start_x},{start_y}->{target_x},{target_y}"


def _run_scenario_step(driver, scenario: str, frame_index: int, base_width: int, base_height: int) -> str:
    if scenario == "wp-s003-006-001":
        if frame_index == 0:
            _safe_click(driver, "#settingsButton")
            driver.execute_script("document.querySelector('#terrainPerformanceHeading')?.scrollIntoView({block:'start'})")
            return "chunk-size:settings-default"
        if frame_index == 1:
            _safe_click(driver, "#settingsPopup .popup-close")
            return _set_terrain_chunk_size(driver, 8) + "+" + _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 2:
            return _set_camera_center_and_render(driver, 128, 0)
        if frame_index == 3:
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 4:
            return _set_terrain_chunk_size(driver, 16) + "+" + _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 5:
            return _set_camera_center_and_render(driver, 128, 0)
        if frame_index == 6:
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 7:
            return _set_terrain_chunk_size(driver, 32) + "+" + _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 8:
            return _set_camera_center_and_render(driver, 128, 0)
        if frame_index == 9:
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 10:
            return _set_terrain_chunk_size(driver, 64) + "+" + _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 11:
            return _set_camera_center_and_render(driver, 128, 0)
        if frame_index == 12:
            return _set_camera_center_and_render(driver, 0, 0)
        driver.refresh()
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, 30).until(lambda d: d.execute_script("return document.readyState") == "complete")
        WebDriverWait(driver, 30).until(
            lambda d: d.execute_script(
                """
                const state=document.querySelector('#campaignState')?.textContent?.trim();
                const setting=window.TerrainChunkSizeSettings?.get?.();
                const snap=window.GameRenderer?.snapshot?.();
                return Boolean(
                  state==='ACTIVE' && snap?.ready && snap?.engine==='PlayCanvas' &&
                  Number(setting?.chunkSize||0)===64 &&
                  Number(snap?.terrainPreload?.chunkSize||0)===64 &&
                  Number(snap?.terrainPreload?.queueDepth||0)===0
                );
                """
            )
        )
        driver.set_window_size(390, 844)
        _safe_click(driver, "#settingsButton")
        driver.execute_script("document.querySelector('#terrainPerformanceHeading')?.scrollIntoView({block:'start'})")
        return "chunk-size:persistence-phone-portrait"
    if scenario == "wp-s003-006-003":
        if frame_index == 0:
            return "chunk-world-data:prewarmed-origin"
        if frame_index == 1:
            return _keyboard_pan_tiles(driver, 4, 0)
        if frame_index == 2:
            return _keyboard_pan_tiles(driver, 4, 0)
        if frame_index == 3:
            return _keyboard_pan_tiles(driver, 8, 0)
        if frame_index == 4:
            return _keyboard_pan_tiles(driver, 8, 0)
        if frame_index == 5:
            return _keyboard_pan_tiles(driver, 8, 0)
        _set_terrain_preload_settings(
            driver, radius=1, cache=256, directional=True, background=False
        )
        return _keyboard_pan_tiles(driver, -32, 0)
    if scenario == "wp-s003-006":
        if frame_index == 0:
            _set_terrain_preload_settings(driver, radius=2, cache=256, directional=True, background=True)
            return _set_camera_center_and_render_active(driver, 0, 0)
        if frame_index == 1:
            return _set_camera_center_and_render_active(driver, 16, 0)
        if frame_index == 2:
            return _set_camera_center_and_render_active(driver, 32, 0)
        if frame_index == 3:
            return _set_camera_center_and_render_active(driver, 48, 0)
        if frame_index == 4:
            return _set_camera_center_and_render_active(driver, 0, 0)
        if frame_index == 5:
            return _wheel_canvas(driver, -500)
        driver.set_window_size(844, 390)
        return _set_camera_center_and_render_active(driver, 0, 0)
    if scenario == "playcanvas-root-cutover":
        if frame_index == 1:
            driver.set_window_size(844, 390)
            return "root-cutover:phone-landscape"
        if frame_index == 2:
            driver.set_window_size(390, 844)
            return "root-cutover:phone-portrait"
        return "root-cutover:desktop-landscape"
    if scenario == "wp-s003-006-002":
        if frame_index == 0:
            return "preload:defaults"
        if frame_index == 1:
            return _set_terrain_preload_settings(driver, radius=1, cache=16, directional=True, background=True)
        if frame_index == 2:
            _set_terrain_preload_settings(driver, radius=2, cache=32, directional=True, background=True)
            return _set_camera_center_and_render(driver, 16, 0)
        if frame_index == 3:
            _set_terrain_preload_settings(driver, radius=3, cache=64, directional=True, background=True)
            return _set_camera_center_and_render(driver, 48, 0)
        if frame_index == 4:
            _set_terrain_preload_settings(driver, radius=4, cache=128, directional=True, background=True)
            return _set_camera_center_and_render(driver, 112, 0)
        if frame_index == 5:
            _set_terrain_preload_settings(driver, radius=4, cache=256, directional=False, background=True)
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 6:
            _set_terrain_preload_settings(driver, radius=4, cache=256, directional=True, background=False)
            driver.set_window_size(844, 390)
            _safe_click(driver, "#settingsButton")
            driver.execute_script("document.querySelector('#terrainPerformanceHeading')?.scrollIntoView({block:'start'})")
            return "preload:phone-landscape-settings"
        driver.refresh()
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, 20).until(lambda d: d.execute_script("return document.readyState") == "complete")
        WebDriverWait(driver, 20).until(
            lambda d: d.execute_script(
                """
                const state=document.querySelector('#campaignState')?.textContent?.trim();
                const renderer=window.GameRenderer?.snapshot?.();
                return Boolean(state==='ACTIVE' && renderer?.ready && renderer?.engine==='PlayCanvas');
                """
            )
        )
        driver.set_window_size(390, 844)
        _safe_click(driver, "#settingsButton")
        driver.execute_script("document.querySelector('#terrainPerformanceHeading')?.scrollIntoView({block:'start'})")
        return "preload:persistence-phone-portrait"
    if scenario == "wp-s003-005-002":
        if frame_index == 0:
            driver.execute_script("window.WP_S003_005_002_PROOF?.setView?.('overview')")
            return "asset-standard:overview"
        if frame_index == 1:
            driver.set_window_size(1280, 800)
            driver.execute_script("window.WP_S003_005_002_PROOF?.setView?.('building')")
            return "asset-standard:building-close"
        if frame_index == 2:
            driver.set_window_size(844, 390)
            driver.execute_script("window.WP_S003_005_002_PROOF?.setView?.('props')")
            return "asset-standard:props-phone-landscape"
        if frame_index == 3:
            driver.set_window_size(390, 844)
            driver.execute_script("window.WP_S003_005_002_PROOF?.setView?.('portrait')")
            return "asset-standard:building-phone-portrait"
        return "asset-standard:overview"
    if scenario == "wp-s003-004-002":
        if frame_index == 0:
            return _set_character_proof_state(driver, "open")
        if frame_index == 1:
            return _set_character_proof_state(driver, "front")
        if frame_index == 2:
            return _set_character_proof_state(driver, "behind")
        if frame_index == 3:
            return _set_character_proof_state(driver, "entering")
        if frame_index == 4:
            return _set_character_proof_state(driver, "inside")
        if frame_index == 5:
            _set_character_proof_state(driver, "open")
            return _wheel_canvas(driver, -500)
        if frame_index == 6:
            driver.set_window_size(844, 390)
            return _set_character_proof_state(driver, "open")
        driver.set_window_size(390, 844)
        return _set_character_proof_state(driver, "inside")
    if scenario == "wp-s003-003":
        if frame_index == 0:
            return _set_interior_object_proof_state(driver, "house")
        if frame_index == 1:
            return _set_interior_object_proof_state(driver, "special")
        driver.set_window_size(1280, 800)
        return _set_interior_object_proof_state(driver, "special")
    if scenario == "playcanvas-scene":
        if frame_index == 1:
            driver.set_window_size(1280, 800)
            return "playcanvas-scene:tablet-landscape"
        if frame_index == 2:
            driver.set_window_size(844, 390)
            return "playcanvas-scene:phone-landscape"
        if frame_index == 3:
            driver.set_window_size(390, 844)
            return "playcanvas-scene:phone-portrait"
        if frame_index == 4:
            driver.set_window_size(1920, 1080)
            return _drag_canvas_and_wait(driver, 120, 0)
        if frame_index == 5:
            return _wheel_canvas(driver, -500)
        return "playcanvas-scene:desktop-landscape"
    if scenario == "playcanvas-foundation":
        if frame_index == 1:
            driver.set_window_size(1080, 1920)
            return "playcanvas:portrait"
        if frame_index == 2:
            driver.set_window_size(1920, 1080)
            return "playcanvas:landscape-return"
        return "playcanvas:initial"
    if scenario == "wp-s003-005":
        if frame_index == 0:
            action = _wait_for_playcanvas_world_assets(driver)
            return action + "+" + _set_asset_preparation_proof(driver, True)
        if frame_index == 1:
            proof_off = _set_asset_preparation_proof(driver, False)
            action = _set_camera_center_and_render_active(driver, 64, 0)
            ready = _wait_for_playcanvas_world_assets(driver)
            proof_on = _set_asset_preparation_proof(driver, True)
            return proof_off + "+" + action + "+" + ready + "+" + proof_on
        proof_off = _set_asset_preparation_proof(driver, False)
        action = _set_camera_center_and_render_active(driver, 0, 0)
        ready = _wait_for_playcanvas_world_assets(driver)
        proof_on = _set_asset_preparation_proof(driver, True)
        return proof_off + "+" + action + "+" + ready + "+" + proof_on
    if scenario == "building-presentation":
        states = ("outside", "entering", "inside", "behind", "leaving")
        # Keep the canonical 1.0x PlayCanvas view so roofs, cutaway transitions,
        # characters and interior depth are large enough for honest inspection.
        return _set_building_proof_state(driver, states[min(frame_index, len(states) - 1)])
    if scenario == "building-occlusion":
        states = ("front", "behind", "behind", "clear", "inside", "restored")
        if frame_index == 0:
            _wheel_canvas(driver, 500)
        if frame_index == 2:
            _wheel_canvas(driver, 500)
        return _set_building_occlusion_proof_state(
            driver, states[min(frame_index, len(states) - 1)]
        )
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
    if scenario == "wp-s003-006-001":
        if len(frames) < 14:
            raise RuntimeError("wp-s003-006-001 requires fourteen evidence frames")
        runtimes=[frame.get("runtime",{}) for frame in frames[:14]]
        builds=[runtime.get("currentBuild",{}) for runtime in runtimes]
        gpus=[(build.get("gpuRenderer") or {}) for build in builds]
        preloads=[(gpu.get("terrainPreload") or {}) for gpu in gpus]
        chunks=[(gpu.get("terrainChunks") or {}) for gpu in gpus]
        settings=[build.get("terrainChunkSizeSetting") or {} for build in builds]
        controls=[build.get("terrainChunkSizeControl") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        identities=[build.get("terrainChunkWorldIdentity") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Chunk-size comparison changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Chunk-size comparison changed protagonist authority: {protagonists}")
        encoded=[json.dumps(item,sort_keys=True) for item in identities]
        if len(set(encoded))!=1 or not identities[0]:
            raise RuntimeError(f"Authoritative terrain identity changed across chunk sizes: {identities}")
        if int(settings[0].get("chunkSize") or 0)!=16 or int(settings[0].get("defaultChunkSize") or 0)!=16:
            raise RuntimeError(f"Default chunk size is not 16×16: {settings[0]}")
        if list(settings[0].get("options") or []) != [8,16,32,64]:
            raise RuntimeError(f"Chunk size options mismatch: {settings[0]}")
        if controls[0].get("present") is not True or controls[0].get("value")!="16" or controls[0].get("settingsOpen") is not True:
            raise RuntimeError(f"Default Settings chunk-size control not visible/correct: {controls[0]}")

        groups={8:(1,2,3),16:(4,5,6),32:(7,8,9),64:(10,11,12)}
        previous_change_invalidations=0
        for size,(origin_idx,target_idx,return_idx) in groups.items():
            for idx,expected_camera in ((origin_idx,"(0,0)"),(target_idx,"(128,0)"),(return_idx,"(0,0)")):
                preload=preloads[idx]; chunk=chunks[idx]; setting=settings[idx]
                if int(setting.get("chunkSize") or 0)!=size:
                    raise RuntimeError(f"Setting did not select {size}×{size} in frame {idx+1}: {setting}")
                if int(preload.get("chunkSize") or 0)!=size or int(chunk.get("chunkSize") or 0)!=size:
                    raise RuntimeError(f"Runtime chunk geometry did not use {size}×{size} in frame {idx+1}: preload={preload}, chunks={chunk}")
                if f"chunk={size}|" not in str(preload.get("signature") or ""):
                    raise RuntimeError(f"Cache signature omits chunk size {size} in frame {idx+1}: {preload}")
                if build_camera:=builds[idx].get("cameraCoordinate"):
                    if build_camera!=expected_camera:
                        raise RuntimeError(f"Same-path camera mismatch for {size}×{size} in frame {idx+1}: {build_camera}")
                else:
                    raise RuntimeError(f"Camera telemetry missing in frame {idx+1}")
                if chunk.get("resourceKind")!="chunk-mesh" or int(chunk.get("visibleChunkCount") or 0)<1:
                    raise RuntimeError(f"Chunk mesh missing for {size}×{size} in frame {idx+1}: {chunk}")
                if int(preload.get("Cached") or 0)>int((preload.get("settings") or {}).get("maxCachedChunks") or 0):
                    raise RuntimeError(f"Chunk cache exceeded budget for {size}×{size}: {preload}")
                if preload.get("simulationAuthorityPreserved") is not True or chunk.get("simulationAuthorityPreserved") is not True:
                    raise RuntimeError(f"Simulation authority changed for {size}×{size} in frame {idx+1}")
            change_invalidations=int(preloads[origin_idx].get("invalidations") or 0)
            if change_invalidations<=previous_change_invalidations:
                raise RuntimeError(f"Chunk-size change did not invalidate incompatible presentation cache for {size}×{size}: {preloads[origin_idx]}")
            if preloads[origin_idx].get("lastInvalidationReason")!="chunk-size":
                raise RuntimeError(f"Chunk-size invalidation reason missing for {size}×{size}: {preloads[origin_idx]}")
            previous_change_invalidations=change_invalidations
            if int(preloads[return_idx].get("cacheReuses") or 0)<=int(preloads[target_idx].get("cacheReuses") or 0):
                raise RuntimeError(f"Return path did not reuse cached {size}×{size} chunks: target={preloads[target_idx]}, return={preloads[return_idx]}")
        if int(settings[13].get("chunkSize") or 0)!=64 or controls[13].get("value")!="64" or controls[13].get("settingsOpen") is not True:
            raise RuntimeError(f"64×64 chunk-size persistence failed after reload: setting={settings[13]}, control={controls[13]}")
        viewport=runtimes[13].get("viewport") or {}
        if int(viewport.get("height") or 0)<=int(viewport.get("width") or 0):
            raise RuntimeError(f"Phone portrait Settings persistence evidence invalid: {viewport}")
        return

    if scenario == "wp-s003-006-003":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-006-003 requires seven evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:7]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]
        chunks = [(gpu.get("terrainChunks") or {}) for gpu in gpus]
        preload = [(gpu.get("terrainPreload") or {}) for gpu in gpus]
        world = [(chunk.get("worldData") or {}) for chunk in chunks]
        scenes = [(gpu.get("scene") or {}) for gpu in gpus]
        render_cache = [(gpu.get("terrainCacheTelemetry") or {}) for gpu in gpus]

        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        cameras = [item.get("cameraCoordinate") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"Chunk world-data path changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"Chunk world-data path changed protagonist authority: {protagonists}")
        expected_cameras = ("(0,0)", "(4,0)", "(8,0)", "(16,0)", "(24,0)", "(32,0)", "(0,0)")
        if tuple(cameras) != expected_cameras:
            raise RuntimeError(f"Chunk world-data keyboard path mismatch: {cameras}")

        for index, (gpu, chunk, stats, data, scene, cache) in enumerate(
            zip(gpus, chunks, preload, world, scenes, render_cache), start=1
        ):
            if gpu.get("engine") != "PlayCanvas" or not gpu.get("ready"):
                raise RuntimeError(f"PlayCanvas renderer missing in frame {index}: {gpu}")
            if chunk.get("resourceKind") != "chunk-mesh" or chunk.get("completeChunkWorldData") is not True:
                raise RuntimeError(f"Chunk mesh/world-data contract missing in frame {index}: {chunk}")
            if data.get("stableChunkIdentity") is not True or data.get("completeChunksOnly") is not True:
                raise RuntimeError(f"Stable complete chunk identity failed in frame {index}: {data}")
            if data.get("boundedByRendererRetention") is not True or data.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Chunk world-data retention/authority failed in frame {index}: {data}")
            entries = int(data.get("entryCount") or 0)
            complete = int(data.get("completeEntryCount") or 0)
            if entries < 1 or complete != entries:
                raise RuntimeError(f"Incomplete cached chunks in frame {index}: {data}")
            chunk_size = int(stats.get("chunkSize") or 0)
            if chunk_size < 1:
                raise RuntimeError(f"Chunk size telemetry missing in frame {index}: {stats}")
            if int(data.get("surfaceCellCount") or 0) != entries * chunk_size * chunk_size:
                raise RuntimeError(f"Cached chunk cells are not complete in frame {index}: data={data}, preload={stats}")
            tf_calls = int(data.get("terrainFoundationCalls") or 0)
            walk_calls = int(data.get("walkabilityClassifications") or 0)
            generations = int(data.get("completeChunkGenerations") or 0)
            if tf_calls != walk_calls or tf_calls != generations * chunk_size * chunk_size:
                raise RuntimeError(f"Chunk generation call accounting mismatch in frame {index}: {data}")
            if generations != int(data.get("cacheMisses") or 0):
                raise RuntimeError(f"Chunk misses/generations diverged in frame {index}: {data}")
            if int(data.get("regenerationCount") or 0) != 0:
                raise RuntimeError(f"A previously generated chunk key was regenerated in frame {index}: {data}")
            if int(data.get("uniqueGeneratedChunkCount") or 0) != generations:
                raise RuntimeError(f"Unique chunk generation accounting diverged in frame {index}: {data}")
            if cache.get("lastRenderSource") != "chunk-cache":
                raise RuntimeError(f"Visible render did not use cached chunk data in frame {index}: {cache}")
            if int(cache.get("fallbackRenderCount") or 0) != 0:
                raise RuntimeError(f"Legacy full-viewport fallback ran in frame {index}: {cache}")
            if int(data.get("lastViewTileMisses") or 0) != 0:
                raise RuntimeError(f"Current cached visible view missed a chunk in frame {index}: {data}")
            if int(stats.get("Cached") or 0) > int((stats.get("settings") or {}).get("maxCachedChunks") or 0):
                raise RuntimeError(f"World-data cache exceeded renderer cache budget in frame {index}: {stats}")
            if chunk.get("simulationAuthorityPreserved") is not True or stats.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Chunk world-data path changed Simulation authority in frame {index}")
            if chunk.get("seedDerivedPresentation") is not True or data.get("seedDerivedPresentation") is not True:
                raise RuntimeError(f"SEED-derived chunk presentation missing in frame {index}: chunk={chunk}, world={data}")
            if chunk.get("hardCodedSampleGeometry") is not False or data.get("hardCodedSampleGeometry") is not False:
                raise RuntimeError(f"Hard-coded sample geometry leaked into chunk presentation in frame {index}: chunk={chunk}, world={data}")
            if chunk.get("normalWorldSource") != "seed-chunk-world-data":
                raise RuntimeError(f"Normal world source is not chunk-native in frame {index}: {chunk}")
            if scene.get("normalWorldSource") != "seed-chunk-world-data" or scene.get("hardCodedSampleGeometry") is not False:
                raise RuntimeError(f"Scene source/sample flags failed in frame {index}: {scene}")
            if int(scene.get("sampleVillageEntityCount") or 0) != 0:
                raise RuntimeError(f"Hard-coded sample village entity still exists in frame {index}: {scene}")
            if int(chunk.get("buildingPresentationCount") or 0) < 1:
                raise RuntimeError(f"No SEED-derived building presentation is visible/prepared in frame {index}: {chunk}")
            if int(chunk.get("roadCellCount") or 0) < 1:
                raise RuntimeError(f"No SEED-derived road presentation cells exist in frame {index}: {chunk}")
            if int(chunk.get("terrainTypeCount") or 0) < 2:
                raise RuntimeError(f"Chunk presentation lacks terrain diversity in frame {index}: {chunk}")

        # Exact camera-center changes inside the same chunk must not regenerate chunk data.
        for index in (1, 2):
            if int(world[index].get("completeChunkGenerations") or 0) != int(world[0].get("completeChunkGenerations") or 0):
                raise RuntimeError(
                    f"Same-chunk overlapping movement regenerated world data at frame {index+1}: "
                    f"origin={world[0]}, current={world[index]}"
                )
            if int(world[index].get("terrainFoundationCalls") or 0) != int(world[0].get("terrainFoundationCalls") or 0):
                raise RuntimeError(
                    f"Same-chunk overlapping movement repeated TerrainFoundation work at frame {index+1}: "
                    f"origin={world[0]}, current={world[index]}"
                )

        initial_active_generations = int(world[0].get("activeGenerations") or 0)
        if initial_active_generations < 1:
            raise RuntimeError(f"Initial Active chunk generations were not classified: {world[0]}")
        for index in range(1, 6):
            if int(world[index].get("activeGenerations") or 0) != initial_active_generations:
                raise RuntimeError(
                    f"Prepared boundary navigation generated a newly-visible chunk at frame {index+1}: "
                    f"initial={world[0]}, current={world[index]}"
                )

        if int(world[6].get("cacheHits") or 0) <= int(world[5].get("cacheHits") or 0):
            raise RuntimeError(f"Return navigation did not increase world-data cache hits: before={world[5]}, return={world[6]}")
        if int(preload[6].get("cacheReuses") or 0) <= int(preload[5].get("cacheReuses") or 0):
            raise RuntimeError(f"Return navigation did not reuse retained renderer chunks: before={preload[5]}, return={preload[6]}")
        if int(world[6].get("regenerationCount") or 0) != 0:
            raise RuntimeError(f"Return navigation regenerated a previously generated chunk key: {world[6]}")
        if int(world[6].get("releases") or 0) != int(world[5].get("releases") or 0):
            raise RuntimeError(f"Return navigation evicted retained world-data unexpectedly: before={world[5]}, return={world[6]}")
        if int(world[0].get("buildingReferenceCount") or 0) < 1:
            raise RuntimeError(f"Starting-village chunk cache contains no building references: {world[0]}")
        if int(world[0].get("presentationBuildingCount") or 0) < 1:
            raise RuntimeError(f"Starting-village chunk cache contains no owned building presentation descriptors: {world[0]}")
        if max(int(item.get("waterCellCount") or 0) for item in chunks) < 1:
            raise RuntimeError(f"Fixed route never exposed SEED-derived water presentation: {chunks}")
        if max(int(item.get("presentationMeshInstanceCount") or 0) for item in chunks) < 1:
            raise RuntimeError(f"Fixed route produced no 3D building/prop presentation geometry: {chunks}")
        return

    if scenario == "wp-s003-006":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-006 requires seven evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:7]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]
        chunks = [(gpu.get("terrainChunks") or {}) for gpu in gpus]
        preload = [(gpu.get("terrainPreload") or {}) for gpu in gpus]

        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"Terrain chunk mesh changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"Terrain chunk mesh changed protagonist authority: {protagonists}")

        expected_cameras = ("(0,0)", "(16,0)", "(32,0)", "(48,0)", "(0,0)")
        cameras = [item.get("cameraCoordinate") for item in builds]
        if tuple(cameras[:5]) != expected_cameras:
            raise RuntimeError(f"Chunk navigation camera path mismatch: {cameras[:5]}")

        initial_visible_waits = int(preload[0].get("visibleWaits") or 0)
        for index, (gpu, chunk, stats) in enumerate(zip(gpus, chunks, preload), start=1):
            if gpu.get("engine") != "PlayCanvas" or not gpu.get("ready"):
                raise RuntimeError(f"PlayCanvas renderer missing in frame {index}: {gpu}")
            if chunk.get("resourceKind") != "chunk-mesh":
                raise RuntimeError(f"Chunk-native mesh resource missing in frame {index}: {chunk}")
            if chunk.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Per-tile entity architecture detected in frame {index}: {chunk}")
            if chunk.get("completeChunkMeshes") is not True:
                raise RuntimeError(f"Incomplete terrain chunk mesh detected in frame {index}: {chunk}")
            resources = int(chunk.get("meshResourceCount") or 0)
            instances = int(chunk.get("meshInstanceCount") or 0)
            visible = int(chunk.get("visibleChunkCount") or 0)
            prepared = int(chunk.get("preparedChunkCount") or 0)
            cached = int(chunk.get("cachedChunkCount") or 0)
            if resources < 1 or instances != resources:
                raise RuntimeError(f"Chunk mesh/instance counts invalid in frame {index}: {chunk}")
            if resources != visible + prepared + cached:
                raise RuntimeError(f"Chunk lifecycle/resource totals mismatch in frame {index}: {chunk}")
            if int(chunk.get("vertices") or 0) < resources * 25:
                raise RuntimeError(f"Terrain mesh vertex telemetry unexpectedly small in frame {index}: {chunk}")
            if int(chunk.get("triangles") or 0) < resources * 32:
                raise RuntimeError(f"Terrain mesh triangle telemetry unexpectedly small in frame {index}: {chunk}")
            if int(chunk.get("materialCount") or 0) != 1:
                raise RuntimeError(f"Terrain chunks do not share one material family in frame {index}: {chunk}")
            generator = chunk.get("generator") or {}
            if generator.get("oneEntityPerChunk") is not True or generator.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Terrain mesh generator architecture invalid in frame {index}: {generator}")
            if generator.get("sharedMaterial") is not True or generator.get("completeChunkMesh") is not True:
                raise RuntimeError(f"Terrain mesh generator sharing/completeness failed in frame {index}: {generator}")
            if chunk.get("simulationAuthorityPreserved") is not True or stats.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Terrain chunk renderer changed Simulation authority in frame {index}")
            if int(stats.get("Cached") or 0) > int((stats.get("settings") or {}).get("maxCachedChunks") or 0):
                raise RuntimeError(f"Chunk cache exceeded budget in frame {index}: {stats}")
            if visible > 128:
                raise RuntimeError(f"Active terrain mesh draw allocation is not bounded in frame {index}: {chunk}")
            if resources > 512:
                raise RuntimeError(f"Retained terrain mesh allocation is not bounded in frame {index}: {chunk}")
            average_build_ms = float(generator.get("averageBuildMs") or 0)
            if average_build_ms > 1.0:
                raise RuntimeError(f"Average terrain chunk mesh build cost is too high in frame {index}: {generator}")
            draw_calls = int((gpu.get("performance") or {}).get("drawCalls") or 0)
            if draw_calls < 1 or draw_calls > 180:
                raise RuntimeError(f"PlayCanvas draw-call budget invalid in frame {index}: drawCalls={draw_calls}, gpu={gpu}")

        for index in (1,2,3,4):
            if int(preload[index].get("visibleWaits") or 0) != initial_visible_waits:
                raise RuntimeError(
                    f"Prepared navigation introduced a new visible mesh wait at frame {index+1}: "
                    f"initial={initial_visible_waits}, current={preload[index]}"
                )

        if int(chunks[4].get("hits") or 0) <= int(chunks[3].get("hits") or 0):
            raise RuntimeError(f"Return navigation did not reuse retained chunk meshes: before={chunks[3]}, return={chunks[4]}")
        if int(chunks[4].get("compositions") or 0) != int(chunks[3].get("compositions") or 0):
            raise RuntimeError(f"Return navigation rebuilt retained terrain chunks: before={chunks[3]}, return={chunks[4]}")

        zooms = [item.get("cameraZoom") for item in builds]
        if zooms[5] == zooms[4]:
            raise RuntimeError(f"Terrain chunk zoom evidence did not change camera zoom: {zooms}")
        viewport = runtimes[6].get("viewport") or {}
        if int(viewport.get("width") or 0) <= int(viewport.get("height") or 0):
            raise RuntimeError(f"Phone landscape terrain evidence invalid: {viewport}")
        return

    if scenario == "playcanvas-root-cutover":
        if len(frames) < 3:
            raise RuntimeError("playcanvas-root-cutover requires three evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:3]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]

        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        cameras = [item.get("cameraCoordinate") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"Root PlayCanvas cutover changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"Root PlayCanvas cutover changed protagonist authority: {protagonists}")
        if len(set(cameras)) != 1 or not cameras[0]:
            raise RuntimeError(f"Root PlayCanvas cutover changed camera authority during responsive resize: {cameras}")

        for index, gpu in enumerate(gpus, start=1):
            if gpu.get("engine") != "PlayCanvas" or not str(gpu.get("engineVersion") or "").startswith("2."):
                raise RuntimeError(f"Canonical root is not PlayCanvas Engine 2 in frame {index}: {gpu}")
            if gpu.get("bootstrapMode") != "playcanvas":
                raise RuntimeError(f"Canonical root bootstrap mode is not PlayCanvas in frame {index}: {gpu}")
            if gpu.get("bootstrapLegacyAvailable") is not False:
                raise RuntimeError(f"Legacy renderer availability leaked into frame {index}: {gpu}")
            if gpu.get("pixiLoaded") or gpu.get("legacyGameRendererLoaded"):
                raise RuntimeError(f"Legacy renderer globals are loaded in frame {index}: {gpu}")
            if gpu.get("pixiScriptLoaded") or gpu.get("legacyRendererScriptLoaded"):
                raise RuntimeError(f"Legacy renderer scripts are loaded in frame {index}: {gpu}")
            if gpu.get("rendererParam") is not None or str(gpu.get("locationSearch") or "") not in {"", "?"}:
                raise RuntimeError(f"Canonical root evidence unexpectedly uses a renderer/query compatibility path in frame {index}: {gpu}")
            if not gpu.get("ready") or not gpu.get("gpu") or int(gpu.get("canvasCount") or 0) != 1:
                raise RuntimeError(f"Canonical PlayCanvas root did not initialize one GPU canvas in frame {index}: {gpu}")
            if gpu.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"PlayCanvas root changed Simulation authority in frame {index}: {gpu}")

        viewports = [runtime.get("viewport") or {} for runtime in runtimes]
        if int(viewports[0].get("width") or 0) <= int(viewports[0].get("height") or 0):
            raise RuntimeError(f"Root desktop evidence is not landscape: {viewports[0]}")
        if int(viewports[1].get("width") or 0) <= int(viewports[1].get("height") or 0):
            raise RuntimeError(f"Root phone landscape evidence invalid: {viewports[1]}")
        if int(viewports[2].get("height") or 0) <= int(viewports[2].get("width") or 0):
            raise RuntimeError(f"Root phone portrait evidence invalid: {viewports[2]}")
        return

    if scenario == "wp-s003-006-002":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-006-002 requires eight evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:8]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]
        preload = [(gpu.get("terrainPreload") or {}) for gpu in gpus]

        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"Preload settings changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"Preload settings changed protagonist authority: {protagonists}")

        expected = (
            (2,64,True,True),
            (1,16,True,True),
            (2,32,True,True),
            (3,64,True,True),
            (4,128,True,True),
            (4,256,False,True),
            (4,256,True,False),
            (4,256,True,False),
        )
        for index,(stats,values) in enumerate(zip(preload,expected),start=1):
            settings=stats.get("settings") or {}
            actual=(
                int(settings.get("preloadRadius") or 0),
                int(settings.get("maxCachedChunks") or 0),
                bool(settings.get("directionalPreload")),
                bool(settings.get("backgroundChunkGeneration")),
            )
            if actual != values:
                raise RuntimeError(f"Preload settings mismatch in frame {index}: expected={values}, actual={actual}, stats={stats}")
            if int(stats.get("Active") or 0) < 1:
                raise RuntimeError(f"No Active terrain chunks in frame {index}: {stats}")
            if stats.get("bounded") is not True:
                raise RuntimeError(f"Terrain cache exceeded configured budget in frame {index}: {stats}")
            if int(stats.get("Cached") or 0) > int(settings.get("maxCachedChunks") or 0):
                raise RuntimeError(f"Cached terrain exceeded max in frame {index}: {stats}")
            if stats.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Terrain preload mutated Simulation in frame {index}: {stats}")
            if int(stats.get("visibleAssetLoads") or 0) != 0 or int(stats.get("visibleTextureDecodes") or 0) != 0 or int(stats.get("visibleGltfParses") or 0) != 0:
                raise RuntimeError(f"Visible path performed asset/decode/GLB work in frame {index}: {stats}")
            signature=str(stats.get("signature") or "")
            if "chunk=" not in signature or "quality=" not in signature:
                raise RuntimeError(f"Terrain preload cache signature missing chunk/quality inputs in frame {index}: {signature}")

        if int(preload[1].get("evictions") or 0) < 1:
            raise RuntimeError(f"16-chunk cache test did not exercise bounded eviction: {preload[1]}")
        if int(preload[2].get("visibleWaits") or 0) != int(preload[1].get("visibleWaits") or 0):
            raise RuntimeError(
                f"Prepared boundary crossing introduced a new visible wait: before={preload[1]}, after={preload[2]}"
            )
        direction = preload[2].get("direction") or {}
        if int(direction.get("x") or 0) != 1:
            raise RuntimeError(f"Directional preload did not detect +X movement: {preload[2]}")
        preview = preload[2].get("lastQueuePreview") or []
        center = preload[2].get("centerChunk") or {}
        if preview and int(preview[0].get("x") or 0) < int(center.get("x") or 0):
            raise RuntimeError(f"Directional preload did not prioritize ahead chunks: center={center}, preview={preview}")
        if int(preload[5].get("cacheReuses") or 0) < 1:
            raise RuntimeError(f"Reverse traversal did not reuse cached chunks: {preload[5]}")
        if int(preload[6].get("Prepared") or 0) != 0 or int(preload[6].get("queueDepth") or 0) != 0:
            raise RuntimeError(f"Background OFF retained prepared work: {preload[6]}")

        expected_controls = {
            "preloadRadius":"4",
            "maxCachedChunks":"256",
            "directionalPreload":True,
            "backgroundChunkGeneration":False,
        }
        controls6=builds[6].get("terrainPreloadControls") or {}
        controls7=builds[7].get("terrainPreloadControls") or {}
        if controls6 != expected_controls:
            raise RuntimeError(f"Phone landscape Settings controls mismatch: {controls6}")
        if controls7 != expected_controls:
            raise RuntimeError(f"Persisted phone portrait Settings controls mismatch: {controls7}")

        view6=runtimes[6].get("viewport") or {}
        view7=runtimes[7].get("viewport") or {}
        if int(view6.get("width") or 0) <= int(view6.get("height") or 0):
            raise RuntimeError(f"Settings phone landscape evidence invalid: {view6}")
        if int(view7.get("height") or 0) <= int(view7.get("width") or 0):
            raise RuntimeError(f"Settings phone portrait evidence invalid: {view7}")
        return

    if scenario == "wp-s003-005-002":
        if len(frames) < 4:
            raise RuntimeError("wp-s003-005-002 requires four evidence frames")
        proofs = [frame.get("runtime", {}).get("assetStandardProof") or {} for frame in frames[:4]]
        for index, proof in enumerate(proofs, start=1):
            if proof.get("ready") is not True or proof.get("gltfLoaded") is not True:
                raise RuntimeError(f"glTF proof did not load in frame {index}: {proof}")
            if proof.get("engine") != "PlayCanvas" or not str(proof.get("engineVersion") or "").startswith("2."):
                raise RuntimeError(f"PlayCanvas Engine 2 missing in frame {index}: {proof}")
            if proof.get("runtimeFormat") != "glTF 2.0":
                raise RuntimeError(f"Unexpected runtime format in frame {index}: {proof}")
            if abs(float(proof.get("worldTileMeters") or 0) - 2.0) > 0.001:
                raise RuntimeError(f"2 m tile scale missing in frame {index}: {proof}")
            if proof.get("deterministicLogicalKeys") is not True or proof.get("rendererOnly") is not True:
                raise RuntimeError(f"Asset authority/key standard failed in frame {index}: {proof}")
            if proof.get("boundsDefined") is not True:
                raise RuntimeError(f"Asset bounds missing in frame {index}: {proof}")
            if int(proof.get("logicalAssetCount") or 0) < 4:
                raise RuntimeError(f"Representative logical asset set incomplete in frame {index}: {proof}")
            eligible = set(proof.get("instancingEligible") or [])
            if "environment.tree.prototype" not in eligible or "interior.workbench.prototype" not in eligible:
                raise RuntimeError(f"Instancing eligibility missing in frame {index}: {eligible}")
            if int(proof.get("meshInstanceCount") or 0) < 10:
                raise RuntimeError(f"Representative mesh count too small in frame {index}: {proof}")
            if int(proof.get("materialCount") or 0) < 5:
                raise RuntimeError(f"Shared material proof incomplete in frame {index}: {proof}")
            if int(proof.get("drawCalls") or 0) < 1:
                raise RuntimeError(f"Draw-call telemetry missing in frame {index}: {proof}")
            rep = proof.get("representative") or {}
            building = rep.get("building") or {}
            footprint = building.get("footprintMeters") or {}
            roof = building.get("roofMeters") or {}
            door = building.get("doorMeters") or {}
            if footprint != {"x": 6, "z": 5}:
                raise RuntimeError(f"House footprint scale mismatch in frame {index}: {footprint}")
            if roof != {"x": 6.8, "z": 5.6}:
                raise RuntimeError(f"Roof scale mismatch in frame {index}: {roof}")
            if proof.get("roofConstruction") != "dual-slab-gable":
                raise RuntimeError(f"Roof construction proof missing in frame {index}: {proof}")
            if door != {"x": 1.2, "y": 2.1}:
                raise RuntimeError(f"Door scale mismatch in frame {index}: {door}")
            tree = rep.get("tree") or {}
            if int(tree.get("repeatedCount") or 0) != 3 or tree.get("instancingEligible") is not True:
                raise RuntimeError(f"Repeated tree proof failed in frame {index}: {tree}")

        expected_views = ("overview", "building", "props", "portrait")
        actual_views = [str(proof.get("view") or "") for proof in proofs]
        if tuple(actual_views) != expected_views:
            raise RuntimeError(f"Asset proof views did not cycle correctly: {actual_views}")

        viewports = [frame.get("runtime", {}).get("viewport") or {} for frame in frames[:4]]
        if int(viewports[0].get("width") or 0) <= int(viewports[0].get("height") or 0):
            raise RuntimeError(f"Desktop proof is not landscape: {viewports[0]}")
        if int(viewports[1].get("width") or 0) <= int(viewports[1].get("height") or 0):
            raise RuntimeError(f"Tablet proof is not landscape: {viewports[1]}")
        if int(viewports[2].get("width") or 0) <= int(viewports[2].get("height") or 0):
            raise RuntimeError(f"Phone proof is not landscape: {viewports[2]}")
        if int(viewports[3].get("height") or 0) <= int(viewports[3].get("width") or 0):
            raise RuntimeError(f"Phone proof is not portrait: {viewports[3]}")
        return

    if scenario == "wp-s003-004-002":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-004-002 requires eight evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:8]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]
        presentations = [(gpu.get("characterPresentation") or {}) for gpu in gpus]
        proofs = [(gpu.get("characterProof") or {}) for gpu in gpus]

        protagonists = [item.get("protagonistLocation") for item in builds]
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"Character proof changed/missed protagonist authority: {protagonists}")

        expected_states = ("open", "front", "behind", "entering", "inside", "open", "open", "inside")
        for index, (presentation, proof, expected) in enumerate(zip(presentations, proofs, expected_states), start=1):
            if not presentation.get("visibleProtagonist"):
                raise RuntimeError(f"Protagonist billboard not visible in frame {index}: {presentation}")
            active = int(presentation.get("activeCharacterCount") or 0)
            simulated = int(presentation.get("simulatedCharacterCount") or 0)
            prepared = int(presentation.get("preparedCharacterCount") or 0)
            if active < 1 or simulated < active or prepared < 1:
                raise RuntimeError(f"Character activation bounds invalid in frame {index}: {presentation}")
            if simulated < active:
                raise RuntimeError(f"Active character entities exceed simulated population in frame {index}: {presentation}")
            if presentation.get("feetAnchored") is not True or presentation.get("billboardMode") != "vertical-yaw":
                raise RuntimeError(f"Feet/billboard contract failed in frame {index}: {presentation}")
            if presentation.get("depthTest") is not True or presentation.get("depthWrite") is not True:
                raise RuntimeError(f"Character depth contract failed in frame {index}: {presentation}")
            if int(presentation.get("sharedTextureCount") or 0) < 1 or int(presentation.get("sharedMaterialCount") or 0) < 1:
                raise RuntimeError(f"Shared character asset/material path missing in frame {index}: {presentation}")

            instances = presentation.get("instances") or []
            protagonist = next((item for item in instances if item.get("id") == "protagonist"), None)
            if not protagonist:
                raise RuntimeError(f"Protagonist instance telemetry missing in frame {index}: {presentation}")
            world = protagonist.get("world") or {}
            if f"({world.get('x')},{world.get('y')})" != protagonists[index-1]:
                raise RuntimeError(f"Billboard world coordinate diverged in frame {index}: {protagonist} vs {protagonists[index-1]}")
            if abs(float(protagonist.get("height") or 0) - 1.82) > 0.02:
                raise RuntimeError(f"Protagonist world-meter height invalid in frame {index}: {protagonist}")
            if float(protagonist.get("feetY") or -1) < 0 or float(protagonist.get("feetY") or 9) > 0.25:
                raise RuntimeError(f"Protagonist feet anchor invalid in frame {index}: {protagonist}")
            if protagonist.get("depthTest") is not True or protagonist.get("depthWrite") is not True:
                raise RuntimeError(f"Protagonist depth settings invalid in frame {index}: {protagonist}")
            if not isinstance(protagonist.get("yawDegrees"), (int, float)):
                raise RuntimeError(f"Protagonist billboard yaw telemetry missing in frame {index}: {protagonist}")

            if not proof.get("active") or proof.get("state") != expected:
                raise RuntimeError(f"Character proof state mismatch in frame {index}: {proof}")
            if proof.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Character proof mutated Simulation authority in frame {index}: {proof}")
            if proof.get("world") != protagonist.get("world") or proof.get("scene") != protagonist.get("scene"):
                raise RuntimeError(f"Character proof is not anchored to actual protagonist instance in frame {index}: {proof}")

        if not any(int(p.get("simulatedCharacterCount") or 0) > int(p.get("activeCharacterCount") or 0) for p in presentations):
            raise RuntimeError(f"Off-screen character activation was never bounded below simulated population: {presentations}")

        if proofs[1].get("occlusionExpected") != "in-front":
            raise RuntimeError(f"Front-depth proof missing: {proofs[1]}")
        if proofs[2].get("occlusionExpected") != "occluded":
            raise RuntimeError(f"Behind-depth proof missing: {proofs[2]}")
        if proofs[4].get("cutawayActive") is not True or proofs[7].get("cutawayActive") is not True:
            raise RuntimeError(f"Interior cutaway proof missing: frame5={proofs[4]}, frame8={proofs[7]}")

        zooms = [item.get("cameraZoom") for item in builds]
        if zooms[5] == zooms[4]:
            raise RuntimeError(f"Character zoom evidence did not change camera zoom: {zooms}")

        viewports = [runtime.get("viewport") or {} for runtime in runtimes]
        phone_landscape = viewports[6]
        phone_portrait = viewports[7]
        if int(phone_landscape.get("width") or 0) <= int(phone_landscape.get("height") or 0):
            raise RuntimeError(f"Phone landscape evidence invalid: {phone_landscape}")
        if int(phone_portrait.get("height") or 0) <= int(phone_portrait.get("width") or 0):
            raise RuntimeError(f"Phone portrait evidence invalid: {phone_portrait}")

        landscape_layout = builds[6].get("layout") or {}
        gameplay = landscape_layout.get("gameplay") or {}
        proof_panel = landscape_layout.get("characterProofPanel") or {}
        gameplay_area = float(gameplay.get("width") or 0) * float(gameplay.get("height") or 0)
        panel_area = float(proof_panel.get("width") or 0) * float(proof_panel.get("height") or 0)
        if gameplay_area <= 0 or panel_area <= 0:
            raise RuntimeError(
                f"Phone landscape proof/gameplay bounds missing: gameplay={gameplay}, panel={proof_panel}"
            )
        if float(proof_panel.get("height") or 999) > 34:
            raise RuntimeError(f"Phone landscape proof badge is too tall: {proof_panel}")
        if float(proof_panel.get("width") or 9999) > float(gameplay.get("width") or 0) * 0.48:
            raise RuntimeError(
                f"Phone landscape proof badge is too wide: gameplay={gameplay}, panel={proof_panel}"
            )
        if panel_area / gameplay_area > 0.10:
            raise RuntimeError(
                f"Phone landscape proof badge obscures too much gameplay: "
                f"ratio={panel_area/gameplay_area:.3f}, gameplay={gameplay}, panel={proof_panel}"
            )

        landscape_gpu = gpus[6]
        landscape_scene = landscape_gpu.get("scene") or {}
        landscape_canvas = landscape_gpu.get("canvas") or {}
        landscape_instances = (presentations[6].get("instances") or [])
        landscape_protagonist = next(
            (item for item in landscape_instances if item.get("id") == "protagonist"),
            None,
        )
        if not landscape_protagonist:
            raise RuntimeError(f"Phone landscape protagonist telemetry missing: {presentations[6]}")
        ortho = float(landscape_scene.get("orthoHeight") or 0)
        canvas_height = float(landscape_canvas.get("cssHeight") or 0)
        protagonist_height_m = float(landscape_protagonist.get("height") or 0)
        estimated_height_px = (
            protagonist_height_m * canvas_height / (2.0 * ortho)
            if ortho > 0 and canvas_height > 0 else 0
        )
        if estimated_height_px < 14.0:
            raise RuntimeError(
                f"Phone landscape protagonist is too small for readable 2D art: "
                f"estimated_height_px={estimated_height_px:.2f}, "
                f"orthoHeight={ortho}, canvasHeight={canvas_height}"
            )
        return

    if scenario == "wp-s003-003":
        if len(frames) < 3:
            raise RuntimeError("wp-s003-003 requires three evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:3]]
        proofs = [item.get("interiorObjects") or {} for item in builds]
        presentations = [
            ((item.get("gpuRenderer") or {}).get("interiorObjectPresentation") or {})
            for item in builds
        ]
        for index, proof in enumerate(proofs, start=1):
            required = (
                "pass",
                "deterministic",
                "uniqueIds",
                "legalPlacement",
                "interactionsValid",
                "blockingPass",
                "routeBlockingPass",
                "allBuildingsCovered",
            )
            if not all(proof.get(key) is True for key in required):
                raise RuntimeError(f"WP-S003-003 authoritative proof failed in frame {index}: {proof}")
            if int(proof.get("objectCount") or 0) < 1 or int(proof.get("buildingCount") or 0) < 2:
                raise RuntimeError(f"WP-S003-003 proof coverage is unexpectedly empty in frame {index}: {proof}")

        expected_sources = ("house", "special", "special")
        for index, (presentation, source) in enumerate(zip(presentations, expected_sources), start=1):
            if not presentation.get("active"):
                raise RuntimeError(f"WP-S003-003 PlayCanvas proof is inactive in frame {index}: {presentation}")
            if presentation.get("buildingSource") != source:
                raise RuntimeError(f"WP-S003-003 representative source mismatch in frame {index}: {presentation}")
            object_count = int(presentation.get("objectCount") or 0)
            interaction_count = int(presentation.get("interactionCount") or 0)
            reachable_count = int(presentation.get("reachableInteractionCount") or 0)
            if object_count < 1 or interaction_count != object_count or reachable_count != interaction_count:
                raise RuntimeError(f"WP-S003-003 interaction presentation mismatch in frame {index}: {presentation}")
            if int(presentation.get("blockingObjectCount") or 0) < 1:
                raise RuntimeError(f"WP-S003-003 blocking object proof missing in frame {index}: {presentation}")
            objects = presentation.get("objects") or []
            if len(objects) != object_count:
                raise RuntimeError(f"WP-S003-003 presented object details mismatch in frame {index}: {presentation}")
            for obj in objects:
                if not obj.get("id") or not obj.get("type") or not obj.get("coordinate") or not obj.get("interaction"):
                    raise RuntimeError(f"WP-S003-003 object metadata missing in frame {index}: {obj}")
                if not obj.get("actions") or obj.get("reachable") is not True:
                    raise RuntimeError(f"WP-S003-003 action/reachability metadata failed in frame {index}: {obj}")

        protagonists = [item.get("protagonistLocation") for item in builds]
        cameras = [item.get("cameraCoordinate") for item in builds]
        if len(set(protagonists)) != 1 or len(set(cameras)) != 1:
            raise RuntimeError(
                f"WP-S003-003 development proof mutated authoritative coordinates: protagonist={protagonists}, camera={cameras}"
            )
        return

    if scenario == "playcanvas-scene":
        if len(frames) < 6:
            raise RuntimeError("playcanvas-scene requires six evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:6]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        gpus = [(item.get("gpuRenderer") or {}) for item in builds]

        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"PlayCanvas scene changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"PlayCanvas scene changed Protagonist coordinates: {protagonists}")

        required_roots = [
            "TerrainRoot",
            "StructuresRoot",
            "PropsRoot",
            "CharacterBillboardsRoot",
            "LightingRoot",
        ]
        for index, gpu in enumerate(gpus, start=1):
            scene = gpu.get("scene") or {}
            quality = gpu.get("quality") or {}
            canvas = gpu.get("canvas") or {}
            perf = gpu.get("performance") or {}
            if gpu.get("engine") != "PlayCanvas" or not str(gpu.get("engineVersion") or "").startswith("2."):
                raise RuntimeError(f"PlayCanvas Engine 2 missing in frame {index}: {gpu}")
            if gpu.get("backend") not in {"webgl2", "webgpu"} or not gpu.get("gpu"):
                raise RuntimeError(f"PlayCanvas GPU backend failed in frame {index}: {gpu}")
            if int(gpu.get("canvasCount") or 0) != 1:
                raise RuntimeError(f"PlayCanvas expected one gameplay canvas in frame {index}: {gpu}")
            if not gpu.get("sceneBaseline") or scene.get("projection") != "orthographic":
                raise RuntimeError(f"Orthographic scene baseline missing in frame {index}: {scene}")
            if scene.get("roots") != required_roots:
                raise RuntimeError(f"PlayCanvas scene hierarchy mismatch in frame {index}: {scene}")
            if int(scene.get("entityCount") or 0) < 20:
                raise RuntimeError(f"PlayCanvas scene hierarchy is unexpectedly empty in frame {index}: {scene}")
            if int(scene.get("terrainEntityCount") or 0) < 5 or int(scene.get("structureEntityCount") or 0) < 12:
                raise RuntimeError(f"PlayCanvas baseline geometry is incomplete in frame {index}: {scene}")
            if float(scene.get("orthoHeight") or 0) <= 0:
                raise RuntimeError(f"PlayCanvas orthographic height missing in frame {index}: {scene}")
            if float(quality.get("renderScale") or 0) <= 0 or float(quality.get("renderScale") or 0) > 1:
                raise RuntimeError(f"PlayCanvas render scale invalid in frame {index}: {quality}")
            if float(quality.get("maxPixelRatio") or 0) <= 0 or float(quality.get("maxPixelRatio") or 0) > 2:
                raise RuntimeError(f"PlayCanvas max pixel ratio invalid in frame {index}: {quality}")
            if int(canvas.get("cssWidth") or 0) <= 0 or int(canvas.get("cssHeight") or 0) <= 0:
                raise RuntimeError(f"PlayCanvas CSS canvas size missing in frame {index}: {canvas}")
            if int(canvas.get("backingWidth") or 0) <= 0 or int(canvas.get("backingHeight") or 0) <= 0:
                raise RuntimeError(f"PlayCanvas backing canvas size missing in frame {index}: {canvas}")
            if float(perf.get("frameMs") or 0) < 0 or int(perf.get("drawCalls") or 0) < 1:
                raise RuntimeError(f"PlayCanvas frame/draw telemetry invalid in frame {index}: {perf}")
            if not gpu.get("simulationAuthorityPreserved"):
                raise RuntimeError(f"PlayCanvas scene changed Simulation authority in frame {index}: {gpu}")

        viewports = [runtime.get("viewport") or {} for runtime in runtimes]
        desktop, tablet, phone_landscape, phone_portrait = viewports[:4]
        if int(desktop.get("width") or 0) <= int(desktop.get("height") or 0):
            raise RuntimeError(f"Desktop landscape evidence invalid: {desktop}")
        if int(tablet.get("width") or 0) <= int(tablet.get("height") or 0):
            raise RuntimeError(f"Tablet landscape evidence invalid: {tablet}")
        if int(phone_landscape.get("width") or 0) <= int(phone_landscape.get("height") or 0):
            raise RuntimeError(f"Phone landscape evidence invalid: {phone_landscape}")
        if int(phone_portrait.get("height") or 0) <= int(phone_portrait.get("width") or 0):
            raise RuntimeError(f"Phone portrait evidence invalid: {phone_portrait}")

        desktop_quality = gpus[0].get("quality") or {}
        tablet_quality = gpus[1].get("quality") or {}
        phone_quality = gpus[2].get("quality") or {}
        portrait_quality = gpus[3].get("quality") or {}
        if desktop_quality.get("deviceClass") != "desktop":
            raise RuntimeError(f"Desktop viewport did not receive desktop quality policy: {desktop_quality}")
        if float(desktop_quality.get("maxPixelRatio") or 0) < 1.5 or float(desktop_quality.get("renderScale") or 0) < 1.0:
            raise RuntimeError(f"Desktop default quality was unexpectedly reduced: {desktop_quality}")
        if tablet_quality.get("deviceClass") != "tablet":
            raise RuntimeError(f"Tablet viewport did not receive tablet quality policy: {tablet_quality}")
        if abs(float(tablet_quality.get("maxPixelRatio") or 0) - 1.25) > 0.01 or abs(float(tablet_quality.get("renderScale") or 0) - 0.90) > 0.01:
            raise RuntimeError(f"Tablet default quality policy is incorrect: {tablet_quality}")
        for q in (phone_quality, portrait_quality):
            if q.get("deviceClass") != "phone":
                raise RuntimeError(f"Phone viewport did not receive phone quality policy: {q}")
            if abs(float(q.get("maxPixelRatio") or 0) - 1.0) > 0.01 or abs(float(q.get("renderScale") or 0) - 0.85) > 0.01:
                raise RuntimeError(f"Phone quality policy is not conservative/default-correct: {q}")

        cameras = [item.get("cameraCoordinate") for item in builds]
        zooms = [item.get("cameraZoom") for item in builds]
        if cameras[4] == cameras[3] or cameras[4] == cameras[0]:
            raise RuntimeError(f"PlayCanvas pan evidence did not change authoritative camera coordinate: {cameras}")
        if len(set(protagonists)) != 1:
            raise RuntimeError(f"PlayCanvas pan changed protagonist coordinate: {protagonists}")
        if zooms[5] == zooms[4]:
            raise RuntimeError(f"PlayCanvas zoom evidence did not change zoom: {zooms}")
        if float((gpus[5].get("scene") or {}).get("orthoHeight") or 0) >= float((gpus[4].get("scene") or {}).get("orthoHeight") or 0):
            raise RuntimeError(
                f"PlayCanvas zoom-in did not reduce orthographic height: before={gpus[4].get('scene')} after={gpus[5].get('scene')}"
            )
        return

    if scenario == "playcanvas-foundation":
        if len(frames) < 3:
            raise RuntimeError("playcanvas-foundation requires three evidence frames")
        runtimes = [frame.get("runtime", {}) for frame in frames[:3]]
        builds = [runtime.get("currentBuild", {}) for runtime in runtimes]
        seeds = [item.get("campaignSeed") for item in builds]
        protagonists = [item.get("protagonistLocation") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"PlayCanvas migration changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"PlayCanvas migration changed/missed protagonist coordinate: {protagonists}")
        for index, item in enumerate(builds, start=1):
            gpu = item.get("gpuRenderer") or {}
            if gpu.get("engine") != "PlayCanvas":
                raise RuntimeError(f"PlayCanvas engine was not active in frame {index}: {gpu}")
            if not str(gpu.get("engineVersion") or "").startswith("2."):
                raise RuntimeError(f"PlayCanvas Engine 2 version missing in frame {index}: {gpu}")
            if gpu.get("backend") not in {"webgl2", "webgpu"}:
                raise RuntimeError(f"Unexpected PlayCanvas backend in frame {index}: {gpu}")
            if not gpu.get("gpu") or int(gpu.get("canvasCount") or 0) != 1:
                raise RuntimeError(f"PlayCanvas GPU/canvas foundation failed in frame {index}: {gpu}")
            if not gpu.get("migrationFoundation") or not gpu.get("simulationAuthorityPreserved"):
                raise RuntimeError(f"PlayCanvas authority boundary failed in frame {index}: {gpu}")
            if not gpu.get("rendererContractVersion"):
                raise RuntimeError(f"Renderer-neutral contract version missing in frame {index}: {gpu}")
        first_view = runtimes[0].get("viewport") or {}
        portrait_view = runtimes[1].get("viewport") or {}
        last_view = runtimes[2].get("viewport") or {}
        if int(portrait_view.get("height") or 0) <= int(portrait_view.get("width") or 0):
            raise RuntimeError(f"PlayCanvas portrait resize failed: {portrait_view}")
        if int(first_view.get("width") or 0) <= int(first_view.get("height") or 0):
            raise RuntimeError(f"PlayCanvas initial landscape viewport failed: {first_view}")
        if int(last_view.get("width") or 0) <= int(last_view.get("height") or 0):
            raise RuntimeError(f"PlayCanvas landscape return failed: {last_view}")
        return

    if scenario == "wp-s003-005":
        if len(frames) < 3:
            raise RuntimeError("wp-s003-005 requires three evidence frames")

        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:3]]
        gpus=[(item.get("gpuRenderer") or {}) for item in builds]
        world_preparations=[gpu.get("worldAssetPreparation") or {} for gpu in gpus]
        world_caches=[gpu.get("worldAssetCache") or {} for gpu in gpus]
        world_proofs=[gpu.get("worldAssetProof") or {} for gpu in gpus]
        character_preparations=[gpu.get("characterAssetPreparation") or {} for gpu in gpus]
        asset_proofs=[gpu.get("assetPreparationProof") or {} for gpu in gpus]

        seeds=[item.get("campaignSeed") for item in builds]
        protagonists=[item.get("protagonistLocation") for item in builds]
        cameras=[item.get("cameraCoordinate") for item in builds]
        if len(set(seeds)) != 1 or not seeds[0]:
            raise RuntimeError(f"WP-S003-005 Campaign SEED changed/missing: {seeds}")
        if len(set(protagonists)) != 1 or not protagonists[0]:
            raise RuntimeError(f"WP-S003-005 asset preparation changed Protagonist coordinates: {protagonists}")
        if not cameras[0] or cameras[1] == cameras[0] or cameras[2] != cameras[0]:
            raise RuntimeError(f"WP-S003-005 camera evidence did not move away and return: {cameras}")

        for index,(gpu,prep,cache,proof,char_cache) in enumerate(
            zip(gpus,world_preparations,world_caches,world_proofs,character_preparations),start=1
        ):
            if gpu.get("engine") != "PlayCanvas" or gpu.get("backend") not in {"webgl2","webgpu"}:
                raise RuntimeError(f"WP-S003-005 PlayCanvas backend missing in frame {index}: {gpu}")
            if gpu.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"WP-S003-005 renderer changed Simulation authority in frame {index}: {gpu}")
            if prep.get("ready") is not True or prep.get("stale") is True:
                raise RuntimeError(f"WP-S003-005 world preparation gate is not ready in frame {index}: {prep}")
            if int(prep.get("regionCount") or 0) < 1 or int(prep.get("keyCount") or 0) < 2:
                raise RuntimeError(f"WP-S003-005 chunk-derived world requirements missing in frame {index}: {prep}")
            logical_keys=set(prep.get("logicalKeys") or [])
            if "world.prototype.representative-set" not in logical_keys or "world.terrain.grass" not in logical_keys:
                raise RuntimeError(f"WP-S003-005 required stable logical keys missing in frame {index}: {prep}")
            if int(cache.get("registered") or 0) < 10:
                raise RuntimeError(f"WP-S003-005 logical world catalog is incomplete in frame {index}: {cache}")
            if int(cache.get("meshContainers") or 0) < 1 or int(cache.get("materials") or 0) < 3:
                raise RuntimeError(f"WP-S003-005 prepared mesh/material coverage is incomplete in frame {index}: {cache}")
            if int(cache.get("networkLoads") or 0) < 1 or int(cache.get("containerParses") or 0) < 1:
                raise RuntimeError(f"WP-S003-005 real glTF preparation was not exercised in frame {index}: {cache}")
            if int(cache.get("pending") or 0) != 0:
                raise RuntimeError(f"WP-S003-005 world asset preparation is still pending in frame {index}: {cache}")
            if int(cache.get("cached") or 0) > int(cache.get("cacheLimit") or 0):
                raise RuntimeError(f"WP-S003-005 world asset cache exceeded its bound in frame {index}: {cache}")
            if int(cache.get("pinned") or 0) > int(cache.get("cacheLimit") or 0):
                raise RuntimeError(f"WP-S003-005 pinned world assets exceeded cache limit in frame {index}: {cache}")
            if int(cache.get("characterAssets") or 0) != 0:
                raise RuntimeError(f"WP-S003-005 world preparation mixed in character assets in frame {index}: {cache}")
            if (
                proof.get("logicalKeys") is not True or
                proof.get("bounded") is not True or
                proof.get("preparedRegions") is not True or
                proof.get("noVisiblePathLoads") is not True
            ):
                raise RuntimeError(f"WP-S003-005 world asset proof failed in frame {index}: {proof}")
            if int(char_cache.get("characterAssets") or 0) < 1 or int(char_cache.get("textures") or 0) < 1:
                raise RuntimeError(f"WP-S003-005 separate 2D character preparation path missing in frame {index}: {char_cache}")
            if int(char_cache.get("pending") or 0) != 0:
                raise RuntimeError(f"WP-S003-005 character asset preparation still pending in frame {index}: {char_cache}")

        network_loads=[int(cache.get("networkLoads") or 0) for cache in world_caches]
        container_parses=[int(cache.get("containerParses") or 0) for cache in world_caches]
        if len(set(network_loads)) != 1 or len(set(container_parses)) != 1:
            raise RuntimeError(
                "WP-S003-005 visible navigation initiated new world network/GLTF parse work: "
                f"network={network_loads}, parses={container_parses}"
            )

        hits=[int(cache.get("hits") or 0) for cache in world_caches]
        waits=[int(cache.get("waits") or 0) for cache in world_caches]
        if not (hits[1] > hits[0] and hits[2] > hits[1]):
            raise RuntimeError(f"WP-S003-005 move/return did not reuse cached world assets: hits={hits}")
        if not (waits[1] > waits[0] and waits[2] > waits[1]):
            raise RuntimeError(f"WP-S003-005 move/return preparation telemetry did not advance: waits={waits}")

        region_sets=[set(prep.get("regionKeys") or []) for prep in world_preparations]
        if not region_sets[0] or region_sets[1] == region_sets[0]:
            raise RuntimeError(
                "WP-S003-005 prepared chunk ring did not change after distant navigation: "
                f"origin={len(region_sets[0])}, moved={len(region_sets[1])}"
            )
        if not any("coord=0,0|" in key for key in region_sets[0]):
            raise RuntimeError("WP-S003-005 origin preparation does not include center chunk 0,0")
        if not any("coord=4,0|" in key for key in region_sets[1]):
            raise RuntimeError("WP-S003-005 moved preparation does not include center chunk 4,0")
        if not any("coord=0,0|" in key for key in region_sets[2]):
            raise RuntimeError("WP-S003-005 return preparation does not include center chunk 0,0")
        if not all(proof.get("active") is True for proof in asset_proofs):
            raise RuntimeError(f"WP-S003-005 visual proof must be active in every evidence frame: {asset_proofs}")
        for index in (0,1,2):
            proof=asset_proofs[index]
            if proof.get("logicalKey") != "world.prototype.representative-set":
                raise RuntimeError(f"WP-S003-005 cached glTF proof key mismatch in frame {index+1}: {proof}")
            if int(proof.get("entityCount") or 0) < 10 or int(proof.get("meshInstanceCount") or 0) < 10:
                raise RuntimeError(f"WP-S003-005 cached glTF proof geometry is unexpectedly empty in frame {index+1}: {proof}")
            if int(proof.get("materialCount") or 0) < 5:
                raise RuntimeError(f"WP-S003-005 cached glTF proof shared materials missing in frame {index+1}: {proof}")
            if int(proof.get("networkLoads") or 0) != network_loads[index] or int(proof.get("containerParses") or 0) != container_parses[index]:
                raise RuntimeError(f"WP-S003-005 proof view initiated extra loading/parsing in frame {index+1}: {proof}")
        return

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

    if scenario == "building-occlusion":
        if len(frames) < 6:
            raise RuntimeError("building-occlusion requires six evidence frames")
        builds = [frame.get("runtime", {}).get("currentBuild", {}) for frame in frames[:6]]
        protagonist_positions = [item.get("protagonistLocation") for item in builds]
        camera_positions = [item.get("cameraCoordinate") for item in builds]
        if len(set(protagonist_positions)) != 1:
            raise RuntimeError(
                f"WP-S003-004-001 presentation mutated Protagonist coordinates: {protagonist_positions}"
            )
        if len(set(camera_positions)) != 1:
            raise RuntimeError(
                f"WP-S003-004-001 proof mutated Camera coordinates: {camera_positions}"
            )

        expected_states = ["front", "behind", "behind", "clear", "inside", "restored"]
        occlusions = []
        presentations = []
        for index, (item, expected_state) in enumerate(zip(builds, expected_states), start=1):
            gpu = item.get("gpuRenderer") or {}
            occ = gpu.get("buildingOcclusion") or {}
            presentation = gpu.get("buildingPresentation") or {}
            occlusions.append(occ)
            presentations.append(presentation)

            if occ.get("proofState") != expected_state:
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} proof state mismatch: {occ}"
                )
            if not occ.get("simulationAuthorityPreserved"):
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} lost Simulation authority: {occ}"
                )
            if occ.get("wholeBuildingFade"):
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} fades a whole building: {occ}"
                )
            if not presentation.get("tallBuildingMass"):
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} tall building mass is disabled: {presentation}"
                )
            if float(presentation.get("minVisibleHeightFactor") or 0) < 0.45:
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} building mass is still too thin: {presentation}"
                )
            if float(presentation.get("maxVisibleHeightFactor") or 0) < 0.70:
                raise RuntimeError(
                    f"WP-S003-004-001 frame {index} lacks archetype height variation: {presentation}"
                )

        front, behind, behind_wide, clear, inside, restored = occlusions
        for name, occ in (("front", front), ("clear", clear), ("restored", restored)):
            if int(occ.get("localCutoutCount") or 0) != 0:
                raise RuntimeError(
                    f"WP-S003-004-001 {name} incorrectly triggers a local cutout: {occ}"
                )

        for name, occ in (("behind", behind), ("behind-wide", behind_wide)):
            if int(occ.get("localCutoutCount") or 0) < 1:
                raise RuntimeError(
                    f"WP-S003-004-001 {name} has no local character cutout: {occ}"
                )
            if int(occ.get("affectedBuildingCount") or 0) < 1:
                raise RuntimeError(
                    f"WP-S003-004-001 {name} did not identify an occluding building: {occ}"
                )
            patches = int(occ.get("wallCutoutPatchCount") or 0) + int(occ.get("roofCutoutPatchCount") or 0)
            if patches < 1:
                raise RuntimeError(
                    f"WP-S003-004-001 {name} has no locally faded wall/roof patches: {occ}"
                )
            if not occ.get("proofBuildingId"):
                raise RuntimeError(
                    f"WP-S003-004-001 {name} lacks proof building identity: {occ}"
                )

        if int(inside.get("localCutoutCount") or 0) != 0:
            raise RuntimeError(
                f"WP-S003-004-001 inside state incorrectly uses outside local occlusion: {inside}"
            )
        if not inside.get("insideUsesLargeCutaway"):
            raise RuntimeError(
                f"WP-S003-004-001 inside state did not use the large interior cutaway: {inside}"
            )
        if not presentations[4].get("cutawayActive"):
            raise RuntimeError(
                f"WP-S003-004-001 inside roof/wall cutaway is not active: {presentations[4]}"
            )
        if presentations[1].get("cutawayActive") or presentations[2].get("cutawayActive"):
            raise RuntimeError(
                f"WP-S003-004-001 outside-behind proof incorrectly uses whole-building cutaway: {presentations[1:3]}"
            )
        if int(behind.get("localCutoutCount") or 0) > int(behind.get("maxEntities") or 0) * int(behind.get("maxCutoutsPerBuilding") or 0):
            raise RuntimeError(
                f"WP-S003-004-001 local occlusion work exceeded its bound: {behind}"
            )
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
            playcanvas_world = presentation.get("migrationFoundation") is True and presentation.get("layerOrder") == ["playcanvas-world"]
            if not playcanvas_world and presentation.get("layerOrder") != expected_layers:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} layer order failed: {presentation}"
                )
            if not presentation.get("simulationAuthorityPreserved"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} lost Simulation authority: {presentation}"
                )
            if playcanvas_world:
                if int(presentation.get("visibleBuildingCount") or 0) < 1:
                    raise RuntimeError(f"WP-S003-004 PlayCanvas building scene empty in frame {index}: {presentation}")
                expected_cutaway = expected_state in {"entering", "inside", "behind"}
                if bool(presentation.get("cutawayActive")) != expected_cutaway:
                    raise RuntimeError(f"WP-S003-004 PlayCanvas cutaway mismatch in frame {index}: {presentation}")
                continue
            if int(presentation.get("roofCount") or 0) <= 0:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} has no visible roof presentation: {presentation}"
                )
            if not presentation.get("projectedFootprintRoofs"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} is not using four-corner projected roof footprints: {presentation}"
                )
            if int(presentation.get("projectedFootprintRoofCount") or 0) != int(presentation.get("roofCount") or 0):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} projected roof count mismatch: {presentation}"
                )
            if not presentation.get("edgeAwareWallDepth"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} wall depth is not orientation-aware: {presentation}"
                )
            if int(presentation.get("visibleWallCapCount") or 0) <= 0:
                raise RuntimeError(
                    f"WP-S003-004 frame {index} has no raised wall presentation: {presentation}"
                )
            if not presentation.get("ySortedEntities"):
                raise RuntimeError(
                    f"WP-S003-004 frame {index} entity Y sorting is disabled: {presentation}"
                )

        if ((builds[0].get("gpuRenderer") or {}).get("buildingPresentation") or {}).get("migrationFoundation") is True:
            return

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
        runtime_texture_px = int(cache.get("runtimeTextureResolution") or 0)
        if runtime_texture_px not in {16,32,64,128}:
            raise RuntimeError(
                f"PlayCanvas runtime texture resolution is outside the supported adaptive set: "
                f"{runtime_texture_px}px, cache={cache}"
            )
        if not str(cache.get("runtimeTextureCacheSignature") or ""):
            raise RuntimeError(f"PlayCanvas runtime texture cache signature is missing: {cache}")
        if not cache.get("ready") or int(cache.get("svgSourceCount") or 0) <= 0:
            raise RuntimeError(f"PlayCanvas texture preparation cache is not ready: {gpu}")
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
        texture_cache = (current.get("gpuRenderer") or {}).get("textureCache") or {}
        if int(texture_cache.get("pngPreferredCount") or 0) < 1:
            raise RuntimeError(f"PNG-first texture resolution was not observed: {texture_cache}")
        if int(texture_cache.get("fallbackSvgCount") or 0) < 1:
            raise RuntimeError(f"SVG fallback texture resolution was not observed: {texture_cache}")
        if int(texture_cache.get("loadedKeyCount") or 0) >= int(texture_cache.get("logicalKeyCount") or 0):
            raise RuntimeError(f"Starting Village unexpectedly preloaded the full texture catalog: {texture_cache}")
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
        walk = current.get("walkability") or {}
        if not walk.get("pass") or not walk.get("deterministic") or not walk.get("classificationCoverage"):
            raise RuntimeError(f"WP-009 authoritative walkability proof failed: {walk}")
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

        for index, (deck, item) in enumerate(zip(decks, builds), start=1):
            grid = item.get("terrainGrid") or {}
            if not grid.get("coveragePass"):
                raise RuntimeError(f"WP-S003-008 gameplay terrain does not cover frame {index}: {grid}")
            if deck.get("horizontalOverflow"):
                raise RuntimeError(f"WP-S003-008 horizontal overflow in frame {index}: {deck}")
            if not deck.get("advisorInInteractions"):
                raise RuntimeError(f"WP-S003-008 Advisor placement failed in frame {index}: {deck}")
            if deck.get("developmentMode") or deck.get("developmentDetailsVisible"):
                raise RuntimeError(f"WP-S003-008 player-facing layout exposes Development/verification content in frame {index}: {deck}")
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
        if scenario == "wp-s003-005-002":
            browser_url = browser_url.rstrip("/") + "/asset-standard-proof.html"
        if scenario in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-006-002", "wp-s003-006-001"}:
            browser_url += ("&" if "?" in browser_url else "?") + "gpu=webgl2"
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

            prep_action = prepare_current_build(driver, min(ready_timeout, 10.0), scenario) if auto_start else "auto-start-disabled"
            if scenario == "wp-s003-004-002":
                proof_action = _set_character_proof_state(driver, "open")
                prep_action = prep_action + "+" + proof_action

            if force_max_zoom and scenario not in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-005-002", "wp-s003-006-002", "wp-s003-006-001", "playcanvas-root-cutover", "wp-s003-006", "wp-s003-006-003"}:
                force_max_zoom_out(driver)

            frames: list[dict] = []
            for index, path in enumerate(paths):
                if scenario in {"building-presentation", "building-occlusion", "wp-s003-005", "wp-s003-003", "wp-s003-006-001"}:
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
                if scenario not in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-005-002", "wp-s003-006-002"}:
                    validate_current_build_snapshot(snapshot, require_coverage=scenario != "responsive-cycle")
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
