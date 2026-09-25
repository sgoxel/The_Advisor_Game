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
import os
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
    "wp-s003-004-003",
    "wp-s003-004-004",
    "wp-s003-004-005",
    "wp-s003-005-002",
    "wp-s003-005-003",
    "wp-s003-005-004",
    "wp-s003-005-006",
    "wp-s003-006-002",
    "wp-s003-006-001",
    "wp-s003-006",
    "wp-s003-006-003",
    "wp-s003-006-004",
    "wp-s003-006-005",
    "wp-s003-006-006",
    "wp-s003-006-007",
    "wp-s003-006-008",
    "wp-s003-006-009",
    "wp-s003-007-001",
    "wp-s003-008-001",
    "wp-s003-008-002",
    "wp-s003-008-003",
    "wp-s003-009-001",
    "wp-s003-009-002",
    "wp-s003-009-003",
    "wp-s003-009-004",
    "wp-s003-009-004-001",
    "wp-s003-009-004-002",
    "wp-s003-009-005",
    "wp-s004-001",
    "wp-s004-002",
    "wp-s004-003",
    "wp-s004-004",
    "wp-s004-004-001",
    "wp-s004-005",
    "wp-s005-001",
    "wp-s005-002",
    "wp-s005-003",
    "wp-s005-004",
    "wp-s005-005",
    "wp-s006-001",
    "wp-s006-002",
    "wp-s006-003",
    "wp-s006-004",
    "wp-s006-005",
    "wp-s006-006",
    "wp-s007-001",
    "wp-s007-002",
    "wp-s007-003",
    "wp-s007-004",
    "wp-s007-005",
    "wp-s007-006",
    "wp-s007-007",
    "wp-s007-008",
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
    "wp-s003-004-003": 6,
    "wp-s003-004-004": 11,
    "wp-s003-004-005": 11,
    "wp-s003-005-002": 4,
    "wp-s003-005-003": 7,
    "wp-s003-005-004": 7,
    "wp-s003-005-006": 7,
    "wp-s003-006-002": 8,
    "wp-s003-006-001": 14,
    "wp-s003-006": 7,
    "wp-s003-006-003": 7,
    "wp-s003-006-004": 9,
    "wp-s003-006-005": 7,
    "wp-s003-006-006": 7,
    "wp-s003-006-007": 10,
    "wp-s003-006-008": 11,
    "wp-s003-006-009": 11,
    "wp-s003-007-001": 6,
    "wp-s003-008-001": 16,
    "wp-s003-008-002": 9,
    "wp-s003-008-003": 8,
    "wp-s003-009-001": 8,
    "wp-s003-009-002": 11,
    "wp-s003-009-003": 9,
    "wp-s003-009-004": 6,
    "wp-s003-009-004-001": 7,
    "wp-s003-009-004-002": 8,
    "wp-s003-009-005": 8,
    "wp-s004-001": 3,
    "wp-s004-002": 3,
    "wp-s004-003": 4,
    "wp-s004-004": 5,
    "wp-s004-004-001": 6,
    "wp-s004-005": 5,
    "wp-s005-001": 4,
    "wp-s005-002": 4,
    "wp-s005-003": 5,
    "wp-s005-004": 5,
    "wp-s005-005": 5,
    "wp-s006-001": 5,
    "wp-s006-002": 5,
    "wp-s006-003": 5,
    "wp-s006-004": 5,
    "wp-s006-005": 6,
    "wp-s006-006": 6,
    "wp-s007-001": 6,
    "wp-s007-002": 6,
    "wp-s007-003": 7,
    "wp-s007-004": 2,
    "wp-s007-005": 5,
    "wp-s007-006": 6,
    "wp-s007-007": 6,
    "wp-s007-008": 6,
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
        sceneLoading: window.AppUI?.sceneLoadingSnapshot?.() || null,
        worldVisualStyle: window.AdvisorWorldVisualStyle?.snapshot?.() || null,
        sceneLoadingEarlyClick: window.__WP_S003_008_002_EARLY_CLICK || null,
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
        roadProfileCharacterProximity: (() => {
          try {
            const seed=window.SeedSystem?.getCampaign?.()?.seed;
            if(!seed||!window.TerrainFoundation?.getTile)return null;
            const instances=renderer?.characterPresentation?.instances || [];
            const roadlike=type=>['road','path','square'].includes(String(type||''));
            const nearestRoad=world=>{
              if(!world)return null;
              let wx,wy;
              try{wx=BigInt(String(world.x));wy=BigInt(String(world.y));}catch(_){return null;}
              let best=null;
              for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
                const tx=wx+BigInt(dx),ty=wy+BigInt(dy);
                const type=String(window.TerrainFoundation.getTile(seed,String(tx),String(ty))?.type||'');
                if(!roadlike(type))continue;
                const distance=Math.hypot(dx,dy);
                if(!best||distance<best.distanceTiles)best={distanceTiles:Number(distance.toFixed(3)),type,x:String(tx),y:String(ty)};
              }
              return best;
            };
            const rows=instances.map(item=>({
              id:String(item?.id||''),
              world:item?.world||null,
              nearestRoad:nearestRoad(item?.world||null)
            }));
            const protagonist=rows.find(item=>item.id==='protagonist')||null;
            const npcs=rows.filter(item=>item.id&&item.id!=='protagonist'&&item.nearestRoad);
            npcs.sort((a,b)=>Number(a.nearestRoad?.distanceTiles??99)-Number(b.nearestRoad?.distanceTiles??99)||a.id.localeCompare(b.id));
            return {
              visibleCharacterCount:rows.length,
              protagonist,
              nearestNpc:npcs[0]||null
            };
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
        advisorChannel: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.AdvisorChannel?.proof
              ? window.AdvisorChannel.proof(campaign.seed,"protagonist")
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        characterMemory: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.CharacterMemory?.verify
              ? window.CharacterMemory.verify(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        simulationTiers: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.SimulationTiers?.proof
              ? window.SimulationTiers.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        eventScheduler: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.EventScheduler?.proof
              ? window.EventScheduler.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        globalCountrySimulation: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.GlobalCountrySimulation?.proof
              ? window.GlobalCountrySimulation.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        regionalSettlementSimulation: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.RegionalSettlementSimulation?.proof
              ? window.RegionalSettlementSimulation.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        npcLifecycle: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.NPCLifecycle?.proof
              ? window.NPCLifecycle.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        lazyCatchUp: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.CatchUpSimulation?.proof
              ? window.CatchUpSimulation.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        lazyCatchUpPanel: (() => {
          const root=document.querySelector("#lazyCatchUpProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),pass:root.dataset.pass==="true",
            lastStep:Number(root.dataset.lastStep||0),
            incompleteObserved:root.dataset.incompleteObserved==="true",
            blockedWhileIncomplete:root.dataset.blockedWhileIncomplete==="true",
            resumedComplete:root.dataset.resumedComplete==="true",
            phaseOrderPass:root.dataset.phaseOrderPass==="true",
            importantApplied:root.dataset.importantApplied==="true",
            importantDeltaRevision:Number(root.dataset.importantDeltaRevision||0),
            eventsProcessed:Number(root.dataset.eventsProcessed||0),
            batchesProcessed:Number(root.dataset.batchesProcessed||0),
            spanHours:Number(root.dataset.spanHours||0),
            offlineFantasyHours:Number(root.dataset.offlineFantasyHours||0),
            longAbsenceEvents:Number(root.dataset.longAbsenceEvents||0),
            reloadCursorStable:root.dataset.reloadCursorStable==="true",
            reloadReady:root.dataset.reloadReady==="true",
            stableAfterCamera:root.dataset.stableAfterCamera==="true",
            authoritativeReady:root.dataset.authoritativeReady==="true",
            checkStates:Array.from(root.querySelectorAll(".check b")).map(node=>node.textContent?.trim()||"")
          };
        })(),
        npcLifecyclePanel: (() => {
          const root=document.querySelector("#npcLifecycleProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),pass:root.dataset.pass==="true",
            lastStep:Number(root.dataset.lastStep||0),
            identityPopulation:Number(root.dataset.identityPopulation||0),
            activeExactPeak:Number(root.dataset.activeExactPeak||0),
            dormantIdentityCount:Number(root.dataset.dormantIdentityCount||0),
            boundedExact:root.dataset.boundedExact==="true",
            firstActivity:root.dataset.firstActivity||null,
            laterActivity:root.dataset.laterActivity||null,
            scheduleChanged:root.dataset.scheduleChanged==="true",
            replayedPathSteps:Number(root.dataset.replayedPathSteps||0),
            injuryCommitted:root.dataset.injuryCommitted==="true",
            injuryPersistent:root.dataset.injuryPersistent==="true",
            injuryActivity:root.dataset.injuryActivity||null,
            persistentRevision:Number(root.dataset.persistentRevision||0),
            reloadSignatureBefore:root.dataset.reloadSignatureBefore||null,
            reloadSignatureAfter:root.dataset.reloadSignatureAfter||null,
            reloadDeterministic:root.dataset.reloadDeterministic==="true",
            stableAfterCamera:root.dataset.stableAfterCamera==="true",
            noSpriteDependency:root.dataset.noSpriteDependency==="true",
            npcDeltaCount:Number(root.dataset.npcDeltaCount||0),
            checkStates:Array.from(root.querySelectorAll(".check b")).map(node=>node.textContent?.trim()||"")
          };
        })(),
        regionalSettlementSimulationPanel: (() => {
          const root=document.querySelector("#regionalSettlementSimulationProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),pass:root.dataset.pass==="true",
            lastStep:Number(root.dataset.lastStep||0),
            trackedRegions:Number(root.dataset.trackedRegions||0),
            trackedSettlements:Number(root.dataset.trackedSettlements||0),
            processedRegionEvents:Number(root.dataset.processedRegionEvents||0),
            processedSettlementEvents:Number(root.dataset.processedSettlementEvents||0),
            agriculturalRevision:Number(root.dataset.agriculturalRevision||0),
            miningRevision:Number(root.dataset.miningRevision||0),
            agriculturalFood:Number(root.dataset.agriculturalFood||0),
            miningFood:Number(root.dataset.miningFood||0),
            agriculturalProduction:Number(root.dataset.agriculturalProduction||0),
            miningProduction:Number(root.dataset.miningProduction||0),
            parentCountryDeltaRevision:Number(root.dataset.parentCountryDeltaRevision||0),
            settlementRevisionBeforeParent:Number(root.dataset.settlementRevisionBeforeParent||0),
            settlementRevisionAfterParent:Number(root.dataset.settlementRevisionAfterParent||0),
            parentCountryRevisionSeenAfter:root.dataset.parentCountryRevisionSeenAfter||null,
            lazyNoFanOut:root.dataset.lazyNoFanOut==="true",
            lazyConsumed:root.dataset.lazyConsumed==="true",
            longAbsenceRevisionBefore:Number(root.dataset.longAbsenceRevisionBefore||0),
            longAbsenceRevisionAfter:Number(root.dataset.longAbsenceRevisionAfter||0),
            longAbsenceAccumulated:root.dataset.longAbsenceAccumulated==="true",
            reconciliationReady:root.dataset.reconciliationReady==="true",
            noNpcDelta:root.dataset.noNpcDelta==="true",
            stableAfterCamera:root.dataset.stableAfterCamera==="true",
            checkStates:Array.from(root.querySelectorAll(".check b")).map(node=>node.textContent?.trim()||"")
          };
        })(),
        globalCountrySimulationPanel: (() => {
          const root=document.querySelector("#globalCountrySimulationProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),pass:root.dataset.pass==="true",
            lastStep:Number(root.dataset.lastStep||0),
            trackedCountries:Number(root.dataset.trackedCountries||0),
            trackedRelations:Number(root.dataset.trackedRelations||0),
            processedCountryEvents:Number(root.dataset.processedCountryEvents||0),
            processedDiplomacyEvents:Number(root.dataset.processedDiplomacyEvents||0),
            countryARevision:Number(root.dataset.countryARevision||0),
            countryBRevision:Number(root.dataset.countryBRevision||0),
            countryASignature:root.dataset.countryASignature||null,
            countryBSignature:root.dataset.countryBSignature||null,
            relationRevision:Number(root.dataset.relationRevision||0),
            relationRestricted:root.dataset.relationRestricted==="true",
            contextBeforeRevision:root.dataset.contextBeforeRevision||null,
            contextAfterRevision:root.dataset.contextAfterRevision||null,
            contextBeforeTrade:Number(root.dataset.contextBeforeTrade||0),
            contextAfterTrade:Number(root.dataset.contextAfterTrade||0),
            settlementDeltaCount:Number(root.dataset.settlementDeltaCount||0),
            dueOnlyPass:root.dataset.dueOnlyPass==="true",
            stableAfterCamera:root.dataset.stableAfterCamera==="true",
            checkStates:Array.from(root.querySelectorAll(".check b")).map(node=>node.textContent?.trim()||"")
          };
        })(),
        eventSchedulerPanel: (() => {
          const root=document.querySelector("#eventSchedulerProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            pass:root.dataset.pass==="true",
            signature:root.dataset.signature||null,
            noiseSignature:root.dataset.noiseSignature||null,
            maxBatch:Number(root.dataset.maxBatch||0),
            extraEntityCount:Number(root.dataset.extraEntityCount||0),
            checkStates:Array.from(root.querySelectorAll(".check b")).map(node=>node.textContent?.trim()||"")
          };
        })(),
        simulationTiersPanel: (() => {
          const root=document.querySelector("#simulationTiersProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            focusId:root.dataset.focusId||null,
            focusTier:root.dataset.focusTier||null,
            focusSignature:root.dataset.focusSignature||null,
            focusReason:root.dataset.focusReason||null,
            candidateCount:Number(root.dataset.candidateCount||0),
            globalCount:Number(root.dataset.globalCount||0),
            regionalCount:Number(root.dataset.regionalCount||0),
            localCount:Number(root.dataset.localCount||0),
            exactCount:Number(root.dataset.exactCount||0),
            exactNpcHandles:Number(root.dataset.exactNpcHandles||0),
            representedPopulation:Number(root.dataset.representedPopulation||0),
            lastCostMs:Number(root.dataset.lastCostMs||0),
            bounded:root.dataset.bounded==="true",
            renderIndependent:root.dataset.renderIndependent==="true",
            historyPreserved:root.dataset.historyPreserved==="true",
            mutatedSignature:root.dataset.mutatedSignature||null,
            demotedSignature:root.dataset.demotedSignature||null,
            reactivatedSignature:root.dataset.reactivatedSignature||null,
            tierRows:root.querySelectorAll("#simulationTierRows li").length,
            historyRows:root.querySelectorAll("#simulationTierHistory li").length,
          };
        })(),
        worldContext: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.WorldContext?.proof
              ? window.WorldContext.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        worldContextPanel: (() => {
          const root=document.querySelector("#worldContextProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            targetId:root.dataset.targetId||null,
            countryId:root.dataset.countryId||null,
            regionId:root.dataset.regionId||null,
            contextRevision:root.dataset.contextRevision||null,
            contextSignature:root.dataset.contextSignature||null,
            countryRevision:root.dataset.countryRevision||null,
            countryDeltaRevision:Number(root.dataset.countryDeltaRevision||0),
            regionRevision:root.dataset.regionRevision||null,
            settlementRevision:root.dataset.settlementRevision||null,
            cacheHit:root.dataset.cacheHit==="true",
            cacheEntries:Number(root.dataset.cacheEntries||0),
            cacheHits:Number(root.dataset.cacheHits||0),
            cacheMisses:Number(root.dataset.cacheMisses||0),
            staleRefreshes:Number(root.dataset.staleRefreshes||0),
            fanOutInvalidations:Number(root.dataset.fanOutInvalidations||0),
            wealth:Number(root.dataset.wealth||0),
            trade:Number(root.dataset.trade||0),
            agriculturePotential:Number(root.dataset.agriculturePotential||0),
            miningPotential:Number(root.dataset.miningPotential||0),
            transportAccess:Number(root.dataset.transportAccess||0),
            lazyNoFanout:root.dataset.lazyNoFanout==="true",
            cacheEntriesBeforeMutation:Number(root.dataset.cacheEntriesBeforeMutation||0),
            cacheEntriesAfterMutation:Number(root.dataset.cacheEntriesAfterMutation||0),
            queriesBeforeMutation:Number(root.dataset.queriesBeforeMutation||0),
            queriesAfterMutation:Number(root.dataset.queriesAfterMutation||0),
            rematerialized:root.dataset.rematerialized==="true",
            layerRows:root.querySelectorAll("#worldContextLayers li").length,
            comparisonRows:root.querySelectorAll("#worldContextComparison li").length,
            behaviorRows:root.querySelectorAll("#worldContextBehavior .region-profile-bar").length,
          };
        })(),
        worldState: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.WorldState?.proof
              ? window.WorldState.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        worldStatePanel: (() => {
          const root=document.querySelector("#worldStateProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            focusId:root.dataset.focusId||null,
            foundationSignature:root.dataset.foundationSignature||null,
            currentSignature:root.dataset.currentSignature||null,
            deltaRevision:Number(root.dataset.deltaRevision||0),
            deltaSequence:Number(root.dataset.deltaSequence||0),
            deltaEntryCount:Number(root.dataset.deltaEntryCount||0),
            serializedBytes:Number(root.dataset.serializedBytes||0),
            liveDelta:root.dataset.liveDelta==="true",
            status:root.dataset.status||null,
            cacheSize:Number(root.dataset.cacheSize||0),
            generator:root.querySelector("#worldStateGenerator")?.textContent?.trim()||null,
            schemas:root.querySelector("#worldStateSchemas")?.textContent?.trim()||null,
            campaign:root.querySelector("#worldStateCampaign")?.textContent?.trim()||null,
            layerRows:root.querySelectorAll("#worldStateLayers li").length,
            representativeRows:root.querySelectorAll("#worldStateRepresentatives li").length,
          };
        })(),
        settlementBuildingCatalog: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.SettlementBuildingCatalog?.proof
              ? window.SettlementBuildingCatalog.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        settlementBuildingCatalogPanel: (() => {
          const root=document.querySelector("#settlementBuildingCatalogProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            compositionIndex:Number(root.dataset.compositionIndex||0),
            compositionId:root.dataset.compositionId||null,
            revision:root.dataset.revision||null,
            reason:root.dataset.reason||null,
            classId:root.dataset.classId||null,
            planId:root.dataset.planId||null,
            signature:root.dataset.signature||null,
            functionCount:Number(root.dataset.functionCount||0),
            buildingCount:Number(root.dataset.buildingCount||0),
            capitalFunctions:root.dataset.capitalFunctions==="true",
            villageMapped:root.dataset.villageMapped==="true",
            name:root.querySelector("#settlementBuildingName")?.textContent?.trim()||null,
            population:root.querySelector("#settlementBuildingPopulation")?.textContent?.trim()||null,
            context:root.querySelector("#settlementBuildingContext")?.textContent?.trim()||null,
            functionRows:root.querySelectorAll("#settlementBuildingFunctions li").length,
            comparisonRows:root.querySelectorAll("#settlementBuildingComparison li").length,
            villageMapRows:root.querySelectorAll("#settlementBuildingVillageMap .diplomacy-agreement").length,
          };
        })(),
        settlementArchetype: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.SettlementArchetypes?.proof
              ? window.SettlementArchetypes.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        settlementArchetypePanel: (() => {
          const root=document.querySelector("#settlementArchetypeProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            planIndex:Number(root.dataset.planIndex||0),
            planId:root.dataset.planId||null,
            revision:root.dataset.revision||null,
            reason:root.dataset.reason||null,
            classId:root.dataset.classId||null,
            countryId:root.dataset.countryId||null,
            regionId:root.dataset.regionId||null,
            context:root.dataset.context||null,
            planning:root.dataset.planning||null,
            market:Number(root.dataset.market||0),
            defense:Number(root.dataset.defense||0),
            port:Number(root.dataset.port||0),
            coastal:root.dataset.coastal==="true",
            name:root.querySelector("#settlementArchetypeName")?.textContent?.trim()||null,
            population:root.querySelector("#settlementArchetypePopulation")?.textContent?.trim()||null,
            contextText:root.querySelector("#settlementArchetypeContext")?.textContent?.trim()||null,
            tagCount:root.querySelectorAll("#settlementArchetypeTags .diplomacy-agreement").length,
            weightCount:root.querySelectorAll("#settlementArchetypeWeights .region-profile-bar").length,
            comparisonRows:root.querySelectorAll("#settlementArchetypeComparison li").length,
          };
        })(),
        countryRelations: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.CountryRelations?.proof
              ? window.CountryRelations.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        countryRelationsPanel: (() => {
          const root=document.querySelector("#countryRelationsProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            relationIndex:Number(root.dataset.relationIndex||0),
            relationId:root.dataset.relationId||null,
            revision:root.dataset.revision||null,
            kind:root.dataset.kind||null,
            state:root.dataset.state||null,
            score:Number(root.dataset.score||0),
            trade:Number(root.dataset.trade||0),
            tension:Number(root.dataset.tension||0),
            openness:Number(root.dataset.openness||0),
            lowCountryId:root.dataset.lowCountryId||null,
            highCountryId:root.dataset.highCountryId||null,
            lowTradeOpenness:Number(root.dataset.lowTradeOpenness||0),
            highTradeOpenness:Number(root.dataset.highTradeOpenness||0),
            lowMilitary:Number(root.dataset.lowMilitary||0),
            highMilitary:Number(root.dataset.highMilitary||0),
            pair:root.querySelector("#countryRelationsPair")?.textContent?.trim()||null,
            border:root.querySelector("#countryRelationsBorder")?.textContent?.trim()||null,
            agreementCount:root.querySelectorAll("#countryRelationsAgreements .diplomacy-agreement").length,
            directionCount:root.querySelectorAll("#countryRelationsDirections article").length,
            comparisonRows:root.querySelectorAll("#countryRelationsComparison li").length,
          };
        })(),
        regionProfile: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.RegionProfile?.proof
              ? window.RegionProfile.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        regionProfilePanel: (() => {
          const root=document.querySelector("#regionProfileProof");
          if(!root)return null;
          return {
            present:true,open:Boolean(root.open),
            regionIndex:Number(root.dataset.regionIndex||0),
            regionId:root.dataset.regionId||null,
            parentCountryId:root.dataset.parentCountryId||null,
            countryRevision:root.dataset.countryRevision||null,
            identity:root.dataset.identity||null,
            specialization:root.dataset.specialization||null,
            dominantTerrain:root.dataset.dominantTerrain||null,
            agriculture:Number(root.dataset.agriculture||0),
            timber:Number(root.dataset.timber||0),
            mineral:Number(root.dataset.mineral||0),
            water:Number(root.dataset.water||0),
            revision:root.dataset.revision||null,
            regionName:root.querySelector("#regionProfileName")?.textContent?.trim()||null,
            parentCountry:root.querySelector("#regionProfileCountry")?.textContent?.trim()||null,
            resources:root.querySelector("#regionProfileResources")?.textContent?.trim()||null,
            specializationLabels:Array.from(root.querySelectorAll("#regionSpecializationBars .region-profile-bar > span")).map(node=>node.textContent.trim()),
            comparisonRows:root.querySelectorAll("#regionProfileComparison li").length,
          };
        })(),
        countryProfile: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.CountryProfile?.proof
              ? window.CountryProfile.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        countryProfilePanel: (() => {
          const root=document.querySelector("#countryProfileProof");
          if(!root)return null;
          return {
            present:true,
            open:Boolean(root.open),
            profileIndex:Number(root.dataset.profileIndex||0),
            profileId:root.dataset.profileId||null,
            countryId:root.dataset.countryId||null,
            wealth:Number(root.dataset.wealth||0),
            wealthBand:root.dataset.wealthBand||null,
            maritime:Number(root.dataset.maritime||0),
            mining:Number(root.dataset.mining||0),
            waterAccess:Number(root.dataset.waterAccess||0),
            mineralPotential:Number(root.dataset.mineralPotential||0),
            mix:root.dataset.mix||null,
            revision:root.dataset.revision||null,
            countryName:root.querySelector("#countryProfileCountry")?.textContent?.trim()||null,
            governance:root.querySelector("#countryProfileGovernance")?.textContent?.trim()||null,
            geography:root.querySelector("#countryProfileGeography")?.textContent?.trim()||null,
            tendencyLabels:Array.from(root.querySelectorAll("#countryProfileTendencies .country-profile-bar > span")).map(node=>node.textContent.trim()),
            comparisonRows:root.querySelectorAll("#countryProfileComparison li").length,
          };
        })(),
        politicalGeography: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.PoliticalGeography?.proof
              ? window.PoliticalGeography.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        politicalGeographyPanel: (() => {
          const root=document.querySelector("#politicalGeographyProof");
          if(!root)return null;
          return {
            present:true,
            open:Boolean(root.open),
            borderIndex:Number(root.dataset.borderIndex||0),
            borderId:root.dataset.borderId||null,
            countryId:root.dataset.countryId||null,
            borderA:root.dataset.borderA||null,
            borderB:root.dataset.borderB||null,
            featureShift:Number(root.dataset.featureShift||0),
            mapCells:Number(root.dataset.mapCells||0),
            countryName:root.querySelector("#politicalCountry")?.textContent?.trim()||null,
            capital:root.querySelector("#politicalCapital")?.textContent?.trim()||null,
            naturalFeature:root.querySelector("#politicalNaturalFeature")?.textContent?.trim()||null,
            lookupBudget:root.querySelector("#politicalLookupBudget")?.textContent?.trim()||null,
          };
        })(),
        socialState: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.SocialState?.proof
              ? window.SocialState.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        socialStatePanel: (() => {
          const root=document.querySelector("#socialStateProof");
          if(!root)return null;
          return {
            present:true,
            open:Boolean(root.open),
            residentId:root.dataset.residentId||null,
            profession:root.dataset.profession||null,
            trust:Number(root.dataset.trust||0),
            suspicion:Number(root.dataset.suspicion||0),
            reputationAverage:Number(root.dataset.reputationAverage||0),
            adviceDecision:root.dataset.adviceDecision||null,
            dialogueTone:root.dataset.dialogueTone||null,
            eventCount:Number(root.dataset.eventCount||0),
            dutyCount:Number(root.dataset.dutyCount||0),
            dutyStatuses:Array.from(root.querySelectorAll("#socialDutyList .social-duty-status")).map(node=>node.textContent.trim().toLowerCase()),
            reputationScopes:Array.from(root.querySelectorAll("#socialReputationList li > span")).map(node=>node.textContent.trim().toLowerCase()),
            eventTypes:Array.from(root.querySelectorAll("#socialEventList li strong")).map(node=>node.textContent.trim().toLowerCase()),
          };
        })(),
        adviceResolution: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.AdviceResolution?.proof
              ? window.AdviceResolution.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        adviceResolutionPanel: (() => {
          const root=document.querySelector("#adviceResolutionProof");
          if(!root)return null;
          return {
            present:true,
            open:Boolean(root.open),
            adviceId:root.dataset.adviceId||null,
            decision:root.dataset.decision||null,
            entryCount:Number(root.dataset.entryCount||0),
            simulation:root.querySelector("#adviceResolutionSimulation")?.textContent?.trim()||null,
            memoryId:root.querySelector("#adviceResolutionMemory")?.textContent?.trim()||null,
            reasoning:root.querySelector("#adviceResolutionReasoning")?.textContent?.trim()||null,
            eventDecisions:Array.from(root.querySelectorAll("#adviceResolutionEvents .advice-decision")).map(node=>node.textContent.trim().toLowerCase()),
          };
        })(),
        dialogueContext: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.DialogueContext?.proof
              ? window.DialogueContext.proof(campaign.seed,"R03")
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        dialoguePanel: (() => {
          const root=document.querySelector("#dialogueProof");
          if(!root)return null;
          return {
            present:true,
            open:Boolean(root.open),
            caseId:root.dataset.caseId||null,
            dialogueId:root.dataset.dialogueId||null,
            tone:root.dataset.tone||null,
            activity:root.dataset.activity||null,
            location:root.dataset.location||null,
            speaker:root.querySelector("#dialogueSpeaker")?.textContent?.trim()||null,
            listener:root.querySelector("#dialogueListener")?.textContent?.trim()||null,
            response:root.querySelector("#dialogueResponse")?.textContent?.trim()||null,
            grounding:root.querySelector("#dialogueGrounding")?.textContent?.trim()||null,
            socialMetrics:Array.from(root.querySelectorAll("#dialogueSocialMetrics span")).map(node=>node.textContent.trim()),
          };
        })(),
        memoryPanel: (() => {
          const root=document.querySelector("#memoryProof");
          const timeline=document.querySelector("#memoryTimeline");
          if(!root||!timeline)return null;
          return {
            present:true,
            open:Boolean(root.open),
            actorKey:root.dataset.actorKey||null,
            entryCount:Number(root.dataset.entryCount||0),
            renderedEntries:timeline.querySelectorAll(".memory-entry").length,
            uncertainRendered:timeline.querySelectorAll(".memory-entry.uncertain").length,
            summaries:Array.from(timeline.querySelectorAll(".memory-entry > strong")).map(node=>node.textContent.trim()),
            sources:Array.from(timeline.querySelectorAll(".memory-source")).map(node=>node.textContent.trim()),
            timelineScrollTop:Number(timeline.scrollTop||0),
            timelineScrollHeight:Number(timeline.scrollHeight||0),
            timelineClientHeight:Number(timeline.clientHeight||0),
          };
        })(),
        advisorPanel: (() => {
          const panel=document.querySelector("#advisorPanel");
          if(!panel)return null;
          return {
            present:true,
            adviceCount:Number(panel.dataset.adviceCount||0),
            advisorSeed:panel.dataset.advisorSeed||null,
            protagonistId:panel.dataset.protagonistId||null,
            rowCount:panel.querySelectorAll(".advisor-log li[data-advice-id]").length,
            statuses:Array.from(panel.querySelectorAll(".advice-status")).map(node=>node.textContent.trim().toLowerCase()),
            targets:Array.from(panel.querySelectorAll(".advice-copy small:first-of-type")).map(node=>node.textContent.trim()),
            formPresent:Boolean(panel.querySelector("#advisorComposeForm")),
            deliverEnabled:!Boolean(panel.querySelector("#advisorDeliverButton")?.disabled),
            boundary:panel.querySelector(".advisor-boundary")?.textContent?.trim()||null,
            advisorRecordId:panel.querySelector(".advisor-record-id")?.textContent?.trim()||null,
          };
        })(),
        residentRoster: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            const now=window.GameTime?.getNow?.();
            return campaign&&window.ResidentRoster?.proof
              ? window.ResidentRoster.proof(campaign.seed,now)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        residentAssignments: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.ResidentAssignments?.proof
              ? window.ResidentAssignments.proof(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        residentSchedules: window.AppUI?.residentScheduleSnapshot?.() || null,
        residentMovement: window.AppUI?.residentMovementProofSnapshot?.() || window.ResidentMovement?.proofSnapshot?.() || null,
        residentMovementLive: window.AppUI?.residentMovementSnapshot?.() || null,
        residentMovementVerify: (() => {
          try {
            const campaign=window.SeedSystem?.getCampaign?.();
            return campaign&&window.ResidentMovement?.verify
              ? window.ResidentMovement.verify(campaign.seed)
              : null;
          } catch (error) {
            return {error:String(error)};
          }
        })(),
        npcVisibility: window.AppUI?.npcVisibilitySnapshot?.() || null,
        npcBuildingCoherence: window.__npcBuildingCoherenceEvidence || null,
        residentAction: window.AppUI?.residentActionProofSnapshot?.() || window.ActionExecutor?.proofSnapshot?.() || null,
        residentActionLive: window.AppUI?.residentActionSnapshot?.() || window.ActionExecutor?.snapshot?.() || null,
        residentActionVerify: window.AppUI?.residentActionVerify?.() || null,
        residentActionRibbon: {
          hidden:Boolean(document.querySelector('#residentActionRibbon')?.hidden),
          actor:document.querySelector('#residentActionRibbonActor')?.textContent?.trim() || null,
          state:document.querySelector('#residentActionRibbonState')?.textContent?.trim() || null,
          progress:document.querySelector('#residentActionRibbonProgress')?.textContent?.trim() || null,
        },
        gameDate: document.querySelector('#gameDate')?.textContent?.trim() || null,
        gameTime: document.querySelector('#gameTime')?.textContent?.trim() || null,
        protagonistLocation: document.querySelector('#protagonistLocation')?.textContent?.trim() || null,
        cameraCoordinate: document.querySelector('#cameraCoordinate')?.textContent?.trim() || null,
        cameraX: document.querySelector('#cameraX')?.textContent?.trim() || null,
        cameraY: document.querySelector('#cameraY')?.textContent?.trim() || null,
        cameraZoom: document.querySelector('#cameraZoom')?.textContent?.trim() || null,
        cameraNavigation: window.AppUI?.cameraNavigationSnapshot?.() || null,
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
          navigationHotPath: renderer.navigationHotPath || null,
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
          materialTextureQuality: renderer.materialTextureQuality || null,
          renderQualityManager: window.RuntimeRenderQuality?.snapshot?.() || null,
          materialLifetimeProof: window.__WP_S003_005_006_PROOF || null,
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


def _queue_campaign_start_during_application_start(driver, timeout: float = 20.0) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    proof = WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            if(window.__WP_S003_008_002_EARLY_CLICK?.clicked){
              return window.__WP_S003_008_002_EARLY_CLICK;
            }
            const button=document.querySelector('#newCampaignButton');
            const gate=window.AppUI?.applicationStartupSnapshot?.();
            if(!button||typeof button.onclick!=='function'||gate?.state!=='pending')return null;
            const result={
              installedAtMs:Date.now(),
              clicked:true,
              clickedAtMs:Date.now(),
              gateBefore:gate
            };
            window.__WP_S003_008_002_EARLY_CLICK=result;
            button.click();
            return result;
            """
        )
    )
    if not isinstance(proof, dict) or not proof.get("clicked") or (proof.get("gateBefore") or {}).get("state")!="pending":
        raise RuntimeError(f"Early campaign-start click was not exercised during pending startup: {proof}")
    return "scene-loading:queued-new-campaign-during-application-start"


def prepare_current_build(driver, timeout: float = 10.0, scenario: str = "static") -> str:
    queued_start_action = None
    if scenario == "wp-s003-008-002":
        timeout = max(timeout, 180.0)
        queued_start_action = _queue_campaign_start_during_application_start(driver, min(timeout, 30.0))
    if scenario == "wp-s003-005":
        # Use a representative desktop/tablet-landscape viewport so the prepared
        # glTF/material proof is readable instead of being lost inside an ultra-wide
        # evidence canvas. Camera/world coordinates remain independently validated.
        driver.set_window_size(1280, 800)
    if scenario in {"wp-s003-006-003", "wp-s003-006-004", "wp-s003-006-005"}:
        driver.set_window_size(1280, 800)
        timeout = max(timeout, 30.0)
    if scenario == "wp-s003-007-001":
        driver.set_window_size(1920, 1080)
        timeout = max(timeout, 30.0)
    if scenario in {"wp-s003-009-001", "wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s003-009-004-001", "wp-s003-009-004-002", "wp-s003-009-005"}:
        driver.set_window_size(1280, 800)
        # Cold software-WebGL CI can spend well over two minutes preparing the
        # visible semantic terrain set. This is evidence wait time only; runtime
        # contour generation remains preparation-time/cached and is measured
        # separately in renderer telemetry.
        timeout = max(timeout, 240.0)
    if scenario == "wp-s003-005-006":
        driver.set_window_size(1920, 1080)
        timeout = max(timeout, 30.0)
    if scenario == "wp-s003-005-002":
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script(
                "return Boolean(window.WP_S003_005_002_EVIDENCE?.ready)"
            )
        )
        return "asset-standard-proof-ready"
    if queued_start_action:
        result = {"action": "started-current-campaign"}
        action = queued_start_action
    else:
        result = driver.execute_script(CURRENT_BUILD_PREP_SCRIPT)
        action = result.get("action", "unknown") if isinstance(result, dict) else "unknown"

    if action in {"started-current-campaign", "campaign-already-active"} or queued_start_action:
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
            if scenario in {"wp-s003-005-003", "wp-s003-005-004"}:
                _set_terrain_preload_settings(
                    driver, radius=1, cache=128, directional=True, background=False
                )
            if scenario == "wp-s003-009-001":
                _set_terrain_preload_settings(
                    driver, radius=2, cache=128, directional=True, background=True
                )
            if scenario in {"wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s003-009-004-001"}:
                _set_terrain_preload_settings(
                    driver, radius=2, cache=256, directional=True, background=False
                )
            if scenario in {"wp-s003-009-004-002", "wp-s003-009-005"}:
                # Keep contour/art-treatment evidence focused on the visible/prepared ring.
                # Extra idle/background cache work is not part of this WP proof.
                _set_terrain_preload_settings(
                    driver, radius=1, cache=128, directional=False, background=False
                )
            if scenario in {"wp-s003-006-003", "wp-s003-006-004", "wp-s003-006-005"}:
                _set_terrain_preload_settings(
                    driver, radius=1, cache=256, directional=True, background=True
                )
            if scenario in {"wp-s003-006-006", "wp-s003-006-007", "wp-s003-006-008", "wp-s003-006-009"}:
                _set_terrain_preload_settings(
                    driver, radius=2, cache=256, directional=True, background=False
                )
            if scenario in {"wp-s003-006-007", "wp-s003-006-009", "wp-s003-009-002"}:
                _set_terrain_chunk_size(driver, 16)

            if scenario in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-005-003", "wp-s003-005-004", "wp-s003-005-006", "wp-s003-006-002", "wp-s003-006-001", "wp-s003-006", "wp-s003-006-003", "wp-s003-006-004", "wp-s003-006-005", "wp-s003-006-006", "wp-s003-006-007", "wp-s003-006-008", "wp-s003-006-009", "wp-s003-007-001", "wp-s003-009-001", "wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s003-009-004-001", "wp-s003-009-004-002", "wp-s003-009-005", "wp-s003-008-002", "wp-s004-003", "wp-s004-004-001", "playcanvas-root-cutover"}:
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
                          (arguments[0] !== 'wp-s003-008-002' || (() => {
                            const loading=window.AppUI?.sceneLoadingSnapshot?.();
                            const current=loading?.current || {};
                            return Boolean(
                              current.origin === 'new-campaign' &&
                              current.state === 'hidden' &&
                              Number(current.startedAtMs || 0) > 0 &&
                              Number(current.readyAtMs || 0) >= Number(current.startedAtMs || 0) &&
                              Number(current.hiddenAtMs || 0) >= Number(current.readyAtMs || 0) &&
                              current.renderSucceeded === true &&
                              current.readiness?.playableReady === true &&
                              loading?.overlay?.hidden === true
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-005-003' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const atlas=chunks?.textureAtlas || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              atlas.ready === true &&
                              atlas.sharedAtlas === true &&
                              Number(atlas.gpuTextureCount || 0) === 1 &&
                              Number(chunks.texturedBlockCount || 0) > 0 &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-005-004' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const atlas=chunks?.buildingSurfaceAtlas || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              Number(chunks.buildingPresentationCount || 0) > 0 &&
                              atlas.ready === true &&
                              atlas.sharedAtlas === true &&
                              Number(atlas.gpuTextureCount || 0) === 1 &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-005-006' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const building=chunks?.generator?.buildingSurfaceAtlas || chunks?.buildingSurfaceAtlas || {};
                            const tree=chunks?.generator?.treeSpriteAtlas || chunks?.treeSpriteAtlas || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              building.ready === true &&
                              Number(building.gpuTextureCount || 0) === 1 &&
                              tree.ready === true &&
                              Number(tree.gpuTextureCount || 0) === 1 &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-006-007' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              chunks.heightfieldPass === true &&
                              chunks.indexedSharedVertices === true &&
                              Number(chunks.heightfieldGridResolution || 0) === 9 &&
                              Number(chunks.heightfieldStepTiles || 0) === 2 &&
                              chunks.sharedBorderEquality === true &&
                              chunks.terrainDetailTextureReady === true &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-006-009' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              chunks.heightfieldPass === true &&
                              chunks.indexedSharedVertices === true &&
                              Number(chunks.heightfieldGridResolution || 0) === 9 &&
                              Number(chunks.heightfieldStepTiles || 0) === 2 &&
                              chunks.sharedBorderEquality === true &&
                              chunks.roadProfileEnabled === true &&
                              chunks.roadProfileGroundingShared === true &&
                              Number(chunks.roadLiftWorldUnits || 0) > 0 &&
                              Number(chunks.pathLiftWorldUnits || 0) > 0 &&
                              Number(chunks.roadProfileVertexCount || 0) > 0 &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-009-003' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const chars=renderer?.characterPresentation || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              chunks.contactShadowStaticPass === true &&
                              chunks.contactShadowRendererOnly === true &&
                              Number(chunks.contactShadowBuildingCount || 0) > 0 &&
                              Number(chunks.contactShadowTreeCount || 0) > 0 &&
                              Number(chunks.contactShadowInstancedGroupCount || 0) > 0 &&
                              Number(chunks.contactShadowMaterialCount || 0) > 0 &&
                              Number(chars.contactShadowCount || 0) > 0 &&
                              chars.contactShadowHardwareInstanced === true &&
                              chars.contactShadowFeetCoordinateAnchored === true &&
                              Number(chars.contactShadowTerrainAlignedCount || 0) === Number(chars.contactShadowCount || 0) &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-009-002' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const bindings=chunks?.routeSurfaceBindings || {};
                            const world=chunks?.worldData || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              chunks.heightfieldPass === true &&
                              chunks.sharedBorderEquality === true &&
                              chunks.roadProfileEnabled === true &&
                              chunks.roadHierarchyPresentationPass === true &&
                              chunks.routeSurfaceRendererOnly === true &&
                              chunks.routeNetworkDeterministic === true &&
                              chunks.routeNetworkRouteSafetyPass === true &&
                              Number(chunks.routeSurfaceStaleBindingCount || 0) === 0 &&
                              Number(chunks.routeSurfaceCellCount || 0) > 0 &&
                              Number(chunks.routeMainRoadCellCount || 0) > 0 &&
                              Number(chunks.routeSquareCellCount || 0) > 0 &&
                              Number(chunks.routeSurfaceMaterialCount || 0) >= 2 &&
                              bindings?.road?.textureBound === true &&
                              bindings?.path?.textureBound === true &&
                              bindings?.square?.textureBound === true &&
                              world?.connectorRendererOnly === true &&
                              world?.connectorDeterministic === true &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-006-006' || (() => {
                            const chunks=renderer?.terrainChunks || {};
                            const atlas=chunks?.treeSpriteAtlas || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              chunks.treePlanePresentation === true &&
                              Number(chunks.treeCylinderSpherePlaceholderCount || 0) === 0 &&
                              atlas.ready === true &&
                              atlas.sharedTexture === true &&
                              Number(atlas.gpuTextureCount || 0) === 1 &&
                              Number(renderer?.terrainPreload?.queueDepth || 0) === 0
                            );
                          })()) &&
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
                          })()) &&
                          (arguments[0] !== 'wp-s003-006-004' || (() => {
                            const preload=renderer?.terrainPreload || {};
                            const chunks=renderer?.terrainChunks || {};
                            const nav=renderer?.navigationHotPath || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              Number(preload.Prepared || 0) > 0 &&
                              Number(preload.queueDepth || 0) === 0 &&
                              nav.persistentSceneGraph === true &&
                              Number(nav.fullSceneRebuilds || 0) === 0 &&
                              Number(nav.redundantStateCallbacks || 0) === 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s003-006-005' || (() => {
                            const preload=renderer?.terrainPreload || {};
                            const chunks=renderer?.terrainChunks || {};
                            return Boolean(
                              chunks.resourceKind === 'chunk-mesh' &&
                              Number(chunks.visibleChunkCount || 0) > 0 &&
                              Number(preload.Prepared || 0) > 0 &&
                              Number(preload.queueDepth || 0) === 0 &&
                              chunks.chunkLocalStaticBatching === true &&
                              chunks.hardwareInstancing === true &&
                              chunks.frustumCulling === true &&
                              Number(chunks.staticBatchCount || 0) > 0 &&
                              Number(chunks.instancedObjectCount || 0) > 0
                            );
                          })()) &&
                          (arguments[0] !== 'wp-s004-003' || (() => {
                            const campaignState=document.querySelector('#campaignState')?.textContent?.trim();
                            const status=document.querySelector('#statusMessage')?.textContent?.trim() || '';
                            return Boolean(
                              campaignState === 'ACTIVE' &&
                              status.startsWith('Campaign running.') &&
                              renderer?.protagonistVisible === true &&
                              renderer?.regionKey &&
                              renderer?.simulationSnapshot?.campaignActive === true
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
            if scenario in {"wp-s003-009-001", "wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s003-009-004-001", "wp-s003-009-004-002"}:
                recovery = driver.execute_script(
                    """
                    const campaignState=document.querySelector('#campaignState')?.textContent?.trim() || '';
                    const loading=window.AppUI?.sceneLoadingSnapshot?.() || {};
                    return {
                      campaignState,
                      overlayState: loading?.overlay?.state || null,
                      overlayHidden: Boolean(loading?.overlay?.hidden),
                      loadingState: loading?.current?.state || null,
                      playableReady: loading?.current?.readiness?.playableReady === true,
                      hasCampaign: Boolean(window.SeedSystem?.getCampaign?.()),
                      simulationCampaignActive: Boolean(window.GameRenderer?.snapshot?.()?.simulationSnapshot?.campaignActive)
                    };
                    """
                )
                if (
                    not isinstance(recovery, dict)
                    or recovery.get("campaignState") != "ACTIVE"
                    or recovery.get("overlayState") == "error"
                    or recovery.get("overlayHidden") is not True
                    or recovery.get("loadingState") != "hidden"
                    or recovery.get("playableReady") is not True
                ):
                    # A cold CI run can finish the expensive renderer/chunk preparation
                    # just after the new-campaign readiness gate reports its bounded
                    # error. The in-game Retry Startup control performs a reload; use
                    # that real recovery path so the persisted authoritative campaign
                    # is restored instead of hiding/overriding the loading UI.
                    driver.execute_script("document.querySelector('#sceneLoadingRetry')?.click()")
                    WebDriverWait(driver, timeout).until(
                        lambda d: d.execute_script("return document.readyState") == "complete"
                    )
                    WebDriverWait(driver, timeout).until(
                        lambda d: d.execute_script(
                            """
                            const state=document.querySelector('#campaignState')?.textContent?.trim();
                            const loading=window.AppUI?.sceneLoadingSnapshot?.() || {};
                            const renderer=window.GameRenderer?.snapshot?.() || {};
                            return Boolean(
                              state==='ACTIVE' &&
                              loading?.overlay?.hidden===true &&
                              loading?.current?.state==='hidden' &&
                              loading?.current?.readiness?.playableReady===true &&
                              renderer?.ready===true &&
                              renderer?.simulationSnapshot?.campaignActive===true &&
                              renderer?.regionKey &&
                              renderer?.protagonistVisible===true &&
                              Number(renderer?.terrainChunks?.visibleChunkCount||0)>0
                            );
                            """
                        )
                    )
                    action += "+cold-start-retry-recovered"

        except Exception as exc:
            diagnostic = {}
            try:
                diagnostic = driver.execute_script(
                    """
                    return {
                      campaignState: document.querySelector('#campaignState')?.textContent?.trim() || null,
                      statusMessage: document.querySelector('#statusMessage')?.textContent?.trim() || null,
                      sceneLoading: window.AppUI?.sceneLoadingSnapshot?.() || null,
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


def _set_scene_loading_proof(driver, phase: str | None, *, reduced_motion: bool = False) -> str:
    if phase is None:
        result = driver.execute_script(
            """
            const api=window.AppUI;
            if(!api?.clearSceneLoadingProof||!api?.sceneLoadingSnapshot)return null;
            api.clearSceneLoadingProof();
            return api.sceneLoadingSnapshot();
            """
        )
        if not isinstance(result, dict):
            raise RuntimeError(f"Scene-loading proof clear failed: {result}")
        overlay=result.get("overlay") or {}
        if not overlay.get("hidden"):
            raise RuntimeError(f"Scene-loading proof did not return to actual hidden ready state: {result}")
        return "scene-loading:ready-hidden"

    if reduced_motion:
        try:
            driver.execute_cdp_cmd(
                "Emulation.setEmulatedMedia",
                {
                    "media": "",
                    "features": [
                        {"name": "prefers-reduced-motion", "value": "reduce"}
                    ],
                },
            )
        except Exception as exc:
            raise RuntimeError(f"Could not emulate reduced motion for scene-loading evidence: {exc}") from exc
    else:
        try:
            driver.execute_cdp_cmd(
                "Emulation.setEmulatedMedia",
                {
                    "media": "",
                    "features": [
                        {"name": "prefers-reduced-motion", "value": "no-preference"}
                    ],
                },
            )
        except Exception:
            pass

    result = driver.execute_script(
        """
        const phase=String(arguments[0]);
        const reduced=Boolean(arguments[1]);
        const api=window.AppUI;
        if(!api?.setSceneLoadingProof||!api?.sceneLoadingSnapshot)return null;
        api.setSceneLoadingProof(phase,{reducedMotion:reduced});
        return api.sceneLoadingSnapshot();
        """,
        phase,
        reduced_motion,
    )
    if not isinstance(result, dict):
        raise RuntimeError(f"Scene-loading proof phase {phase!r} failed: {result}")
    overlay=result.get("overlay") or {}
    expected_state="error" if phase=="error" else "loading"
    if overlay.get("hidden") or overlay.get("phase")!=phase or overlay.get("state")!=expected_state:
        raise RuntimeError(f"Scene-loading proof phase mismatch for {phase!r}: {result}")
    return (
        f"scene-loading:{phase}:"
        f"state={overlay.get('state')}:"
        f"reduced={str(bool(result.get('reducedMotionPreferred'))).lower()}"
    )


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


def _keyboard_camera(driver, *keys: str) -> str:
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys

    aliases = {
        "arrowleft": Keys.ARROW_LEFT,
        "arrowright": Keys.ARROW_RIGHT,
        "arrowup": Keys.ARROW_UP,
        "arrowdown": Keys.ARROW_DOWN,
        "a": "a",
        "d": "d",
        "w": "w",
        "s": "s",
    }
    action = ActionChains(driver)
    normalized = [str(key).lower() for key in keys]
    for key in normalized:
        action.key_down(aliases[key])
    action.pause(0.04)
    for key in reversed(normalized):
        action.key_up(aliases[key])
    action.perform()
    return "keyboard:" + "+".join(normalized)


def _touch_drag_canvas(driver, dx: int, dy: int) -> str:
    rect = driver.execute_script(
        """
        const node=document.querySelector('#gameCanvas')||document.querySelector('#gameplayArea');
        if(!node)return null;
        const r=node.getBoundingClientRect();
        return {left:r.left,top:r.top,width:r.width,height:r.height};
        """
    )
    if not isinstance(rect, dict) or float(rect.get("width") or 0) <= 0 or float(rect.get("height") or 0) <= 0:
        return "touch-drag-skipped:no-camera-surface"
    start_x = float(rect["left"]) + float(rect["width"]) * 0.5
    start_y = float(rect["top"]) + float(rect["height"]) * 0.5
    end_x = start_x + int(dx)
    end_y = start_y + int(dy)
    driver.execute_cdp_cmd(
        "Input.dispatchTouchEvent",
        {"type": "touchStart", "touchPoints": [{"x": start_x, "y": start_y, "id": 1}]},
    )
    driver.execute_cdp_cmd(
        "Input.dispatchTouchEvent",
        {"type": "touchMove", "touchPoints": [{"x": end_x, "y": end_y, "id": 1}]},
    )
    driver.execute_cdp_cmd("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    return f"touch-drag:{dx},{dy}"


def _show_resident_roster_proof(driver, position: str = "top") -> str:
    result = driver.execute_script(
        """
        const position=arguments[0];
        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#residentRosterProof');
        const scroll=document.querySelector('#residentRosterScroll');
        if(!section||!proof||!scroll)return null;
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;
        window.AppUI?.refreshResidentRoster?.();
        proof.scrollIntoView({block:'start'});
        scroll.scrollTop=position==='bottom'?scroll.scrollHeight:0;
        return {
          rows:document.querySelectorAll('#residentRosterRows tr').length,
          open:proof.open,
          position,
          scrollTop:Number(scroll.scrollTop||0),
          scrollHeight:Number(scroll.scrollHeight||0),
          clientHeight:Number(scroll.clientHeight||0)
        };
        """,
        position,
    )
    if not isinstance(result, dict) or int(result.get("rows") or 0) != 12:
        raise RuntimeError(f"Resident roster proof view did not expose 12 rows: {result}")
    return f"resident-roster:{position}:rows={result['rows']}"


def _show_resident_assignment_proof(driver, position: str = "top") -> str:
    result = driver.execute_script(
        """
        const position=arguments[0];
        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#residentAssignmentProof');
        const scroll=document.querySelector('#residentAssignmentScroll');
        if(!section||!proof||!scroll)return null;
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;
        window.AppUI?.refreshResidentAssignments?.();
        proof.scrollIntoView({block:'start'});
        if(position==='bottom')scroll.scrollTop=scroll.scrollHeight;
        else if(position==='middle')scroll.scrollTop=Math.max(0,(scroll.scrollHeight-scroll.clientHeight)/2);
        else scroll.scrollTop=0;
        return {
          rows:document.querySelectorAll('#residentAssignmentRows tr').length,
          open:proof.open,
          position,
          scrollTop:Number(scroll.scrollTop||0),
          scrollHeight:Number(scroll.scrollHeight||0),
          clientHeight:Number(scroll.clientHeight||0)
        };
        """,
        position,
    )
    if not isinstance(result, dict) or int(result.get("rows") or 0) != 12:
        raise RuntimeError(f"Resident assignment proof view did not expose 12 rows: {result}")
    return f"resident-assignments:{position}:rows={result['rows']}"


def _show_resident_schedule_proof(driver, sample_hour: int, sample_minute: int = 30) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    result = driver.execute_script(
        """
        const hour=arguments[0],minute=arguments[1];
        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#residentScheduleProof');
        const scroll=document.querySelector('#residentScheduleScroll');
        const now=window.GameTime?.getNow?.();
        if(!section||!proof||!scroll||!now)return null;
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;
        const sample={
          year:now.year,month:now.month,day:now.day,
          hour:Number(hour),minute:Number(minute),second:0
        };
        const snapshot=window.AppUI?.refreshResidentSchedules?.(sample,true);
        proof.scrollIntoView({block:'start'});
        scroll.scrollTop=0;
        return {
          rows:document.querySelectorAll('#residentScheduleRows tr').length,
          open:proof.open,
          hour:Number(hour),
          minute:Number(minute),
          pass:Boolean(snapshot?.pass)
        };
        """,
        sample_hour,
        sample_minute,
    )
    if not isinstance(result, dict) or int(result.get("rows") or 0) != 12 or not result.get("pass"):
        raise RuntimeError(f"Resident schedule proof view failed: {result}")
    stable = WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            """
            const expectedHour=Number(arguments[0]), expectedMinute=Number(arguments[1]);
            const snapshot=window.AppUI?.residentScheduleSnapshot?.();
            const section=document.querySelector('#developmentDetails');
            const proof=document.querySelector('#residentScheduleProof');
            const rows=document.querySelectorAll('#residentScheduleRows tr');
            const time=snapshot?.sampleTime;
            if(
              !snapshot?.pass || !time ||
              Number(time.hour)!==expectedHour || Number(time.minute)!==expectedMinute ||
              !section || section.hidden || !proof?.open || rows.length!==12
            ) return null;
            proof.scrollIntoView({block:'start'});
            document.querySelector('#residentScheduleScroll').scrollTop=0;
            return {
              hour:Number(time.hour),
              minute:Number(time.minute),
              rows:rows.length,
              campaignState:document.querySelector('#campaignState')?.textContent?.trim() || null
            };
            """,
            sample_hour,
            sample_minute,
        )
    )
    return (
        f"resident-schedules:{sample_hour:02d}:{sample_minute:02d}:"
        f"rows={stable['rows']}:campaign={stable['campaignState']}"
    )


def _show_resident_movement_proof(driver, frame_index: int) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    result = driver.execute_async_script(
        """
        const index=Number(arguments[0]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const campaign=window.SeedSystem?.getCampaign?.();
            if(!campaign||!window.ResidentMovement||!window.AppUI)throw new Error('movement proof APIs unavailable');
            let proof;
            if(index===0)proof=ResidentMovement.beginProof(campaign.seed);
            else if(index===1)proof=ResidentMovement.proofAdvanceToDoor();
            else if(index===2)proof=ResidentMovement.proofAdvanceToTarget();
            else if(index===3){
              ResidentMovement.proofBeginOutbound();
              proof=ResidentMovement.proofAdvanceToDoor();
            }else proof=ResidentMovement.proofAdvanceToTarget();
            if(!proof?.position)throw new Error('movement proof position unavailable');

            const before=ResidentMovement.position(proof.residentId);
            if(index===3){
              const far=WorldCoordinates.add(before,'80','80');
              Camera.setCenter(far.x,far.y);
              const afterCameraOnly=ResidentMovement.position(proof.residentId);
              await AppUI.refreshTerrain();
              const hiddenBefore=!GameRenderer.snapshot()?.characterPresentation?.visibleCharacterIds?.includes('resident:'+proof.residentId);
              const progressBefore=ResidentMovement.get(proof.residentId);
              ResidentMovement.proofAdvanceSeconds(2.2);
              await AppUI.refreshResidentCharacters();
              const progressAfter=ResidentMovement.get(proof.residentId);
              const hiddenAfter=!GameRenderer.snapshot()?.characterPresentation?.visibleCharacterIds?.includes('resident:'+proof.residentId);
              const progressed=
                progressBefore.position.x!==progressAfter.position.x||
                progressBefore.position.y!==progressAfter.position.y||
                Math.abs(Number(progressBefore.segmentElapsed)-Number(progressAfter.segmentElapsed))>1e-6;
              ResidentMovement.recordEvidence({
                cameraIndependencePass:before.x===afterCameraOnly.x&&before.y===afterCameraOnly.y,
                offscreenSimulationPass:progressed,
                rendererCullingPass:hiddenBefore&&hiddenAfter
              });
            }
            const current=ResidentMovement.position(proof.residentId);
            Camera.setCenter(current.x,current.y);
            Camera.setZoom(Math.min(1.5,Number(Camera.MAX_ZOOM||2)));
            await AppUI.refreshTerrain();
            await AppUI.refreshResidentCharacters();
            AppUI.refreshResidentMovementProof();
            window.scrollTo(0,0);
            const finalProof=ResidentMovement.proofSnapshot();
            done({
              ok:true,index,stage:finalProof?.stage,residentId:finalProof?.residentId,
              position:finalProof?.position,pass:Boolean(finalProof?.pass),
              visibleIds:GameRenderer.snapshot()?.characterPresentation?.visibleCharacterIds||[],
              simulated:Number(GameRenderer.snapshot()?.characterPresentation?.simulatedCharacterCount||0)
            });
          }catch(error){done({ok:false,error:String(error)});}
        })();
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Resident movement proof frame failed: {result}")
    WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            "return document.querySelector('#movementProofBadge')?.hidden===false && document.querySelectorAll('#residentMovementRows tr').length===12"
        )
    )
    return (
        f"resident-movement:{frame_index}:{result.get('stage')}:"
        f"{result.get('residentId')}@{result.get('position')}:simulated={result.get('simulated')}"
    )


def _show_npc_building_coherence_proof(driver, frame_index: int) -> str:
    result = driver.execute_async_script(
        """
        const index=Number(arguments[0]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const campaign=window.SeedSystem?.getCampaign?.();
            const movement=window.ResidentMovement;
            const ui=window.AppUI;
            const renderer=window.GameRenderer;
            if(!campaign||!movement?.beginProof||!movement?.proofPlaceAt||!ui?.refreshTerrain||!renderer?.snapshot){
              done({ok:false,error:'npc-building-coherence-proof-api-missing'});
              return;
            }
            const seed=campaign.seed;
            const idFor=proof=>'resident:'+String(proof?.residentId||'');
            const manhattan=(a,b)=>{
              if(!a||!b)return null;
              const dx=BigInt(String(a.x))-BigInt(String(b.x));
              const dy=BigInt(String(a.y))-BigInt(String(b.y));
              return Number((dx<0n?-dx:dx)+(dy<0n?-dy:dy));
            };
            const refreshAt=async(point)=>{
              if(point)window.Camera?.setCenter?.(point.x,point.y);
              window.Camera?.setZoom?.(1);
              await ui.refreshTerrain();
              await ui.refreshResidentCharacters();
              ui.refreshResidentMovementProof?.();
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              window.scrollTo(0,0);
            };
            const visibilityFor=id=>{
              const v=ui.npcVisibilitySnapshot?.()||{};
              const p=renderer.snapshot?.()?.characterPresentation||{};
              return {
                visible:Boolean((p.visibleCharacterIds||[]).includes(id)),
                hiddenIndoor:Boolean((v.hiddenIndoorIds||[]).includes(id)),
                hiddenOccluded:Boolean((v.hiddenOccludedIds||[]).includes(id)),
                visibility:v,
                presentation:p
              };
            };
            const outsideCandidates=(interior,front)=>{
              const b=interior.bounds;
              const result=[];
              if(front){
                for(let x=b.minX;x<=b.maxX;x++)result.push({x:String(x),y:String(b.maxY+1)});
                for(let y=b.minY;y<=b.maxY;y++)result.push({x:String(b.maxX+1),y:String(y)});
                result.push({x:String(b.maxX+1),y:String(b.maxY+1)});
              }else{
                for(let x=b.minX;x<=b.maxX;x++)result.push({x:String(x),y:String(b.minY-1)});
                for(let y=b.minY;y<=b.maxY;y++)result.push({x:String(b.minX-1),y:String(y)});
                result.push({x:String(b.minX-1),y:String(b.minY-1)});
              }
              return result;
            };
            const placeForVisibility=async(proof,interior,wantVisible)=>{
              const id=idFor(proof);
              for(const candidate of outsideCandidates(interior,wantVisible)){
                const nav=window.InteriorObjects?.classifyNavigation?.(seed,candidate.x,candidate.y)
                  ||window.Walkability?.classify?.(seed,candidate.x,candidate.y);
                if(!nav?.walkable||nav.buildingId)continue;
                const placed=movement.proofPlaceAt(candidate,wantVisible?'front-proof':'behind-proof');
                if(!placed)continue;
                await refreshAt(candidate);
                const state=visibilityFor(id);
                if(wantVisible?state.visible:state.hiddenOccluded)return {candidate,state,proof:placed};
              }
              return null;
            };

            let proof=movement.proofSnapshot?.()||null;
            if(index===0){
              proof=movement.beginProof(seed);
              if(!proof)throw new Error('npc coherence beginProof failed');
              for(let step=0;step<400;step++){
                const state=movement.get(proof.residentId);
                if(state?.nextDoorwayKind==='exterior-door')break;
                movement.proofAdvanceSeconds(0.1);
              }
              proof=movement.proofSnapshot();
              const state=movement.get(proof.residentId);
              await refreshAt(state.position);
              const interior=window.BuildingInteriors?.get?.(seed,proof.homeId);
              const visibility=visibilityFor(idFor(proof));
              window.__npcBuildingCoherenceEvidence={
                stage:'approach',
                residentId:proof.residentId,
                position:state.position,
                door:interior?.entrance?.door||null,
                doorSide:interior?.entrance?.side||null,
                distanceToDoor:manhattan(state.position,interior?.entrance?.door),
                currentBuildingId:state.buildingId||null,
                nextDoorwayKind:state.nextDoorwayKind||null,
                ...visibility
              };
            }else if(index===1){
              if(!proof)throw new Error('npc coherence proof missing before door');
              proof=movement.proofAdvanceToDoor();
              const state=movement.get(proof.residentId);
              await refreshAt(state.position);
              window.__npcBuildingCoherenceEvidence={
                stage:'door',
                residentId:proof.residentId,
                position:state.position,
                currentBuildingId:state.buildingId||null,
                doorwayKind:state.doorwayKind||null,
                ...visibilityFor(idFor(proof))
              };
            }else if(index===2){
              if(!proof)throw new Error('npc coherence proof missing before inside');
              proof=movement.proofAdvanceToTarget();
              const state=movement.get(proof.residentId);
              await refreshAt(state.position);
              const snap=renderer.snapshot?.()||{};
              window.__npcBuildingCoherenceEvidence={
                stage:'inside',
                residentId:proof.residentId,
                position:state.position,
                currentBuildingId:state.buildingId||null,
                cutawayActive:Boolean(snap.buildingPresentation?.cutawayActive),
                hiddenRoofCount:Number(snap.buildingPresentation?.hiddenRoofCount||0),
                ...visibilityFor(idFor(proof))
              };
            }else if(index===3||index===4){
              if(!proof)throw new Error('npc coherence proof missing before occlusion probe');
              const interior=window.BuildingInteriors?.get?.(seed,proof.homeId);
              if(!interior)throw new Error('npc coherence home interior missing');
              const wantVisible=index===4;
              const placed=await placeForVisibility(proof,interior,wantVisible);
              if(!placed)throw new Error(wantVisible?'front visibility candidate unavailable':'behind occlusion candidate unavailable');
              const state=movement.get(proof.residentId);
              window.__npcBuildingCoherenceEvidence={
                stage:wantVisible?'front':'behind',
                residentId:proof.residentId,
                position:state.position,
                currentBuildingId:state.buildingId||null,
                ...placed.state
              };
              window.__npcBuildingCoherenceFront=wantVisible?placed.candidate:(window.__npcBuildingCoherenceFront||null);
            }else{
              const base=window.__npcBuildingCoherenceFront;
              if(!base)throw new Error('npc overlap proof missing front anchor');
              window.Camera?.setCenter?.(base.x,base.y);
              window.Camera?.setZoom?.(1);
              await ui.refreshTerrain();
              const pair=[
                {id:'resident:overlap-a',role:'resident',textureUrl:'assets/characters/npc_farmer_male_01.png',point:{x:base.x,y:base.y},height:1.74,elevation:0.03,flipX:false,frameIndex:0},
                {id:'resident:overlap-b',role:'resident',textureUrl:'assets/characters/npc_guard_male_01.png',point:{x:base.x,y:base.y},height:1.74,elevation:0.03,flipX:true,frameIndex:0}
              ];
              await renderer.updateCharacters(pair,13);
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              const snap=renderer.snapshot?.()||{};
              const instances=(snap.characterPresentation?.instances||[]).filter(item=>String(item.id).startsWith('resident:overlap-'));
              window.__npcBuildingCoherenceEvidence={
                stage:'overlap',
                pairCount:instances.length,
                sameAuthoritativeWorld:instances.length===2&&
                  JSON.stringify(instances[0].world)===JSON.stringify(instances[1].world),
                separated:instances.length===2&&(
                  Math.abs(Number(instances[0].scene?.x||0)-Number(instances[1].scene?.x||0))>0.05||
                  Math.abs(Number(instances[0].scene?.z||0)-Number(instances[1].scene?.z||0))>0.05
                ),
                instances
              };
              window.scrollTo(0,0);
            }
            done({ok:true,evidence:window.__npcBuildingCoherenceEvidence});
          }catch(error){
            done({ok:false,error:String(error),stack:error?.stack||null});
          }
        })();
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"NPC building coherence proof frame failed: {result}")
    evidence=result.get("evidence") or {}
    return f"npc-building-coherence:{frame_index}:{evidence.get('stage','unknown')}"


def _show_resident_action_proof(driver, frame_index: int) -> str:
    from selenium.webdriver.support.ui import WebDriverWait

    result = driver.execute_async_script(
        """
        const index=Number(arguments[0]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const campaign=window.SeedSystem?.getCampaign?.();
            if(!campaign||!window.ActionExecutor||!window.ResidentMovement||!window.AppUI){
              throw new Error('action proof APIs unavailable');
            }
            const sample=(hour,minute=30)=>{
              const now=GameTime.getNow();
              return {year:now.year,month:now.month,day:now.day,hour,minute,second:0};
            };
            const residentFor=id=>DailyActivity.build(campaign.seed).find(item=>item.id===id);
            let movement=ResidentMovement.proofSnapshot?.();
            let proof=ActionExecutor.proofSnapshot?.();

            if(index===0){
              movement=ResidentMovement.beginProof(campaign.seed);
              proof=ActionExecutor.beginProof(campaign.seed,movement.residentId);
              const resident=residentFor(movement.residentId);
              const sleep=DailyActivity.resolveActionTarget(campaign.seed,resident,sample(2,30));
              const rejected=ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:movement.position,activity:sleep
              },0);
              ActionExecutor.recordProof({
                stage:'arrival-required',
                arrivalRejected:rejected.status==='waiting-arrival'&&!rejected.holdsPosition
              });
            }else if(index===1){
              movement=ResidentMovement.proofAdvanceToTarget();
              const resident=residentFor(movement.residentId);
              const sleep=DailyActivity.resolveActionTarget(campaign.seed,resident,sample(2,30));
              const before=ResidentMovement.position(resident.id);
              const started=ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:before,activity:sleep
              },0.25);
              const after=ResidentMovement.position(resident.id);
              ActionExecutor.recordProof({
                stage:'sleep-active',
                actionStarted:started.status==='active'&&started.holdsPosition,
                heldAtTarget:before.x===after.x&&before.y===after.y
              });
            }else if(index===2){
              movement=ResidentMovement.proofSnapshot();
              const resident=residentFor(movement.residentId);
              const sleep=DailyActivity.resolveActionTarget(campaign.seed,resident,sample(2,30));
              const beforePos=ResidentMovement.position(resident.id);
              const completed=ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:beforePos,activity:sleep
              },20);
              const far=WorldCoordinates.add(beforePos,'80','80');
              Camera.setCenter(far.x,far.y);
              await AppUI.refreshTerrain();
              const hidden=!GameRenderer.snapshot()?.characterPresentation?.visibleCharacterIds?.includes('resident:'+resident.id);
              const offBefore=ActionExecutor.get('resident',resident.id);
              ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:beforePos,activity:sleep
              },1);
              const offAfter=ActionExecutor.get('resident',resident.id);
              const afterPos=ResidentMovement.position(resident.id);
              Camera.setCenter(beforePos.x,beforePos.y);
              await AppUI.refreshTerrain();
              ActionExecutor.recordProof({
                stage:'sleep-complete-offscreen',
                actionCompleted:completed.status==='complete',
                offscreenStatePass:offBefore?.status==='complete'&&offAfter?.status==='complete'&&
                  offBefore.action===offAfter.action,
                rendererCullingPass:hidden,
                cameraRoundTripPass:beforePos.x===afterPos.x&&beforePos.y===afterPos.y
              });
            }else if(index===3){
              const before=ResidentMovement.proofSnapshot();
              const resident=residentFor(before.residentId);
              ResidentMovement.proofBeginOutbound();
              const work=DailyActivity.resolveActionTarget(campaign.seed,resident,sample(10,30));
              const released=ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:ResidentMovement.position(resident.id),activity:work
              },0);
              const start=ResidentMovement.position(resident.id);
              movement=ResidentMovement.proofAdvanceToDoor();
              const end=ResidentMovement.position(resident.id);
              ActionExecutor.recordProof({
                stage:'route-next-goal',
                scheduleReleasePass:released.status==='waiting-arrival'&&!released.holdsPosition&&
                  ActionExecutor.get('resident',resident.id)===null,
                nextGoalRoutingPass:start.x!==end.x||start.y!==end.y
              });
            }else{
              movement=ResidentMovement.proofAdvanceToTarget();
              const resident=residentFor(movement.residentId);
              const work=DailyActivity.resolveActionTarget(campaign.seed,resident,sample(10,30));
              const started=ActionExecutor.advanceActor({
                seed:campaign.seed,actorKind:'resident',actorId:resident.id,
                position:ResidentMovement.position(resident.id),activity:work
              },0.25);
              ActionExecutor.recordProof({
                stage:'work-active',
                workStarted:started.status==='active'&&started.holdsPosition
              });
            }

            proof=ActionExecutor.proofSnapshot();
            movement=ResidentMovement.proofSnapshot();
            const focus=ResidentMovement.position(proof.residentId);
            Camera.setCenter(focus.x,focus.y);
            await AppUI.refreshTerrain();
            AppUI.refreshResidentMovementProof();
            AppUI.refreshResidentActionProof();
            window.scrollTo(0,0);
            done({
              ok:true,index,stage:proof.stage,residentId:proof.residentId,
              action:proof.current?.action||null,status:proof.current?.status||null,
              pass:Boolean(proof.pass),position:focus,
              ribbonHidden:Boolean(document.querySelector('#residentActionRibbon')?.hidden),
              ribbonState:document.querySelector('#residentActionRibbonState')?.textContent?.trim()||null
            });
          }catch(error){done({ok:false,error:String(error),stack:error?.stack||null});}
        })();
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Resident action proof frame failed: {result}")
    WebDriverWait(driver, 8).until(
        lambda d: d.execute_script(
            "return document.querySelector('#residentActionProof') && document.querySelectorAll('#residentMovementRows tr').length===12"
        )
    )
    return (
        f"resident-action:{frame_index}:{result.get('stage')}:"
        f"{result.get('residentId')}:{result.get('action')}:{result.get('status')}:"
        f"ribbonHidden={result.get('ribbonHidden')}"
    )


def _show_character_memory_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const memory=window.CharacterMemory;
        const advisor=window.AdvisorChannel;
        if(!campaign?.seed||!memory)return {ok:false,error:'character-memory-unavailable'};
        const seed=campaign.seed;
        const protagonist={kind:'protagonist',id:'protagonist'};
        const resident={kind:'resident',id:'R03'};

        if(index===0){
          memory.clear(seed);
          if(advisor){
            localStorage.removeItem(advisor.storageKey(seed,'protagonist'));
            const advice=advisor.recordAdvice(seed,{
              topic:'Warn the elder about the late milling run',
              target:{kind:'topic',label:'Village elder'},
              timestamp:'1200-06-12 07:55:00'
            },'protagonist');

            memory.recordFact(seed,protagonist,{
              category:'places',
              summary:'The mill is closed today.',
              timestamp:'1200-06-12 08:00:00',
              source:{type:'simulation',id:'mill-state:1200-06-12',label:'Mill operating state'},
              confidence:1,relevance:0.95,reliability:'verified',
              fact:{subject:'mill',predicate:'open',value:false}
            });
            memory.recordObservation(seed,protagonist,{
              category:'people',
              summary:'The baker is inside the tavern.',
              timestamp:'1200-06-12 08:05:00',
              source:{type:'direct-observation',id:'scene:tavern:0805',label:'Direct tavern observation'},
              confidence:0.98,relevance:0.82,reliability:'verified',
              scene:{location:'tavern',event:'morning-visit',subjectId:'R05'}
            });
            memory.recordMemory(seed,protagonist,{
              kind:'memory',category:'warnings',
              summary:'The trader was angry after the missed payment.',
              timestamp:'1200-06-12 08:10:00',
              source:{type:'trusted-testimony',id:'resident:R07',label:'Trusted villager testimony'},
              confidence:0.82,relevance:0.9,reliability:'trusted'
            });
            memory.recordMemory(seed,protagonist,{
              kind:'memory',category:'rumors',
              summary:'A caravan may arrive after dusk.',
              timestamp:'1200-06-12 08:12:00',
              source:{type:'rumor',id:'market-rumor:17',label:'Market rumor'},
              confidence:0.35,relevance:0.58,reliability:'uncertain'
            });
            if(advice){
              memory.recordAdviceReference(seed,protagonist,advice.id,{
                category:'advice',
                summary:'Advisor warning retained for later consideration.',
                timestamp:'1200-06-12 08:15:00',
                relevance:0.88
              });
            }
          }

          memory.recordObservation(seed,resident,{
            category:'places',
            summary:'Rain clouds are gathering over the west field.',
            timestamp:'1200-06-12 08:03:00',
            source:{type:'direct-observation',id:'scene:west-field:0803',label:'Direct field observation'},
            confidence:0.92,relevance:0.67,reliability:'verified',
            scene:{location:'west field',event:'weather-check'}
          });
          memory.recordMemory(seed,resident,{
            category:'rumors',
            summary:'A merchant may be buying grain above market price.',
            timestamp:'1200-06-12 08:14:00',
            source:{type:'rumor',id:'rumor:grain-buyer',label:'Unverified market rumor'},
            confidence:0.4,relevance:0.72,reliability:'uncertain'
          });
        }

        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#memoryProof');
        const timeline=document.querySelector('#memoryTimeline');
        if(!section||!proof||!timeline)return {ok:false,error:'memory-proof-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;

        const actor=index===2?resident:protagonist;
        memory.renderDebugPanel(seed,actor,undefined,proof);
        proof.scrollIntoView({block:'start'});
        if(index===1||index===3)timeline.scrollTop=timeline.scrollHeight;
        else timeline.scrollTop=0;

        const verify=memory.verify(seed);
        return {
          ok:Boolean(verify.pass),
          index,
          actorKey:proof.dataset.actorKey,
          entryCount:Number(proof.dataset.entryCount||0),
          renderedEntries:timeline.querySelectorAll('.memory-entry').length,
          uncertainRendered:timeline.querySelectorAll('.memory-entry.uncertain').length,
          scrollTop:Number(timeline.scrollTop||0),
          scrollHeight:Number(timeline.scrollHeight||0),
          clientHeight:Number(timeline.clientHeight||0)
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Character memory proof frame failed: {result}")
    return (
        f"character-memory:{frame_index}:{result.get('actorKey')}:"
        f"entries={result.get('entryCount')}:uncertain={result.get('uncertainRendered')}"
    )


def _show_dialogue_context_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const memory=window.CharacterMemory;
        const dialogue=window.DialogueContext;
        if(!campaign?.seed||!memory||!dialogue)return {ok:false,error:'dialogue-context-unavailable'};
        const seed=campaign.seed;
        const resident={kind:'resident',id:'R03'};
        if(index===0){
          memory.clear(seed);
          memory.recordFact(seed,resident,{
            category:'places',
            summary:'The mill is closed today.',
            timestamp:'1200-06-12 07:45:00',
            source:{type:'simulation',id:'mill-state:1200-06-12',label:'Mill operating state'},
            confidence:1,relevance:0.98,reliability:'verified',
            fact:{subject:'mill',predicate:'open',value:false}
          });
          memory.recordMemory(seed,resident,{
            category:'rumors',
            summary:'Someone said the miller may leave early tomorrow.',
            timestamp:'1200-06-12 07:50:00',
            source:{type:'rumor',id:'rumor:miller-leave',label:'Unverified village rumor'},
            confidence:0.4,relevance:0.42,reliability:'uncertain'
          });
        }
        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#dialogueProof');
        if(!section||!proof)return {ok:false,error:'dialogue-proof-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;
        const caseIds=['public-friendly','home-guarded','work-formal','travel-urgent','sleep-private'];
        const caseId=caseIds[Math.min(index,caseIds.length-1)];
        const rendered=dialogue.renderDebugPanel(seed,'R03',caseId,proof);
        proof.scrollIntoView({block:'start'});
        const verify=dialogue.proof(seed,'R03');
        return {
          ok:Boolean(verify.pass),
          index,caseId,
          tone:rendered?.result?.tone||null,
          activity:rendered?.result?.activity?.kind||null,
          location:rendered?.result?.location?.kind||null,
          speaker:rendered?.result?.speaker?.id||null,
          listener:rendered?.result?.listener?.id||null,
          knowledgeId:rendered?.result?.knowledge?.memoryId||null,
          dialogueId:rendered?.result?.id||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Dialogue context proof frame failed: {result}")
    return (
        f"dialogue-context:{frame_index}:{result.get('caseId')}:"
        f"{result.get('tone')}:{result.get('activity')}:{result.get('location')}"
    )


def _show_advice_resolution_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const channel=window.AdvisorChannel;
        const memory=window.CharacterMemory;
        const resolution=window.AdviceResolution;
        if(!campaign?.seed||!channel||!memory||!resolution||!window.ActionExecutor||!window.DailyActivity){
          return {ok:false,error:'advice-resolution-unavailable'};
        }
        const seed=campaign.seed;
        const protagonistId='protagonist';

        if(index===0){
          localStorage.removeItem(channel.storageKey(seed,protagonistId));
          memory.clear(seed);
          resolution.clear(seed);

          const resident=DailyActivity.roster(seed).find(item=>item.id==='R03');
          const lunchBlock=resident?.schedule?.find(item=>item.state==='lunch');
          if(!resident||!lunchBlock)return {ok:false,error:'proof-lunch-block-missing'};
          const mid=Math.floor((lunchBlock.startMinute+lunchBlock.endMinute)/2);
          const when={year:1200,month:6,day:12,hour:Math.floor(mid/60),minute:mid%60,second:0};
          const activity=DailyActivity.resolve(seed,resident,when);
          if(!activity)return {ok:false,error:'proof-activity-missing'};
          const validIntent={position:{x:activity.target.x,y:activity.target.y},activity};
          const invalidActivity={
            ...activity,
            action:'sleep',intendedAction:'sleep',
            supportedActions:['eat']
          };
          const invalidIntent={position:{x:activity.target.x,y:activity.target.y},activity:invalidActivity};

          const samples=[
            {
              topic:'Eat at the tavern before returning to work.',
              target:'Tavern meal',
              timestamp:'1200-06-12 12:20:00',
              decisionTimestamp:'1200-06-12 12:21:00',
              value:0.95,urgency:0.9,socialAcceptability:0.86,
              intent:validIntent,
              recommendation:'Take the meal now while the action is timely.'
            },
            {
              topic:'Check the market notices when there is time.',
              target:'Market notices',
              timestamp:'1200-06-12 12:22:00',
              decisionTimestamp:'1200-06-12 12:23:00',
              value:0.82,urgency:0.25,socialAcceptability:0.8,
              intent:validIntent,
              recommendation:'Keep the useful suggestion for later.'
            },
            {
              topic:'Insult the village elder to force immediate access.',
              target:'Village elder',
              timestamp:'1200-06-12 12:24:00',
              decisionTimestamp:'1200-06-12 12:25:00',
              value:0.75,urgency:0.9,socialAcceptability:0.1,
              intent:validIntent,
              recommendation:'Force the request despite the social cost.'
            },
            {
              topic:'Use the tavern table as a workbench immediately.',
              target:'Tavern table',
              timestamp:'1200-06-12 12:26:00',
              decisionTimestamp:'1200-06-12 12:27:00',
              value:0.86,urgency:0.75,socialAcceptability:0.72,
              intent:invalidIntent,
              modifiedIntent:validIntent,
              recommendation:'Use the tavern table as a workbench.',
              modification:'Take a short meal at the tavern table instead.'
            }
          ];

          for(const sample of samples){
            const advice=channel.recordAdvice(seed,{
              topic:sample.topic,
              target:{kind:'topic',label:sample.target},
              timestamp:sample.timestamp
            },protagonistId);
            const resolved=resolution.resolveAdvice(seed,{
              adviceId:advice.id,
              timestamp:sample.decisionTimestamp,
              value:sample.value,
              urgency:sample.urgency,
              socialAcceptability:sample.socialAcceptability,
              intent:sample.intent,
              modifiedIntent:sample.modifiedIntent||null,
              recommendation:sample.recommendation,
              modification:sample.modification||''
            });
            if(!resolved)return {ok:false,error:'resolution-failed',adviceId:advice.id};
          }
        }

        const entries=resolution.list(seed);
        if(entries.length!==4)return {ok:false,error:'unexpected-resolution-count',count:entries.length};
        const expected=['accepted','deferred','rejected','modified','accepted'];
        const decision=expected[Math.min(index,expected.length-1)];
        const selected=entries.find(entry=>entry.decision===decision);
        if(!selected)return {ok:false,error:'expected-decision-missing',decision};

        const section=document.querySelector('#developmentDetails');
        const proof=document.querySelector('#adviceResolutionProof');
        if(!section||!proof)return {ok:false,error:'resolution-proof-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        proof.open=true;
        const rendered=resolution.renderDebugPanel(seed,selected.adviceId,proof);
        proof.scrollIntoView({block:'start'});
        const verify=resolution.proof(seed);
        return {
          ok:Boolean(verify.pass),
          index,
          selectedDecision:rendered?.entry?.decision||null,
          selectedAdviceId:rendered?.entry?.adviceId||null,
          entryCount:entries.length,
          decisions:entries.map(entry=>entry.decision),
          executionAllowed:rendered?.entry?.executionAllowed??null,
          validationOk:rendered?.entry?.finalValidation?.ok??null,
          validationReason:rendered?.entry?.finalValidation?.reason||null,
          memoryId:rendered?.entry?.memoryId||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Advice resolution proof frame failed: {result}")
    return (
        f"advice-resolution:{frame_index}:{result.get('selectedDecision')}:"
        f"validation={result.get('validationOk')}:{result.get('validationReason')}"
    )


def _show_simulation_tiers_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 6 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const tiers=window.SimulationTiers;
        if(!campaign?.seed||!tiers||!window.WorldState||!window.WorldContext){
          return {ok:false,error:'simulation-tiers-unavailable'};
        }
        const seed=campaign.seed;
        const step=tiers.evidenceStep(seed,index);
        if(!step?.ok)return {ok:false,error:'simulation-tier-step-failed',step};
        const proof=tiers.proof(seed);
        if(!proof.pass)return {ok:false,error:'simulation-tier-proof-failed',proof};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#simulationTiersProof');
        if(!section||!root)return {ok:false,error:'simulation-tier-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=tiers.renderDebugPanel(seed,root);
        root.dataset.historyPreserved=String(step.historyPreserved===true);
        root.dataset.mutatedSignature=step.mutatedSignature||'';
        root.dataset.demotedSignature=step.demotedSignature||'';
        root.dataset.reactivatedSignature=step.reactivatedSignature||'';
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,
          requestedTier:step.requestedTier,
          requestedPoint:step.requestedPoint||null,
          requestedClassification:step.requestedClassification||null,
          targetCenter:step.targetCenter||null,
          catalogTargetCenter:step.catalogTargetCenter||null,
          focusTier:step.focus?.tier||null,
          focusId:step.focus?.id||null,
          focusSignature:step.focus?.contextSignature||null,
          focusReason:step.focus?.reason||null,
          historyPreserved:Boolean(step.historyPreserved),
          counts:step.snapshot?.counts||null,
          bounded:Boolean(step.snapshot?.bounded),
          telemetry:step.snapshot?.telemetry||null,
          mutatedSignature:step.mutatedSignature||null,
          demotedSignature:step.demotedSignature||null,
          reactivatedSignature:step.reactivatedSignature||null,
          proof
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Simulation tiers proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    counts=result.get("counts") or {}
    return (
        prefix+
        f"simulation-tiers:{frame_index}:{result.get('focusTier')}:"
        f"requested={result.get('requestedTier')}/{(result.get('requestedClassification') or {}).get('tier')}:"
        f"point={result.get('requestedPoint')}:target={result.get('targetCenter')}:"
        f"exact={counts.get('exactNpcHandles')}:population={counts.get('representedPopulation')}"
    )


def _show_event_scheduler_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 1 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const scheduler=window.EventScheduler;
        if(!campaign?.seed||!scheduler||!window.PRNG){
          return {ok:false,error:'event-scheduler-unavailable'};
        }
        const seed=campaign.seed;
        const proof=scheduler.proof(seed);
        if(!proof.pass)return {ok:false,error:'event-scheduler-proof-failed',proof};

        const isolated=seed+'|WP-S007-004|browser';
        scheduler.reset(isolated);
        scheduler.scheduleMany(isolated,[
          {fantasyTimestamp:'1200-06-15 12:00:02',systemKind:'proof',entityId:'B',slotKey:'same-time'},
          {fantasyTimestamp:'1200-06-15 12:00:02',systemKind:'proof',entityId:'A',slotKey:'same-time'},
          {fantasyTimestamp:'1200-06-15 12:00:03',systemKind:'proof',entityId:'C',slotKey:'later'}
        ]);
        const first=scheduler.processDue(isolated,'1200-06-15 12:00:02',{maxEvents:1});
        const saved=scheduler.serialize(isolated);
        const restored=scheduler.restore(isolated,saved);
        const final=scheduler.processDue(isolated,'1200-06-15 12:00:08',{maxEvents:32});
        const runtimeApiPass=Boolean(
          first.processedCount===1&&first.processed?.[0]?.event?.entityId==='A'&&
          first.hasMoreDue===true&&restored?.ok===true&&
          final.processedCount===2&&final.pending===0
        );
        scheduler.reset(isolated);
        if(!runtimeApiPass)return {ok:false,error:'event-scheduler-runtime-api-failed',first,restored,final};

        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#eventSchedulerProof');
        if(!section||!root)return {ok:false,error:'event-scheduler-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=scheduler.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass&&runtimeApiPass),
          index,
          runtimeApiPass,
          signature:proof.canonicalHistorySignature,
          noiseSignature:proof.noiseHistoryBaseSignature,
          maxBatch:proof.maxBatch,
          extraEntityCount:proof.extraEntityCount,
          proof
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Event scheduler proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    return (
        prefix+
        f"event-scheduler:{frame_index}:signature={result.get('signature')}:"
        f"noise={result.get('noiseSignature')}:batch={result.get('maxBatch')}"
    )


def _show_global_country_simulation_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 4 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const sim=window.GlobalCountrySimulation;
        if(!campaign?.seed||!sim||!window.EventScheduler||!window.WorldState||!window.WorldContext){
          return {ok:false,error:'global-country-simulation-unavailable'};
        }
        const seed=campaign.seed;
        const proof=sim.proof(seed);
        if(!proof.pass)return {ok:false,error:'global-country-proof-failed',proof};
        const step=sim.evidenceStep(seed,index);
        if(!step?.ok)return {ok:false,error:'global-country-evidence-step-failed',step};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#globalCountrySimulationProof');
        if(!section||!root)return {ok:false,error:'global-country-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=sim.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,
          proof,
          evidence:step.evidence||null,
          deltaEntryCount:step.deltaEntryCount,
          deltaSequence:step.deltaSequence,
          snapshot:step.snapshot||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Global country Simulation proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    evidence=result.get("evidence") or {}
    return (
        prefix+
        f"global-country:{frame_index}:step={evidence.get('lastStep')}:"
        f"country={evidence.get('countryARevision')}/{evidence.get('countryBRevision')}:"
        f"relation={evidence.get('relationRevision')}:restricted={evidence.get('relationRestricted')}"
    )


def _show_regional_settlement_simulation_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 5 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const sim=window.RegionalSettlementSimulation;
        if(!campaign?.seed||!sim||!window.EventScheduler||!window.WorldState||!window.WorldContext){
          return {ok:false,error:'regional-settlement-simulation-unavailable'};
        }
        const seed=campaign.seed;
        const proof=sim.proof(seed);
        if(!proof.pass)return {ok:false,error:'regional-settlement-proof-failed',proof};
        const step=sim.evidenceStep(seed,index);
        if(!step?.ok)return {ok:false,error:'regional-settlement-evidence-step-failed',step};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#regionalSettlementSimulationProof');
        if(!section||!root)return {ok:false,error:'regional-settlement-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=sim.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,proof,evidence:step.evidence||null,
          snapshot:step.snapshot||null,delta:step.delta||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Regional/settlement Simulation proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    evidence=result.get("evidence") or {}
    return (
        prefix+
        f"regional-settlement:{frame_index}:step={evidence.get('lastStep')}:"
        f"settlement={evidence.get('agriculturalRevision')}/{evidence.get('miningRevision')}:"
        f"lazy={evidence.get('lazyConsumed')}:long={evidence.get('longAbsenceRevisionAfter')}"
    )


def _show_npc_lifecycle_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 5 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const lifecycle=window.NPCLifecycle;
        if(!campaign?.seed||!lifecycle||!window.WorldState||!window.WorldContext||!window.DailyActivity){
          return {ok:false,error:'npc-lifecycle-unavailable'};
        }
        const seed=campaign.seed;
        const proof=lifecycle.proof(seed);
        if(!proof.pass)return {ok:false,error:'npc-lifecycle-proof-failed',proof};
        const step=lifecycle.evidenceStep(seed,index);
        if(!step?.ok)return {ok:false,error:'npc-lifecycle-evidence-step-failed',step};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#npcLifecycleProof');
        if(!section||!root)return {ok:false,error:'npc-lifecycle-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=lifecycle.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {ok:Boolean(rendered?.verification?.pass),index,proof,evidence:step.evidence||null,snapshot:step.snapshot||null};
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"NPC lifecycle proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    evidence=result.get("evidence") or {}
    return (
        prefix+
        f"npc-lifecycle:{frame_index}:step={evidence.get('lastStep')}:"
        f"exact={evidence.get('activeExactPeak')}:dormant={evidence.get('dormantIdentityCount')}:"
        f"injury={evidence.get('injuryPersistent')}:reload={evidence.get('reloadDeterministic')}"
    )


def _show_lazy_catchup_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 5 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const sim=window.CatchUpSimulation;
        if(!campaign?.seed||!sim||!window.EventScheduler||!window.WorldState||!window.GameTime){
          return {ok:false,error:'lazy-catchup-unavailable'};
        }
        const seed=campaign.seed;
        const proof=sim.proof(seed);
        if(!proof.pass)return {ok:false,error:'lazy-catchup-proof-failed',proof};
        const step=sim.evidenceStep(seed,index);
        if(!step?.ok)return {ok:false,error:'lazy-catchup-evidence-step-failed',step};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#lazyCatchUpProof');
        if(!section||!root)return {ok:false,error:'lazy-catchup-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=sim.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {ok:Boolean(rendered?.verification?.pass),index,proof,evidence:step.evidence||null,snapshot:step.snapshot||null};
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Lazy catch-up proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    evidence=result.get("evidence") or {}
    return (
        prefix+
        f"lazy-catchup:{frame_index}:step={evidence.get('lastStep')}:"
        f"incomplete={evidence.get('incompleteObserved')}:complete={evidence.get('resumedComplete')}:"
        f"important={evidence.get('importantApplied')}:events={evidence.get('eventsProcessed')}"
    )


def _show_world_context_proof(driver, frame_index: int) -> str:
    camera_action = _drag_canvas(driver, 120, 0) if frame_index == 3 else None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const context=window.WorldContext;
        if(!campaign?.seed||!context||!window.WorldState||!window.SettlementArchetypes||!window.RegionProfile||!window.CountryProfile){
          return {ok:false,error:'world-context-unavailable'};
        }
        const seed=campaign.seed;
        const targets=context.evidenceTargets(seed);
        if(!targets?.primary||!targets?.contrast)return {ok:false,error:'world-context-targets-missing',targets};

        let lazyNoFanout=null;
        let beforeMutation=null;
        let afterMutation=null;
        let rematerialized=false;
        if(index===0){
          context.clearCaches({resetTelemetry:true});
        }
        if(index===1){
          beforeMutation=context.telemetry();
          const applied=context.applyEvidenceCountryDelta(seed);
          if(!applied?.ok)return {ok:false,error:'world-context-country-delta-failed',applied};
          afterMutation=context.telemetry();
          lazyNoFanout=Boolean(
            beforeMutation.cacheEntries===afterMutation.cacheEntries &&
            beforeMutation.queries===afterMutation.queries &&
            beforeMutation.hits===afterMutation.hits &&
            beforeMutation.misses===afterMutation.misses &&
            beforeMutation.staleRefreshes===afterMutation.staleRefreshes &&
            afterMutation.fanOutInvalidations===0
          );
          if(!lazyNoFanout)return {ok:false,error:'country-change-triggered-context-fanout',beforeMutation,afterMutation};
        }
        if(index===4){
          context.clearCaches();
          rematerialized=true;
        }

        const target=index===2?targets.contrast:targets.primary;
        const fixedTime={year:1200,month:6,day:15,hour:12,minute:0,second:0};
        const resolved=context.resolve(seed,target,fixedTime);
        if(!resolved)return {ok:false,error:'world-context-resolve-failed',index};
        const proof=context.proof(seed);
        if(!proof.pass)return {ok:false,error:'world-context-proof-failed',proof};

        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#worldContextProof');
        if(!section||!root)return {ok:false,error:'world-context-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=context.renderDebugPanel(seed,target,root,fixedTime);
        if(!rendered?.context)return {ok:false,error:'world-context-render-failed'};
        root.dataset.lazyNoFanout=String(lazyNoFanout===true);
        root.dataset.cacheEntriesBeforeMutation=String(beforeMutation?.cacheEntries||0);
        root.dataset.cacheEntriesAfterMutation=String(afterMutation?.cacheEntries||0);
        root.dataset.queriesBeforeMutation=String(beforeMutation?.queries||0);
        root.dataset.queriesAfterMutation=String(afterMutation?.queries||0);
        root.dataset.rematerialized=String(rematerialized);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered.verification?.pass),
          index,
          targetId:rendered.context.target.id,
          countryId:rendered.context.country.id,
          regionId:rendered.context.region.id,
          contextSignature:rendered.context.signature,
          contextRevision:rendered.context.revision,
          countryRevision:rendered.context.revisions.country,
          countryDeltaRevision:rendered.context.country.campaignDeltaRevision,
          wealth:rendered.context.country.wealth,
          trade:rendered.context.country.tendencies.tradeOpenness,
          agriculturePotential:rendered.context.behavior.agriculturePotential,
          miningPotential:rendered.context.behavior.miningPotential,
          transportAccess:rendered.context.behavior.transportAccess,
          lazyNoFanout,
          rematerialized,
          telemetry:context.telemetry()
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"WorldContext proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    return (
        prefix+
        f"world-context:{frame_index}:{result.get('targetId')}:"
        f"countryDelta={result.get('countryDeltaRevision')}:cache={result.get('telemetry',{}).get('cacheEntries')}"
    )


def _show_world_state_proof(driver, frame_index: int) -> str:
    if frame_index == 3:
        camera_action = _drag_canvas(driver, 120, 0)
    else:
        camera_action = None
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const world=window.WorldState;
        if(!campaign?.seed||!world||!window.SettlementArchetypes||!window.RegionProfile||!window.PoliticalGeography||!window.GeographyFoundation){
          return {ok:false,error:'world-state-unavailable'};
        }
        const seed=campaign.seed;
        if(index===1){
          const applied=world.applyEvidenceDelta(seed);
          if(!applied?.ok)return {ok:false,error:'world-state-evidence-delta-failed',applied};
        }
        const focus=world.focusReference(seed);
        if(!focus)return {ok:false,error:'world-state-focus-missing'};
        if(index===2)world.evictFoundation(seed,focus);
        let distantSparse=null;
        if(index===4){
          const before=world.deltaSnapshot(seed);
          const distant=world.terrainRef(seed,"1000000","-1000000");
          const resolved=world.resolve(seed,distant);
          const after=world.deltaSnapshot(seed);
          distantSparse=Boolean(resolved&&before.entryCount===after.entryCount&&before.serializedBytes===after.serializedBytes);
          if(!distantSparse)return {ok:false,error:'distant-query-created-save-payload',before,after};
        }
        const proof=world.proof(seed);
        if(!proof.pass)return {ok:false,error:'world-state-proof-failed',proof};
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#worldStateProof');
        if(!section||!root)return {ok:false,error:'world-state-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=world.renderDebugPanel(seed,root);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,
          focusId:root.dataset.focusId||null,
          foundationSignature:root.dataset.foundationSignature||null,
          currentSignature:root.dataset.currentSignature||null,
          deltaRevision:Number(root.dataset.deltaRevision||0),
          deltaSequence:Number(root.dataset.deltaSequence||0),
          deltaEntryCount:Number(root.dataset.deltaEntryCount||0),
          serializedBytes:Number(root.dataset.serializedBytes||0),
          liveDelta:root.dataset.liveDelta==='true',
          status:root.dataset.status||null,
          representativeRows:root.querySelectorAll('#worldStateRepresentatives li').length,
          layerRows:root.querySelectorAll('#worldStateLayers li').length,
          distantSparse,
          camera:window.Camera?.snapshot?.()||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"World-state proof frame failed: {result}")
    prefix = f"{camera_action}+" if camera_action else ""
    return (
        prefix+
        f"world-state:{frame_index}:{result.get('status')}:"
        f"delta={result.get('deltaRevision')}:entries={result.get('deltaEntryCount')}"
    )


def _show_settlement_building_catalog_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const catalog=window.SettlementBuildingCatalog;
        if(!campaign?.seed||!catalog||!window.SettlementArchetypes||!window.SpecialLots){
          return {ok:false,error:'settlement-building-catalog-unavailable'};
        }
        const seed=campaign.seed;
        const proof=catalog.proof(seed);
        if(!proof.pass)return {ok:false,error:'settlement-building-catalog-proof-failed',proof};
        const count=proof.representatives?.length||0;
        if(count!==5)return {ok:false,error:'settlement-building-representatives-missing',count};
        const requested=index===5?0:index%count;
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#settlementBuildingCatalogProof');
        if(!section||!root)return {ok:false,error:'settlement-building-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=catalog.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        const p=rendered?.plan;
        const c=rendered?.composition;
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,requested,count,
          planId:p?.id||null,compositionId:c?.id||null,revision:c?.revision||null,
          reason:rendered?.selected?.reason||null,classId:p?.classId||null,
          functionCount:c?.selected?.length||0,buildingCount:c?.totalPlannedBuildings||0,
          signature:root.dataset.signature||null,
          selectedIds:c?.selected?.map(item=>item.id)||[],
          villageMapped:Boolean(rendered?.verification?.startingVillageMapped),
          capitalFunctions:Boolean(rendered?.verification?.capitalFunctions)
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Settlement building catalog proof frame failed: {result}")
    return (
        f"settlement-buildings:{frame_index}:{result.get('reason')}:{result.get('classId')}:"
        f"functions={result.get('functionCount')}:buildings={result.get('buildingCount')}"
    )


def _show_settlement_archetype_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const settlements=window.SettlementArchetypes;
        if(!campaign?.seed||!settlements||!window.CountryProfile||!window.RegionProfile||!window.PoliticalGeography||!window.GeographyFoundation){
          return {ok:false,error:'settlement-archetypes-unavailable'};
        }
        const seed=campaign.seed;
        const proof=settlements.proof(seed);
        if(!proof.pass)return {ok:false,error:'settlement-archetypes-proof-failed',proof};
        const count=proof.representatives?.length||0;
        if(count!==5)return {ok:false,error:'settlement-archetypes-representatives-missing',count};
        const requested=index===5?0:index%count;
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#settlementArchetypeProof');
        if(!section||!root)return {ok:false,error:'settlement-archetypes-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=settlements.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        const p=rendered?.plan;
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,requested,count,
          planId:p?.id||null,revision:p?.revision||null,reason:rendered?.selected?.reason||null,
          classId:p?.classId||null,countryId:p?.countryId||null,regionId:p?.regionId||null,
          context:root.dataset.context||null,planning:root.dataset.planning||null,
          market:p?.tradeMarketTendency??null,defense:p?.defenseTendency??null,
          port:p?.subtypes?.weights?.port??null,coastal:p?.inputs?.local?.coastalAccess??null,
          tags:p?.subtypes?.tags||[],population:p?.population?.planned??null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Settlement archetype proof frame failed: {result}")
    return (
        f"settlement-archetype:{frame_index}:{result.get('reason')}:{result.get('classId')}:"
        f"market={result.get('market')}:defense={result.get('defense')}"
    )


def _show_country_relations_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const diplomacy=window.CountryRelations;
        if(!campaign?.seed||!diplomacy||!window.CountryProfile||!window.PoliticalGeography){
          return {ok:false,error:'country-relations-unavailable'};
        }
        const seed=campaign.seed;
        const proof=diplomacy.proof(seed);
        if(!proof.pass)return {ok:false,error:'country-relations-proof-failed',proof};
        const count=proof.representatives?.length||0;
        if(count<4)return {ok:false,error:'country-relations-representatives-missing',count};
        const requested=index===4?0:index%Math.min(count,4);
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#countryRelationsProof');
        if(!section||!root)return {ok:false,error:'country-relations-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=diplomacy.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        const r=rendered?.relation;
        const low=r?.countries?.[r?.pair?.lowCountryId];
        const high=r?.countries?.[r?.pair?.highCountryId];
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,requested,count,
          relationId:r?.id||null,
          revision:r?.revision||null,
          kind:rendered?.selected?.reason||null,
          state:r?.shared?.state||null,
          score:r?.shared?.relationshipScore??null,
          trade:r?.shared?.tradeAccess??null,
          tension:r?.shared?.militaryTension??null,
          openness:r?.shared?.borderOpenness??null,
          lowCountryId:r?.pair?.lowCountryId||null,
          highCountryId:r?.pair?.highCountryId||null,
          lowProfileRevision:low?.profileRevision||null,
          highProfileRevision:high?.profileRevision||null,
          lowTradeOpenness:low?.tradeOpenness??null,
          highTradeOpenness:high?.tradeOpenness??null,
          lowMilitary:low?.militaryEmphasis??null,
          highMilitary:high?.militaryEmphasis??null,
          warState:r?.shared?.warState??null,
          agreements:r?.agreements||null,
          directional:r?.directional||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Country relations proof frame failed: {result}")
    return (
        f"country-relations:{frame_index}:{result.get('kind')}:{result.get('state')}:"
        f"score={result.get('score')}:trade={result.get('trade')}:tension={result.get('tension')}"
    )


def _show_region_profile_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const regions=window.RegionProfile;
        if(!campaign?.seed||!regions||!window.CountryProfile||!window.PoliticalGeography||!window.GeographyFoundation){
          return {ok:false,error:'region-profile-unavailable'};
        }
        const seed=campaign.seed;
        const proof=regions.proof(seed);
        if(!proof.pass)return {ok:false,error:'region-profile-proof-failed',proof};
        const count=proof.representatives?.length||0;
        if(count<3)return {ok:false,error:'region-profile-representatives-missing',count};
        const requested=index===4?0:index%Math.min(count,4);
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#regionProfileProof');
        if(!section||!root)return {ok:false,error:'region-profile-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=regions.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        const p=rendered?.region;
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,requested,count,
          regionId:p?.id||null,
          regionName:p?.name||null,
          parentCountryId:p?.parentCountryId||null,
          countryRevision:p?.countryProfileRevision||null,
          dominantTerrain:p?.identity?.dominantTerrain||null,
          agriculture:p?.identity?.agriculturalSuitability??null,
          timber:p?.identity?.timberAvailability??null,
          mineral:p?.identity?.mineralPotential??null,
          water:p?.identity?.waterAccess??null,
          identity:p?[
            p.identity.dominantTerrain,p.identity.dominantBiome,
            Math.round(p.identity.agriculturalSuitability*5),Math.round(p.identity.timberAvailability*5),
            Math.round(p.identity.mineralPotential*5),Math.round(p.identity.waterAccess*5)
          ].join(':'):null,
          specialization:p?[
            p.specialization.agriculture,p.specialization.forestry,p.specialization.mining,p.specialization.trade,
            p.specialization.maritime,p.specialization.defense,p.specialization.craft
          ].map(v=>Math.round(v*10)).join(':'):null,
          revision:p?.revision||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Region profile proof frame failed: {result}")
    return (
        f"region-profile:{frame_index}:{result.get('regionId')}:"
        f"terrain={result.get('dominantTerrain')}:specialization={result.get('specialization')}"
    )


def _show_country_profile_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const profiles=window.CountryProfile;
        if(!campaign?.seed||!profiles||!window.PoliticalGeography||!window.GeographyFoundation){
          return {ok:false,error:'country-profile-unavailable'};
        }
        const seed=campaign.seed;
        const proof=profiles.proof(seed);
        if(!proof.pass)return {ok:false,error:'country-profile-proof-failed',proof};
        const count=proof.representatives?.length||0;
        if(count<3)return {ok:false,error:'country-profile-representatives-missing',count};
        const requested=index===4?0:index%Math.min(count,4);
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#countryProfileProof');
        if(!section||!root)return {ok:false,error:'country-profile-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=profiles.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        const p=rendered?.profile;
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,requested,count,
          profileId:p?.id||null,
          countryId:p?.countryId||null,
          countryName:p?.countryName||null,
          wealth:p?.wealth?.value??null,
          wealthBand:p?.wealth?.band||null,
          governance:p?.governance?.id||null,
          maritime:p?.tendencies?.maritime??null,
          mining:p?.tendencies?.mining??null,
          waterAccess:p?.geography?.waterAccess??null,
          mineralPotential:p?.geography?.mineralPotential??null,
          mix:p?[
            p.tendencies.tradeOpenness,p.tendencies.militaryEmphasis,p.tendencies.agriculture,
            p.tendencies.craftProduction,p.tendencies.maritime,p.tendencies.mining
          ].map(v=>Math.round(v*10)).join(':'):null,
          revision:p?.revision||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Country profile proof frame failed: {result}")
    return (
        f"country-profile:{frame_index}:{result.get('countryId')}:"
        f"wealth={result.get('wealth')}:{result.get('wealthBand')}:mix={result.get('mix')}"
    )


def _show_political_geography_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const political=window.PoliticalGeography;
        if(!campaign?.seed||!political||!window.GeographyFoundation){
          return {ok:false,error:'political-geography-unavailable'};
        }
        const seed=campaign.seed;
        const proof=political.proof(seed);
        if(!proof.pass)return {ok:false,error:'political-proof-failed',proof};
        const borderCount=proof.borders?.length||0;
        if(borderCount<1)return {ok:false,error:'political-border-missing'};
        const requested=index===4?0:index%borderCount;
        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#politicalGeographyProof');
        if(!section||!root)return {ok:false,error:'political-proof-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=political.renderDebugPanel(seed,requested,root);
        root.scrollIntoView({block:'start'});
        return {
          ok:Boolean(rendered?.verification?.pass),
          index,
          requested,
          borderCount,
          borderId:rendered?.border?.id||null,
          countryId:rendered?.verification?.origin?.id||null,
          countryName:rendered?.verification?.origin?.name||null,
          capitalId:rendered?.verification?.origin?.capital?.id||null,
          featureShift:rendered?.border?.featureShiftTiles??null,
          terrain:rendered?.border?.terrain||null,
          borderA:rendered?.border?.countryA?.id||null,
          borderB:rendered?.border?.countryB?.id||null,
          neighborCount:rendered?.verification?.neighbors?.length||0
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Political geography proof frame failed: {result}")
    return (
        f"political-geography:{frame_index}:{result.get('countryId')}:"
        f"{result.get('borderA')}->{result.get('borderB')}:shift={result.get('featureShift')}"
    )


def _show_social_state_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const social=window.SocialState;
        const memory=window.CharacterMemory;
        const channel=window.AdvisorChannel;
        if(!campaign?.seed||!social||!memory||!channel||!window.DialogueContext||!window.AdviceResolution||!window.DailyActivity){
          return {ok:false,error:'social-state-unavailable'};
        }
        const seed=campaign.seed;
        const protagonist={kind:'protagonist',id:'protagonist',label:'Protagonist'};
        const residents=DailyActivity.roster(seed);
        const smith=residents.find(item=>item.profession==='smith')||residents[0];
        if(!smith)return {ok:false,error:'proof-resident-missing'};
        const residentActor={kind:'resident',id:smith.id,label:smith.name};
        const relationship={observer:residentActor,subject:protagonist};
        const reputationTargets=social.residentReputationTargets(seed,smith.id);

        if(index===0){
          social.clear(seed);
          memory.clear(seed);
          localStorage.removeItem(channel.storageKey(seed,'protagonist'));
          if(window.AdviceResolution?.clear)AdviceResolution.clear(seed);

          memory.recordFact(seed,residentActor,{
            category:'places',
            summary:'The mill is closed today.',
            timestamp:'1200-06-12 07:40:00',
            source:{type:'simulation',id:'mill-state:1200-06-12',label:'Mill operating state'},
            confidence:1,relevance:0.9,reliability:'verified',
            fact:{subject:'mill',predicate:'open',value:false}
          });

          const advice=channel.recordAdvice(seed,{
            topic:'Ask the smith for help with the mill problem.',
            target:{kind:'person',id:smith.id,label:smith.name},
            timestamp:'1200-06-12 08:00:00'
          },'protagonist');

          const household=social.createDuty(seed,{
            type:'family',title:'Protect the household',
            actor:protagonist,beneficiary:residentActor,
            scopeTarget:{scope:'family',id:'family-'+smith.homePlanId,label:smith.homeLabel+' household',subjectActor:protagonist},
            priority:0.92,timestamp:'1200-06-12 08:02:00',
            externalRef:{type:'proof',id:'protect-household'}
          });
          const delivery=social.createDuty(seed,{
            type:'service',title:'Deliver the promised goods',
            actor:protagonist,beneficiary:residentActor,
            scopeTarget:{scope:'guild',id:smith.workFunction+'-guild',label:smith.profession+' guild scope',subjectActor:protagonist},
            priority:0.82,timestamp:'1200-06-12 08:03:00',
            externalRef:{type:'proof',id:'deliver-goods'}
          });
          const tools=social.createDuty(seed,{
            type:'debt',title:'Return the borrowed tools',
            actor:protagonist,beneficiary:residentActor,
            scopeTarget:{scope:'role',id:smith.profession,label:smith.profession+' role',subjectActor:protagonist},
            priority:0.74,timestamp:'1200-06-12 08:04:00',
            externalRef:{type:'proof',id:'return-tools'}
          });
          social.recordEvent(seed,{
            type:'promise-made',timestamp:'1200-06-12 08:05:00',
            actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'promise',id:'smith-promise-made-001'},
            summary:'The protagonist made a clear promise to the smith.'
          });
          window.__socialProof={smithId:smith.id,adviceId:advice.id,householdId:household.id,deliveryId:delivery.id,toolsId:tools.id};
        }

        let proofState=window.__socialProof;
        if(!proofState){
          const duties=social.listDuties(seed,{kind:'protagonist',id:'protagonist'});
          const advice=channel.list(seed,'protagonist')[0];
          proofState={
            smithId:smith.id,
            adviceId:advice?.id||null,
            householdId:duties.find(d=>d.title==='Protect the household')?.id||null,
            deliveryId:duties.find(d=>d.title==='Deliver the promised goods')?.id||null,
            toolsId:duties.find(d=>d.title==='Return the borrowed tools')?.id||null
          };
          window.__socialProof=proofState;
        }

        if(index===1){
          social.recordEvent(seed,{
            type:'truthful-advice',timestamp:'1200-06-12 09:00:00',
            actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'advice',id:proofState.adviceId},
            summary:'The recommendation proved truthful and useful.'
          });
          social.recordEvent(seed,{
            type:'observed-help',timestamp:'1200-06-12 09:05:00',
            actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'observation',id:'help-smith-001'},
            summary:'The smith observed the protagonist helping with the mill problem.'
          });
          social.transitionDuty(seed,proofState.deliveryId,'fulfilled',{
            timestamp:'1200-06-12 09:10:00',actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'duty',id:proofState.deliveryId},
            summary:'The promised goods were delivered.'
          });
        }else if(index===2){
          social.recordEvent(seed,{
            type:'promise-broken',timestamp:'1200-06-12 10:00:00',
            actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'promise',id:'smith-promise-broken-001'},
            summary:'A clear promise to the smith was broken.'
          });
          social.transitionDuty(seed,proofState.toolsId,'breached',{
            timestamp:'1200-06-12 10:05:00',actor:protagonist,relationship,reputationTargets,
            externalRef:{type:'duty',id:proofState.toolsId},
            summary:'The borrowed tools were not returned as promised.'
          });
        }

        const section=document.querySelector('#developmentDetails');
        const root=document.querySelector('#socialStateProof');
        if(!section||!root)return {ok:false,error:'social-proof-ui-missing'};
        section.hidden=false;
        document.body.classList.add('development-mode');
        root.open=true;
        const rendered=social.renderDebugPanel(seed,smith.id,root);
        root.scrollIntoView({block:'start'});

        const integration=rendered?.integration||{};
        const verify=social.proof(seed);
        return {
          ok:Boolean(verify.pass),
          index,
          smithId:smith.id,
          profession:smith.profession,
          trust:rendered?.relationship?.values?.trust??null,
          suspicion:rendered?.relationship?.values?.suspicion??null,
          reputationAverage:rendered?.verification?social.dialogueContext(seed,smith.id).reputationAverage:null,
          dialogueTone:integration.dialogueTone||null,
          dialogueSource:integration.dialogueSource||null,
          adviceDecision:integration.adviceDecision||null,
          adviceSource:integration.adviceSource||null,
          adviceAcceptability:integration.acceptability??null,
          dutyConflictAcceptability:integration.dutyConflictAcceptability??null,
          dutyStatuses:rendered?.duties?.map(d=>d.status)||[],
          eventCount:verify.eventCount,
          dutyCount:verify.dutyCount
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Social state proof frame failed: {result}")
    return (
        f"social-state:{frame_index}:{result.get('profession')}:{result.get('trust')}:"
        f"{result.get('dialogueTone')}:{result.get('adviceDecision')}"
    )


def _show_advisor_channel_proof(driver, frame_index: int) -> str:
    result = driver.execute_script(
        """
        const index=Number(arguments[0]);
        const campaign=window.SeedSystem?.getCampaign?.();
        const channel=window.AdvisorChannel;
        if(!campaign?.seed||!channel) return {ok:false,error:'advisor-channel-unavailable'};
        const seed=campaign.seed;
        const protagonistId='protagonist';
        const toggle=document.querySelector('#characterInteractionsToggle');
        if(toggle?.getAttribute('aria-expanded')==='false') toggle.click();

        if(index===0){
          localStorage.removeItem(channel.storageKey(seed,protagonistId));
          channel.getAdvisor(seed,protagonistId);
          const samples=[
            ['Warn the elder about the late milling run','Village elder','1200-01-01 08:00:00'],
            ['Ask the tanner about the spare hides','Tanner','1200-01-01 08:05:00'],
            ['Visit the market before dusk','Market','1200-01-01 08:10:00'],
            ['Check the bridge watch before nightfall','Bridge watch','1200-01-01 08:15:00']
          ];
          for(const [topic,target,timestamp] of samples){
            channel.recordAdvice(seed,{topic,target:{kind:'topic',label:target},timestamp},protagonistId);
          }
        }

        const entries=channel.list(seed,protagonistId);
        if(entries.length!==4) return {ok:false,error:'unexpected-entry-count',count:entries.length};

        if(index===1){
          channel.transition(seed,entries[0].id,'considered',protagonistId,{timestamp:'1200-01-01 08:30:00',actor:'protagonist'});
          channel.transition(seed,entries[1].id,'considered',protagonistId,{timestamp:'1200-01-01 08:31:00',actor:'protagonist'});
          channel.transition(seed,entries[2].id,'deferred',protagonistId,{timestamp:'1200-01-01 08:32:00',actor:'protagonist'});
          channel.transition(seed,entries[3].id,'considered',protagonistId,{timestamp:'1200-01-01 08:33:00',actor:'protagonist'});
        }else if(index===2){
          const current=channel.list(seed,protagonistId);
          channel.transition(seed,current[0].id,'accepted',protagonistId,{timestamp:'1200-01-01 09:00:00',actor:'protagonist'});
          channel.transition(seed,current[1].id,'rejected',protagonistId,{timestamp:'1200-01-01 09:01:00',actor:'protagonist'});
          channel.transition(seed,current[3].id,'forgotten',protagonistId,{timestamp:'1200-01-01 09:02:00',actor:'protagonist'});
        }

        channel.renderAdvicePanel(seed,protagonistId,document.querySelector('#advisorPanel'));
        document.querySelector('#characterInteractionsPanel')?.scrollIntoView({block:'nearest'});
        const body=document.querySelector('#characterInteractionsBody');
        if(body)body.scrollTop=index===0?0:body.scrollHeight;
        const proof=channel.proof(seed,protagonistId);
        return {
          ok:Boolean(proof.pass),
          index,
          statuses:proof.entries.map(entry=>entry.status),
          ids:proof.entries.map(entry=>entry.id),
          advisorId:proof.advisor?.id||null,
          boundary:document.querySelector('.advisor-boundary')?.textContent?.trim()||null
        };
        """,
        frame_index,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Advisor channel proof frame failed: {result}")
    return (
        f"advisor-channel:{frame_index}:"
        f"{','.join(result.get('statuses') or [])}:"
        f"{result.get('advisorId')}"
    )


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
    result = driver.execute_async_script(
        """
        const done = arguments[arguments.length - 1];
        (async () => {
          const campaign = window.SeedSystem?.getCampaign?.();
          const village = window.StartingVillage;
          const camera = window.Camera;
          const ui = window.AppUI;
          if (!campaign || !village?.plan || !camera?.pan || !ui?.refreshTerrain) {
            done({ok:false, reason:'starting-village-runtime-unavailable'});
            return;
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
          await ui.refreshTerrain();
          done({ok:true, direction:plan.gatewayDirection, move});
        })().catch(error => done({ok:false, reason:String(error)}));
        """
    )
    if isinstance(result, dict) and result.get("ok"):
        return f"focus-gateway:{result.get('direction')}"
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


def _show_character_billboard_readability_proof(driver, frame_index: int, doubled_scale: bool = False) -> str:
    configs = {
        1: (1920, 1080, 1.00, "open", "desktop-1.00x", "protagonist"),
        2: (1920, 1080, 2.00, "open", "desktop-2.00x", "protagonist"),
        3: (1920, 1080, 0.50, "front", "front-0.50x", "protagonist"),
        4: (1920, 1080, 0.50, "behind", "behind-0.50x", "protagonist"),
        5: (1920, 1080, 1.00, "entering", "entering-1.00x", "protagonist"),
        6: (1920, 1080, 1.00, "inside", "inside-1.00x", "protagonist"),
        7: (430, 932, 0.50, "open", "phone-portrait-0.50x", "protagonist"),
        8: (932, 430, 0.50, "open", "phone-landscape-0.50x", "protagonist"),
        9: (1920, 1080, 1.00 if doubled_scale else 0.50, "open", "npc-1.00x" if doubled_scale else "npc-0.50x", "npc"),
        10: (1920, 1080, 2.00 if doubled_scale else 1.00, "open", "npc-2.00x" if doubled_scale else "npc-1.00x", "npc"),
    }
    width, height, zoom, state, label, focus_kind = configs.get(frame_index, configs[10])
    driver.set_window_size(width, height)
    result = driver.execute_async_script(
        """
        const zoom=Number(arguments[0]);
        const state=String(arguments[1]);
        const label=String(arguments[2]);
        const focusKind=String(arguments[3]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const camera=window.Camera;
            const renderer=window.GameRenderer;
            if(!camera?.setZoom||!camera?.pan||!renderer?.setCharacterProofState||!window.AppUI?.refreshTerrain){
              done({ok:false,error:'character-billboard-proof-api-missing'});
              return;
            }

            let requestedNpc=null;
            if(focusKind==='npc'){
              const initial=renderer.snapshot?.()||{};
              const campaign=window.SeedSystem?.getCampaign?.();
              const seed=campaign?.seed||null;
              const movement=window.ResidentMovement?.snapshot?.()||null;
              const roster=seed&&window.DailyActivity?.build?window.DailyActivity.build(seed):[];
              const rosterById=new Map(roster.map(item=>[String(item.id),item]));
              const bounds=[
                ...(seed&&window.HousePlans?.build?window.HousePlans.build(seed):[]),
                ...(seed&&window.SpecialLots?.build?window.SpecialLots.build(seed):[])
              ].map(item=>item?.bounds).filter(Boolean);
              const clearance=(point)=>{
                if(!point)return -1;
                const x=Number(BigInt(String(point.x))),y=Number(BigInt(String(point.y)));
                let best=999;
                for(const b of bounds){
                  const dx=x<Number(b.minX)?Number(b.minX)-x:x>Number(b.maxX)?x-Number(b.maxX):0;
                  const dy=y<Number(b.minY)?Number(b.minY)-y:y>Number(b.maxY)?y-Number(b.maxY):0;
                  best=Math.min(best,Math.max(dx,dy));
                }
                return best;
              };
              const existing=window.__advisorBillboardNpcProof||null;
              let state=null;
              let proof=window.ResidentMovement?.proofSnapshot?.()||null;
              if(!existing){
                if(!window.ResidentMovement?.beginProof||
                   !window.ResidentMovement?.proofAdvanceToTarget||
                   !window.ResidentMovement?.proofBeginOutbound||
                   !window.ResidentMovement?.proofAdvanceSeconds){
                  done({ok:false,error:'resident-movement-proof-api-missing'});
                  return;
                }
                proof=window.ResidentMovement.beginProof(seed);
                if(!proof){
                  done({ok:false,error:'resident-movement-proof-start-failed'});
                  return;
                }
                window.ResidentMovement.proofAdvanceToTarget();
                window.ResidentMovement.proofBeginOutbound();
                for(let step=0;step<180;step++){
                  proof=window.ResidentMovement.proofAdvanceSeconds(0.5);
                  state=window.ResidentMovement.get(proof?.residentId);
                  const clear=state?clearance(state.position):-1;
                  if(state?.position&&!state.buildingId&&clear>=4)break;
                  state=null;
                }
              }else{
                proof=window.ResidentMovement?.proofSnapshot?.()||null;
                state=proof&&String(proof.residentId)===String(existing.residentId)
                  ?window.ResidentMovement.get(existing.residentId)
                  :null;
              }
              const clearanceTiles=state?clearance(state.position):-1;
              if(!proof||!state||!state.position||state.buildingId||clearanceTiles<4){
                done({
                  ok:false,error:'no-deterministic-clear-proof-npc',
                  proof:proof||null,selected:state||null,clearanceTiles
                });
                return;
              }
              const resident=rosterById.get(String(state.residentId))||null;
              requestedNpc={
                id:'resident:'+String(state.residentId),
                residentId:String(state.residentId),
                x:String(state.position.x),
                y:String(state.position.y),
                residentName:resident?.name||null,
                profession:resident?.profession||null,
                status:state.status||null,
                buildingId:state.buildingId||null,
                navigationCategory:state.navigationCategory||null,
                clearanceTiles
              };
              window.__advisorBillboardNpcProof={
                residentId:requestedNpc.residentId,
                x:requestedNpc.x,
                y:requestedNpc.y,
                clearanceTiles:requestedNpc.clearanceTiles
              };
              const center=camera.getCenter?.()||initial.frame?.center||{x:'0',y:'0'};
              const dx=(BigInt(requestedNpc.x)-BigInt(String(center.x))).toString();
              const dy=(BigInt(requestedNpc.y)-BigInt(String(center.y))).toString();
              camera.pan(dx,dy);
            }

            camera.setZoom(zoom);
            await window.AppUI.refreshTerrain();
            renderer.setCharacterProofState(state);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const snapshot=renderer.snapshot?.()||{};
            const presentation=snapshot.characterPresentation||{};
            const proof=snapshot.characterProof||{};
            const instances=Array.isArray(presentation.instances)?presentation.instances:[];
            const protagonist=instances.find(item=>item.id==='protagonist')||null;
            const npcId=requestedNpc?.id||null;
            const npc=npcId?instances.find(item=>String(item.id)===String(npcId))||null:
                instances.find(item=>item.id!=='protagonist')||null;
            const focus=focusKind==='npc'?npc:protagonist;
            done({
              ok:Boolean(
                focus &&
                focus.upright===true &&
                focus.cameraFacing===true &&
                focus.verticalInverted===false &&
                focus.imageUpAxis==='+Y' &&
                presentation.billboardMode==='camera-facing-upright'
              ),
              zoom:Number(camera.getZoom?.()||zoom),
              state,label,focusKind,
              focus,protagonist,npc,requestedNpc,
              npcClearanceTiles:Number(requestedNpc?.clearanceTiles??-1),
              npcMovementStatus:requestedNpc?.status||null,
              cameraCenter:camera.getCenter?.()||null,
              active:Number(presentation.activeCharacterCount||0),
              simulated:Number(presentation.simulatedCharacterCount||0),
              suppressed:Number(presentation.suppressedCharacterCount||0),
              prepared:Number(presentation.preparedCharacterCount||0),
              sharedTextures:Number(presentation.sharedTextureCount||0),
              sharedMaterials:Number(presentation.sharedMaterialCount||0),
              minScreenPixelHeight:Number(presentation.minScreenPixelHeight||0),
              shortViewportFallbackPixelHeight:Number(presentation.shortViewportFallbackPixelHeight||0),
              proof,
              cutaway:snapshot.buildingPresentation||null,
              simulationAuthorityPreserved:Boolean(snapshot.simulationAuthorityPreserved)
            });
          }catch(error){done({ok:false,error:String(error),stack:error?.stack||null})}
        })();
        """,
        zoom,
        state,
        label,
        focus_kind,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Character billboard readability proof failed: {result}")
    driver.execute_script("window.scrollTo(0,0)")
    focus=result.get("focus") or {}
    return (
        f"character-billboard:{label}:zoom={zoom:.2f}:state={state}:focus={focus_kind}:"
        f"{focus.get('id')}:px={float(focus.get('renderedPixelHeight') or 0):.2f}:"
        f"scale={float(focus.get('presentationScale') or 0):.2f}:"
        f"clearance={float(result.get('npcClearanceTiles') or 0):.1f}:"
        f"movementBuilding={(result.get('requestedNpc') or {}).get('buildingId') or 'none'}:"
        f"active={result.get('active')}:sim={result.get('simulated')}"
    )

def _show_gabled_roof_proof(driver, frame_index: int) -> str:
    configs = (
        (1920, 1080, 0.50, "outside", "desktop-0.50x"),
        (1920, 1080, 1.00, "outside", "desktop-1.00x"),
        (1920, 1080, 2.00, "outside", "desktop-2.00x"),
        (430, 932, 0.50, "outside", "phone-portrait"),
        (932, 430, 0.50, "outside", "phone-landscape"),
        (1920, 1080, 1.00, "inside", "cutaway-inside"),
    )
    width, height, zoom, state, label = configs[min(frame_index, len(configs) - 1)]
    driver.set_window_size(width, height)
    result = driver.execute_async_script(
        """
        const zoom=Number(arguments[0]);
        const state=String(arguments[1]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const camera=window.Camera;
            const renderer=window.GameRenderer;
            if(!camera?.setZoom||!renderer?.setBuildingProofState){
              done({ok:false,error:'roof-proof-api-missing'});
              return;
            }
            camera.setZoom(zoom);
            if(window.AppUI?.refreshTerrain)await window.AppUI.refreshTerrain();
            renderer.setBuildingProofState(state);
            try{window.AppUI?.refreshBuildingPresentation?.()}catch(_){}
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const snapshot=renderer.snapshot?.()||{};
            const chunks=snapshot.terrainChunks||{};
            const presentation=snapshot.buildingPresentation||{};
            const samples=Array.isArray(chunks.roofProfileSamples)?chunks.roofProfileSamples:[];
            const profilePass=Boolean(
              chunks.roofProfilePass===true &&
              chunks.roofCenterRidgeHigher===true &&
              chunks.roofEaveContactPass===true &&
              chunks.roofFootprintDriven===true &&
              Number(chunks.roofProfileCount||0)>0 &&
              Number(chunks.roofNormalProfileCount||0)>0 &&
              Number(chunks.roofSpecialProfileCount||0)>0 &&
              samples.length>0 &&
              samples.every(item=>
                item.centerRidgeHigher===true &&
                item.eaveContact===true &&
                item.restrainedOverhang===true &&
                item.footprintDriven===true &&
                Number(item.ridgeBottomY)>Number(item.eaveBottomY) &&
                Number(item.eaveBottomY)<=Number(item.wallTopY)+0.001
              )
            );
            done({
              ok:profilePass,
              zoom:Number(camera.getZoom?.()||zoom),
              state,
              chunks:{
                roofProfileCount:Number(chunks.roofProfileCount||0),
                roofNormalProfileCount:Number(chunks.roofNormalProfileCount||0),
                roofSpecialProfileCount:Number(chunks.roofSpecialProfileCount||0),
                roofProfilePass:Boolean(chunks.roofProfilePass),
                sampleCount:samples.length,
              },
              presentation:{
                cutawayActive:Boolean(presentation.cutawayActive),
                cutawayBuildingId:presentation.cutawayBuildingId||null,
                hiddenRoofCount:Number(presentation.hiddenRoofCount||0),
                totalRoofCount:Number(presentation.totalRoofCount||0),
              }
            });
          }catch(error){done({ok:false,error:String(error)})}
        })();
        """,
        zoom,
        state,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Gabled-roof proof frame failed: {result}")
    if abs(float(result.get("zoom") or 0)-zoom)>1e-9:
        raise RuntimeError(f"Gabled-roof zoom mismatch: expected {zoom}, got {result}")
    if state == "inside":
        presentation=result.get("presentation") or {}
        if not presentation.get("cutawayActive") or int(presentation.get("hiddenRoofCount") or 0)!=2 or not presentation.get("cutawayBuildingId"):
            raise RuntimeError(f"Gabled-roof cutaway did not hide exactly one building roof pair: {result}")
    driver.execute_script("window.scrollTo(0,0)")
    return (
        f"roof-geometry:{label}:zoom={zoom:.2f}:state={state}:"
        f"profiles={result.get('chunks',{}).get('roofProfileCount')}:"
        f"normal={result.get('chunks',{}).get('roofNormalProfileCount')}:"
        f"special={result.get('chunks',{}).get('roofSpecialProfileCount')}"
    )


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



def _set_camera_center_and_render_active(driver, x: int, y: int, timeout: float = 8.0) -> str:
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
    WebDriverWait(driver, timeout).until(
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


def _focus_tree_sample_chunk(driver) -> str:
    sample = driver.execute_script(
        """
        const snap=window.GameRenderer?.snapshot?.();
        const chunks=snap?.terrainChunks || {};
        const list=Array.isArray(chunks.treeSampleChunks)?chunks.treeSampleChunks:[];
        if(!list.length)return null;
        const best=list.slice().sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0];
        const size=Number(chunks.chunkSize||16);
        const sample=best?.sample || null;
        const sampleX=Number(sample?.x),sampleY=Number(sample?.y);
        const hasSample=Number.isFinite(sampleX)&&Number.isFinite(sampleY);
        return {
          chunkX:Number(best.chunkX||0),
          chunkY:Number(best.chunkY||0),
          count:Number(best.count||0),
          centerX:hasSample?sampleX:Number(best.chunkX||0)*size+Math.floor(size/2),
          centerY:hasSample?sampleY:Number(best.chunkY||0)*size+Math.floor(size/2),
          treeX:hasSample?sampleX:null,
          treeY:hasSample?sampleY:null
        };
        """
    )
    if not isinstance(sample, dict) or int(sample.get("count") or 0) <= 0:
        raise RuntimeError(f"No prepared tree-bearing chunk available: {sample}")
    action=_set_camera_center_and_render_active(driver, int(sample["centerX"]), int(sample["centerY"]))
    point = f":tree={sample.get('treeX')},{sample.get('treeY')}" if sample.get("treeX") is not None else ""
    return f"tree-focus:{sample['chunkX']},{sample['chunkY']}:trees={sample['count']}{point}+"+action


def _focus_dressing_sample(driver, context: str | None = None, *, road_adjacent: bool = False) -> str:
    sample = driver.execute_script(
        """
        const context=arguments[0] ? String(arguments[0]) : null;
        const requireRoad=Boolean(arguments[1]);
        const snap=window.GameRenderer?.snapshot?.();
        const chunks=snap?.terrainChunks || {};
        const samples=Array.isArray(chunks.dressingSamples)?chunks.dressingSamples:[];
        const filtered=samples.filter(item=>{
          if(context && String(item?.context||'')!==context)return false;
          if(requireRoad && item?.roadAdjacent!==true)return false;
          return Number.isFinite(Number(item?.x)) && Number.isFinite(Number(item?.y));
        });
        if(!filtered.length)return null;
        const semanticPriority={
          signpost:0,cart:1,well:2,garden:3,pen:4,barrel:5,crate:6,
          woodpile:7,bench:8,flower:9,bush:10,sack:11,'work-prop':12,fence:13
        };
        filtered.sort((a,b)=>{
          const ap=semanticPriority[String(a?.semantic||'')] ?? 50;
          const bp=semanticPriority[String(b?.semantic||'')] ?? 50;
          return ap-bp || String(a?.id||'').localeCompare(String(b?.id||''));
        });
        return filtered[0];
        """,
        context,
        road_adjacent,
    )
    if not isinstance(sample, dict):
        qualifier=f"context={context}" if context else "any-context"
        if road_adjacent:
            qualifier += ",road-adjacent"
        raise RuntimeError(f"No prepared dressing sample available for {qualifier}: {sample}")
    action=_set_camera_center_and_render_active(driver, int(sample["x"]), int(sample["y"]), timeout=25.0)
    return (
        f"dressing-focus:{sample.get('context')}:{sample.get('semantic')}:"
        f"{sample.get('x')},{sample.get('y')}:road={str(bool(sample.get('roadAdjacent'))).lower()}+"
        + action
    )


def _move_camera_relative_active(driver, dx: int, dy: int) -> str:
    center=driver.execute_script("return window.Camera?.getCenter?.() || null")
    if not isinstance(center, dict):
        raise RuntimeError(f"Camera center unavailable before relative active move: {center}")
    target_x=int(center.get("x") or 0)+int(dx)
    target_y=int(center.get("y") or 0)+int(dy)
    action=_set_camera_center_and_render_active(driver,target_x,target_y)
    return f"camera-relative-active:{dx},{dy}+"+action


def _set_camera_view_and_render_active(driver, x: int, y: int, zoom: float, timeout: float = 45.0) -> str:
    result = driver.execute_async_script(
        """
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            if(!window.Camera?.setCenter||!window.Camera?.setZoom||!window.AppUI?.refreshTerrain){
              done({ok:false,reason:'camera-view-refresh-api-missing'});
              return;
            }
            window.Camera.setCenter(String(arguments[0]),String(arguments[1]));
            const selected=window.Camera.setZoom(Number(arguments[2]));
            await Promise.resolve(window.AppUI.refreshTerrain());
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            done({
              ok:true,
              center:window.Camera.getCenter?.()||null,
              zoom:Number(window.Camera.getZoom?.()||selected),
              terrainPreload:window.GameRenderer?.snapshot?.()?.terrainPreload||null
            });
          }catch(error){done({ok:false,reason:String(error?.stack||error)})}
        })();
        """,
        int(x), int(y), float(zoom),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set camera view and render: {result}")
    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            const camera=window.Camera?.getCenter?.();
            const z=Number(window.Camera?.getZoom?.()||0);
            const snap=window.GameRenderer?.snapshot?.();
            const frame=snap?.frame;
            const chunks=snap?.terrainChunks;
            return Boolean(
              camera && frame?.center &&
              String(camera.x)===String(arguments[0]) &&
              String(camera.y)===String(arguments[1]) &&
              String(frame.center.x)===String(arguments[0]) &&
              String(frame.center.y)===String(arguments[1]) &&
              Math.abs(z-Number(arguments[2]))<0.001 &&
              Number(chunks?.visibleChunkCount||0)>0 &&
              chunks?.resourceKind==='chunk-mesh'
            );
            """,
            str(x), str(y), float(zoom),
        )
    )
    return f"camera-view-active:{x},{y}@{zoom:.2f}"


def _set_camera_zoom_and_render(driver, zoom: float, timeout: float = 15.0) -> str:
    result = driver.execute_async_script(
        """
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            if(!window.Camera?.setZoom||!window.AppUI?.refreshTerrain){
              done({ok:false,reason:'camera-zoom-refresh-api-missing'});
              return;
            }
            const selected=window.Camera.setZoom(Number(arguments[0]));
            await Promise.resolve(window.AppUI.refreshTerrain());
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            done({ok:true,zoom:Number(window.Camera.getZoom?.()||selected)});
          }catch(error){done({ok:false,reason:String(error?.stack||error)})}
        })();
        """,
        float(zoom),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set camera zoom and render: {result}")
    from selenium.webdriver.support.ui import WebDriverWait
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script(
            """
            const z=Number(window.Camera?.getZoom?.()||0);
            const snap=window.GameRenderer?.snapshot?.();
            return Boolean(
              Math.abs(z-Number(arguments[0]))<0.001 &&
              snap?.ready &&
              Number(snap?.terrainPreload?.queueDepth||0)===0
            );
            """,
            float(zoom),
        )
    )
    return f"camera-zoom:{zoom:.2f}"


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


def _render_quality_step(
    driver,
    *,
    mode: str | None = None,
    frame_ms: float | None = None,
    samples: int = 0,
    viewport: tuple[int, int] | None = None,
) -> str:
    if viewport:
        driver.set_window_size(int(viewport[0]), int(viewport[1]))
        time.sleep(0.15)
    result = driver.execute_async_script(
        """
        const mode=arguments[0];
        const frameMs=Number(arguments[1]||0);
        const samples=Math.max(0,Number(arguments[2]||0));
        const done=arguments[arguments.length-1];
        (async()=>{
          const api=window.RuntimeRenderQuality;
          if(!api)throw new Error('RuntimeRenderQuality unavailable');
          if(mode)api.setMode(mode);
          for(let i=0;i<samples;i++)api.recordFrame(frameMs);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          if(window.AppUI?.refreshTerrain)await window.AppUI.refreshTerrain();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          done({ok:true,state:api.snapshot(),renderer:window.GameRenderer?.snapshot?.()||null});
        })().catch(error=>done({ok:false,error:String(error)}));
        """,
        mode,
        float(frame_ms or 0),
        int(samples),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Render-quality evidence action failed: {result}")
    state=result.get("state") or {}
    return (
        f"render-quality:{state.get('mode')}:{state.get('activeLevel')}"
        f":scale={state.get('renderScale')}:dpr={state.get('maxPixelRatio')}"
        f":reason={state.get('lastTransitionReason')}"
    )


def _focus_heightfield_target(driver, kind: str) -> str:
    result = driver.execute_script(
        r"""
        const kind=arguments[0];
        const seed=window.SeedSystem?.getCampaign?.()?.seed;
        if(!seed||!window.GeographyFoundation?.environment||!window.TerrainFoundation?.getTile){
          return {ok:false,reason:'terrain-foundation-unavailable'};
        }
        const elevation=(x,y)=>Number(window.GeographyFoundation.environment(seed,String(x),String(y))?.elevationMeters||0);
        const terrain=(x,y)=>String(window.TerrainFoundation.getTile(seed,String(x),String(y))?.type||'');
        let best=null;
        const consider=(x,y,score,extra={})=>{
          if(!best||score>best.score)best={ok:true,x,y,score,...extra};
        };
        if(kind==='highland'){
          for(let y=-512;y<=512;y+=16)for(let x=-512;x<=512;x+=16){
            const e=elevation(x,y);consider(x,y,e,{elevationMeters:e,type:terrain(x,y)});
          }
        }else if(kind==='rolling'){
          for(let y=-320;y<=320;y+=16)for(let x=-320;x<=320;x+=16){
            const e=elevation(x,y);
            const variation=Math.max(
              Math.abs(elevation(x+16,y)-e),Math.abs(elevation(x-16,y)-e),
              Math.abs(elevation(x,y+16)-e),Math.abs(elevation(x,y-16)-e)
            );
            const type=terrain(x,y);
            if(type!=='water')consider(x,y,variation,{elevationMeters:e,type,variation});
          }
        }else if(kind==='water'){
          for(let y=-144;y<=144;y+=2)for(let x=-144;x<=144;x+=2){
            if(terrain(x,y)!=='water')continue;
            let land=0;
            for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2]])if(terrain(x+dx,y+dy)!=='water')land++;
            consider(x,y,land,{elevationMeters:elevation(x,y),type:'water',landNeighbors:land});
          }
        }else if(kind==='road'){
          for(let y=-144;y<=144;y+=1)for(let x=-144;x<=144;x+=1){
            const type=terrain(x,y);
            if(type!=='road'&&type!=='path'&&type!=='square')continue;
            const e=elevation(x,y);
            const slope=Math.max(Math.abs(elevation(x+4,y)-e),Math.abs(elevation(x,y+4)-e));
            consider(x,y,slope,{elevationMeters:e,type,slope});
          }
        }else if(['dirt','rock','farmland'].includes(kind)){
          const radius=kind==='rock'?2048:256;
          const step=kind==='rock'?8:2;
          search:
          for(let y=-radius;y<=radius;y+=step)for(let x=-radius;x<=radius;x+=step){
            const type=terrain(x,y);
            if(type!==kind)continue;
            let same=0;
            const neighborStep=Math.max(2,step);
            for(const [dx,dy] of [[-neighborStep,0],[neighborStep,0],[0,-neighborStep],[0,neighborStep],[-neighborStep,-neighborStep],[neighborStep,-neighborStep],[-neighborStep,neighborStep],[neighborStep,neighborStep]]){
              if(terrain(x+dx,y+dy)===kind)same++;
            }
            consider(x,y,same,{elevationMeters:elevation(x,y),type,sameTypeNeighbors:same});
            if(kind==='rock'&&same>=6)break search;
          }
        }
        return best||{ok:false,reason:'target-not-found',kind};
        """,
        kind,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Heightfield target {kind!r} not found: {result}")
    action = _set_camera_center_and_render(driver, int(result["x"]), int(result["y"]))
    return f"heightfield-target:{kind}:{result.get('type')}:{result.get('elevationMeters')}+" + action


def _focus_road_profile_target(driver, kind: str) -> str:
    result = driver.execute_script(
        r"""
        const kind=String(arguments[0]||'road');
        const seed=window.SeedSystem?.getCampaign?.()?.seed;
        if(!seed||!window.TerrainFoundation?.getTile||!window.GeographyFoundation?.environment){
          return {ok:false,reason:'terrain-foundation-unavailable'};
        }
        if(kind==='water'&&window.StartingVillage?.direction&&window.StartingVillage?.plan){
          const dir=window.StartingVillage.direction(seed);
          const plan=window.StartingVillage.plan(seed);
          const start=Number(plan?.bridgeWindow?.startTiles||20);
          const length=Math.max(1,Number(plan?.bridgeWindow?.lengthTiles||8));
          for(let forward=start;forward<start+length;forward++){
            for(let lateral=-6;lateral<=6;lateral++){
              const x=forward*Number(dir.dx)-lateral*Number(dir.dy);
              const y=forward*Number(dir.dy)+lateral*Number(dir.dx);
              const type=String(window.TerrainFoundation.getTile(seed,String(x),String(y))?.type||'');
              if(type==='bridge'){
                return {
                  ok:true,x,y,type,score:1000,
                  adjacentNatural:'water-edge+approach-road',
                  gatewayDirection:String(dir.name||''),
                  bridgeStart:start,bridgeLength:length
                };
              }
            }
          }
        }
        if(!window.__wpS003006009RoadTargets||window.__wpS003006009RoadTargets.seed!==seed){
          const terrainCache=new Map(),elevationCache=new Map();
          const terrain=(x,y)=>{
            const key=x+','+y;
            if(!terrainCache.has(key))terrainCache.set(key,String(window.TerrainFoundation.getTile(seed,String(x),String(y))?.type||''));
            return terrainCache.get(key);
          };
          const elevation=(x,y)=>{
            const key=x+','+y;
            if(!elevationCache.has(key))elevationCache.set(key,Number(window.GeographyFoundation.environment(seed,String(x),String(y))?.elevationMeters||0));
            return elevationCache.get(key);
          };
          const roadlike=t=>t==='road'||t==='path'||t==='square';
          const targets={};
          const consider=(name,x,y,score,extra={})=>{
            const distance=Math.abs(x)+Math.abs(y);
            const current=targets[name];
            if(!current||score>current.score||(score===current.score&&distance<current.distance)){
              targets[name]={ok:true,x,y,score,distance,type:terrain(x,y),...extra};
            }
          };
          const radius=160;
          for(let y=-radius;y<=radius;y++){
            for(let x=-radius;x<=radius;x++){
              const type=terrain(x,y);
              if(!roadlike(type))continue;
              const neighbors=[];
              let grass=0,dirtMud=0,water=0,square=type==='square'?4:0;
              for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
                const t=terrain(x+dx,y+dy);
                neighbors.push(t);
                if(t==='grass')grass++;
                if(t==='dirt'||t==='mud')dirtMud++;
                if(t==='water')water++;
                if(t==='square')square++;
              }
              const e=elevation(x,y);
              const slope=Math.max(
                Math.abs(elevation(x+4,y)-e),Math.abs(elevation(x-4,y)-e),
                Math.abs(elevation(x,y+4)-e),Math.abs(elevation(x,y-4)-e)
              );
              if(grass>0)consider('grass',x,y,grass*20+slope,{adjacentNatural:'grass',neighborCount:grass,slope});
              if(dirtMud>0)consider('dirt-mud',x,y,dirtMud*20+slope,{adjacentNatural:'dirt-mud',neighborCount:dirtMud,slope});
              if(water>0)consider('water',x,y,water*24+slope,{adjacentNatural:'water',neighborCount:water,slope});
              consider('rolling',x,y,slope,{slope,elevationMeters:e});
              if(square>0)consider('square',x,y,square*25+slope,{squareNeighbors:square,slope});
              const mx=((x%16)+16)%16,my=((y%16)+16)%16;
              let crossing=false,across=null;
              if(mx===15&&roadlike(terrain(x+1,y))){crossing=true;across=[x+1,y];}
              else if(mx===0&&roadlike(terrain(x-1,y))){crossing=true;across=[x-1,y];}
              else if(my===15&&roadlike(terrain(x,y+1))){crossing=true;across=[x,y+1];}
              else if(my===0&&roadlike(terrain(x,y-1))){crossing=true;across=[x,y-1];}
              if(crossing)consider('chunk-boundary',x,y,100+slope,{across,slope});
            }
          }
          window.__wpS003006009RoadTargets={seed,targets};
        }
        const target=window.__wpS003006009RoadTargets.targets?.[kind]||null;
        return target||{ok:false,reason:'target-not-found',kind,available:Object.keys(window.__wpS003006009RoadTargets.targets||{})};
        """,
        kind,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Road-profile target {kind!r} not found: {result}")
    action = _set_camera_center_and_render(driver, int(result["x"]), int(result["y"]))
    return (
        f"road-profile-target:{kind}:{result.get('type')}:{result.get('x')},{result.get('y')}"
        f":score={result.get('score')}+" + action
    )


def _focus_road_connector(driver, source_kind: str) -> str:
    result = driver.execute_script(
        """
        const source=String(arguments[0]||'house');
        const seed=window.SeedSystem?.getCampaign?.()?.seed;
        if(!seed||!window.HousePlans?.build||!window.SpecialLots?.build){
          return {ok:false,reason:'building-plan-api-unavailable'};
        }
        const candidates=[];
        if(source==='house'){
          for(const plan of window.HousePlans.build(seed)||[]){
            const e=plan?.entrance;
            if(!e?.target)continue;
            candidates.push({
              id:String(plan.id||''),kind:String(plan.kind||'house'),source:'house',
              door:{x:Number(e.x),y:Number(e.y),side:String(e.side||'')},
              target:{x:Number(e.target.x),y:Number(e.target.y)},
              accessLengthTiles:Number(e.accessLengthTiles||0)
            });
          }
        }else{
          for(const lot of window.SpecialLots.build(seed)||[]){
            if(lot?.enterable===false)continue;
            const e=lot?.access;
            if(!e?.target)continue;
            candidates.push({
              id:String(lot.id||''),kind:String(lot.kind||'special'),source:'special',
              door:{x:Number(e.x),y:Number(e.y),side:String(e.side||'')},
              target:{x:Number(e.target.x),y:Number(e.target.y)},
              accessLengthTiles:Number(e.accessLengthTiles||0)
            });
          }
        }
        candidates.sort((a,b)=>
          Number(b.accessLengthTiles||0)-Number(a.accessLengthTiles||0) ||
          String(a.id).localeCompare(String(b.id))
        );
        const best=candidates.find(item=>Number(item.accessLengthTiles||0)>=2)||candidates[0]||null;
        if(!best)return {ok:false,reason:'connector-candidate-not-found',source};
        const centerX=Math.round((best.door.x+best.target.x)/2);
        const centerY=Math.round((best.door.y+best.target.y)/2);
        return {ok:true,...best,centerX,centerY};
        """,
        source_kind,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Road connector target {source_kind!r} not found: {result}")
    action=_set_camera_center_and_render_active(
        driver, int(result["centerX"]), int(result["centerY"]), timeout=30.0
    )
    return (
        f"road-hierarchy-connector:{result.get('source')}:{result.get('id')}:{result.get('kind')}:"
        f"door={result.get('door',{}).get('x')},{result.get('door',{}).get('y')}:"
        f"target={result.get('target',{}).get('x')},{result.get('target',{}).get('y')}:"
        f"length={result.get('accessLengthTiles')}+" + action
    )


def _prepare_multi_character_grounding(driver) -> str:
    """Place real resident movement states on verified walkable village cells for evidence."""
    result = driver.execute_async_script(
        """
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const campaign=window.SeedSystem?.getCampaign?.();
            const movement=window.ResidentMovement;
            const ui=window.AppUI;
            const renderer=window.GameRenderer;
            const camera=window.Camera;
            if(!campaign||!movement?.beginProof||!movement?.proofPlaceResidentsAt||
               !movement?.snapshot||!ui?.refreshTerrain||!ui?.refreshResidentCharacters||
               !renderer?.snapshot||!camera?.setCenter||!camera?.setZoom){
              done({ok:false,error:'multi-character-proof-api-missing'});
              return;
            }

            const started=movement.beginProof(campaign.seed);
            if(!started?.residentId){
              done({ok:false,error:'multi-character-proof-start-failed'});
              return;
            }

            const residentIds=(movement.snapshot()?.residents||[])
              .map(item=>String(item?.residentId||''))
              .filter(Boolean)
              .slice(0,3);
            if(residentIds.length<3){
              done({ok:false,error:'multi-character-proof-residents-missing',residentIds});
              return;
            }

            const used=new Set(['0,0']);
            const anchors=[[-4,0],[4,0],[0,4]];
            const placements=[];
            const classify=(x,y)=>window.InteriorObjects?.classifyNavigation
              ?InteriorObjects.classifyNavigation(campaign.seed,String(x),String(y))
              :window.Walkability?.classify?.(campaign.seed,String(x),String(y));
            for(let index=0;index<anchors.length;index++){
              const [ax,ay]=anchors[index];
              let selected=null;
              for(let radius=0;radius<=5&&!selected;radius++){
                for(let dy=-radius;dy<=radius&&!selected;dy++){
                  for(let dx=-radius;dx<=radius;dx++){
                    if(radius>0&&Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
                    const x=ax+dx,y=ay+dy,key=x+','+y;
                    if(used.has(key)||Math.max(Math.abs(x),Math.abs(y))>9)continue;
                    const nav=classify(x,y);
                    if(nav?.walkable&&!nav?.buildingId){
                      selected={x:String(x),y:String(y)};
                      used.add(key);
                      break;
                    }
                  }
                }
              }
              if(!selected){
                done({ok:false,error:'multi-character-proof-open-cell-missing',anchor:[ax,ay]});
                return;
              }
              placements.push({residentId:residentIds[index],position:selected});
            }

            const placed=movement.proofPlaceResidentsAt(placements,'contact-grounding-flat');
            if(!placed?.residentIds||placed.residentIds.length!==3){
              done({ok:false,error:'multi-character-proof-placement-failed',placements,placed});
              return;
            }

            camera.setCenter('0','0');
            camera.setZoom(1);
            await ui.refreshTerrain();
            await ui.refreshResidentCharacters();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

            const snap=renderer.snapshot?.()||{};
            const chars=snap.characterPresentation||{};
            const ids=chars.visibleCharacterIds||[];
            const visibleResidents=ids.filter(id=>String(id).startsWith('resident:'));
            const ok=chars.visibleProtagonist===true&&visibleResidents.length>=2;
            done({
              ok,
              error:ok?null:'multi-character-proof-not-visible',
              placements,
              visibleIds:ids,
              visibleResidents,
              activeCharacterCount:Number(chars.activeCharacterCount||0),
              center:camera.getCenter?.()||null,
              zoom:Number(camera.getZoom?.()||0),
              simulationAuthorityPreserved:snap.simulationAuthorityPreserved!==false
            });
          }catch(error){done({ok:false,error:String(error?.stack||error)});}
        })();
        """
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Multi-character flat grounding proof failed: {result}")
    if result.get("simulationAuthorityPreserved") is not True:
        raise RuntimeError(f"Multi-character grounding proof lost Simulation authority: {result}")
    return (
        f"grounding-flat-authoritative:residents={len(result.get('visibleResidents') or [])}:"
        f"active={result.get('activeCharacterCount')}"
    )


def _place_npc_on_road_profile_target(driver, kind: str) -> str:
    target_ready = driver.execute_script(
        """
        const seed=window.SeedSystem?.getCampaign?.()?.seed;
        const cache=window.__wpS003006009RoadTargets;
        return Boolean(seed && cache?.seed===seed && cache?.targets?.[String(arguments[0])]);
        """,
        kind,
    )
    if not target_ready:
        # Reuse the deterministic road-profile target discovery so this helper
        # is self-contained in scenarios that did not previously focus a road.
        _focus_road_profile_target(driver, kind)
    result = driver.execute_async_script(
        """
        const kind=String(arguments[0]||'grass');
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const campaign=window.SeedSystem?.getCampaign?.();
            const target=window.__wpS003006009RoadTargets?.targets?.[kind]||null;
            const movement=window.ResidentMovement;
            const ui=window.AppUI;
            const renderer=window.GameRenderer;
            if(!campaign||!target||!movement?.beginProof||!movement?.proofPlaceAt||!ui?.refreshTerrain||!renderer?.snapshot){
              done({ok:false,error:'road-npc-proof-api-or-target-missing',kind,target});
              return;
            }
            const started=movement.beginProof(campaign.seed);
            if(!started?.residentId){
              done({ok:false,error:'road-npc-proof-resident-missing'});
              return;
            }
            const point={x:String(target.x),y:String(target.y)};
            const placed=movement.proofPlaceAt(point,'road-hierarchy-road-proof');
            if(!placed?.position){
              done({ok:false,error:'road-npc-proof-placement-failed',point});
              return;
            }
            window.Camera?.setCenter?.(point.x,point.y);
            await ui.refreshTerrain();
            await ui.refreshResidentCharacters();
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const snap=renderer.snapshot?.()||{};
            const id='resident:'+String(placed.residentId);
            const visible=Boolean((snap.characterPresentation?.visibleCharacterIds||[]).includes(id));
            done({
              ok:visible,
              error:visible?null:'road-npc-proof-resident-not-visible',
              residentId:String(placed.residentId),
              position:placed.position,
              target:{x:Number(target.x),y:Number(target.y),type:String(target.type||'')},
              visible,
              visibleIds:snap.characterPresentation?.visibleCharacterIds||[]
            });
          }catch(error){done({ok:false,error:String(error?.stack||error)});}
        })();
        """,
        kind,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Road NPC proof target {kind!r} failed: {result}")
    return (
        f"road-hierarchy-npc:{kind}:{result.get('residentId')}@"
        f"{result.get('position')}:target={result.get('target')}"
    )


def _set_graphics_quality_mode(driver, mode: str) -> str:
    result = driver.execute_script(
        """
        const mode=String(arguments[0]||'standard');
        const api=window.RuntimeRenderQuality;
        if(!api?.setMode)return {ok:false,reason:'runtime-render-quality-api-missing'};
        const state=api.setMode(mode);
        return {
          ok:true,
          mode:String(state?.mode||''),
          activeLevel:String(state?.activeLevel||''),
          shadowsEnabled:Boolean(state?.shadowsEnabled),
          shadowQuality:String(state?.shadowQuality||'off')
        };
        """,
        mode,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Failed to set graphics quality {mode!r}: {result}")
    return (
        f"graphics-quality:{result.get('mode')}:{result.get('activeLevel')}:"
        f"nativeShadows={str(bool(result.get('shadowsEnabled'))).lower()}"
    )


def _set_material_lifetime_texture_quality(driver, profile: str) -> dict:
    result = driver.execute_async_script(
        """
        const profile=String(arguments[0]);
        const done=arguments[arguments.length-1];
        (async()=>{
          try{
            const quality=window.RuntimeTextureQuality;
            if(!quality?.setProfile||!window.AppUI?.refreshTerrain){
              done({ok:false,error:'texture-quality-api-missing'});
              return;
            }
            const before=window.GameRenderer?.snapshot?.()||{};
            quality.setProfile(profile);
            await Promise.resolve(window.AppUI.refreshTerrain());
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const after=window.GameRenderer?.snapshot?.()||{};
            const generator=after.terrainChunks?.generator||{};
            done({
              ok:true,
              profile:String(quality.snapshot?.()?.qualityProfile||profile),
              buildingGeneration:Number(generator.buildingSurfaceAtlas?.textureGeneration||0),
              treeGeneration:Number(generator.treeSpriteAtlas?.textureGeneration||0),
              buildingRefreshes:Number(generator.buildingSurfaceMaterialRefreshes||0),
              treeRefreshes:Number(generator.treeSpriteMaterialRefreshes||0),
              buildingRetired:Number(generator.buildingSurfaceAtlas?.retiredTextureCount||0),
              treeRetired:Number(generator.treeSpriteAtlas?.retiredTextureCount||0),
              beforeProfile:String(before.materialTextureQuality?.profile||'')
            });
          }catch(error){done({ok:false,error:String(error?.stack||error)})}
        })();
        """,
        str(profile),
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Material lifetime texture-quality transition failed: {result}")
    if result.get("profile") != profile:
        raise RuntimeError(f"Texture-quality profile did not settle to {profile}: {result}")
    return result


def _ensure_texture_quality_profile(driver, profile: str) -> dict:
    current = driver.execute_script(
        "return String(window.RuntimeTextureQuality?.snapshot?.()?.qualityProfile||'')"
    )
    if str(current) == str(profile):
        return {"ok": True, "profile": str(profile), "refreshed": False}
    result = _set_material_lifetime_texture_quality(driver, profile)
    return {**result, "refreshed": True}


def _set_terrain_micro_relief_proof(driver, enabled: bool | None) -> dict:
    value = None if enabled is None else bool(enabled)
    result = driver.execute_script(
        """
        const value=arguments[0];
        const api=window.GameRenderer;
        if(!api?.setTerrainMicroReliefProofState){
          return {ok:false,error:'micro-relief-proof-api-missing'};
        }
        const state=api.setTerrainMicroReliefProofState(value);
        const snap=api.snapshot?.()||{};
        const chunks=snap.terrainChunks||{};
        return {
          ok:true,
          override:state?.override??null,
          enabled:Boolean(chunks.terrainMicroReliefEnabled),
          qualityAllows:Boolean(chunks.terrainMicroReliefQualityAllows),
          profile:String(snap.materialTextureQuality?.profile||'')
        };
        """,
        value,
    )
    if not isinstance(result, dict) or not result.get("ok"):
        raise RuntimeError(f"Terrain micro-relief proof toggle failed: {result}")
    return result


def _material_lifetime_telemetry(driver) -> dict:
    result = driver.execute_script(
        """
        const snap=window.GameRenderer?.snapshot?.()||{};
        const chunks=snap.terrainChunks||{};
        const generator=chunks.generator||{};
        return {
          profile:String(window.RuntimeTextureQuality?.snapshot?.()?.qualityProfile||''),
          cameraCenter:window.Camera?.getCenter?.()||null,
          protagonist:window.RendererContract?.simulationSnapshot?.()?.protagonist||null,
          buildingPresentationCount:Number(chunks.buildingPresentationCount||0),
          treePresentationCount:Number(chunks.treePresentationCount||0),
          buildingTexturedMaterialCount:Number(generator.buildingTexturedMaterialCount||0),
          treeSpriteMaterialCount:Number(generator.treeSpriteMaterialCount||0),
          buildingSurfaceMaterialRebinds:Number(generator.buildingSurfaceMaterialRebinds||0),
          buildingSurfaceMaterialRefreshes:Number(generator.buildingSurfaceMaterialRefreshes||0),
          buildingSurfaceStaleBindingCount:Number(generator.buildingSurfaceStaleBindingCount||0),
          treeSpriteMaterialRebinds:Number(generator.treeSpriteMaterialRebinds||0),
          treeSpriteMaterialRefreshes:Number(generator.treeSpriteMaterialRefreshes||0),
          buildingSurfaceAtlas:generator.buildingSurfaceAtlas||null,
          treeSpriteAtlas:generator.treeSpriteAtlas||null,
          terrainPreload:snap.terrainPreload||null,
          simulationAuthorityPreserved:Boolean(snap.simulationAuthorityPreserved)
        };
        """
    )
    return result if isinstance(result, dict) else {}


def _exercise_material_lifetime(driver) -> str:
    _set_terrain_preload_settings(
        driver, radius=1, cache=16, directional=True, background=True
    )
    _set_camera_center_and_render_active(driver, 0, 0, timeout=20.0)
    _set_material_lifetime_texture_quality(driver, "standard")
    initial = _material_lifetime_telemetry(driver)

    start = time.monotonic()
    visited = []
    quality_events = []
    plan = ((64, 0), (128, 0), (192, 0), (128, 0), (64, 0), (0, 0))
    switched = {"low": False, "high": False, "standard2": False, "high2": False}
    index = 0
    while time.monotonic() - start < 92.0:
        x, y = plan[index % len(plan)]
        _set_camera_center_and_render_active(driver, x, y, timeout=20.0)
        visited.append({"x": x, "y": y, "elapsed": round(time.monotonic() - start, 3)})
        elapsed = time.monotonic() - start
        if elapsed >= 18.0 and not switched["low"]:
            quality_events.append(_set_material_lifetime_texture_quality(driver, "low"))
            switched["low"] = True
        if elapsed >= 42.0 and not switched["high"]:
            quality_events.append(_set_material_lifetime_texture_quality(driver, "high"))
            switched["high"] = True
        if elapsed >= 66.0 and not switched["standard2"]:
            quality_events.append(_set_material_lifetime_texture_quality(driver, "standard"))
            switched["standard2"] = True
        if elapsed >= 84.0 and not switched["high2"]:
            quality_events.append(_set_material_lifetime_texture_quality(driver, "high"))
            switched["high2"] = True
        index += 1
        if time.monotonic() - start < 92.0:
            time.sleep(2.5)

    if not switched["high2"]:
        quality_events.append(_set_material_lifetime_texture_quality(driver, "high"))
        switched["high2"] = True
    _set_camera_center_and_render_active(driver, 0, 0, timeout=20.0)
    visited.append({"x": 0, "y": 0, "elapsed": round(time.monotonic() - start, 3)})
    _set_camera_zoom_and_render(driver, 1.00, timeout=30.0)
    final = _material_lifetime_telemetry(driver)
    elapsed = time.monotonic() - start

    try:
        logs = driver.get_log("browser")
    except Exception:
        logs = []
    graphics_errors = []
    for item in logs:
        message = str(item.get("message") or "").lower() if isinstance(item, dict) else str(item).lower()
        if (
            "context lost" in message or
            "gl_invalid" in message or
            "webgl: invalid" in message or
            ("shader" in message and "error" in message)
        ):
            graphics_errors.append(str(item.get("message") if isinstance(item, dict) else item)[:500])

    non_origin_seen = any(int(item["x"]) != 0 or int(item["y"]) != 0 for item in visited[:-1])
    reentered_origin = non_origin_seen and visited[-1]["x"] == 0 and visited[-1]["y"] == 0
    proof = {
        "elapsedRealSeconds": round(elapsed, 3),
        "visitedCenters": visited,
        "qualityEvents": quality_events,
        "initial": initial,
        "final": final,
        "reenteredOrigin": reentered_origin,
        "graphicsErrorCount": len(graphics_errors),
        "graphicsErrors": graphics_errors,
    }
    driver.execute_script("window.__WP_S003_005_006_PROOF=arguments[0]", proof)
    preload = final.get("terrainPreload") or {}
    return (
        f"material-lifetime:elapsed={elapsed:.1f}s:"
        f"moves={len(visited)}:evictions={int(preload.get('evictions') or 0)}:"
        f"destroys={int(preload.get('resourceDestructions') or 0)}:"
        f"buildingGen={int((final.get('buildingSurfaceAtlas') or {}).get('textureGeneration') or 0)}:"
        f"treeGen={int((final.get('treeSpriteAtlas') or {}).get('textureGeneration') or 0)}"
    )


def _set_minimap_view(
    driver,
    x: int,
    y: int,
    zoom: float,
    *,
    viewport: tuple[int, int] | None = None,
    focus_map: bool = False,
) -> str:
    if viewport:
        driver.set_window_size(int(viewport[0]), int(viewport[1]))
        time.sleep(0.25)
    action = _set_camera_view_and_render_active(driver, int(x), int(y), float(zoom), timeout=45.0)
    result = driver.execute_script(
        """
        const focus=Boolean(arguments[0]);
        window.ResponsiveControlDeck?.drawMiniMap?.();
        if(focus)window.ResponsiveControlDeck?.focusPanel?.('map','keyboard');
        const snap=window.ResponsiveControlDeck?.snapshot?.()?.miniMap||null;
        return snap;
        """,
        bool(focus_map),
    )
    if not isinstance(result, dict) or result.get("ready") is not True:
        raise RuntimeError(f"Mini Map did not reach a prepared renderer-frame state: {result}")
    if result.get("usesPreparedRendererFrame") is not True:
        raise RuntimeError(f"Mini Map used an unexpected terrain source: {result}")
    return (
        f"mini-map:{int(x)},{int(y)}@{float(zoom):.2f}:"
        f"{int(result.get('columns') or 0)}x{int(result.get('rows') or 0)}:"
        f"region={result.get('regionKey')}"
    )


def _run_scenario_step(driver, scenario: str, frame_index: int, base_width: int, base_height: int) -> str:
    if scenario == "wp-s003-005-006":
        if frame_index == 0:
            driver.set_script_timeout(60.0)
            driver.set_window_size(1920, 1080)
            _set_terrain_preload_settings(driver, radius=1, cache=16, directional=True, background=True)
            quality=_set_material_lifetime_texture_quality(driver, "standard")
            driver.execute_script("window.__WP_S003_005_006_PROOF=null")
            return "material-lifetime:baseline+" + _set_camera_center_and_render_active(driver, 0, 0, timeout=20.0) + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=30.0) + f":buildingGen={quality.get('buildingGeneration')}:treeGen={quality.get('treeGeneration')}"
        if frame_index == 1:
            return _exercise_material_lifetime(driver)
        if frame_index == 2:
            return "material-lifetime:post-close+" + _set_camera_center_and_render_active(driver, 0, 0, timeout=20.0) + "+" + _set_camera_zoom_and_render(driver, 2.00, timeout=30.0)
        if frame_index == 3:
            driver.set_window_size(390, 844)
            return "material-lifetime:phone-portrait+" + _set_camera_center_and_render_active(driver, 0, 0, timeout=20.0) + "+" + _set_camera_zoom_and_render(driver, 0.50, timeout=30.0)
        if frame_index == 4:
            driver.set_window_size(844, 390)
            return "material-lifetime:phone-landscape+" + _focus_tree_sample_chunk(driver) + "+" + _set_camera_zoom_and_render(driver, 0.50, timeout=30.0)
        if frame_index == 5:
            driver.set_window_size(1920, 1080)
            time.sleep(0.75)
            return "material-lifetime:return-high+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        driver.set_window_size(1920, 1080)
        time.sleep(0.75)
        quality=_set_material_lifetime_texture_quality(driver, "standard")
        return "material-lifetime:return-standard+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0) + f":buildingGen={quality.get('buildingGeneration')}:treeGen={quality.get('treeGeneration')}"
    if scenario == "wp-s003-007-001":
        if frame_index == 0:
            return _render_quality_step(driver, mode="low", viewport=(1920, 1080))
        if frame_index == 1:
            return _render_quality_step(driver, mode="standard")
        if frame_index == 2:
            return _render_quality_step(driver, mode="high")
        if frame_index == 3:
            return _render_quality_step(driver, mode="auto", viewport=(430, 900))
        if frame_index == 4:
            return _render_quality_step(driver, frame_ms=12.0, samples=360)
        if frame_index == 5:
            return _render_quality_step(driver, frame_ms=40.0, samples=180)
        return "render-quality:no-op"
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
    if scenario == "wp-s003-006-004":
        if frame_index == 0:
            _set_terrain_preload_settings(driver, radius=1, cache=256, directional=True, background=True)
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 1:
            return _set_camera_center_and_render(driver, 2, 0)
        if frame_index == 2:
            return _set_camera_center_and_render(driver, 4, 0)
        if frame_index == 3:
            return _set_camera_center_and_render(driver, 16, 0)
        if frame_index == 4:
            return _set_camera_center_and_render(driver, 32, 0)
        if frame_index == 5:
            return _set_camera_center_and_render(driver, 16, 0)
        if frame_index == 6:
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 7:
            return _set_camera_zoom_and_render(driver, 0.75)
        return _set_camera_zoom_and_render(driver, 1.0)
    if scenario == "wp-s003-006-005":
        if frame_index == 0:
            _set_terrain_preload_settings(driver, radius=1, cache=256, directional=True, background=True)
            return _set_camera_center_and_render(driver, 0, 0)
        if frame_index == 1:
            return _set_camera_center_and_render(driver, 16, 0)
        if frame_index == 2:
            return _set_camera_center_and_render(driver, 32, 0)
        if frame_index == 3:
            return _set_camera_center_and_render(driver, 64, 0)
        if frame_index == 4:
            return _set_camera_center_and_render(driver, 32, 0)
        if frame_index == 5:
            return _set_camera_center_and_render(driver, 0, 0)
        return _set_camera_zoom_and_render(driver, 0.75)
    if scenario == "wp-s003-009-001":
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return "dressing:village-overview+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        if frame_index == 1:
            return _focus_dressing_sample(driver, "residential") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 2:
            return _focus_dressing_sample(driver, "commercial") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 3:
            return _focus_dressing_sample(driver, "farm") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 4:
            return _focus_dressing_sample(driver, None, road_adjacent=True) + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 5:
            return "dressing:quiet-open+" + _set_camera_view_and_render_active(driver, 64, 64, 1.00, timeout=45.0)
        if frame_index == 6:
            driver.set_window_size(390, 844)
            return "dressing:phone-portrait+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        driver.set_window_size(844, 390)
        return "dressing:phone-landscape+" + _focus_dressing_sample(driver, "commercial") + "+" + _set_camera_zoom_and_render(driver, 0.75, timeout=30.0)
    if scenario == "wp-s003-009-005":
        _ensure_texture_quality_profile(driver, "standard")
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return "art-treatment:overview+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        if frame_index == 1:
            return "art-treatment:multi-character+" + _prepare_multi_character_grounding(driver)
        if frame_index == 2:
            return "art-treatment:multi-character-close+" + _set_camera_zoom_and_render(driver, 2.00, timeout=30.0)
        if frame_index == 3:
            return "art-treatment:trees-buildings-east+" + _set_camera_view_and_render_active(driver, 8, 0, 1.00, timeout=45.0)
        if frame_index == 4:
            return "art-treatment:trees-buildings-south+" + _set_camera_view_and_render_active(driver, 0, 8, 1.00, timeout=45.0)
        if frame_index == 5:
            return "art-treatment:wider-village+" + _set_camera_view_and_render_active(driver, 0, 0, 0.50, timeout=45.0)
        if frame_index == 6:
            driver.set_window_size(390, 844)
            return "art-treatment:phone-portrait+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        driver.set_window_size(844, 390)
        return "art-treatment:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
    if scenario == "wp-s003-009-004-002":
        _ensure_texture_quality_profile(driver, "standard")
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return "contour:overview-0.50x+" + _set_camera_view_and_render_active(driver, 0, 0, 0.50, timeout=45.0)
        if frame_index == 1:
            return "contour:origin-1.00x+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        if frame_index == 2:
            return "contour:origin-2.00x+" + _set_camera_view_and_render_active(driver, 0, 0, 2.00, timeout=45.0)
        if frame_index == 3:
            return "contour:road-grass@" + _set_camera_view_and_render_active(driver, 0, 84, 1.00, timeout=45.0)
        if frame_index == 4:
            return "contour:road-dirt-mud@" + _set_camera_view_and_render_active(driver, 15, -1, 1.00, timeout=45.0)
        if frame_index == 5:
            return "contour:square-close@" + _set_camera_view_and_render_active(driver, 0, 0, 2.00, timeout=45.0)
        if frame_index == 6:
            return "contour:chunk-boundary@" + _set_camera_view_and_render_active(driver, 16, 0, 1.00, timeout=45.0)
        driver.set_window_size(844, 390)
        return "contour:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
    if scenario == "wp-s003-009-004-001":
        _ensure_texture_quality_profile(driver, "standard")
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return "surface-identity:overview-0.50x+" + _set_camera_view_and_render_active(driver, 0, 0, 0.50, timeout=45.0)
        if frame_index == 1:
            return "surface-identity:origin-1.00x+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        if frame_index == 2:
            return "surface-identity:origin-2.00x+" + _set_camera_view_and_render_active(driver, 0, 0, 2.00, timeout=45.0)
        if frame_index == 3:
            return "surface-identity:road-grass+" + _focus_road_profile_target(driver, "grass") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=30.0)
        if frame_index == 4:
            return "surface-identity:road-dirt-mud+" + _focus_road_profile_target(driver, "dirt-mud") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=30.0)
        if frame_index == 5:
            return "surface-identity:square-close+" + _focus_road_profile_target(driver, "square") + "+" + _set_camera_zoom_and_render(driver, 2.00, timeout=30.0)
        driver.set_window_size(844, 390)
        return "surface-identity:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
    if scenario == "wp-s003-009-004":
        profiles=("low","standard","high","ultra")
        if frame_index < 4:
            profile=profiles[frame_index]
            quality=_set_material_lifetime_texture_quality(driver, profile)
            return f"material-quality:{profile}:same-camera+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=60.0)
        if frame_index == 4:
            _ensure_texture_quality_profile(driver, "ultra")
            return "material-quality:ultra:close-building+" + _focus_road_connector(driver, "house") + "+" + _set_camera_zoom_and_render(driver, 2.00, timeout=45.0)
        _ensure_texture_quality_profile(driver, "ultra")
        driver.set_window_size(844, 390)
        return "material-quality:ultra:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=60.0)
    if scenario == "wp-s003-009-003":
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return _set_graphics_quality_mode(driver, "standard") + "+grounding:overview+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        if frame_index == 1:
            return "grounding:flat-characters+" + _prepare_multi_character_grounding(driver)
        if frame_index == 2:
            return "grounding:raised-road-npc+" + _place_npc_on_road_profile_target(driver, "grass") + "+" + _set_camera_zoom_and_render(driver, 1.50, timeout=30.0)
        if frame_index == 3:
            return "grounding:building-foundation+" + _focus_road_connector(driver, "house") + "+" + _set_camera_zoom_and_render(driver, 1.25, timeout=30.0)
        if frame_index == 4:
            return "grounding:tree-contact+" + _focus_tree_sample_chunk(driver) + "+" + _set_camera_zoom_and_render(driver, 1.25, timeout=30.0)
        if frame_index == 5:
            return _set_graphics_quality_mode(driver, "high") + "+grounding:high-quality+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        if frame_index == 6:
            return _set_graphics_quality_mode(driver, "low") + "+grounding:low-quality+" + _set_camera_view_and_render_active(driver, 0, 0, 1.00, timeout=45.0)
        if frame_index == 7:
            _set_graphics_quality_mode(driver, "standard")
            driver.set_window_size(390, 844)
            return "grounding:phone-portrait+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        _set_graphics_quality_mode(driver, "standard")
        driver.set_window_size(844, 390)
        return "grounding:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
    if scenario == "wp-s003-009-002":
        if frame_index == 0:
            driver.set_window_size(1280, 800)
            return "road-hierarchy:overview+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
        if frame_index == 1:
            return _focus_road_profile_target(driver, "grass") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 2:
            return _focus_road_profile_target(driver, "dirt-mud") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 3:
            return _focus_road_connector(driver, "house") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=30.0)
        if frame_index == 4:
            return _focus_road_connector(driver, "special") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=30.0)
        if frame_index == 5:
            return _focus_road_profile_target(driver, "square") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 6:
            return _focus_road_profile_target(driver, "rolling") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 7:
            return _focus_road_profile_target(driver, "chunk-boundary") + "+" + _set_camera_zoom_and_render(driver, 1.00, timeout=25.0)
        if frame_index == 8:
            return "road-hierarchy:close+" + _place_npc_on_road_profile_target(driver, "grass") + "+" + _set_camera_zoom_and_render(driver, 2.00, timeout=30.0)
        if frame_index == 9:
            driver.set_window_size(390, 844)
            return "road-hierarchy:phone-portrait+" + _focus_road_connector(driver, "house") + "+" + _set_camera_zoom_and_render(driver, 0.75, timeout=30.0)
        driver.set_window_size(844, 390)
        return "road-hierarchy:phone-landscape+" + _set_camera_view_and_render_active(driver, 0, 0, 0.75, timeout=45.0)
    if scenario == "wp-s003-006-009":
        if frame_index == 0:
            return "road-profile:origin-wide+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 1:
            return _focus_road_profile_target(driver, "grass") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 2:
            return _focus_road_profile_target(driver, "dirt-mud") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 3:
            return _focus_road_profile_target(driver, "water") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 4:
            return _focus_road_profile_target(driver, "rolling") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 5:
            return _focus_road_profile_target(driver, "square") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 6:
            return _focus_road_profile_target(driver, "chunk-boundary") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 7:
            return "road-profile:origin-close+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 2.00)
        if frame_index == 8:
            return "road-profile:origin-standard+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 9:
            driver.set_window_size(390, 844)
            return "road-profile:phone-portrait+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
        driver.set_window_size(844, 390)
        return "road-profile:phone-landscape+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
    if scenario == "wp-s003-006-008":
        pairs=(("road",False),("road",True),("dirt",False),("dirt",True),("rock",False),("rock",True),("farmland",False),("farmland",True))
        if frame_index < len(pairs):
            kind,enabled=pairs[frame_index]
            _ensure_texture_quality_profile(driver, "standard")
            proof=_set_terrain_micro_relief_proof(driver, enabled)
            return (
                f"micro-relief:{kind}:standard:{'on' if enabled else 'off'}+"
                + _focus_heightfield_target(driver, kind)
                + "+"
                + _set_camera_zoom_and_render(driver, 1.00)
            )
        if frame_index == 8:
            _ensure_texture_quality_profile(driver, "low")
            proof=_set_terrain_micro_relief_proof(driver, True)
            return "micro-relief:road:low:quality-gated+" + _focus_heightfield_target(driver, "road") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 9:
            _ensure_texture_quality_profile(driver, "standard")
            proof=_set_terrain_micro_relief_proof(driver, True)
            return "micro-relief:road:standard:close+" + _focus_heightfield_target(driver, "road") + "+" + _set_camera_zoom_and_render(driver, 2.00)
        driver.set_window_size(844, 390)
        _ensure_texture_quality_profile(driver, "standard")
        proof=_set_terrain_micro_relief_proof(driver, True)
        return "micro-relief:road:standard:phone-landscape+" + _focus_heightfield_target(driver, "road") + "+" + _set_camera_zoom_and_render(driver, 1.00)
    if scenario == "wp-s003-006-007":
        if frame_index == 0:
            return "heightfield:origin-wide+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 1:
            return "heightfield:origin-standard+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 2:
            return _focus_heightfield_target(driver, "rolling") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 3:
            return _focus_heightfield_target(driver, "highland") + "+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 4:
            return _focus_heightfield_target(driver, "water") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 5:
            return _focus_heightfield_target(driver, "road") + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 6:
            return "heightfield:chunk-border+" + _set_camera_center_and_render(driver, 16, 0) + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 7:
            return "heightfield:origin-close+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 2.00)
        if frame_index == 8:
            driver.set_window_size(390, 844)
            return "heightfield:phone-portrait+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
        driver.set_window_size(844, 390)
        return "heightfield:phone-landscape+" + _set_camera_center_and_render(driver, 0, 0) + "+" + _set_camera_zoom_and_render(driver, 0.50)
    if scenario == "wp-s003-006-006":
        if frame_index == 0:
            return "tree-planes:origin+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 1:
            focused=_focus_tree_sample_chunk(driver)
            return focused+"+"+_set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 2:
            return "tree-planes:near-far+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 3:
            return _move_camera_relative_active(driver, 16, 0) + "+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 4:
            focused=_focus_tree_sample_chunk(driver)
            return "tree-planes:return+"+focused+"+"+_set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 5:
            driver.set_window_size(390, 844)
            focused=_focus_tree_sample_chunk(driver)
            return "tree-planes:phone-portrait+"+focused+"+"+_set_camera_zoom_and_render(driver, 0.50)
        driver.set_window_size(844, 390)
        focused=_focus_tree_sample_chunk(driver)
        return "tree-planes:phone-landscape+"+focused+"+"+_set_camera_zoom_and_render(driver, 0.50)
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
    if scenario == "wp-s003-004-003":
        return _show_gabled_roof_proof(driver, frame_index)
    if scenario == "wp-s003-004-004":
        return _show_character_billboard_readability_proof(driver, frame_index)
    if scenario == "wp-s003-004-005":
        return _show_character_billboard_readability_proof(driver, frame_index, doubled_scale=True)
    if scenario == "wp-s003-005-003":
        if frame_index == 0:
            return _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 1:
            return _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 2:
            return _set_camera_center_and_render_active(driver, 16, 0)
        if frame_index == 3:
            moved = _set_camera_center_and_render_active(driver, 32, 16)
            return moved + "+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 4:
            driver.set_window_size(390, 844)
            return "phone-portrait+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 5:
            driver.set_window_size(844, 390)
            return "phone-landscape+" + _set_camera_zoom_and_render(driver, 0.50)
        driver.set_window_size(1280, 800)
        returned = _set_camera_center_and_render_active(driver, 0, 0)
        return returned + "+" + _set_camera_zoom_and_render(driver, 1.00)
    if scenario == "wp-s003-005-004":
        if frame_index == 0:
            _set_building_proof_state(driver, "outside")
            return "building-textures:outside+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 1:
            return "building-textures:outside+" + _set_camera_zoom_and_render(driver, 1.00)
        if frame_index == 2:
            return "building-textures:detail+" + _set_camera_zoom_and_render(driver, 2.00)
        if frame_index == 3:
            zoomed=_set_camera_zoom_and_render(driver, 1.00)
            return zoomed+"+"+_set_building_proof_state(driver, "inside")
        if frame_index == 4:
            driver.set_window_size(390, 844)
            _set_building_proof_state(driver, "outside")
            return "building-textures:phone-portrait+" + _set_camera_zoom_and_render(driver, 0.50)
        if frame_index == 5:
            driver.set_window_size(844, 390)
            return "building-textures:phone-landscape+" + _set_camera_zoom_and_render(driver, 0.50)
        driver.set_window_size(1280, 800)
        _set_building_proof_state(driver, "outside")
        return "building-textures:return+" + _set_camera_zoom_and_render(driver, 1.00)
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
    if scenario == "static" or (
        frame_index == 0 and
        scenario not in {"wp-s004-001","wp-s004-002","wp-s004-003","wp-s004-004","wp-s004-004-001","wp-s004-005","wp-s005-001","wp-s005-002","wp-s005-003","wp-s005-004","wp-s005-005","wp-s006-001","wp-s006-002","wp-s006-003","wp-s006-004","wp-s006-005","wp-s006-006","wp-s007-001","wp-s007-002","wp-s007-003"}
    ):
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
    if scenario == "wp-s004-001":
        if frame_index == 0:
            return _show_resident_roster_proof(driver, "top")
        if frame_index == 1:
            return _show_resident_roster_proof(driver, "bottom")
        return _show_resident_roster_proof(driver, "top")
    if scenario == "wp-s004-002":
        if frame_index == 0:
            return _show_resident_assignment_proof(driver, "top")
        if frame_index == 1:
            return _show_resident_assignment_proof(driver, "middle")
        return _show_resident_assignment_proof(driver, "bottom")
    if scenario == "wp-s004-003":
        samples=((2,30),(7,30),(12,30),(19,30))
        hour,minute=samples[min(frame_index,len(samples)-1)]
        return _show_resident_schedule_proof(driver,hour,minute)
    if scenario == "wp-s004-004":
        return _show_resident_movement_proof(driver,frame_index)
    if scenario == "wp-s004-004-001":
        return _show_npc_building_coherence_proof(driver,frame_index)
    if scenario == "wp-s004-005":
        return _show_resident_action_proof(driver,frame_index)
    if scenario == "wp-s005-001":
        if frame_index == 3:
            action=_reload_current_build(driver)
            driver.execute_script("""
                const toggle=document.querySelector('#characterInteractionsToggle');
                if(toggle?.getAttribute('aria-expanded')==='false')toggle.click();
                const body=document.querySelector('#characterInteractionsBody');
                if(body)body.scrollTop=body.scrollHeight;
            """)
            return action+"+advisor-history-scroll"
        return _show_advisor_channel_proof(driver,frame_index)
    if scenario == "wp-s005-002":
        if frame_index == 3:
            action=_reload_current_build(driver)
            return action+"+"+_show_character_memory_proof(driver,frame_index)
        return _show_character_memory_proof(driver,frame_index)
    if scenario == "wp-s005-003":
        return _show_dialogue_context_proof(driver,frame_index)
    if scenario == "wp-s005-004":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_advice_resolution_proof(driver,frame_index)
        return _show_advice_resolution_proof(driver,frame_index)
    if scenario == "wp-s005-005":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_social_state_proof(driver,frame_index)
        return _show_social_state_proof(driver,frame_index)
    if scenario == "wp-s006-001":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_political_geography_proof(driver,frame_index)
        return _show_political_geography_proof(driver,frame_index)
    if scenario == "wp-s006-002":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_country_profile_proof(driver,frame_index)
        return _show_country_profile_proof(driver,frame_index)
    if scenario == "wp-s006-003":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_region_profile_proof(driver,frame_index)
        return _show_region_profile_proof(driver,frame_index)
    if scenario == "wp-s006-004":
        if frame_index == 4:
            action=_reload_current_build(driver)
            return action+"+"+_show_country_relations_proof(driver,frame_index)
        return _show_country_relations_proof(driver,frame_index)
    if scenario == "wp-s006-005":
        if frame_index == 5:
            action=_reload_current_build(driver)
            return action+"+"+_show_settlement_archetype_proof(driver,frame_index)
        return _show_settlement_archetype_proof(driver,frame_index)
    if scenario == "wp-s006-006":
        if frame_index == 5:
            action=_reload_current_build(driver)
            return action+"+"+_show_settlement_building_catalog_proof(driver,frame_index)
        return _show_settlement_building_catalog_proof(driver,frame_index)
    if scenario == "wp-s007-001":
        if frame_index == 5:
            action=_reload_current_build(driver)
            return action+"+"+_show_world_state_proof(driver,frame_index)
        return _show_world_state_proof(driver,frame_index)
    if scenario == "wp-s007-003":
        return _show_simulation_tiers_proof(driver,frame_index)
    if scenario == "wp-s007-004":
        return _show_event_scheduler_proof(driver,frame_index)
    if scenario == "wp-s007-005":
        return _show_global_country_simulation_proof(driver,frame_index)
    if scenario == "wp-s007-006":
        return _show_regional_settlement_simulation_proof(driver,frame_index)
    if scenario == "wp-s007-007":
        return _show_npc_lifecycle_proof(driver,frame_index)
    if scenario == "wp-s007-008":
        return _show_lazy_catchup_proof(driver,frame_index)
    if scenario == "wp-s007-002":
        if frame_index == 5:
            action=_reload_current_build(driver)
            return action+"+"+_show_world_context_proof(driver,frame_index)
        return _show_world_context_proof(driver,frame_index)
    if scenario == "wp-s003-008-003":
        if frame_index == 0:
            return _set_minimap_view(driver, 0, 0, 1.00, viewport=(1440, 900))
        if frame_index == 1:
            return _set_minimap_view(driver, 6, 4, 1.00)
        if frame_index == 2:
            chunk_size = int(driver.execute_script(
                "return Number(window.TerrainChunkSizeSettings?.get?.()?.chunkSize||16)"
            ))
            return _set_minimap_view(driver, chunk_size + 2, 0, 1.00)
        if frame_index == 3:
            return _set_minimap_view(driver, 0, 0, 0.50)
        if frame_index == 4:
            return _set_minimap_view(driver, 0, 0, 1.00)
        if frame_index == 5:
            return _set_minimap_view(driver, 6, 4, 1.00, viewport=(390, 844), focus_map=True)
        if frame_index == 6:
            return _set_minimap_view(driver, 6, 4, 1.00, viewport=(844, 390))
        return _set_minimap_view(driver, 0, 0, 1.00, viewport=(1440, 900))
    if scenario == "wp-s003-008-002":
        if frame_index == 0:
            driver.set_window_size(1440, 900)
            return _set_scene_loading_proof(driver, "renderer")
        if frame_index == 1:
            return _set_scene_loading_proof(driver, "world")
        if frame_index == 2:
            return _set_scene_loading_proof(driver, "assets")
        if frame_index == 3:
            return _set_scene_loading_proof(driver, "finalizing")
        if frame_index == 4:
            return _set_scene_loading_proof(driver, None)
        if frame_index == 5:
            return _set_scene_loading_proof(driver, "error")
        if frame_index == 6:
            driver.set_window_size(390, 844)
            return "phone-portrait+" + _set_scene_loading_proof(driver, "world")
        if frame_index == 7:
            driver.set_window_size(844, 390)
            return "phone-landscape+" + _set_scene_loading_proof(driver, "assets")
        driver.set_window_size(1280, 800)
        return "reduced-motion+" + _set_scene_loading_proof(driver, "finalizing", reduced_motion=True)
    if scenario == "wp-s003-008-001":
        actions = {
            1: lambda: _drag_canvas(driver, -120, 0),
            2: lambda: _drag_canvas(driver, 120, 0),
            3: lambda: _drag_canvas(driver, 0, -120),
            4: lambda: _drag_canvas(driver, 0, 120),
            5: lambda: _keyboard_camera(driver, "arrowleft"),
            6: lambda: _keyboard_camera(driver, "arrowright"),
            7: lambda: _keyboard_camera(driver, "arrowup"),
            8: lambda: _keyboard_camera(driver, "arrowdown"),
            9: lambda: _keyboard_camera(driver, "a"),
            10: lambda: _keyboard_camera(driver, "d"),
            11: lambda: _keyboard_camera(driver, "w"),
            12: lambda: _keyboard_camera(driver, "s"),
            13: lambda: _keyboard_camera(driver, "arrowup", "arrowleft"),
            14: lambda: _keyboard_camera(driver, "s", "d"),
            15: lambda: _touch_drag_canvas(driver, -120, 0),
        }
        action = actions.get(frame_index)
        return action() if action else "screen-navigation:initial"
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
    if scenario == "wp-s003-005-006":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-005-006 requires seven sustained material-lifetime evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:7]]
        gpus=[build.get("gpuRenderer") or {} for build in builds]
        chunks=[gpu.get("terrainChunks") or {} for gpu in gpus]
        generators=[chunk.get("generator") or {} for chunk in chunks]
        preloads=[gpu.get("terrainPreload") or {} for gpu in gpus]
        protagonist_locations=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Material-lifetime exercise changed protagonist authority: {protagonist_locations}")

        proof=gpus[1].get("materialLifetimeProof") or {}
        if float(proof.get("elapsedRealSeconds") or 0)<90.0:
            raise RuntimeError(f"Sustained runtime did not reach 90 seconds: {proof}")
        if proof.get("reenteredOrigin") is not True:
            raise RuntimeError(f"Chunk active-set leave/re-entry was not proven: {proof}")
        profiles=[str(item.get("profile") or "") for item in proof.get("qualityEvents") or []]
        if not {"low","standard","high"}.issubset(set(profiles)):
            raise RuntimeError(f"Texture-quality lifecycle was not exercised across low/standard/high: {profiles}")
        if int(proof.get("graphicsErrorCount") or 0)!=0:
            raise RuntimeError(f"WebGL/shader errors occurred during sustained material lifecycle: {proof.get('graphicsErrors')}")
        initial=proof.get("initial") or {}
        final=proof.get("final") or {}
        initial_preload=initial.get("terrainPreload") or {}
        final_preload=final.get("terrainPreload") or {}
        if int(final_preload.get("resourceDestructions") or 0)<=int(initial_preload.get("resourceDestructions") or 0):
            raise RuntimeError(f"Chunk resource destruction/cleanup was not exercised: initial={initial_preload}, final={final_preload}")
        if int(final_preload.get("evictions") or 0)<=int(initial_preload.get("evictions") or 0):
            raise RuntimeError(f"Chunk cache eviction was not exercised: initial={initial_preload}, final={final_preload}")

        building_frames=0
        tree_frames=0
        for index,(gpu,chunk,generator,preload) in enumerate(zip(gpus,chunks,generators,preloads),start=1):
            if gpu.get("simulationAuthorityPreserved") is not True or chunk.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Material lifetime changed Simulation authority in frame {index}: {gpu}")
            building=generator.get("buildingSurfaceAtlas") or {}
            tree=generator.get("treeSpriteAtlas") or {}
            if building.get("ready") is not True or int(building.get("gpuTextureCount") or 0)!=1:
                raise RuntimeError(f"Building atlas unavailable in frame {index}: {building}")
            if tree.get("ready") is not True or int(tree.get("gpuTextureCount") or 0)!=1:
                raise RuntimeError(f"Tree atlas unavailable in frame {index}: {tree}")
            if int(building.get("retiredTextureCount") or 0)!=0 or int(tree.get("retiredTextureCount") or 0)!=0:
                raise RuntimeError(f"Retired shared textures leaked after rebind in frame {index}: building={building}, tree={tree}")
            if int(generator.get("buildingSurfaceStaleBindingCount") or 0)!=0:
                raise RuntimeError(f"Stale building atlas binding detected in frame {index}: {generator}")
            building_sig=str(building.get("signature") or "")
            for signature in generator.get("buildingSurfaceMaterialAtlasSignatures") or []:
                if signature!=building_sig:
                    raise RuntimeError(f"Building material references a stale atlas generation in frame {index}: {generator}")
            tree_sig=str(tree.get("signature") or "")
            for signature in generator.get("treeSpriteMaterialAtlasSignatures") or []:
                if signature!=tree_sig:
                    raise RuntimeError(f"Tree material references a stale atlas generation in frame {index}: {generator}")
            if int(building.get("frameDecodeCount") or 0)!=0 or int(building.get("frameRasterizeCount") or 0)!=0:
                raise RuntimeError(f"Building atlas work leaked into frame path in frame {index}: {building}")
            if int(tree.get("frameDecodeCount") or 0)!=0 or int(tree.get("frameRasterizeCount") or 0)!=0:
                raise RuntimeError(f"Tree atlas work leaked into frame path in frame {index}: {tree}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame asset work detected in frame {index}: {preload}")
            building_frames+=int(chunk.get("buildingPresentationCount") or 0)>0
            tree_frames+=int(chunk.get("treePresentationCount") or 0)>0

        post_generator=generators[1]
        initial_building=initial.get("buildingSurfaceAtlas") or {}
        initial_tree=initial.get("treeSpriteAtlas") or {}
        post_building=post_generator.get("buildingSurfaceAtlas") or {}
        post_tree=post_generator.get("treeSpriteAtlas") or {}
        if int(post_building.get("textureGeneration") or 0)<=int(initial_building.get("textureGeneration") or 0):
            raise RuntimeError(f"Building atlas generation did not advance during quality lifecycle: initial={initial_building}, post={post_building}")
        if int(post_tree.get("textureGeneration") or 0)<=int(initial_tree.get("textureGeneration") or 0):
            raise RuntimeError(f"Tree atlas generation did not advance during quality lifecycle: initial={initial_tree}, post={post_tree}")
        if int(post_generator.get("buildingSurfaceMaterialRefreshes") or 0)<=0 or int(post_generator.get("treeSpriteMaterialRefreshes") or 0)<=0:
            raise RuntimeError(f"Shared material refresh paths were not exercised: {post_generator}")
        if int(post_building.get("textureDestructions") or 0)<=0 or int(post_tree.get("textureDestructions") or 0)<=0:
            raise RuntimeError(f"Superseded shared textures were not released after safe rebind: building={post_building}, tree={post_tree}")
        if building_frames<5 or tree_frames<2:
            raise RuntimeError(f"Insufficient visible building/tree coverage in sustained evidence: buildings={building_frames}, trees={tree_frames}")

        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:7]]
        if int(viewports[3].get("height") or 0)<=int(viewports[3].get("width") or 0):
            raise RuntimeError(f"Phone portrait sustained-runtime evidence missing: {viewports[3]}")
        if int(viewports[4].get("width") or 0)<=int(viewports[4].get("height") or 0):
            raise RuntimeError(f"Phone landscape sustained-runtime evidence missing: {viewports[4]}")
        return

    if scenario == "wp-s003-009-001":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-009-001 requires eight village-dressing evidence frames")
        expected_zooms=("0.75×","1.00×","1.00×","1.00×","1.00×","1.00×","0.75×","0.75×")
        protagonist_locations=[]
        contexts=set()
        semantics=set()
        max_dressing=0
        for index,frame in enumerate(frames[:8]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            preload=gpu.get("terrainPreload") or {}
            characters=gpu.get("characterPresentation") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Dressing zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Dressing presentation changed Simulation authority in frame {index+1}: {gpu}")
            if chunks.get("dressingDeterministic") is not True or chunks.get("dressingRendererOnly") is not True:
                raise RuntimeError(f"Dressing determinism/renderer-only contract missing in frame {index+1}: {chunks}")
            if chunks.get("dressingHardwareInstanced") is not True or chunks.get("hardwareInstancing") is not True or chunks.get("frustumCulling") is not True:
                raise RuntimeError(f"Dressing instancing/culling contract missing in frame {index+1}: {chunks}")
            count=int(chunks.get("dressingPresentationCount") or 0)
            max_dressing=max(max_dressing,count)
            if count>0:
                if int(chunks.get("dressingRouteSafeCount") or 0)!=count or chunks.get("dressingRouteProtectionPass") is not True:
                    raise RuntimeError(f"Dressing route protection failed in frame {index+1}: {chunks}")
                if int(chunks.get("dressingInstancedGroupCount") or 0)<=0:
                    raise RuntimeError(f"No dressing instanced groups in frame {index+1}: {chunks}")
                if int(chunks.get("dressingPrimitiveInstanceCount") or 0)<count:
                    raise RuntimeError(f"Dressing primitive count is below descriptor count in frame {index+1}: {chunks}")
            if int(chunks.get("dressingSharedMaterialCount") or 0)>8:
                raise RuntimeError(f"Dressing material reuse is not bounded in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame dressing asset work detected in frame {index+1}: {preload}")
            if chunks.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Dressing introduced per-tile entities in frame {index+1}: {chunks}")
            for key,value in (chunks.get("dressingContextCounts") or {}).items():
                if int(value or 0)>0:contexts.add(str(key))
            for key,value in (chunks.get("dressingSemanticCounts") or {}).items():
                if int(value or 0)>0:semantics.add(str(key))
            protagonist_locations.append(build.get("protagonistLocation"))
        if max_dressing < 12:
            raise RuntimeError(f"Village dressing evidence is too sparse: max descriptors={max_dressing}")
        required_contexts={"residential","commercial","farm","civic"}
        if not required_contexts.issubset(contexts):
            raise RuntimeError(f"Dressing context coverage incomplete: contexts={sorted(contexts)}")
        if len(semantics)<8:
            raise RuntimeError(f"Dressing semantic variety too low: semantics={sorted(semantics)}")
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Dressing camera evidence changed protagonist authority: {protagonist_locations}")
        actions=[str(frame.get("action") or "") for frame in frames[:8]]
        for required in (
            "dressing-focus:residential",
            "dressing-focus:commercial",
            "dressing-focus:farm",
            "road=true",
            "dressing:quiet-open",
        ):
            if not any(required in action for action in actions):
                raise RuntimeError(f"Required dressing scene {required} missing: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:8]]
        if int(viewports[6].get("height") or 0)<=int(viewports[6].get("width") or 0):
            raise RuntimeError(f"Phone portrait dressing evidence missing: {viewports[6]}")
        if int(viewports[7].get("width") or 0)<=int(viewports[7].get("height") or 0):
            raise RuntimeError(f"Phone landscape dressing evidence missing: {viewports[7]}")
        return

    if scenario == "wp-s003-009-005":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-009-005 requires eight unified-art evidence frames")
        max_active=0
        for index,frame in enumerate(frames[:8]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            style=gpu.get("worldVisualStyle") or {}
            treatment=style.get("spriteTreatment") or {}
            character=treatment.get("character") or {}
            tree=treatment.get("tree") or {}
            chars=gpu.get("characterPresentation") or {}
            chunks=gpu.get("terrainChunks") or {}
            perf=style.get("performance") or {}
            if style.get("signature")!="living-world-style-v3":
                raise RuntimeError(f"Unified art style signature missing in frame {index+1}: {style.get('signature')}")
            if character.get("role")!="character-accent" or tree.get("role")!="vegetation-midground":
                raise RuntimeError(f"Unified sprite roles missing in frame {index+1}: {treatment}")
            if float(character.get("alphaTest") or 0)<0.12 or float(tree.get("alphaTest") or 0)<0.12:
                raise RuntimeError(f"Unified alpha-edge treatment missing in frame {index+1}: {treatment}")
            if treatment.get("sharedMaterialOnly") is not True or treatment.get("destructiveAssetRewrite") is not False:
                raise RuntimeError(f"Unified treatment architecture invalid in frame {index+1}: {treatment}")
            if perf.get("postProcessing") is not False or perf.get("perObjectShaders") is not False or int(perf.get("extraLights") or 0)!=0:
                raise RuntimeError(f"Unified art treatment added expensive rendering in frame {index+1}: {perf}")
            if int(chars.get("sharedMaterialCount") or 0)>int(chars.get("sharedTextureCount") or 0)+1:
                raise RuntimeError(f"Character material sharing regressed in frame {index+1}: {chars}")
            if int(chunks.get("treeSpriteMaterialCount") or 0)>2 or int(chunks.get("treeSharedTextureCount") or 0)>1:
                raise RuntimeError(f"Tree shared material/texture budget regressed in frame {index+1}: {chunks}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Unified art treatment changed Simulation authority in frame {index+1}")
            max_active=max(max_active,int(chars.get("activeCharacterCount") or 0))
        if max_active<3:
            raise RuntimeError(f"Unified art evidence did not show protagonist plus several characters: max active={max_active}")
        portrait=frames[6].get("runtime",{}).get("viewport",{})
        landscape=frames[7].get("runtime",{}).get("viewport",{})
        if int(portrait.get("height") or 0)<=int(portrait.get("width") or 0):
            raise RuntimeError(f"Phone portrait unified-art evidence missing: {portrait}")
        if int(landscape.get("width") or 0)<=int(landscape.get("height") or 0):
            raise RuntimeError(f"Phone landscape unified-art evidence missing: {landscape}")
        return

    if scenario == "wp-s003-009-004-002":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-009-004-002 requires eight contour evidence frames")
        expected_zooms=("0.50×","1.00×","2.00×","1.00×","1.00×","2.00×","1.00×","1.00×")
        max_patches=0
        max_triangles=0
        edge_keys=0
        for index,frame in enumerate(frames[:8]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Contour zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if chunks.get("contourAlgorithm")!="categorical-marching-corners-rounded-fan":
                raise RuntimeError(f"Contour algorithm missing in frame {index+1}: {chunks.get('contourAlgorithm')}")
            per_frame_regen=chunks.get("contourPerFrameRegenerationCount")
            if chunks.get("contourPreparationOnly") is not True or per_frame_regen is None or int(per_frame_regen)!=0:
                raise RuntimeError(f"Contour preparation contract failed in frame {index+1}: {chunks}")
            radius=float(chunks.get("contourRoundRadiusTiles") or 0)
            deviation=float(chunks.get("contourMaxBoundaryDeviationTiles") or 0)
            band=float(chunks.get("contourTransitionBandWidthTiles") or 0)
            if not (0 < radius <= 0.5 and 0 < deviation <= 0.5 and 0 < band <= 0.5):
                raise RuntimeError(f"Contour deviation/band is not bounded in frame {index+1}: radius={radius}, deviation={deviation}, band={band}")
            added_draw_calls=chunks.get("contourDrawCallsAdded")
            added_materials=chunks.get("contourMaterialCountAdded")
            if added_draw_calls is None or added_materials is None or int(added_draw_calls)!=0 or int(added_materials)!=0:
                raise RuntimeError(f"Contour smoothing added draw calls/materials in frame {index+1}: {chunks}")
            if chunks.get("contourCanonicalCornerOwnership") is not True or chunks.get("contourSharedEdgeEquality") is not True:
                raise RuntimeError(f"Contour shared-edge continuity failed in frame {index+1}: {chunks}")
            if chunks.get("contourTileCentersPreserved") is not True or chunks.get("contourAlphaBlend") is not False:
                raise RuntimeError(f"Contour tile-center/alpha contract failed in frame {index+1}: {chunks}")
            if chunks.get("oneEntityPerTile") is not False or gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Contour smoothing changed bounded rendering or Simulation authority in frame {index+1}")
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Visible-frame contour/terrain rebuild detected in frame {index+1}: {chunks.get('visibleFrameTerrainRebuildCount')}")
            max_patches=max(max_patches,int(chunks.get("contourPatchCount") or 0))
            max_triangles=max(max_triangles,int(chunks.get("contourAddedTriangleCount") or 0))
            edge_keys=max(edge_keys,int(chunks.get("contourSharedEdgeKeyCount") or 0))
        if max_patches<=0 or max_triangles<=0:
            raise RuntimeError(f"No prepared contour geometry was evidenced: patches={max_patches}, triangles={max_triangles}")
        if edge_keys<=0:
            raise RuntimeError("No chunk-edge contour ownership evidence was observed")
        phone=frames[7].get("runtime",{}).get("viewport",{})
        if int(phone.get("width") or 0)<=int(phone.get("height") or 0):
            raise RuntimeError(f"Phone-landscape contour evidence missing: {phone}")
        return

    if scenario == "wp-s003-009-004-001":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-009-004-001 requires seven terrain-surface evidence frames")
        expected_zooms=("0.50×","1.00×","2.00×","1.00×","1.00×","2.00×","1.00×")
        required_surfaces=("grass","dirt","road","path","square")
        for index,frame in enumerate(frames[:7]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            atlas=chunks.get("textureAtlas") or {}
            report=chunks.get("surfaceDebugReport") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Surface identity zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if chunks.get("surfaceIdentityMode")!="semantic-atlas-per-logical-tile":
                raise RuntimeError(f"Semantic terrain identity mode missing in frame {index+1}: {chunks.get('surfaceIdentityMode')}")
            if chunks.get("terrainSurfaceMode")!="semantic-atlas-per-logical-tile+uv1-normal-detail":
                raise RuntimeError(f"Terrain surface mode mismatch in frame {index+1}: {chunks.get('terrainSurfaceMode')}")
            if chunks.get("indexedSemanticQuads") is not True or chunks.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Terrain topology violated bounded chunk rendering in frame {index+1}: {chunks}")
            if int(chunks.get("colorFallbackBlockCount") or 0)!=0:
                raise RuntimeError(f"Visible/prepared terrain fell back to color-only blocks in frame {index+1}: {chunks.get('colorFallbackBlockCount')}")
            if int(chunks.get("routeSurfaceStaleBindingCount") or 0)!=0:
                raise RuntimeError(f"Stale route atlas binding in frame {index+1}: {chunks.get('routeSurfaceStaleBindingCount')}")
            if atlas.get("semanticSurfaceAtlas") is not True or atlas.get("atlasMipmaps") is not False:
                raise RuntimeError(f"Semantic terrain atlas sampling contract failed in frame {index+1}: {atlas}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Terrain surface presentation changed Simulation authority in frame {index+1}")
            for surface in required_surfaces:
                row=report.get(surface) or {}
                if row.get("authoritativeSurfaceId")!=surface:
                    raise RuntimeError(f"Missing authoritative surface debug row for {surface}: {row}")
                if row.get("diffuseTextureKey")!=f"tile:{surface}":
                    raise RuntimeError(f"Wrong texture key for {surface}: {row}")
                if row.get("textureBound") is not True or int(row.get("textureWidth") or 0)<=0 or int(row.get("textureHeight") or 0)<=0:
                    raise RuntimeError(f"Surface texture is not actually bound for {surface}: {row}")
                if int(row.get("atlasCellResolution") or 0)<=0:
                    raise RuntimeError(f"Surface atlas cell resolution missing for {surface}: {row}")
                uv=row.get("uvScale") or []
                if len(uv)!=2 or min(float(v) for v in uv)<=0:
                    raise RuntimeError(f"Surface UV scale invalid for {surface}: {row}")
                tint=row.get("tint") or []
                if len(tint)!=3 or min(float(v) for v in tint)<=0:
                    raise RuntimeError(f"Surface tint invalid for {surface}: {row}")
                if tuple(float(v) for v in (row.get("blendWeightRange") or []))!=(1.0,1.0):
                    raise RuntimeError(f"Surface interior blend weight is not opaque for {surface}: {row}")
                if abs(float(row.get("opacity") or 0)-1.0)>1e-6:
                    raise RuntimeError(f"Surface opacity is not 1 for {surface}: {row}")
                if row.get("qualityProfile")!="standard" or not row.get("materialCacheSignature"):
                    raise RuntimeError(f"Surface quality/cache evidence missing for {surface}: {row}")
        phone=frames[6].get("runtime",{}).get("viewport",{})
        if int(phone.get("width") or 0)<=int(phone.get("height") or 0):
            raise RuntimeError(f"Phone-landscape terrain-surface evidence missing: {phone}")
        return

    if scenario == "wp-s003-009-004":
        if len(frames) < 6:
            raise RuntimeError("wp-s003-009-004 requires six material-quality evidence frames")
        expected_profiles=("low","standard","high","ultra")
        expected={
            "low":(16,64,192),
            "standard":(32,128,256),
            "high":(64,256,320),
            "ultra":(128,512,384),
        }
        protagonist_locations=[]
        camera_coordinates=[]
        signatures=[]
        for index,frame in enumerate(frames[:4]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            generator=chunks.get("generator") or {}
            terrain=chunks.get("textureAtlas") or {}
            building=chunks.get("buildingSurfaceAtlas") or generator.get("buildingSurfaceAtlas") or {}
            tree=chunks.get("treeSpriteAtlas") or generator.get("treeSpriteAtlas") or {}
            mq=gpu.get("materialTextureQuality") or {}
            profile=expected_profiles[index]
            if str(mq.get("profile") or "")!=profile:
                raise RuntimeError(f"Effective renderer profile mismatch in frame {index+1}: {mq}")
            want=expected[profile]
            actual=(int(terrain.get("runtimeResolution") or 0),int(building.get("runtimeResolution") or 0),int(tree.get("runtimeWidth") or 0))
            if actual!=want:
                raise RuntimeError(f"Bound texture dimensions mismatch for {profile}: expected={want}, actual={actual}")
            if int(generator.get("buildingMaterialVariantPaletteSize") or 0)!=4:
                raise RuntimeError(f"Building material palette is not bounded to four variants: {generator}")
            if int(generator.get("buildingMaterialVariantCount") or 0)<2:
                raise RuntimeError(f"Visible/prepared settlement did not demonstrate material variation: {generator}")
            if int(generator.get("buildingMaterialVariantMaterialCount") or 0)>int(generator.get("buildingMaterialVariantMaterialBudget") or 16):
                raise RuntimeError(f"Building material variant budget exceeded: {generator}")
            if generator.get("buildingMaterialVariationDeterministic") is not True:
                raise RuntimeError(f"Building material variation is not deterministic: {generator}")
            if int(generator.get("buildingSurfaceStaleBindingCount") or 0)!=0:
                raise RuntimeError(f"Stale building material binding in {profile}: {generator}")
            if building.get("sharedSurfaceTextures") is not True or int(building.get("gpuTextureCount") or 0)!=4:
                raise RuntimeError(f"Building shared surface-texture budget mismatch in {profile}: {building}")
            if str(building.get("uvPolicy") or "")!="full-texture-0-1":
                raise RuntimeError(f"Building UV policy mismatch in {profile}: {building}")
            bindings=generator.get("buildingSurfaceVariantBindings") or []
            if len(bindings)<8:
                raise RuntimeError(f"Building runtime binding evidence is incomplete in {profile}: {bindings}")
            for binding in bindings:
                if not str(binding.get("textureName") or ""):
                    raise RuntimeError(f"Building material has no bound texture in {profile}: {binding}")
                if (int(binding.get("textureWidth") or 0),int(binding.get("textureHeight") or 0))!=(want[1],want[1]):
                    raise RuntimeError(f"Building material texture size mismatch in {profile}: {binding}")
                scale=tuple(float(v) for v in (binding.get("uvScale") or []))
                offset=tuple(float(v) for v in (binding.get("uvOffset") or []))
                if scale!=(1.0,1.0) or offset!=(0.0,0.0):
                    raise RuntimeError(f"Building material is not bound to full standalone UVs in {profile}: {binding}")
                tint=tuple(float(v) for v in (binding.get("tint") or []))
                if len(tint)!=3 or min(tint)<=0.0:
                    raise RuntimeError(f"Building material tint evidence is invalid in {profile}: {binding}")
            pixel_stats=building.get("surfacePixelStats") or {}
            for surface_key in ("building:house-wall","building:special-wall","building:roof","building:door"):
                sample=pixel_stats.get(surface_key) or {}
                if int(sample.get("sampleCount") or 0)<=0 or not str(sample.get("checksum") or ""):
                    raise RuntimeError(f"Missing pre-upload building pixel proof for {surface_key} in {profile}: {pixel_stats}")
                if float(sample.get("averageLuminance") or 0)<=20:
                    raise RuntimeError(f"Pre-upload building surface is unexpectedly dark for {surface_key} in {profile}: {sample}")
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Quality switch rebuilt terrain in visible frame for {profile}: {chunks}")
            if gpu.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Quality switch changed Simulation authority for {profile}: {gpu}")
            protagonist_locations.append(build.get("protagonistLocation"))
            camera_coordinates.append(build.get("cameraCoordinate"))
            signatures.append(str(mq.get("cacheSignature") or terrain.get("signature") or ""))
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Texture-quality cycle changed protagonist authority: {protagonist_locations}")
        if len(set(camera_coordinates))!=1 or not camera_coordinates[0]:
            raise RuntimeError(f"Low/Standard/High/Ultra were not captured at the same camera: {camera_coordinates}")
        if len(set(signatures))!=4:
            raise RuntimeError(f"Quality profiles did not produce distinct cache signatures: {signatures}")
        ultra=frames[3].get("runtime",{}).get("currentBuild",{}).get("gpuRenderer",{})
        ug=(ultra.get("terrainChunks") or {}).get("generator") or {}
        samples=ug.get("buildingMaterialVariantSamples") or []
        if len({int(item.get("variantIndex") or 0) for item in samples})<2:
            raise RuntimeError(f"Ultra building variant samples do not demonstrate deterministic variety: {samples}")
        phone=frames[5].get("runtime",{}).get("viewport",{})
        if int(phone.get("width") or 0)<=int(phone.get("height") or 0):
            raise RuntimeError(f"Phone-landscape material evidence missing: {phone}")
        return

    if scenario == "wp-s003-009-003":
        if len(frames) < 9:
            raise RuntimeError("wp-s003-009-003 requires nine contact-shadow grounding evidence frames")
        expected_zooms=("0.75×","1.00×","1.50×","1.25×","1.25×","1.00×","1.00×","0.75×","0.75×")
        protagonist_locations=[]
        saw_multiple_characters=False
        saw_building_contacts=False
        saw_tree_contacts=False
        saw_raised_character=False
        max_static_shadow_draws=0
        max_frame_ms=0.0
        quality_opacity={}
        for index,frame in enumerate(frames[:9]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            chars=gpu.get("characterPresentation") or {}
            grounding=gpu.get("contactGrounding") or {}
            preload=gpu.get("terrainPreload") or {}
            quality=gpu.get("quality") or {}
            perf=gpu.get("performance") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Grounding zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Contact-shadow grounding changed Simulation authority in frame {index+1}: {gpu}")
            if chunks.get("contactShadowStaticPass") is not True or chunks.get("contactShadowRendererOnly") is not True:
                raise RuntimeError(f"Static contact-shadow contract failed in frame {index+1}: {chunks}")
            if chunks.get("contactShadowTerrainSampled") is not True:
                raise RuntimeError(f"Static contacts are not terrain-grounded in frame {index+1}: {chunks}")
            if int(chunks.get("contactShadowMaterialCount") or 0)<=0 or int(chunks.get("contactShadowMaterialCount") or 0)>2:
                raise RuntimeError(f"Static contact-shadow material count is not bounded in frame {index+1}: {chunks}")
            if int(chunks.get("contactShadowBuildingCount") or 0)>0:saw_building_contacts=True
            if int(chunks.get("contactShadowTreeCount") or 0)>0:saw_tree_contacts=True
            max_static_shadow_draws=max(max_static_shadow_draws,int(chunks.get("contactShadowDrawCalls") or 0))
            count=int(chars.get("contactShadowCount") or 0)
            active=int(chars.get("activeCharacterCount") or 0)
            action=str(frame.get("action") or "")
            object_only=any(tag in action for tag in ("grounding:tree-contact","grounding:building-foundation"))
            if count!=active:
                raise RuntimeError(f"Character contact-shadow count does not match visible characters in frame {index+1}: active={active}, shadows={count}")
            if not object_only and count<=0:
                raise RuntimeError(f"Character-focused grounding frame has no visible character contacts in frame {index+1}: {action}")
            expected_draw_calls=1 if active>0 else 0
            if chars.get("contactShadowHardwareInstanced") is not True or int(chars.get("contactShadowDrawCalls") or 0)!=expected_draw_calls:
                raise RuntimeError(f"Character contacts do not use the expected shared instanced draw count in frame {index+1}: active={active}, expectedDrawCalls={expected_draw_calls}, state={chars}")
            if active>0 and chars.get("contactShadowFeetCoordinateAnchored") is not True:
                raise RuntimeError(f"Visible character contacts lost authoritative feet-coordinate anchoring in frame {index+1}: {chars}")
            if int(chars.get("contactShadowTerrainAlignedCount") or 0)!=count:
                raise RuntimeError(f"Character contacts are not terrain-aligned in frame {index+1}: {chars}")
            if chars.get("contactShadowTerrainGroundSampler")!="indexed-triangle-exact":
                raise RuntimeError(f"Character contacts use the wrong terrain sampler in frame {index+1}: {chars}")
            if float(chars.get("contactShadowGroundLift") or 0)<=0 or float(chars.get("contactShadowGroundLift") or 0)>0.05:
                raise RuntimeError(f"Character contact lift is detached/excessive in frame {index+1}: {chars}")
            if int(chars.get("contactShadowMaterialCount") or 0)!=1:
                raise RuntimeError(f"Character contact-shadow material is not shared in frame {index+1}: {chars}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Contact grounding triggered visible-frame asset work in frame {index+1}: {preload}")
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Contact grounding triggered visible-frame terrain rebuilds in frame {index+1}: {chunks}")
            if chunks.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Contact grounding introduced one-entity-per-tile rendering in frame {index+1}: {chunks}")
            if quality.get("shadowsEnabled") is not False or str(quality.get("shadowQuality") or "off")!="off":
                raise RuntimeError(f"Contact grounding accidentally enabled dynamic shadow maps in frame {index+1}: {quality}")
            if "grounding:flat-characters" in action:
                visible_ids=[str(value) for value in (chars.get("visibleCharacterIds") or [])]
                resident_visible=sum(1 for value in visible_ids if value.startswith("resident:"))
                if chars.get("visibleProtagonist") is not True or resident_visible<2:
                    raise RuntimeError(f"Flat grounding frame requires protagonist plus multiple residents in frame {index+1}: {chars}")
            if active>=3:saw_multiple_characters=True
            if index==2 and float(grounding.get("maxSlopeMagnitude") or 0)>=0:
                saw_raised_character=True
            max_frame_ms=max(max_frame_ms,float(perf.get("frameMs") or 0))
            level=str(chars.get("contactShadowQuality") or quality.get("activeLevel") or "")
            if level:
                quality_opacity[level]=float(chars.get("contactShadowOpacity") or 0)
            protagonist_locations.append(build.get("protagonistLocation"))
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Grounding evidence changed authoritative protagonist position: {protagonist_locations}")
        if not saw_multiple_characters or not saw_building_contacts or not saw_tree_contacts or not saw_raised_character:
            raise RuntimeError(f"Grounding coverage incomplete: multipleCharacters={saw_multiple_characters}, building={saw_building_contacts}, tree={saw_tree_contacts}, raisedCharacter={saw_raised_character}")
        if max_static_shadow_draws<=0:
            raise RuntimeError(f"Static contact-shadow draw-call evidence missing: {max_static_shadow_draws}")
        if "low" not in quality_opacity or "high" not in quality_opacity or not (quality_opacity["low"] < quality_opacity["high"]):
            raise RuntimeError(f"Contact-shadow quality scaling did not reduce low-quality opacity: {quality_opacity}")
        actions=[str(frame.get("action") or "") for frame in frames[:9]]
        for required in (
            "grounding:flat-characters",
            "grounding:raised-road-npc",
            "grounding:building-foundation",
            "grounding:tree-contact",
            "grounding:high-quality",
            "grounding:low-quality",
        ):
            if not any(required in action for action in actions):
                raise RuntimeError(f"Required grounding scene {required} missing: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:9]]
        if int(viewports[7].get("height") or 0)<=int(viewports[7].get("width") or 0):
            raise RuntimeError(f"Phone portrait grounding evidence missing: {viewports[7]}")
        if int(viewports[8].get("width") or 0)<=int(viewports[8].get("height") or 0):
            raise RuntimeError(f"Phone landscape grounding evidence missing: {viewports[8]}")
        return

    if scenario == "wp-s003-009-002":
        if len(frames) < 11:
            raise RuntimeError("wp-s003-009-002 requires eleven road-hierarchy evidence frames")
        expected_zooms=("0.75×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","2.00×","0.75×","0.75×")
        protagonist_locations=[]
        saw_path=False
        saw_square=False
        saw_connector=False
        saw_core_delta=False
        protagonist_near_road=False
        npc_near_road=False
        max_route_cells=0
        max_route_triangles=0
        max_diagonal_bridges=0
        max_saved_draws=0
        for index,frame in enumerate(frames[:11]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            preload=gpu.get("terrainPreload") or {}
            world=chunks.get("worldData") or {}
            bindings=chunks.get("routeSurfaceBindings") or {}
            proximity=build.get("roadProfileCharacterProximity") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Road hierarchy zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Road hierarchy changed Simulation authority in frame {index+1}: {gpu}")
            if chunks.get("heightfieldPass") is not True or chunks.get("sharedBorderEquality") is not True:
                raise RuntimeError(f"Road hierarchy broke shared heightfield continuity in frame {index+1}: {chunks}")
            if chunks.get("roadProfileEnabled") is not True or chunks.get("roadProfileGroundingShared") is not True:
                raise RuntimeError(f"Raised road profile missing in frame {index+1}: {chunks}")
            road_lift=float(chunks.get("roadLiftWorldUnits") or 0)
            path_lift=float(chunks.get("pathLiftWorldUnits") or 0)
            square_lift=float(chunks.get("squareLiftWorldUnits") or 0)
            if abs(road_lift-0.12)>1e-6 or abs(path_lift-0.08)>1e-6 or abs(square_lift-0.055)>1e-6:
                raise RuntimeError(f"Road/path/square lift mismatch in frame {index+1}: {chunks}")
            if chunks.get("roadHierarchyPresentationPass") is not True:
                raise RuntimeError(f"Road hierarchy presentation contract failed in frame {index+1}: {chunks}")
            if chunks.get("routeSurfaceRendererOnly") is not True or chunks.get("routeNetworkDeterministic") is not True:
                raise RuntimeError(f"Road hierarchy renderer-only/deterministic contract failed in frame {index+1}: {chunks}")
            if chunks.get("routeSurfaceRouteSafe") is not True or chunks.get("routeNetworkRouteSafetyPass") is not True:
                raise RuntimeError(f"Road connector safety failed in frame {index+1}: {chunks}")
            if int(chunks.get("routeSurfaceStaleBindingCount") or 0)!=0:
                raise RuntimeError(f"Stale road material binding detected in frame {index+1}: {chunks}")
            material_count=int(chunks.get("routeSurfaceMaterialCount") or 0)
            if material_count<2 or material_count>3:
                raise RuntimeError(f"Road hierarchy material count is not bounded in frame {index+1}: {chunks}")
            for surface in ("road","path","square"):
                binding=bindings.get(surface) or {}
                if binding.get("textureKey")!=f"tile:{surface}" or binding.get("textureBound") is not True:
                    raise RuntimeError(f"{surface} road-hierarchy texture binding missing in frame {index+1}: {binding}")
                if int(binding.get("runtimeResolution") or 0)<16 or not binding.get("uvRect"):
                    raise RuntimeError(f"{surface} road-hierarchy texture sampling invalid in frame {index+1}: {binding}")
                if float(binding.get("opacity") or 0)<0.99 or float(binding.get("blendWeightInterior") or 0)<0.99:
                    raise RuntimeError(f"{surface} road-hierarchy interior is not opaque/fully weighted in frame {index+1}: {binding}")
                if binding.get("vertexColorTint") is not False:
                    raise RuntimeError(f"{surface} road-hierarchy texture is still washed by vertex tint in frame {index+1}: {binding}")
            route_cells=int(chunks.get("routeSurfaceCellCount") or 0)
            if route_cells<=0 or int(chunks.get("routeMainRoadCellCount") or 0)<=0:
                raise RuntimeError(f"No visible batched road hierarchy in frame {index+1}: {chunks}")
            max_route_cells=max(max_route_cells,route_cells)
            max_route_triangles=max(max_route_triangles,int(chunks.get("routeSurfaceTriangleCount") or 0))
            max_diagonal_bridges=max(max_diagonal_bridges,int(chunks.get("routeDiagonalBridgeCount") or 0))
            max_saved_draws=max(max_saved_draws,int(chunks.get("savedDrawCalls") or 0))
            if int(chunks.get("routeLocalPathCellCount") or 0)>0:saw_path=True
            if int(chunks.get("routeSquareCellCount") or 0)>0:saw_square=True
            if int(chunks.get("routeConnectorCellCount") or 0)>0:saw_connector=True
            if int(chunks.get("roadProfileRoadVertexCount") or 0)>0 and int(chunks.get("roadProfileCoreVertexCount") or 0)>0:
                lo=float(chunks.get("minRoadCoreHeightDelta") or 0)
                hi=float(chunks.get("maxRoadCoreHeightDelta") or 0)
                if lo>0 and hi>=lo:saw_core_delta=True
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Road hierarchy triggered visible-frame terrain rebuilds in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Road hierarchy triggered visible-frame asset work in frame {index+1}: {preload}")
            if chunks.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Road hierarchy introduced one-entity-per-tile rendering in frame {index+1}: {chunks}")
            if world.get("connectorRendererOnly") is not True or world.get("connectorDeterministic") is not True:
                raise RuntimeError(f"Connector world-data contract missing in frame {index+1}: {world}")
            if world.get("connectorRouteSafetyPass") is not True:
                raise RuntimeError(f"Connector world-data route safety failed in frame {index+1}: {world}")
            total_routes=int(chunks.get("routeNetworkTotalRouteCount") or 0)
            connected_routes=int(chunks.get("routeNetworkConnectedRouteCount") or 0)
            if total_routes<=0 or connected_routes!=total_routes:
                raise RuntimeError(f"Not all real entrances reached the circulation network in frame {index+1}: connected={connected_routes}, total={total_routes}")
            protagonist_locations.append(build.get("protagonistLocation"))
            protagonist=(proximity.get("protagonist") or {}).get("nearestRoad") or {}
            npc=(proximity.get("nearestNpc") or {}).get("nearestRoad") or {}
            if protagonist and protagonist.get("distanceTiles") is not None and float(protagonist.get("distanceTiles"))<=3.0:
                protagonist_near_road=True
            if npc and npc.get("distanceTiles") is not None and float(npc.get("distanceTiles"))<=3.0:
                npc_near_road=True
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Road hierarchy camera evidence changed authoritative protagonist location: {protagonist_locations}")
        if not saw_path or not saw_square or not saw_connector or not saw_core_delta:
            raise RuntimeError(f"Road hierarchy coverage incomplete: path={saw_path}, square={saw_square}, connector={saw_connector}, raisedCore={saw_core_delta}")
        if not protagonist_near_road or not npc_near_road:
            raise RuntimeError(f"Character/road proximity coverage incomplete: protagonist={protagonist_near_road}, npc={npc_near_road}")
        if max_route_cells<=0 or max_route_triangles<=0 or max_diagonal_bridges<=0 or max_saved_draws<=0:
            raise RuntimeError(f"Road hierarchy batching/continuity evidence incomplete: cells={max_route_cells}, triangles={max_route_triangles}, diagonalBridges={max_diagonal_bridges}, savedDraws={max_saved_draws}")
        actions=[str(frame.get("action") or "") for frame in frames[:11]]
        for required in (
            "road-profile-target:grass",
            "road-profile-target:dirt-mud",
            "road-hierarchy-connector:house",
            "road-hierarchy-connector:special",
            "road-profile-target:square",
            "road-profile-target:rolling",
            "road-profile-target:chunk-boundary",
            "road-hierarchy:close",
            "road-hierarchy-npc:grass",
        ):
            if not any(required in action for action in actions):
                raise RuntimeError(f"Required road hierarchy scene {required} missing: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:11]]
        if int(viewports[9].get("height") or 0)<=int(viewports[9].get("width") or 0):
            raise RuntimeError(f"Phone portrait road-hierarchy evidence missing: {viewports[9]}")
        if int(viewports[10].get("width") or 0)<=int(viewports[10].get("height") or 0):
            raise RuntimeError(f"Phone landscape road-hierarchy evidence missing: {viewports[10]}")
        return

    if scenario == "wp-s003-006-009":
        if len(frames) < 11:
            raise RuntimeError("wp-s003-006-009 requires eleven raised-road evidence frames")
        expected_zooms=("0.50×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","2.00×","1.00×","0.50×","0.50×")
        protagonist_locations=[]
        saw_path=False
        saw_square=False
        saw_bridge=False
        saw_core_delta=False
        protagonist_near_road=False
        npc_near_road=False
        for index,frame in enumerate(frames[:11]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            preload=gpu.get("terrainPreload") or {}
            proximity=build.get("roadProfileCharacterProximity") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Raised-road zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Raised-road presentation changed Simulation authority in frame {index+1}: {gpu}")
            resources=int(chunks.get("meshResourceCount") or 0)
            if resources<=0 or int(chunks.get("heightfieldResourceCount") or 0)!=resources:
                raise RuntimeError(f"Raised-road evidence lost heightfield resources in frame {index+1}: {chunks}")
            if chunks.get("heightfieldPass") is not True or chunks.get("indexedSharedVertices") is not True:
                raise RuntimeError(f"Raised-road shared heightfield contract failed in frame {index+1}: {chunks}")
            if int(chunks.get("heightfieldGridResolution") or 0)!=9 or int(chunks.get("heightfieldStepTiles") or 0)!=2:
                raise RuntimeError(f"Raised-road topology changed from 9x9 / 2-tile step in frame {index+1}: {chunks}")
            if int(chunks.get("vertices") or 0)!=resources*81 or int(chunks.get("triangles") or 0)!=resources*128:
                raise RuntimeError(f"Raised-road profile added geometry in frame {index+1}: {chunks}")
            if int(chunks.get("meshInstanceCount") or 0)!=resources:
                raise RuntimeError(f"Raised-road profile added terrain mesh instances in frame {index+1}: {chunks}")
            if chunks.get("sharedBorderEquality") is not True or float(chunks.get("sharedBorderMaxError") or 0)>1e-7:
                raise RuntimeError(f"Raised-road chunk border mismatch in frame {index+1}: {chunks}")
            if chunks.get("roadProfileEnabled") is not True or chunks.get("roadProfileGroundingShared") is not True:
                raise RuntimeError(f"Raised-road shared-grounding profile missing in frame {index+1}: {chunks}")
            road_lift=float(chunks.get("roadLiftWorldUnits") or 0)
            path_lift=float(chunks.get("pathLiftWorldUnits") or 0)
            square_lift=float(chunks.get("squareLiftWorldUnits") or 0)
            shoulder_tiles=float(chunks.get("roadShoulderBlendWidthTiles") or 0)
            shoulder_world=float(chunks.get("roadShoulderBlendWidthWorldUnits") or 0)
            bridge_clearance=float(chunks.get("bridgeClearanceWorldUnits") or 0)
            if abs(road_lift-0.12)>1e-6 or abs(path_lift-0.08)>1e-6 or abs(square_lift-0.055)>1e-6:
                raise RuntimeError(f"Raised-road configured lift mismatch in frame {index+1}: {chunks}")
            if shoulder_tiles<=0 or shoulder_tiles>1.5 or shoulder_world<=0 or shoulder_world>3.0:
                raise RuntimeError(f"Raised-road shoulder width is not restrained in frame {index+1}: {chunks}")
            if bridge_clearance<=road_lift:
                raise RuntimeError(f"Bridge clearance is not distinct from ordinary road lift in frame {index+1}: {chunks}")
            if int(chunks.get("roadProfileResourceCount") or 0)!=resources or int(chunks.get("roadProfileVertexCount") or 0)<=0:
                raise RuntimeError(f"Raised-road profile is not prepared across retained chunks in frame {index+1}: {chunks}")
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Raised-road visible-frame terrain rebuild detected in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Raised-road visible-frame asset work detected in frame {index+1}: {preload}")
            if chunks.get("oneEntityPerTile") is not False:
                raise RuntimeError(f"Raised-road profile introduced per-tile entities in frame {index+1}: {chunks}")
            if int(chunks.get("roadProfilePathVertexCount") or 0)>0:saw_path=True
            if int(chunks.get("roadProfileSquareVertexCount") or 0)>0:saw_square=True
            if int(chunks.get("bridgeCellCount") or 0)>0:saw_bridge=True
            if int(chunks.get("roadProfileRoadVertexCount") or 0)>0 and int(chunks.get("roadProfileCoreVertexCount") or 0)>0:
                lo=float(chunks.get("minRoadCoreHeightDelta") or 0)
                hi=float(chunks.get("maxRoadCoreHeightDelta") or 0)
                if lo>0 and hi>=lo:
                    saw_core_delta=True
                    if lo<0.045 or hi>0.24:
                        raise RuntimeError(f"Raised-road height delta is not subtle/bounded in frame {index+1}: min={lo}, max={hi}, chunks={chunks}")
            protagonist_locations.append(build.get("protagonistLocation"))
            protagonist=(proximity.get("protagonist") or {}).get("nearestRoad") or {}
            npc=(proximity.get("nearestNpc") or {}).get("nearestRoad") or {}
            protagonist_distance=protagonist.get("distanceTiles")
            npc_distance=npc.get("distanceTiles")
            if protagonist and protagonist_distance is not None and float(protagonist_distance)<=3.0:protagonist_near_road=True
            if npc and npc_distance is not None and float(npc_distance)<=3.0:npc_near_road=True
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Raised-road camera evidence changed authoritative protagonist location: {protagonist_locations}")
        if not saw_path or not saw_square:
            raise RuntimeError(f"Raised-road evidence did not exercise path/square profiles: path={saw_path}, square={saw_square}")
        if not saw_bridge:
            raise RuntimeError("Raised-road evidence did not keep a bridge scene in the retained chunk set")
        if not saw_core_delta:
            raise RuntimeError("Raised-road evidence did not report a positive bounded road-core height delta")
        if not protagonist_near_road or not npc_near_road:
            raise RuntimeError(f"Raised-road character grounding evidence incomplete: protagonistNear={protagonist_near_road}, npcNear={npc_near_road}")
        actions=[str(frame.get("action") or "") for frame in frames[:11]]
        for required in (
            "road-profile-target:grass",
            "road-profile-target:dirt-mud",
            "road-profile-target:water",
            "road-profile-target:rolling",
            "road-profile-target:square",
            "road-profile-target:chunk-boundary",
        ):
            if not any(required in action for action in actions):
                raise RuntimeError(f"Required raised-road scene {required} missing: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:11]]
        if int(viewports[9].get("height") or 0)<=int(viewports[9].get("width") or 0):
            raise RuntimeError(f"Phone portrait raised-road evidence missing: {viewports[9]}")
        if int(viewports[10].get("width") or 0)<=int(viewports[10].get("height") or 0):
            raise RuntimeError(f"Phone landscape raised-road evidence missing: {viewports[10]}")
        return

    if scenario == "wp-s003-006-008":
        if len(frames) < 11:
            raise RuntimeError("wp-s003-006-008 requires eleven terrain micro-relief evidence frames")
        expected_profiles=("standard","standard","standard","standard","standard","standard","standard","standard","low","standard","standard")
        expected_enabled=(False,True,False,True,False,True,False,True,False,True,True)
        expected_zooms=("1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","1.00×","2.00×","1.00×")
        pair_centers=[]
        pair_topology=[]
        for index,frame in enumerate(frames[:11]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            atlas=chunks.get("textureAtlas") or {}
            quality=gpu.get("materialTextureQuality") or {}
            if str(quality.get("profile") or "")!=expected_profiles[index]:
                raise RuntimeError(f"Micro-relief quality mismatch in frame {index+1}: expected {expected_profiles[index]}, got {quality}")
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Micro-relief zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if chunks.get("terrainNormalDetailTextureReady") is not True or atlas.get("normalDetailTextureReady") is not True:
                raise RuntimeError(f"Shared normal-detail texture missing in frame {index+1}: chunks={chunks}, atlas={atlas}")
            if bool(chunks.get("terrainMicroReliefEnabled"))!=expected_enabled[index]:
                raise RuntimeError(f"Micro-relief OFF/ON gate failed in frame {index+1}: expected {expected_enabled[index]}, chunks={chunks}")
            if index==8 and chunks.get("terrainMicroReliefQualityAllows") is not False:
                raise RuntimeError(f"Low quality did not disable auxiliary micro-relief in frame 9: {chunks}")
            if int(chunks.get("terrainMicroReliefGeometryVerticesAdded") or 0)!=0:
                raise RuntimeError(f"Micro-relief added terrain geometry in frame {index+1}: {chunks}")
            if int(chunks.get("terrainMicroReliefMaterialVariantsAdded") or 0)!=0:
                raise RuntimeError(f"Micro-relief added material variants in frame {index+1}: {chunks}")
            if int(atlas.get("totalGpuTextureCount") or 0)!=3:
                raise RuntimeError(f"Terrain texture set is not bounded to atlas+detail+normal in frame {index+1}: {atlas}")
            topology=(int(chunks.get("vertices") or 0),int(chunks.get("triangles") or 0),int(chunks.get("presentationMeshInstanceCount") or 0))
            pair_topology.append(topology)
            if gpu.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Micro-relief changed Simulation authority in frame {index+1}: {gpu}")
            if int(atlas.get("frameDecodeCount") or 0)!=0 or int(atlas.get("frameRasterizeCount") or 0)!=0 or int(atlas.get("frameAtlasBuildCount") or 0)!=0:
                raise RuntimeError(f"Micro-relief preparation leaked into visible frame path in frame {index+1}: {atlas}")
            pair_centers.append(str(build.get("cameraCenter") or build.get("cameraLocation") or ""))
        for a,b in ((0,1),(2,3),(4,5),(6,7)):
            if pair_centers[a]!=pair_centers[b]:
                raise RuntimeError(f"OFF/ON comparison moved camera for pair {a//2+1}: {pair_centers[a]} vs {pair_centers[b]}")
            if pair_topology[a]!=pair_topology[b]:
                raise RuntimeError(f"Micro-relief changed topology/draw resources within OFF/ON pair {a//2+1}: off={pair_topology[a]}, on={pair_topology[b]}")
        viewport=frames[10].get("runtime",{}).get("viewport",{})
        if int(viewport.get("width") or 0)<=int(viewport.get("height") or 0):
            raise RuntimeError(f"Phone landscape micro-relief evidence missing: {viewport}")
        return

    if scenario == "wp-s003-006-007":
        if len(frames) < 10:
            raise RuntimeError("wp-s003-006-007 requires ten heightfield evidence frames")
        expected_zooms=("0.50×","1.00×","1.00×","0.50×","1.00×","1.00×","1.00×","2.00×","0.50×","0.50×")
        protagonist_locations=[]
        saw_relief=False
        for index,frame in enumerate(frames[:10]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            preload=gpu.get("terrainPreload") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Heightfield zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Heightfield changed Simulation authority in frame {index+1}: {gpu}")
            resources=int(chunks.get("meshResourceCount") or 0)
            if resources<=0 or int(chunks.get("heightfieldResourceCount") or 0)!=resources:
                raise RuntimeError(f"Not every chunk is a heightfield in frame {index+1}: {chunks}")
            if chunks.get("heightfieldPass") is not True or chunks.get("indexedSharedVertices") is not True:
                raise RuntimeError(f"Shared indexed heightfield contract failed in frame {index+1}: {chunks}")
            if int(chunks.get("heightfieldGridResolution") or 0)!=9 or int(chunks.get("heightfieldStepTiles") or 0)!=2:
                raise RuntimeError(f"Standard 16x16 chunk is not 9x9 / 2-tile step in frame {index+1}: {chunks}")
            if int(chunks.get("vertices") or 0)!=resources*81 or int(chunks.get("triangles") or 0)!=resources*128:
                raise RuntimeError(f"Heightfield topology is not 81 vertices / 128 triangles per chunk in frame {index+1}: {chunks}")
            if chunks.get("sharedBorderEquality") is not True or float(chunks.get("sharedBorderMaxError") or 0)>1e-7:
                raise RuntimeError(f"Adjacent chunk border mismatch in frame {index+1}: {chunks}")
            if chunks.get("terrainGroundSampler")!="indexed-triangle-exact":
                raise RuntimeError(f"Shared grounding sampler missing in frame {index+1}: {chunks}")
            if int(chunks.get("visibleFrameTerrainRebuildCount") or 0)!=0:
                raise RuntimeError(f"Visible-frame terrain rebuild detected in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame terrain source work detected in frame {index+1}: {preload}")
            if chunks.get("terrainDetailTextureReady") is not True:
                raise RuntimeError(f"Shared terrain detail texture missing in frame {index+1}: {chunks}")
            lo=chunks.get("minConditionedHeight")
            hi=chunks.get("maxConditionedHeight")
            if lo is not None and hi is not None and float(hi)-float(lo)>=0.08:
                saw_relief=True
            protagonist_locations.append(build.get("protagonistLocation"))
        if not saw_relief:
            raise RuntimeError("Heightfield evidence never showed measurable conditioned relief")
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Heightfield camera traversal changed authoritative protagonist location: {protagonist_locations}")
        for index in (0,1,7,8,9):
            chars=(frames[index].get("runtime",{}).get("currentBuild",{}).get("gpuRenderer",{}).get("characterPresentation") or {}).get("instances") or []
            protagonist=next((item for item in chars if item.get("id")=="protagonist"),None)
            if not protagonist or protagonist.get("terrainGrounded") is not True or protagonist.get("groundSampler")!="indexed-triangle-exact":
                raise RuntimeError(f"Protagonist is not shared-height grounded in frame {index+1}: {protagonist}")
        actions=[str(frame.get("action") or "") for frame in frames[:10]]
        for required in ("heightfield-target:rolling","heightfield-target:highland","heightfield-target:water","heightfield-target:road","heightfield:chunk-border"):
            if not any(required in action for action in actions):
                raise RuntimeError(f"Required heightfield scene {required} missing: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:10]]
        if int(viewports[8].get("height") or 0)<=int(viewports[8].get("width") or 0):
            raise RuntimeError(f"Phone portrait heightfield evidence missing: {viewports[8]}")
        if int(viewports[9].get("width") or 0)<=int(viewports[9].get("height") or 0):
            raise RuntimeError(f"Phone landscape heightfield evidence missing: {viewports[9]}")
        return

    if scenario == "wp-s003-006-006":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-006-006 requires seven tree-plane evidence frames")
        expected_zooms=("0.50×","1.00×","0.50×","1.00×","1.00×","0.50×","0.50×")
        protagonist_locations=[]
        max_trees=0
        variant0=0
        variant1=0
        centers=[]
        for index,frame in enumerate(frames[:7]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            atlas=chunks.get("treeSpriteAtlas") or {}
            preload=gpu.get("terrainPreload") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Tree evidence zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or atlas.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Tree presentation changed Simulation authority in frame {index+1}: {gpu}")
            if atlas.get("ready") is not True or atlas.get("sharedTexture") is not True or int(atlas.get("gpuTextureCount") or 0)!=1:
                raise RuntimeError(f"Shared tree sprite texture is not ready in frame {index+1}: {atlas}")
            if atlas.get("pngFirstPolicy") is not True or int(atlas.get("pngAttemptCount") or 0)!=1:
                raise RuntimeError(f"Tree PNG-first policy not exercised in frame {index+1}: {atlas}")
            if int(atlas.get("svgFallbackCount") or 0)!=1 or atlas.get("sourceKind")!="svg-fallback":
                raise RuntimeError(f"Tree SVG fallback source not proven in frame {index+1}: {atlas}")
            if atlas.get("transparentSource") is not True or atlas.get("alphaTested") is not True:
                raise RuntimeError(f"Tree alpha presentation contract missing in frame {index+1}: {atlas}")
            if atlas.get("preparationOnly") is not True or int(atlas.get("frameDecodeCount") or 0)!=0 or int(atlas.get("frameRasterizeCount") or 0)!=0:
                raise RuntimeError(f"Tree source work leaked into visible frame path in frame {index+1}: {atlas}")
            if chunks.get("treePlanePresentation") is not True or int(chunks.get("treeCylinderSpherePlaceholderCount") or 0)!=0:
                raise RuntimeError(f"Cylinder/sphere tree placeholders remain in frame {index+1}: {chunks}")
            if int(chunks.get("treeInstancedGroupCount") or 0)<=0 or chunks.get("hardwareInstancing") is not True or chunks.get("frustumCulling") is not True:
                raise RuntimeError(f"Tree instancing/culling contract missing in frame {index+1}: {chunks}")
            if int(chunks.get("treeSharedTextureCount") or 0)!=1 or int(chunks.get("treeSharedMaterialCount") or 0)>2:
                raise RuntimeError(f"Tree resource reuse is not bounded in frame {index+1}: {chunks}")
            if chunks.get("treeDeterministicVariation") is not True:
                raise RuntimeError(f"Tree deterministic variation flag missing in frame {index+1}: {chunks}")
            if chunks.get("instancingCoordinateSpace")!="chunk-local" or chunks.get("instancingParentTranslationAppliedOnce") is not True:
                raise RuntimeError(f"Tree instancing is not chunk-local / single-translation in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame tree asset work detected in frame {index+1}: {preload}")
            max_trees=max(max_trees,int(chunks.get("treePresentationCount") or 0))
            variant0=max(variant0,int(chunks.get("treeVariant0Count") or 0))
            variant1=max(variant1,int(chunks.get("treeVariant1Count") or 0))
            protagonist_locations.append(build.get("protagonistLocation"))
        if max_trees < 3:
            raise RuntimeError(f"Tree evidence never showed a sufficiently populated prepared forest area: max tree count {max_trees}")
        if variant0<=0 or variant1<=0:
            raise RuntimeError(f"Both deterministic tree artwork variants were not exercised: variant0={variant0}, variant1={variant1}")
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Tree presentation changed protagonist authority: {protagonist_locations}")
        actions=[str(frame.get("action") or "") for frame in frames[:7]]
        if "camera-relative-active:16,0" not in actions[3]:
            raise RuntimeError(f"Tree evidence did not perform the required active-camera chunk traversal: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:7]]
        if int(viewports[5].get("height") or 0)<=int(viewports[5].get("width") or 0):
            raise RuntimeError(f"Phone portrait tree evidence missing: {viewports[5]}")
        if int(viewports[6].get("width") or 0)<=int(viewports[6].get("height") or 0):
            raise RuntimeError(f"Phone landscape tree evidence missing: {viewports[6]}")
        return

    if scenario == "wp-s003-005-004":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-005-004 requires seven building-surface evidence frames")
        expected_zooms=("0.50×","1.00×","2.00×","1.00×","0.50×","0.50×","1.00×")
        locations=[]
        for index,frame in enumerate(frames[:7]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            atlas=chunks.get("buildingSurfaceAtlas") or {}
            generator=chunks.get("generator") or {}
            preload=gpu.get("terrainPreload") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Building texture zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or atlas.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Building surface presentation changed Simulation authority in frame {index+1}: {gpu}")
            if atlas.get("ready") is not True or atlas.get("sharedAtlas") is not True or int(atlas.get("gpuTextureCount") or 0)!=1:
                raise RuntimeError(f"Shared building surface atlas is not ready in frame {index+1}: {atlas}")
            if int(atlas.get("sourceFamilyCount") or 0)!=4 or int(atlas.get("pngAttemptCount") or 0)!=4:
                raise RuntimeError(f"Building surface family/PNG-first policy mismatch in frame {index+1}: {atlas}")
            if int(atlas.get("svgFallbackCount") or 0)!=4 or len(atlas.get("svgFallbackKeys") or [])!=4:
                raise RuntimeError(f"SVG fallback not proven for all building surface families in frame {index+1}: {atlas}")
            if atlas.get("colorFallbackKeys"):
                raise RuntimeError(f"Building surface fell through to color fallback in frame {index+1}: {atlas.get('colorFallbackKeys')}")
            if atlas.get("preparationOnly") is not True or int(atlas.get("frameDecodeCount") or 0)!=0 or int(atlas.get("frameRasterizeCount") or 0)!=0:
                raise RuntimeError(f"Building asset preparation leaked into visible frame path in frame {index+1}: {atlas}")
            names=set(chunks.get("buildingTexturedMaterialNames") or generator.get("buildingTexturedMaterialNames") or [])
            required={"building-house-wall","building-special-wall","building-roof","building-door"}
            if not required.issubset(names):
                raise RuntimeError(f"Not all building material families are texture-bound in frame {index+1}: names={sorted(names)}")
            if int(chunks.get("roofNormalProfileCount") or 0)<=0 or int(chunks.get("roofSpecialProfileCount") or 0)<=0:
                raise RuntimeError(f"Normal and special building coverage missing in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame building asset work detected in frame {index+1}: {preload}")
            locations.append(build.get("protagonistLocation"))
        if len(set(locations))!=1 or not locations[0]:
            raise RuntimeError(f"Building texture evidence changed protagonist authority: {locations}")
        cutaway=frames[3].get("runtime",{}).get("currentBuild",{}).get("gpuRenderer",{}).get("buildingPresentation") or {}
        if cutaway.get("cutawayActive") is not True or int(cutaway.get("hiddenRoofCount") or 0)!=2 or not cutaway.get("cutawayBuildingId"):
            raise RuntimeError(f"Building texture cutaway did not preserve local roof pair behavior: {cutaway}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:7]]
        if int(viewports[4].get("height") or 0)<=int(viewports[4].get("width") or 0):
            raise RuntimeError(f"Phone portrait building-texture evidence missing: {viewports[4]}")
        if int(viewports[5].get("width") or 0)<=int(viewports[5].get("height") or 0):
            raise RuntimeError(f"Phone landscape building-texture evidence missing: {viewports[5]}")
        return

    if scenario == "wp-s003-005-003":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-005-003 requires seven terrain-texture evidence frames")
        expected_zooms=("0.50×","1.00×","1.00×","0.50×","0.50×","0.50×","1.00×")
        locations=[]
        for index,frame in enumerate(frames[:7]):
            build=frame.get("runtime",{}).get("currentBuild",{})
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            atlas=chunks.get("textureAtlas") or {}
            cache=gpu.get("textureCache") or {}
            preload=gpu.get("terrainPreload") or {}
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Terrain texture zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if gpu.get("simulationAuthorityPreserved") is not True or atlas.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Terrain texture presentation changed Simulation authority in frame {index+1}: {gpu}")
            if atlas.get("ready") is not True or atlas.get("sharedAtlas") is not True or int(atlas.get("gpuTextureCount") or 0)!=1:
                raise RuntimeError(f"Shared terrain atlas is not ready in frame {index+1}: {atlas}")
            if atlas.get("preparationOnly") is not True or int(atlas.get("frameDecodeCount") or 0)!=0 or int(atlas.get("frameRasterizeCount") or 0)!=0:
                raise RuntimeError(f"Terrain texture preparation leaked into frame path in frame {index+1}: {atlas}")
            if atlas.get("pngFirstPolicy") is not True or int(atlas.get("pngAttemptCount") or 0)<10:
                raise RuntimeError(f"PNG-first terrain policy not exercised in frame {index+1}: {atlas}")
            if int(atlas.get("svgFallbackCount") or 0)<10 or len(atlas.get("svgFallbackKeys") or [])<10:
                raise RuntimeError(f"SVG fallback terrain sources not proven in frame {index+1}: {atlas}")
            if atlas.get("colorFallbackKeys"):
                raise RuntimeError(f"Required core terrain asset fell through to color fallback in frame {index+1}: {atlas.get('colorFallbackKeys')}")
            if int(chunks.get("texturedBlockCount") or 0)<=0:
                raise RuntimeError(f"No textured PlayCanvas terrain blocks in frame {index+1}: {chunks}")
            if int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleAssetLoads") or 0)!=0:
                raise RuntimeError(f"Visible-frame terrain asset work detected in frame {index+1}: {preload}")
            if cache.get("pngFirstTerrainPolicyPass") is not True:
                raise RuntimeError(f"Texture source cache PNG-first policy failed in frame {index+1}: {cache}")
            locations.append(build.get("protagonistLocation"))
        if len(set(locations))!=1 or not locations[0]:
            raise RuntimeError(f"Terrain texture evidence changed protagonist authority: {locations}")
        actions=[str(frame.get("action") or "") for frame in frames[:7]]
        if "camera-center-active:16,0" not in actions[2] or "camera-center-active:32,16" not in actions[3]:
            raise RuntimeError(f"Terrain texture evidence did not cross prepared chunk boundaries: {actions}")
        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:7]]
        if int(viewports[4].get("height") or 0)<=int(viewports[4].get("width") or 0):
            raise RuntimeError(f"Phone portrait terrain-texture evidence missing: {viewports[4]}")
        if int(viewports[5].get("width") or 0)<=int(viewports[5].get("height") or 0):
            raise RuntimeError(f"Phone landscape terrain-texture evidence missing: {viewports[5]}")
        return

    if scenario == "wp-s003-004-005":
        if len(frames) < 11:
            raise RuntimeError("wp-s003-004-005 requires eleven doubled-character evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:11]]
        gpus=[build.get("gpuRenderer") or {} for build in builds]
        presentations=[gpu.get("characterPresentation") or {} for gpu in gpus]
        protagonist_locations=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"2x character presentation changed/missed protagonist authority: {protagonist_locations}")

        expected_zooms=("0.50×","1.00×","2.00×","0.50×","0.50×","1.00×","1.00×","0.50×","0.50×","1.00×","2.00×")
        expected_states=(None,"open","open","front","behind","entering","inside","open","open","open","open")
        protagonist_feet=[]
        for index,(build,gpu,presentation) in enumerate(zip(builds,gpus,presentations)):
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"2x character zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if abs(float(presentation.get("presentationMultiplier") or 0)-2.0)>0.001:
                raise RuntimeError(f"Shared 2x character multiplier missing in frame {index+1}: {presentation}")
            if abs(float(presentation.get("baselineMaxPresentationScale") or 0)-5.0)>0.001 or abs(float(presentation.get("maxPresentationScale") or 0)-10.0)>0.001:
                raise RuntimeError(f"Character baseline/final caps are not 5x/10x in frame {index+1}: {presentation}")
            if presentation.get("billboardMode")!="camera-facing-upright" or presentation.get("feetAnchored") is not True:
                raise RuntimeError(f"Character billboard/feet contract failed in frame {index+1}: {presentation}")
            if presentation.get("depthTest") is not True or presentation.get("depthWrite") is not True:
                raise RuntimeError(f"Character depth contract failed in frame {index+1}: {presentation}")
            if gpu.get("simulationAuthorityPreserved") is not True or presentation.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"2x presentation changed Simulation authority in frame {index+1}: {gpu}")

            instances=presentation.get("instances") or []
            if not instances:
                raise RuntimeError(f"No active character instance in frame {index+1}: {presentation}")
            for instance in instances:
                baseline_h=float(instance.get("baselinePresentationHeight") or 0)
                final_h=float(instance.get("height") or 0)
                baseline_px=float(instance.get("baselineRenderedPixelHeight") or 0)
                final_px=float(instance.get("renderedPixelHeight") or 0)
                effective=float(instance.get("effectivePresentationMultiplier") or 0)
                if baseline_h<=0 or abs(final_h-baseline_h*2)>0.003 or abs(effective-2.0)>0.003:
                    raise RuntimeError(f"Character is not exactly doubled from prior visible height in frame {index+1}: {instance}")
                if baseline_px>1 and abs(final_px-baseline_px*2)>1.2:
                    raise RuntimeError(f"Character rendered pixel height is not approximately doubled in frame {index+1}: {instance}")
                if abs(float(instance.get("baselineFeetY") or 0)-float(instance.get("feetY") or 0))>0.0001:
                    raise RuntimeError(f"2x scale moved character feet in frame {index+1}: {instance}")
                if instance.get("upright") is not True or instance.get("cameraFacing") is not True or instance.get("verticalInverted") is not False:
                    raise RuntimeError(f"2x character orientation failed in frame {index+1}: {instance}")
                aspect=float(instance.get("aspectRatio") or 0)
                if abs(aspect-float(instance.get("width") or 0)/max(1e-9,final_h))>0.002:
                    raise RuntimeError(f"2x character aspect ratio stretched in frame {index+1}: {instance}")
                if float(instance.get("presentationScale") or 0)>10.001:
                    raise RuntimeError(f"2x character escaped bounded 10x cap in frame {index+1}: {instance}")

            if index<=8:
                protagonist=next((item for item in instances if item.get("id")=="protagonist"),None)
                if not protagonist:
                    raise RuntimeError(f"Protagonist telemetry missing in 2x frame {index+1}: {presentation}")
                world=protagonist.get("world") or {}
                if f"({world.get('x')},{world.get('y')})"!=protagonist_locations[index]:
                    raise RuntimeError(f"2x billboard world coordinate diverged in frame {index+1}: {protagonist} vs {protagonist_locations[index]}")
                protagonist_feet.append(round(float(protagonist.get("feetY") or 0),4))

            expected=expected_states[index]
            proof=gpu.get("characterProof") or {}
            if expected is not None and index<=8 and proof.get("state")!=expected:
                raise RuntimeError(f"2x character proof state mismatch in frame {index+1}: expected {expected}, got {proof}")

        if len(set(protagonist_feet))!=1:
            raise RuntimeError(f"2x presentation moved protagonist feet across proof states: {protagonist_feet}")

        npc_instances=[]
        for offset,(frame,presentation) in enumerate(zip(frames[9:11],presentations[9:11]),start=10):
            npc=next((item for item in presentation.get("instances") or [] if item.get("id")!="protagonist"),None)
            if not npc:
                raise RuntimeError(f"NPC billboard missing from doubled-scale frame {offset}: {presentation}")
            action=str(frame.get("action") or "")
            if "focus=npc" not in action or "movementBuilding=none" not in action:
                raise RuntimeError(f"NPC doubled-scale evidence is not an outdoor active resident in frame {offset}: {action}")
            npc_instances.append(npc)
        if npc_instances[0].get("id")!=npc_instances[1].get("id") or npc_instances[0].get("world")!=npc_instances[1].get("world"):
            raise RuntimeError(f"NPC 1.00x/2.00x frames did not inspect the same resident/coordinate: {npc_instances}")

        viewports=[frame.get("runtime",{}).get("viewport",{}) for frame in frames[:11]]
        if int(viewports[7].get("height") or 0)<=int(viewports[7].get("width") or 0):
            raise RuntimeError(f"Phone portrait doubled-character evidence missing: {viewports[7]}")
        if int(viewports[8].get("width") or 0)<=int(viewports[8].get("height") or 0):
            raise RuntimeError(f"Phone landscape doubled-character evidence missing: {viewports[8]}")

        front=gpus[3].get("characterProof") or {}
        behind=gpus[4].get("characterProof") or {}
        entering=gpus[5].get("characterProof") or {}
        inside=gpus[6].get("characterProof") or {}
        if front.get("occlusionExpected")!="in-front" or behind.get("occlusionExpected")!="occluded":
            raise RuntimeError(f"2x character front/behind depth proof failed: front={front}, behind={behind}")
        if entering.get("state")!="entering" or inside.get("state")!="inside" or inside.get("cutawayActive") is not True:
            raise RuntimeError(f"2x character interior/cutaway proof failed: entering={entering}, inside={inside}")
        return

    if scenario == "wp-s003-004-004":
        if len(frames) < 11:
            raise RuntimeError("wp-s003-004-004 requires eleven character-billboard evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:11]]
        gpus=[build.get("gpuRenderer") or {} for build in builds]
        presentations=[gpu.get("characterPresentation") or {} for gpu in gpus]
        protagonist_locations=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonist_locations))!=1 or not protagonist_locations[0]:
            raise RuntimeError(f"Billboard presentation changed/missed protagonist authority: {protagonist_locations}")

        expected_zooms=("0.50×","1.00×","2.00×","0.50×","0.50×","1.00×","1.00×","0.50×","0.50×","0.50×","1.00×")
        expected_states=(None,"open","open","front","behind","entering","inside","open","open","open","open")
        protagonist_feet=[]
        for index,(build,gpu,presentation) in enumerate(zip(builds,gpus,presentations)):
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Character billboard zoom mismatch in frame {index+1}: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            if presentation.get("billboardMode")!="camera-facing-upright":
                raise RuntimeError(f"Character billboard mode mismatch in frame {index+1}: {presentation}")
            if presentation.get("feetAnchored") is not True or presentation.get("depthTest") is not True or presentation.get("depthWrite") is not True:
                raise RuntimeError(f"Character anchoring/depth contract failed in frame {index+1}: {presentation}")
            if int(presentation.get("activeCharacterCount") or 0)<1:
                raise RuntimeError(f"No active character billboard in frame {index+1}: {presentation}")
            if int(presentation.get("activeCharacterCount") or 0)>int(presentation.get("simulatedCharacterCount") or 0):
                raise RuntimeError(f"Active billboards exceed Simulation population in frame {index+1}: {presentation}")
            if int(presentation.get("sharedTextureCount") or 0)<1 or int(presentation.get("sharedMaterialCount") or 0)<1:
                raise RuntimeError(f"Shared character texture/material reuse missing in frame {index+1}: {presentation}")
            if gpu.get("simulationAuthorityPreserved") is not True or presentation.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Character presentation changed Simulation authority in frame {index+1}: {gpu}")

            instances=presentation.get("instances") or []
            for instance in instances:
                if instance.get("upright") is not True or instance.get("verticalInverted") is not False or instance.get("imageUpAxis")!="+Y":
                    raise RuntimeError(f"Visible character artwork is not explicitly upright in frame {index+1}: {instance}")
                if instance.get("cameraFacing") is not True or instance.get("billboardBasis")!="yaw(+Y)*plane(+90X)":
                    raise RuntimeError(f"Visible character is not using explicit camera-facing basis in frame {index+1}: {instance}")
                if abs(float(instance.get("aspectRatio") or 0)-float(instance.get("width") or 0)/max(1e-9,float(instance.get("height") or 0)))>0.002:
                    raise RuntimeError(f"Character image aspect ratio was stretched in frame {index+1}: {instance}")
                rendered=float(instance.get("renderedPixelHeight") or 0)
                target=float(instance.get("targetPixelHeight") or 0)
                if rendered+0.6<target:
                    raise RuntimeError(f"Character screen-size target not met in frame {index+1}: rendered={rendered}, target={target}, data={instance}")
                max_scale=float(presentation.get("maxPresentationScale") or 10)
                if float(instance.get("presentationScale") or 0)<1 or float(instance.get("presentationScale") or 0)>max_scale+0.001:
                    raise RuntimeError(f"Character screen-space scaling escaped bounded range in frame {index+1}: {instance}")
            yaws=[round(float(item.get("cameraFacingYawDegrees") or 0),3) for item in instances]
            if yaws and max(yaws)-min(yaws)>0.01:
                raise RuntimeError(f"Orthographic billboards do not share camera view direction in frame {index+1}: {yaws}")

            if index<=8:
                protagonist=next((item for item in instances if item.get("id")=="protagonist"),None)
                if not protagonist:
                    raise RuntimeError(f"Protagonist telemetry missing in frame {index+1}: {presentation}")
                world=protagonist.get("world") or {}
                if f"({world.get('x')},{world.get('y')})"!=protagonist_locations[index]:
                    raise RuntimeError(f"Billboard world coordinate diverged in frame {index+1}: {protagonist} vs {protagonist_locations[index]}")
                protagonist_feet.append(round(float(protagonist.get("feetY") or 0),4))

            expected=expected_states[index]
            proof=gpu.get("characterProof") or {}
            if expected is not None and index<=8 and proof.get("state")!=expected:
                raise RuntimeError(f"Character proof state mismatch in frame {index+1}: expected {expected}, got {proof}")

        if len(set(protagonist_feet))!=1:
            raise RuntimeError(f"Presentation scaling moved authoritative protagonist feet: {protagonist_feet}")

        npc_instances=[]
        for offset,(frame,presentation) in enumerate(zip(frames[9:11],presentations[9:11]),start=10):
            npc=next((item for item in presentation.get("instances") or [] if item.get("id")!="protagonist"),None)
            if not npc:
                raise RuntimeError(f"NPC billboard missing from dedicated NPC frame {offset}: {presentation}")
            if npc.get("upright") is not True or npc.get("cameraFacing") is not True or npc.get("verticalInverted") is not False:
                raise RuntimeError(f"NPC billboard orientation failed in frame {offset}: {npc}")
            if float(npc.get("renderedPixelHeight") or 0)+0.6<float(npc.get("targetPixelHeight") or 0):
                raise RuntimeError(f"NPC billboard readability target failed in frame {offset}: {npc}")
            action=str(frame.get("action") or "")
            if "focus=npc" not in action or "clearance=" not in action or "movementBuilding=none" not in action:
                raise RuntimeError(f"NPC evidence action is missing authoritative outdoor-clearance proof in frame {offset}: {action}")
            try:
                clearance=float(action.split("clearance=",1)[1].split(":",1)[0])
            except Exception as error:
                raise RuntimeError(f"NPC clearance telemetry could not be parsed in frame {offset}: {action}") from error
            if clearance<4:
                raise RuntimeError(f"NPC is not sufficiently separated from building footprints in frame {offset}: clearance={clearance}, action={action}")
            npc_instances.append(npc)
        if npc_instances[0].get("id")!=npc_instances[1].get("id") or npc_instances[0].get("world")!=npc_instances[1].get("world"):
            raise RuntimeError(f"NPC 0.50x/1.00x frames did not inspect the same frozen authoritative resident/coordinate: {npc_instances}")

        phone_portrait=presentations[7]
        phone_landscape=presentations[8]
        pp=next(item for item in phone_portrait.get("instances") or [] if item.get("id")=="protagonist")
        pl=next(item for item in phone_landscape.get("instances") or [] if item.get("id")=="protagonist")
        if float(pp.get("targetPixelHeight") or 0)<32 or float(pp.get("renderedPixelHeight") or 0)<31.4:
            raise RuntimeError(f"Phone portrait protagonist is below 32px readability target: {pp}")
        if float(pl.get("targetPixelHeight") or 0)<26 or float(pl.get("renderedPixelHeight") or 0)<25.4:
            raise RuntimeError(f"Phone landscape protagonist is below bounded fallback target: {pl}")

        front=gpus[3].get("characterProof") or {}
        behind=gpus[4].get("characterProof") or {}
        entering=gpus[5].get("characterProof") or {}
        inside=gpus[6].get("characterProof") or {}
        if front.get("occlusionExpected")!="in-front" or behind.get("occlusionExpected")!="occluded":
            raise RuntimeError(f"Character front/behind depth proof failed: front={front}, behind={behind}")
        if entering.get("state")!="entering" or inside.get("state")!="inside" or inside.get("cutawayActive") is not True:
            raise RuntimeError(f"Character interior/cutaway proof failed: entering={entering}, inside={inside}")

        if not any(int(p.get("simulatedCharacterCount") or 0)>int(p.get("activeCharacterCount") or 0) for p in presentations):
            raise RuntimeError("Character activation never demonstrated bounded active entities below Simulation population")
        return

    if scenario == "wp-s003-004-003":
        if len(frames) < 6:
            raise RuntimeError("wp-s003-004-003 requires six gabled-roof evidence frames")
        expected_actions=(None,"desktop-1.00x","desktop-2.00x","phone-portrait","phone-landscape","cutaway-inside")
        expected_zooms=("0.50×","1.00×","2.00×","0.50×","0.50×","1.00×")
        for index,frame in enumerate(frames[:6]):
            action=str(frame.get("action") or "")
            if index==0:
                if "started-current-campaign" not in action and "campaign-already-active" not in action:
                    raise RuntimeError(f"Gabled-roof 0.50x startup action mismatch in frame 1: {action}")
            elif expected_actions[index] not in action:
                raise RuntimeError(f"Gabled-roof evidence action mismatch in frame {index+1}: {action}")
            build=frame.get("runtime",{}).get("currentBuild",{})
            if build.get("cameraZoom")!=expected_zooms[index]:
                raise RuntimeError(f"Gabled-roof frame {index+1} zoom mismatch: expected {expected_zooms[index]}, got {build.get('cameraZoom')}")
            gpu=build.get("gpuRenderer") or {}
            chunks=gpu.get("terrainChunks") or {}
            scene=gpu.get("scene") or {}
            presentation=gpu.get("buildingPresentation") or {}
            hot=gpu.get("navigationHotPath") or {}
            if chunks.get("roofProfilePass") is not True or chunks.get("roofCenterRidgeHigher") is not True:
                raise RuntimeError(f"Gabled-roof ridge geometry failed in frame {index+1}: {chunks}")
            if chunks.get("roofEaveContactPass") is not True or chunks.get("roofFootprintDriven") is not True:
                raise RuntimeError(f"Gabled-roof wall contact/footprint scaling failed in frame {index+1}: {chunks}")
            if int(chunks.get("roofProfileCount") or 0)<=0:
                raise RuntimeError(f"No gabled-roof profiles were captured in frame {index+1}: {chunks}")
            if int(chunks.get("roofNormalProfileCount") or 0)<=0 or int(chunks.get("roofSpecialProfileCount") or 0)<=0:
                raise RuntimeError(f"Normal + special building roof coverage missing in frame {index+1}: {chunks}")
            samples=chunks.get("roofProfileSamples") or []
            if not samples:
                raise RuntimeError(f"Gabled-roof sample telemetry missing in frame {index+1}: {chunks}")
            for sample in samples:
                ridge=float(sample.get("ridgeBottomY") or 0)
                eave=float(sample.get("eaveBottomY") or 0)
                wall=float(sample.get("wallTopY") or 0)
                if not sample.get("centerRidgeHigher") or ridge<=eave:
                    raise RuntimeError(f"Roof center is not higher than eave in frame {index+1}: {sample}")
                if not sample.get("eaveContact") or abs(wall-eave)>0.081:
                    raise RuntimeError(f"Roof eave is detached/buried in frame {index+1}: {sample}")
                if not sample.get("restrainedOverhang") or not sample.get("footprintDriven"):
                    raise RuntimeError(f"Roof overhang/footprint rule failed in frame {index+1}: {sample}")
            if scene.get("roofStyle")!="gabled-center-ridge-two-plane":
                raise RuntimeError(f"Unexpected roof style in frame {index+1}: {scene}")
            if gpu.get("simulationAuthorityPreserved") is not True or chunks.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Roof renderer changed Simulation authority in frame {index+1}: {gpu}")
            if hot.get("fullSceneRebuilds") not in (0,0.0):
                raise RuntimeError(f"Roof proof introduced per-frame scene reconstruction in frame {index+1}: {hot}")

        cutaway=(frames[5].get("runtime",{}).get("currentBuild",{}).get("gpuRenderer",{}).get("buildingPresentation") or {})
        if cutaway.get("cutawayActive") is not True or int(cutaway.get("hiddenRoofCount") or 0)!=2 or not cutaway.get("cutawayBuildingId"):
            raise RuntimeError(f"Cutaway did not target exactly one two-plane roof: {cutaway}")
        if int(cutaway.get("totalRoofCount") or 0)<=2:
            raise RuntimeError(f"Cutaway evidence did not retain other building roofs: {cutaway}")
        return






    if scenario == "wp-s007-008":
        if len(frames) < 6:
            raise RuntimeError("wp-s007-008 requires six lazy catch-up evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("lazyCatchUp") or {} for build in builds]
        panels=[build.get("lazyCatchUpPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Lazy catch-up evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Lazy catch-up mutated Protagonist position: {protagonists}")
        required={
            "pass":True,"continuousDormantEquivalent":True,"offlineEquivalent":True,
            "offlineUsesWallClockEntropy":False,"canonicalParentOrder":True,
            "perSecondReplay":0,"perNpcReplay":0,"boundedByAggregateIntervals":True,
            "resumableBudget":True,"partialStateInteractable":False,
            "importantEventsPreserved":True,"persistentExceptionsReconciled":True,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Lazy catch-up proof {key} mismatch in frame {index}: {proof}")
            if float(proof.get("offlineRealHourFantasyHours") or 0)!=24:
                raise RuntimeError(f"Offline conversion is not 1 real hour = 24 fantasy hours: {proof}")
            if int(proof.get("longAbsenceDays") or 0)<180 or int(proof.get("longAbsenceAggregateEvents") or 0)<=0:
                raise RuntimeError(f"Long absence aggregate bound missing: {proof}")

        partial=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=1),None)
        if not partial or partial.get("incompleteObserved") is not True or partial.get("blockedWhileIncomplete") is not True:
            raise RuntimeError(f"Bounded incomplete catch-up did not block authoritative detail: {panels}")
        resumed=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=2),None)
        if not resumed or resumed.get("resumedComplete") is not True or resumed.get("phaseOrderPass") is not True:
            raise RuntimeError(f"Catch-up did not resume to canonical complete state: {panels}")
        if resumed.get("importantApplied") is not True or int(resumed.get("importantDeltaRevision") or 0)<=0:
            raise RuntimeError(f"Scheduled important event was lost during catch-up: {resumed}")
        if int(resumed.get("eventsProcessed") or 0)<=0 or int(resumed.get("batchesProcessed") or 0)<=1:
            raise RuntimeError(f"Catch-up did not exercise bounded multi-batch work: {resumed}")

        equivalence=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=3),None)
        if not equivalence or float(equivalence.get("offlineFantasyHours") or 0)!=24 or int(equivalence.get("longAbsenceEvents") or 0)<=0:
            raise RuntimeError(f"Offline/long-absence evidence missing: {panels}")
        reload=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=4),None)
        if not reload or reload.get("reloadCursorStable") is not True or reload.get("reloadReady") is not True:
            raise RuntimeError(f"Persisted catch-up cursor/scheduler did not restore deterministically: {panels}")
        final=next((panel for panel in reversed(panels) if int(panel.get("lastStep") or 0)>=5),None)
        if not final or final.get("stableAfterCamera") is not True or final.get("authoritativeReady") is not True:
            raise RuntimeError(f"Camera changed catch-up authority or final state is not ready: {panels}")
        for index,panel in enumerate(panels,start=1):
            if not panel.get("present") or not panel.get("pass"):
                raise RuntimeError(f"Lazy catch-up inspector incomplete in frame {index}: {panel}")
            states=panel.get("checkStates") or []
            if len(states)!=6 or any(state!="PASS" for state in states):
                raise RuntimeError(f"Lazy catch-up panel checks did not all pass in frame {index}: {panel}")
        return

    if scenario == "wp-s007-007":
        if len(frames) < 6:
            raise RuntimeError("wp-s007-007 requires six NPC lifecycle evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("npcLifecycle") or {} for build in builds]
        panels=[build.get("npcLifecyclePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"NPC lifecycle evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"NPC lifecycle mutated Protagonist position: {protagonists}")
        required={
            "pass":True,"manyPersistentIdentities":True,"deterministicMaterialization":True,
            "validPlacement":True,"stableIdentityRef":True,"scheduleReconstruction":True,
            "missedPathReplay":False,"persistentExceptionalState":True,
            "meaningfulDematerializationCommit":True,"reconciliationAware":True,
            "exactCountBounded":True,"identityIndependentOfSprite":True,
            "rendererDependency":False,"spriteDependency":False,"wallClockDependency":False,
            "unrelatedRandomStreamConsumption":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"NPC lifecycle proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("maxExactActive") or 0)>24:
                raise RuntimeError(f"NPC lifecycle exact cap exceeds 24: {proof}")
            if int(proof.get("identityPopulation") or 0)<=int(proof.get("maxExactActive") or 0):
                raise RuntimeError(f"NPC lifecycle did not demonstrate dormant identity population: {proof}")

        bounded=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=1),None)
        if not bounded or bounded.get("boundedExact") is not True:
            raise RuntimeError(f"Exact NPC set was not bounded: {panels}")
        if int(bounded.get("activeExactPeak") or 0)<=0 or int(bounded.get("activeExactPeak") or 0)>24:
            raise RuntimeError(f"Exact NPC peak invalid: {bounded}")
        if int(bounded.get("dormantIdentityCount") or 0)<=0:
            raise RuntimeError(f"No dormant persistent identities remained: {bounded}")

        dormant=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=2),None)
        if not dormant or dormant.get("scheduleChanged") is not True or int(dormant.get("replayedPathSteps") or 0)!=0:
            raise RuntimeError(f"Dormant schedule reconstruction failed or replayed path steps: {panels}")
        if not dormant.get("firstActivity") or not dormant.get("laterActivity") or dormant.get("firstActivity")==dormant.get("laterActivity"):
            raise RuntimeError(f"Dormant NPC did not reappear in a different schedule-consistent activity: {dormant}")

        injury=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=3),None)
        if not injury or injury.get("injuryCommitted") is not True or injury.get("injuryPersistent") is not True:
            raise RuntimeError(f"Persistent injury did not survive dormancy: {panels}")
        if injury.get("injuryActivity")!="recovering-injury" or int(injury.get("persistentRevision") or 0)<=0:
            raise RuntimeError(f"Exceptional injury did not override default schedule: {injury}")

        reload=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=4),None)
        if not reload or reload.get("reloadDeterministic") is not True:
            raise RuntimeError(f"Same WorldState/time did not rematerialize identically after runtime reload: {panels}")
        if not reload.get("reloadSignatureBefore") or reload.get("reloadSignatureBefore")!=reload.get("reloadSignatureAfter"):
            raise RuntimeError(f"Reload materialization signatures differ: {reload}")
        if int(reload.get("npcDeltaCount") or 0)<1:
            raise RuntimeError(f"Persistent NPC state was not represented by sparse NPC CampaignDelta: {reload}")

        final=next((panel for panel in reversed(panels) if int(panel.get("lastStep") or 0)>=5),None)
        if not final or final.get("stableAfterCamera") is not True or final.get("noSpriteDependency") is not True:
            raise RuntimeError(f"Camera/sprite state influenced NPC identity or materialization: {panels}")

        for index,panel in enumerate(panels,start=1):
            if not panel.get("present") or not panel.get("pass"):
                raise RuntimeError(f"NPC lifecycle inspector incomplete in frame {index}: {panel}")
            states=panel.get("checkStates") or []
            if len(states)!=6 or any(state!="PASS" for state in states):
                raise RuntimeError(f"NPC lifecycle panel checks did not all pass in frame {index}: {panel}")
        return

    if scenario == "wp-s007-006":
        if len(frames) < 6:
            raise RuntimeError("wp-s007-006 requires six regional/settlement aggregate evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("regionalSettlementSimulation") or {} for build in builds]
        panels=[build.get("regionalSettlementSimulationPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Regional aggregate evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Regional aggregate Simulation mutated Protagonist position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"differentiated":True,"resourceConstrained":True,
            "eventDriven":True,"lazyParentRevisionChecks":True,"noImmediateCountryFanOut":True,
            "noResidentSimulation":True,"persistentAggregateHistory":True,"reconciliationData":True,
            "renderIndependent":True,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Regional aggregate proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("renderInputs") or 0)!=0 or int(proof.get("perResidentIterations") or 0)!=0:
                raise RuntimeError(f"Regional aggregate proof gained render/resident iteration in frame {index}: {proof}")
            if int(proof.get("maxRegions") or 0)>16 or int(proof.get("maxSettlements") or 0)>24:
                raise RuntimeError(f"Regional aggregate scope exceeds bounded catalogs: {proof}")

        diff=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=1),None)
        if not diff or int(diff.get("agriculturalRevision") or 0)<=0 or int(diff.get("miningRevision") or 0)<=0:
            raise RuntimeError(f"Agricultural/mining settlement aggregates were not both updated: {panels}")
        if abs(float(diff.get("agriculturalFood") or 0)-float(diff.get("miningFood") or 0))<=0.005 and \
           abs(float(diff.get("agriculturalProduction") or 0)-float(diff.get("miningProduction") or 0))<=0.005:
            raise RuntimeError(f"Agricultural/mining evidence did not diverge: {diff}")

        parent=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=2),None)
        if not parent or int(parent.get("parentCountryDeltaRevision") or 0)<=0 or parent.get("lazyNoFanOut") is not True:
            raise RuntimeError(f"Parent country revision did not remain lazy: {panels}")
        if int(parent.get("settlementRevisionAfterParent") or 0)!=int(parent.get("settlementRevisionBeforeParent") or 0):
            raise RuntimeError(f"Country change immediately fanned out to settlement delta: {parent}")

        lazy=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=3),None)
        if not lazy or lazy.get("lazyConsumed") is not True:
            raise RuntimeError(f"Relevant settlement did not consume stale parent revision lazily: {panels}")
        if int(lazy.get("settlementRevisionAfterParent") or 0)<=int(lazy.get("settlementRevisionBeforeParent") or 0):
            raise RuntimeError(f"Lazy relevant refresh did not advance settlement revision: {lazy}")
        if not lazy.get("parentCountryRevisionSeenAfter"):
            raise RuntimeError(f"Lazy refresh did not record consumed parent revision: {lazy}")

        dormant=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=4),None)
        if not dormant or dormant.get("longAbsenceAccumulated") is not True:
            raise RuntimeError(f"Dormant settlement did not retain accumulated history: {panels}")
        if int(dormant.get("longAbsenceRevisionAfter") or 0)<=int(dormant.get("longAbsenceRevisionBefore") or 0):
            raise RuntimeError(f"Dormant aggregate revision did not advance: {dormant}")
        if dormant.get("reconciliationReady") is not True or dormant.get("noNpcDelta") is not True:
            raise RuntimeError(f"Dormant aggregate required resident Simulation or lacked reconciliation data: {dormant}")

        final=next((panel for panel in reversed(panels) if int(panel.get("lastStep") or 0)>=5),None)
        if not final or final.get("stableAfterCamera") is not True:
            raise RuntimeError(f"Camera movement changed regional/settlement authoritative state: {panels}")

        for index,panel in enumerate(panels,start=1):
            if not panel.get("present") or not panel.get("pass"):
                raise RuntimeError(f"Regional/settlement aggregate inspector incomplete in frame {index}: {panel}")
            states=panel.get("checkStates") or []
            if len(states)!=6 or any(state!="PASS" for state in states):
                raise RuntimeError(f"Regional/settlement aggregate panel checks did not all pass in frame {index}: {panel}")
        return

    if scenario == "wp-s007-005":
        if len(frames) < 5:
            raise RuntimeError("wp-s007-005 requires five global aggregate evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("globalCountrySimulation") or {} for build in builds]
        panels=[build.get("globalCountrySimulationPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Global aggregate evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Global aggregate Simulation mutated Protagonist position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"countriesEvolveDifferently":True,
            "profileGeographyInfluence":True,"controlledRestriction":True,
            "eventDriven":True,"scheduledAggregateUpdates":True,
            "currentWorldDeltaAuthority":True,"immutableCountryFoundation":True,
            "revisionBasedLazyPropagation":True,"noSettlementFanOut":True,
            "noNpcFanOut":True,"offscreenEquivalent":True,
            "militaristicWeightNotForcedWar":True,"mercantileWeightNotForcedFriendship":True,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Global aggregate proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("renderInputs") or 0)!=0 or int(proof.get("perFrameCountryIterations") or 0)!=0:
                raise RuntimeError(f"Global aggregate proof gained render/frame authority in frame {index}: {proof}")
            if int(proof.get("perCitizenGlobalIterations") or 0)!=0:
                raise RuntimeError(f"Global aggregate proof performed per-citizen global work: {proof}")
            if int(proof.get("maxCountries") or 0)>25 or int(proof.get("maxRelations") or 0)>20:
                raise RuntimeError(f"Global aggregate scope exceeds bounded catalogs: {proof}")

        active=[panel for panel in panels if int(panel.get("lastStep") or 0)>=1]
        if not active:
            raise RuntimeError(f"Global aggregate evidence never executed a controlled step: {panels}")
        country=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=1),None)
        if not country or int(country.get("countryARevision") or 0)<=0 or int(country.get("countryBRevision") or 0)<=0:
            raise RuntimeError(f"Two-country aggregate revisions were not created: {panels}")
        if country.get("countryASignature")==country.get("countryBSignature"):
            raise RuntimeError(f"Different countries produced identical aggregate outcomes: {country}")

        relation=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=2),None)
        if not relation or int(relation.get("relationRevision") or 0)<=0 or relation.get("relationRestricted") is not True:
            raise RuntimeError(f"Diplomacy restriction evidence missing: {panels}")
        if relation.get("contextAfterRevision")==relation.get("contextBeforeRevision"):
            raise RuntimeError(f"WorldContext did not lazily refresh after diplomacy revision: {relation}")
        if float(relation.get("contextAfterTrade") or 0)>=float(relation.get("contextBeforeTrade") or 0):
            raise RuntimeError(f"Trade restriction did not reduce downstream settlement trade: {relation}")
        if int(relation.get("settlementDeltaCount") or 0)!=0:
            raise RuntimeError(f"Global update fanned out into settlement CampaignDelta entries: {relation}")

        due=next((panel for panel in panels if int(panel.get("lastStep") or 0)>=3),None)
        if not due or due.get("dueOnlyPass") is not True:
            raise RuntimeError(f"Future country event was processed before it became due: {panels}")
        final=next((panel for panel in reversed(panels) if int(panel.get("lastStep") or 0)>=4),None)
        if not final or final.get("stableAfterCamera") is not True:
            raise RuntimeError(f"Camera movement changed global authoritative state: {panels}")

        for index,panel in enumerate(panels,start=1):
            if not panel.get("present") or not panel.get("pass"):
                raise RuntimeError(f"Global aggregate inspector proof incomplete in frame {index}: {panel}")
            states=panel.get("checkStates") or []
            if len(states)!=6 or any(state!="PASS" for state in states):
                raise RuntimeError(f"Global aggregate panel checks did not all pass in frame {index}: {panel}")
        return

    if scenario == "wp-s007-004":
        if len(frames) < 2:
            raise RuntimeError("wp-s007-004 requires two deterministic scheduler evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:2]]
        proofs=[build.get("eventScheduler") or {} for build in builds]
        panels=[build.get("eventSchedulerPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Event-scheduler evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Event-scheduler proof mutated Protagonist position: {protagonists}")
        required={
            "pass":True,"fpsInvariant":True,"loadingOrderInvariant":True,
            "cameraPathInvariant":True,"batchingInvariant":True,
            "unrelatedEntityInvariant":True,"equalDueOrderStable":True,
            "addressedRandomStable":True,"secondPrecision":True,
            "renderFrameRandomness":False,"renderOrCameraInputs":False,
            "realWorldEntropy":False,"dueOnlyProcessing":True,
            "boundedProcessing":True,"versionedCompactState":True,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Event-scheduler proof {key} mismatch in frame {index}: {proof}")
            if proof.get("randomSource")!="PRNG.liveAddressedUint32":
                raise RuntimeError(f"Event-scheduler random source mismatch in frame {index}: {proof}")
            if int(proof.get("extraEntityCount") or 0)!=200:
                raise RuntimeError(f"Event-scheduler extra-entity isolation count mismatch: {proof}")
            if int(proof.get("maxBatch") or 0)>32:
                raise RuntimeError(f"Event-scheduler batch budget exceeded: {proof}")
            if proof.get("canonicalHistorySignature")!=proof.get("noiseHistoryBaseSignature"):
                raise RuntimeError(f"Unrelated entities shifted base outcomes: {proof}")
        signatures=[proof.get("canonicalHistorySignature") for proof in proofs]
        if len(set(signatures))!=1 or not signatures[0]:
            raise RuntimeError(f"Camera/frame evidence changed scheduler history: {signatures}")
        for index,panel in enumerate(panels,start=1):
            if not panel.get("present") or not panel.get("pass"):
                raise RuntimeError(f"Event-scheduler inspector proof incomplete in frame {index}: {panel}")
            if int(panel.get("maxBatch") or 0)>32 or int(panel.get("extraEntityCount") or 0)!=200:
                raise RuntimeError(f"Event-scheduler panel budget/isolation mismatch in frame {index}: {panel}")
            states=panel.get("checkStates") or []
            if len(states)!=6 or any(state!="PASS" for state in states):
                raise RuntimeError(f"Event-scheduler panel checks did not all pass in frame {index}: {panel}")
        return

    if scenario == "wp-s007-003":
        if len(frames) < 7:
            raise RuntimeError("wp-s007-003 requires seven Simulation-tier evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:7]]
        proofs=[build.get("simulationTiers") or {} for build in builds]
        panels=[build.get("simulationTiersPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Simulation-tier evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Simulation-tier proof mutated Protagonist position: {protagonists}")
        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,"deterministicActivation":True,"tierChangesOutcome":False,
                "contextStableAcrossTierChanges":True,"proofDoesNotMutateWorldState":True,
                "renderIndependent":True,"renderVisibilityActivation":False,
                "boundedCandidates":True,"boundedExactObjects":True,
                "compactDistantState":True,"noFullWorldObjectGraph":True,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Simulation-tier proof {key} mismatch in frame {index}: {proof}")
            if proof.get("promotionSequence")!=["global","regional","local","exact","global","exact"]:
                raise RuntimeError(f"Simulation-tier deterministic sequence mismatch in frame {index}: {proof}")
            budgets=proof.get("budgets") or {}
            if int(budgets.get("candidateSettlements") or 0)>12 or int(budgets.get("exactNpcHandles") or 0)>24:
                raise RuntimeError(f"Simulation-tier budgets are not bounded: {budgets}")
            if int(proof.get("representedPopulation") or 0)<=int(proof.get("exactHandleSampleCount") or 0):
                raise RuntimeError(f"Simulation-tier evidence did not show aggregate population > exact objects: {proof}")

        expected=["global","regional","local","exact","global","exact","exact"]
        actual=[panel.get("focusTier") for panel in panels]
        if actual!=expected:
            raise RuntimeError(f"Simulation-tier promotion/demotion sequence mismatch: expected={expected}, actual={actual}")
        for index,panel in enumerate(panels,start=1):
            if not panel.get("open") or int(panel.get("tierRows") or 0)!=4:
                raise RuntimeError(f"Simulation-tier inspector incomplete in frame {index}: {panel}")
            if not panel.get("bounded") or not panel.get("renderIndependent"):
                raise RuntimeError(f"Simulation-tier bounds/render independence failed in frame {index}: {panel}")
            if int(panel.get("candidateCount") or 0)>12 or int(panel.get("exactCount") or 0)>1 or int(panel.get("exactNpcHandles") or 0)>24:
                raise RuntimeError(f"Simulation-tier active counts exceed budgets in frame {index}: {panel}")
            if int(panel.get("representedPopulation") or 0)<=int(panel.get("exactNpcHandles") or 0):
                raise RuntimeError(f"Simulation-tier aggregate population is not larger than exact object count in frame {index}: {panel}")

        if int(panels[0].get("exactNpcHandles") or 0)!=0:
            raise RuntimeError(f"Distant aggregate frame unexpectedly materialized exact NPC handles: {panels[0]}")
        if int(panels[3].get("exactNpcHandles") or 0)<=0:
            raise RuntimeError(f"Exact-tier frame did not materialize bounded exact NPC handles: {panels[3]}")
        demoted=panels[4]
        reactivated=panels[5]
        if not demoted.get("historyPreserved") or not demoted.get("mutatedSignature") or demoted.get("demotedSignature")!=demoted.get("mutatedSignature"):
            raise RuntimeError(f"Demotion did not preserve authoritative changed state: {demoted}")
        if not reactivated.get("historyPreserved") or reactivated.get("reactivatedSignature")!=demoted.get("mutatedSignature"):
            raise RuntimeError(f"Reactivation did not reconstruct the preserved authoritative result: {reactivated}")
        if panels[6].get("focusTier")!="exact" or panels[6].get("focusSignature")!=reactivated.get("focusSignature"):
            raise RuntimeError(f"Camera/render movement changed Simulation tier/outcome: {reactivated} -> {panels[6]}")
        if "drag-" not in str(frames[6].get("action") or ""):
            raise RuntimeError(f"Render-independence frame did not exercise camera movement: {frames[6].get('action')}")
        return

    if scenario == "wp-s007-002":
        if len(frames) < 6:
            raise RuntimeError("wp-s007-002 requires six WorldContext evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("worldContext") or {} for build in builds]
        panels=[build.get("worldContextPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"WorldContext evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"WorldContext proof mutated Protagonist world position: {protagonists}")

        required={
            "pass":True,"deterministic":True,"sameCountryDifferentRegions":True,
            "regionalTerrainDifference":True,"regionalBehaviorDifference":True,
            "localAuthorityPreserved":True,"complete":True,"parentRevisionsRecorded":True,
            "cachedRepeat":True,"noStateMutation":True,"childInheritance":True,
            "renderIndependent":True,"currentStateIntegrated":True,"noFanOut":True,
            "worldStateMutation":False,"renderDependency":False,"globalFanOut":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"WorldContext proof {key} mismatch in frame {index}: {proof}")
            if proof.get("hierarchy")!="Country → Region → Local Geography/Resources → Settlement → Building/Job/NPC Context":
                raise RuntimeError(f"WorldContext hierarchy mismatch in frame {index}: {proof}")
            if float(proof.get("differenceScore") or 0)<=0:
                raise RuntimeError(f"WorldContext regional evidence has no local difference in frame {index}: {proof}")

        for panel in panels:
            if not panel.get("open") or int(panel.get("layerRows") or 0)!=6 or int(panel.get("comparisonRows") or 0)!=2:
                raise RuntimeError(f"WorldContext inspector hierarchy/comparison incomplete: {panel}")
            if int(panel.get("behaviorRows") or 0)<10:
                raise RuntimeError(f"WorldContext behavior evidence incomplete: {panel}")
            if not panel.get("targetId") or not panel.get("countryId") or not panel.get("regionId") or not panel.get("contextSignature"):
                raise RuntimeError(f"WorldContext inspector missing identity/signature: {panel}")
            if int(panel.get("fanOutInvalidations") or 0)!=0:
                raise RuntimeError(f"WorldContext performed fan-out invalidation: {panel}")

        baseline=panels[0]
        changed=panels[1]
        contrast=panels[2]
        repeated=panels[3]
        rematerialized=panels[4]
        reloaded=panels[5]

        if int(baseline.get("countryDeltaRevision") or 0)!=0:
            raise RuntimeError(f"WorldContext baseline unexpectedly had country delta: {baseline}")
        if int(changed.get("countryDeltaRevision") or 0)!=1:
            raise RuntimeError(f"Country change did not increment context delta revision exactly once: {changed}")
        if not changed.get("lazyNoFanout"):
            raise RuntimeError(f"Country change caused eager context fan-out: {changed}")
        if changed.get("cacheEntriesBeforeMutation")!=changed.get("cacheEntriesAfterMutation") or changed.get("queriesBeforeMutation")!=changed.get("queriesAfterMutation"):
            raise RuntimeError(f"Country change touched WorldContext cache before query: {changed}")
        if changed.get("countryRevision")==baseline.get("countryRevision"):
            raise RuntimeError(f"Country parent revision did not change after country delta: {baseline} -> {changed}")
        if changed.get("contextSignature")==baseline.get("contextSignature"):
            raise RuntimeError(f"Same settlement behavior/context did not change after country wealth/trade change: {baseline} -> {changed}")
        if changed.get("wealth")==baseline.get("wealth") or changed.get("trade")==baseline.get("trade"):
            raise RuntimeError(f"Country wealth/trade evidence did not change: {baseline} -> {changed}")

        if contrast.get("countryId")!=changed.get("countryId") or contrast.get("regionId")==changed.get("regionId"):
            raise RuntimeError(f"Regional comparison is not two different regions in one country: {changed} vs {contrast}")
        local_values=("agriculturePotential","miningPotential","transportAccess")
        if all(abs(float(contrast.get(key) or 0)-float(changed.get(key) or 0))<1e-9 for key in local_values):
            raise RuntimeError(f"Regional/local geography did not change lower behavior modifiers: {changed} vs {contrast}")

        if repeated.get("targetId")!=changed.get("targetId") or repeated.get("contextSignature")!=changed.get("contextSignature"):
            raise RuntimeError(f"Repeated loaded context changed unexpectedly: {changed} -> {repeated}")
        if not repeated.get("cacheHit"):
            raise RuntimeError(f"Repeated context did not report a final-cache hit: {repeated}")
        if "drag-" not in str(frames[3].get("action") or ""):
            raise RuntimeError(f"WorldContext render-independence frame did not move camera: {frames[3].get('action')}")

        if not rematerialized.get("rematerialized") or rematerialized.get("contextSignature")!=changed.get("contextSignature"):
            raise RuntimeError(f"Newly materialized context differs from continuously loaded context: {changed} -> {rematerialized}")
        if reloaded.get("contextSignature")!=changed.get("contextSignature") or reloaded.get("countryRevision")!=changed.get("countryRevision"):
            raise RuntimeError(f"WorldContext changed after full page reload: {changed} -> {reloaded}")
        if int(reloaded.get("countryDeltaRevision") or 0)!=1:
            raise RuntimeError(f"Country delta was not restored after full page reload: {reloaded}")
        return

    if scenario == "wp-s007-001":
        if len(frames) < 6:
            raise RuntimeError("wp-s007-001 requires six world-state evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("worldState") or {} for build in builds]
        panels=[build.get("worldStatePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"World-state evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"World-state proof mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"stableIds":True,"immutable":True,
            "schemasVersioned":True,"foundationUnaffected":True,"currentMergeDeterministic":True,
            "untouchedQuerySparse":True,"sparseDeltaSchema":True,"unloadReloadStable":True,
            "liveDeltaMerged":True,"persistedMatchesMemory":True,"structuralIdentityCoverage":True,
            "deltaDomainCoverage":True,"renderingZeroAuthority":True,"noWholeWorldSave":True,
            "foundationMutation":False,"wholeWorldSerialized":False,"renderDependency":False,
            "cameraDependency":False,"assetLoadingDependency":False,"deviceSpeedDependency":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"World-state proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("representativeCount") or 0)<6:
                raise RuntimeError(f"World-state stable identity coverage incomplete in frame {index}: {proof}")
            if int(proof.get("foundationSchemaVersion") or 0)<1 or int(proof.get("deltaSchemaVersion") or 0)<1 or int(proof.get("currentWorldSchemaVersion") or 0)<1:
                raise RuntimeError(f"World-state schemas are not versioned in frame {index}: {proof}")
            if not proof.get("worldGeneratorVersion"):
                raise RuntimeError(f"World-state generator version missing in frame {index}: {proof}")

        for panel in panels:
            if not panel.get("open") or int(panel.get("layerRows") or 0)!=3 or int(panel.get("representativeRows") or 0)<6:
                raise RuntimeError(f"World-state inspector incomplete: {panel}")
            if not panel.get("focusId") or not panel.get("foundationSignature") or not panel.get("currentSignature"):
                raise RuntimeError(f"World-state inspector missing stable identity/signatures: {panel}")
            if int(panel.get("serializedBytes") or 0)<=0:
                raise RuntimeError(f"World-state sparse storage telemetry missing: {panel}")

        baseline=panels[0]
        changed=panels[1:]
        if baseline.get("liveDelta") or int(baseline.get("deltaEntryCount") or 0)!=0 or int(baseline.get("deltaRevision") or 0)!=0:
            raise RuntimeError(f"World-state baseline was not sparse/clean: {baseline}")
        if baseline.get("status")!="foundation-only" or baseline.get("currentSignature")!=baseline.get("foundationSignature"):
            raise RuntimeError(f"World-state baseline CurrentWorld did not equal foundation: {baseline}")
        if any(not panel.get("liveDelta") for panel in changed):
            raise RuntimeError(f"World-state campaign delta disappeared after mutation: {changed}")
        if any(int(panel.get("deltaEntryCount") or 0)!=1 or int(panel.get("deltaRevision") or 0)!=1 for panel in changed):
            raise RuntimeError(f"World-state sparse delta count/revision changed unexpectedly: {changed}")
        if any(panel.get("status")!="persistent-change" for panel in changed):
            raise RuntimeError(f"World-state CurrentWorld lost persistent campaign status: {changed}")
        foundation_signatures={panel.get("foundationSignature") for panel in panels}
        if len(foundation_signatures)!=1:
            raise RuntimeError(f"SeedFoundation changed across delta/cache/camera/reload evidence: {panels}")
        if changed[0].get("currentSignature")==baseline.get("currentSignature") or changed[0].get("currentSignature")==changed[0].get("foundationSignature"):
            raise RuntimeError(f"Campaign delta did not alter CurrentWorld: {baseline} -> {changed[0]}")
        if len({panel.get("currentSignature") for panel in changed})!=1:
            raise RuntimeError(f"CurrentWorld changed across eviction/camera/distant-query/reload: {changed}")
        if len({panel.get("serializedBytes") for panel in changed})!=1:
            raise RuntimeError(f"Sparse save payload changed without campaign changes: {changed}")
        if panels[5].get("focusId")!=panels[1].get("focusId") or panels[5].get("currentSignature")!=panels[1].get("currentSignature"):
            raise RuntimeError(f"World-state changed after full page reload: {panels[1]} -> {panels[5]}")
        if "drag-" not in str(frames[3].get("action") or ""):
            raise RuntimeError(f"World-state camera-independence frame did not move camera: {frames[3].get('action')}")
        return

    if scenario == "wp-s006-006":
        if len(frames) < 6:
            raise RuntimeError("wp-s006-006 requires six settlement-building evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("settlementBuildingCatalog") or {} for build in builds]
        panels=[build.get("settlementBuildingCatalogPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Settlement-building evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Settlement building planning mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"timeIndependent":True,"catalogCoverage":True,
            "metadataComplete":True,"contextualValidity":True,"portConstraint":True,
            "agricultureConstraint":True,"miningConstraint":True,"scaleLeakagePrevented":True,
            "capitalFunctions":True,"startingVillageMapped":True,"classCoverage":True,
            "contextualDiversity":True,"classDifferences":True,"requiredSignalsSatisfied":True,"selectedHasReasons":True,
            "logicalAssetOnly":True,"noTemplateClone":True,"authorityPreserved":True,
            "physicalLayoutCreated":False,"terrainMutation":False,"resourceMutation":False,
            "npcStateCreated":False,"finalArtRequired":False,"renderDependency":False,
            "fullWorldMaterialized":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Settlement-building proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("catalogCount") or 0)<30 or int(proof.get("categoryCount") or 0)<9:
                raise RuntimeError(f"Settlement-building catalog coverage too small in frame {index}: {proof}")
            if int(proof.get("planCount") or 0)<12 or int(proof.get("representativeCount") or 0)!=5:
                raise RuntimeError(f"Settlement-building proof sample set insufficient in frame {index}: {proof}")

        expected=["agricultural-village","trade-town","city","national-capital","resource-specialist"]
        if [panel.get("reason") for panel in panels[:5]]!=expected:
            raise RuntimeError(f"Settlement-building representative order mismatch: {panels[:5]}")
        classes=[panel.get("classId") for panel in panels[:5]]
        if classes[0]!="village" or classes[1]!="town" or classes[2]!="city" or classes[3]!="national-capital":
            raise RuntimeError(f"Village/town/city/capital evidence incomplete: {classes}")
        if len({panel.get("signature") for panel in panels[:5]})<4:
            raise RuntimeError(f"Settlement-building compositions are too template-like: {panels[:5]}")
        for panel in panels:
            if not panel.get("open") or int(panel.get("comparisonRows") or 0)!=5:
                raise RuntimeError(f"Settlement-building panel/comparison incomplete: {panel}")
            if int(panel.get("functionRows") or 0)<4 or int(panel.get("villageMapRows") or 0)!=7:
                raise RuntimeError(f"Settlement-building function/mapping evidence incomplete: {panel}")
            if not panel.get("villageMapped") or not panel.get("capitalFunctions"):
                raise RuntimeError(f"Settlement-building village/capital proof missing: {panel}")
        if panels[3].get("functionCount",0)<=panels[0].get("functionCount",0):
            raise RuntimeError(f"Capital composition is not richer than village composition: {panels[:5]}")
        if panels[0].get("compositionId")!=panels[5].get("compositionId") or panels[0].get("revision")!=panels[5].get("revision"):
            raise RuntimeError("Settlement-building composition changed after reload")
        if json.dumps(proofs[0],sort_keys=True)!=json.dumps(proofs[5],sort_keys=True):
            raise RuntimeError("Settlement-building foundation changed after reload")
        return

    if scenario == "wp-s006-005":
        if len(frames) < 6:
            raise RuntimeError("wp-s006-005 requires six settlement-archetype evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        proofs=[build.get("settlementArchetype") or {} for build in builds]
        panels=[build.get("settlementArchetypePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Settlement evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Settlement planner mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"timeIndependent":True,"numericValid":True,
            "geographyValid":True,"physicalConstraints":True,"classSupport":True,"capitalScale":True,
            "contextComplete":True,"countryRegionTerrainInfluence":True,"cloneAvoidance":True,
            "genericPlanner":True,"lazyQueryable":True,"authorityPreserved":True,"representativeCoverage":True,
            "terrainMutation":False,"resourceMutation":False,"npcPopulationCreated":False,
            "physicalLayoutCreated":False,"liveEconomyCreated":False,"renderDependency":False,"fullWorldMaterialized":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Settlement-archetype proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("planCount") or 0)<12 or int(proof.get("representativeCount") or 0)!=5:
                raise RuntimeError(f"Settlement plan sample set insufficient in frame {index}: {proof}")
            if int(proof.get("classCount") or 0)<3 or int(proof.get("subtypeCount") or 0)<4:
                raise RuntimeError(f"Settlement class/subtype diversity insufficient in frame {index}: {proof}")

        expected=["agricultural","mining","trade","frontier-fortified","capital"]
        if [panel.get("reason") for panel in panels[:5]]!=expected:
            raise RuntimeError(f"Settlement evidence roles are incomplete: {panels[:5]}")
        first_five=panels[:5]
        if len({panel.get("planId") for panel in first_five})!=5:
            raise RuntimeError(f"Settlement evidence did not inspect five distinct examples: {first_five}")
        if len({panel.get("context") for panel in first_five})<4 or len({panel.get("planning") for panel in first_five})<4:
            raise RuntimeError(f"Settlement contexts/planning outputs did not visibly diverge: {first_five}")
        if panels[4].get("classId")!="national-capital":
            raise RuntimeError(f"Capital evidence is not national-capital scale: {panels[4]}")
        if panels[0].get("classId") not in {"hamlet","village"}:
            raise RuntimeError(f"Agricultural evidence is not village-scale: {panels[0]}")
        if panels[2].get("classId") not in {"town","city"}:
            raise RuntimeError(f"Trade evidence is not town/city scale: {panels[2]}")
        for panel in panels:
            if not panel.get("open") or int(panel.get("comparisonRows") or 0)!=5:
                raise RuntimeError(f"Settlement panel/comparison incomplete: {panel}")
            if int(panel.get("tagCount") or 0)<1 or int(panel.get("weightCount") or 0)!=7:
                raise RuntimeError(f"Settlement tags/weights incomplete: {panel}")
            if panel.get("port",0)>0 and not panel.get("coastal"):
                raise RuntimeError(f"Settlement port weighting violated physical coastal constraint: {panel}")
        if panels[0].get("planId")!=panels[5].get("planId") or panels[0].get("revision")!=panels[5].get("revision"):
            raise RuntimeError("Settlement archetype changed after reload")
        if json.dumps(proofs[0],sort_keys=True)!=json.dumps(proofs[5],sort_keys=True):
            raise RuntimeError("Settlement-archetype foundation changed after reload")
        return

    if scenario == "wp-s006-004":
        if len(frames) < 5:
            raise RuntimeError("wp-s006-004 requires five country-relations evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("countryRelations") or {} for build in builds]
        panels=[build.get("countryRelationsPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Country-relations evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Country diplomacy mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"reversedSymmetric":True,"timeIndependent":True,
            "numericValid":True,"agreementSymmetry":True,"directionalSupported":True,
            "orientationSeparated":True,"mercantileNotUniversal":True,"militaristicNotWar":True,
            "adjacencyContext":True,"lazyQueryable":True,"overlayReady":True,
            "liveDiplomacy":False,"warDeclarations":False,"treatyNegotiation":False,
            "countryProfileMutation":False,"politicalMutation":False,"renderDependency":False,"fullWorldMaterialized":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Country-relations proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("relationCount") or 0)<8 or int(proof.get("representativeCount") or 0)<4:
                raise RuntimeError(f"Country-relations sample set too small in frame {index}: {proof}")
            if int(proof.get("tradeFriendlyCount") or 0)<1 or int(proof.get("tenseRivalCount") or 0)<1 or int(proof.get("stateCount") or 0)<3:
                raise RuntimeError(f"Country-relations variety insufficient in frame {index}: {proof}")

        first_four=panels[:4]
        if len({panel.get("relationId") for panel in first_four})<3:
            raise RuntimeError(f"Country-relations evidence did not inspect three pairs: {first_four}")
        if "trade-friendly" not in {panel.get("kind") for panel in first_four}:
            raise RuntimeError(f"Country-relations evidence lacks trade-friendly pair: {first_four}")
        if "tense-rival" not in {panel.get("kind") for panel in first_four}:
            raise RuntimeError(f"Country-relations evidence lacks tense/rival pair: {first_four}")
        for panel in panels:
            if not panel.get("open") or int(panel.get("comparisonRows") or 0)<4:
                raise RuntimeError(f"Country-relations panel/comparison incomplete: {panel}")
            if int(panel.get("agreementCount") or 0)!=4 or int(panel.get("directionCount") or 0)!=2:
                raise RuntimeError(f"Country-relations agreements/directions incomplete: {panel}")
        if panels[0].get("kind")!="trade-friendly":
            raise RuntimeError(f"First relation is not trade-friendly: {panels[0]}")
        if panels[1].get("kind")!="tense-rival":
            raise RuntimeError(f"Second relation is not tense/rival: {panels[1]}")
        if panels[0].get("trade",0)<0.60 or panels[1].get("tension",0)<0.58:
            raise RuntimeError(f"Trade/tension evidence thresholds not met: {panels[:2]}")
        if panels[0].get("relationId")!=panels[4].get("relationId") or panels[0].get("revision")!=panels[4].get("revision"):
            raise RuntimeError("Country relation changed after reload")
        if json.dumps(proofs[0],sort_keys=True)!=json.dumps(proofs[4],sort_keys=True):
            raise RuntimeError("Country-relations foundation changed after reload")
        return

    if scenario == "wp-s006-003":
        if len(frames) < 5:
            raise RuntimeError("wp-s006-003 requires five region-profile evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("regionProfile") or {} for build in builds]
        panels=[build.get("regionProfilePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Region-profile evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Region profiles mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,"deterministic":True,"timeIndependent":True,
            "parentCountryCorrect":True,"hierarchyIntegrated":True,"numericValid":True,
            "sameCountry":True,"sameCountryProfile":True,"geographyRedirectsCountry":True,
            "independentLayers":True,"lazyQueryable":True,"overlayReady":True,
            "duplicateOwnership":False,"terrainMutation":False,"resourceMutation":False,
            "liveRegionalEconomy":False,"renderDependency":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Region-profile proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("regionCount") or 0)<5 or int(proof.get("representativeCount") or 0)<3:
                raise RuntimeError(f"Region-profile sample set too small in frame {index}: {proof}")
            if int(proof.get("identityCount") or 0)<3 or int(proof.get("specializationCount") or 0)<3:
                raise RuntimeError(f"Region-profile diversity insufficient in frame {index}: {proof}")
            if float(proof.get("maxRegionalDifference") or 0)<0.55:
                raise RuntimeError(f"Same-country regional difference too weak in frame {index}: {proof}")

        first_four=panels[:4]
        if len({panel.get("parentCountryId") for panel in first_four})!=1:
            raise RuntimeError(f"Region evidence does not remain inside one parent country: {first_four}")
        if len({panel.get("countryRevision") for panel in first_four})!=1:
            raise RuntimeError(f"Region evidence does not share one CountryProfile orientation: {first_four}")
        if len({panel.get("regionId") for panel in first_four})<3:
            raise RuntimeError(f"Region evidence did not inspect at least three regions: {first_four}")
        if len({panel.get("identity") for panel in first_four})<3:
            raise RuntimeError(f"Region terrain/resource identities are not diverse: {first_four}")
        if len({panel.get("specialization") for panel in first_four})<3:
            raise RuntimeError(f"Same-country regional specialization did not diverge: {first_four}")
        for panel in panels:
            if not panel.get("open") or int(panel.get("comparisonRows") or 0)<3:
                raise RuntimeError(f"Region-profile panel/comparison incomplete: {panel}")
            if len(panel.get("specializationLabels") or [])!=7:
                raise RuntimeError(f"Region specialization bars incomplete: {panel}")
        if panels[0].get("regionId")!=panels[4].get("regionId") or panels[0].get("revision")!=panels[4].get("revision"):
            raise RuntimeError("Region profile changed after reload")
        if json.dumps(proofs[0],sort_keys=True)!=json.dumps(proofs[4],sort_keys=True):
            raise RuntimeError("Region-profile foundation changed after reload")
        return

    if scenario == "wp-s006-002":
        if len(frames) < 5:
            raise RuntimeError("wp-s006-002 requires five country-profile evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("countryProfile") or {} for build in builds]
        panels=[build.get("countryProfilePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Country-profile evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Country profiles mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,
            "deterministic":True,
            "timeIndependent":True,
            "numericValid":True,
            "maritimePlausible":True,
            "miningPlausible":True,
            "geographyPreserved":True,
            "capitalLinked":True,
            "weightedNotExclusive":True,
            "overlayReady":True,
            "dynamicStateCreated":False,
            "terrainMutation":False,
            "resourceMutation":False,
            "renderDependency":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Country-profile proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("profileCount") or 0)<9 or int(proof.get("representativeCount") or 0)<3:
                raise RuntimeError(f"Country-profile sample set too small in frame {index}: {proof}")
            if int(proof.get("wealthBandCount") or 0)<3 or int(proof.get("strategicMixCount") or 0)<3 or int(proof.get("geographyVariety") or 0)<3:
                raise RuntimeError(f"Country-profile diversity insufficient in frame {index}: {proof}")

        for panel in panels:
            if not panel.get("open") or int(panel.get("comparisonRows") or 0)<3:
                raise RuntimeError(f"Country-profile panel/comparison incomplete: {panel}")
            if len(panel.get("tendencyLabels") or [])!=8:
                raise RuntimeError(f"Country-profile weighted tendencies incomplete: {panel}")
            if float(panel.get("maritime") or 0)>0.080001 and float(panel.get("waterAccess") or 0)<0.08:
                raise RuntimeError(f"Landlocked maritime emphasis is implausible: {panel}")
            if float(panel.get("mining") or 0)>float(panel.get("mineralPotential") or 0)+1e-9:
                raise RuntimeError(f"Mining emphasis exceeds mineral potential: {panel}")

        first_four=panels[:4]
        if len({panel.get("countryId") for panel in first_four})<3:
            raise RuntimeError(f"Country-profile evidence did not inspect three countries: {first_four}")
        if len({panel.get("mix") for panel in first_four})<3:
            raise RuntimeError(f"Country-profile evidence did not inspect three strategic mixes: {first_four}")
        if len({round(float(panel.get("wealth") or 0),3) for panel in first_four})<3:
            raise RuntimeError(f"Country-profile evidence did not inspect three wealth values: {first_four}")
        if panels[0].get("profileId")!=panels[4].get("profileId") or panels[0].get("revision")!=panels[4].get("revision"):
            raise RuntimeError("Country profile changed after reload")
        if json.dumps(proofs[0],sort_keys=True)!=json.dumps(proofs[4],sort_keys=True):
            raise RuntimeError("Country-profile foundation changed after reload")
        return

    if scenario == "wp-s006-001":
        if len(frames) < 5:
            raise RuntimeError("wp-s006-001 requires five political-geography evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("politicalGeography") or {} for build in builds]
        panels=[build.get("politicalGeographyPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Political-geography evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Political geography mutated Protagonist world position: {protagonists}")
        required={
            "pass":True,
            "deterministic":True,
            "neighborsStable":True,
            "timeIndependent":True,
            "terrainAuthorityPreserved":True,
            "hierarchyIntegrated":True,
            "lazyQueryable":True,
            "fullWorldMaterialized":False,
            "capitalInside":True,
            "borderSamplePass":True,
            "naturalFeatureInfluence":True,
            "nonRectangular":True,
            "liveBorderChanges":False,
            "terrainMutation":False,
            "renderDependency":False,
        }
        for index,proof in enumerate(proofs,start=1):
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Political-geography proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("candidateCountPerLookup") or 0)!=9:
                raise RuntimeError(f"Political lookup is not bounded to nine candidates in frame {index}: {proof}")
            if len(proof.get("neighbors") or [])<2 or len(proof.get("borders") or [])<1:
                raise RuntimeError(f"Political neighbors/borders are missing in frame {index}: {proof}")
            if not proof.get("origin",{}).get("capital",{}).get("id"):
                raise RuntimeError(f"Political capital missing in frame {index}: {proof}")

        country_ids=[panel.get("countryId") for panel in panels]
        if len(set(country_ids))!=1 or not country_ids[0]:
            raise RuntimeError(f"Political origin country changed across evidence: {country_ids}")
        for panel in panels:
            if not panel.get("open") or panel.get("mapCells")!=91:
                raise RuntimeError(f"Political evidence panel/map incomplete: {panel}")
            if not panel.get("capital") or "local candidates" not in str(panel.get("lookupBudget") or ""):
                raise RuntimeError(f"Political capital/lazy lookup not visible: {panel}")
            if float(panel.get("featureShift") or 0)<1:
                raise RuntimeError(f"Selected political border lacks measured geographic influence: {panel}")
            if not panel.get("borderA") or not panel.get("borderB") or panel.get("borderA")==panel.get("borderB"):
                raise RuntimeError(f"Political border owners invalid: {panel}")

        distinct_pairs={(panel.get("borderA"),panel.get("borderB")) for panel in panels[:4]}
        if len(distinct_pairs)<2:
            raise RuntimeError(f"Political evidence did not inspect multiple borders: {panels}")
        before=proofs[0]
        after=proofs[4]
        if json.dumps(before,sort_keys=True)!=json.dumps(after,sort_keys=True):
            raise RuntimeError("Political foundation changed after page reload")
        if panels[0].get("borderId")!=panels[4].get("borderId"):
            raise RuntimeError("Political border selection changed after reload")
        return

    if scenario == "wp-s005-005":
        if len(frames) < 5:
            raise RuntimeError("wp-s005-005 requires five social-state evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("socialState") or {} for build in builds]
        panels=[build.get("socialStatePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Social-state evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Social state mutated Protagonist world position: {protagonists}")
        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,
                "relationshipsValid":True,
                "reputationsValid":True,
                "dutiesValid":True,
                "deterministicEvents":True,
                "replayStable":True,
                "storageRoundTrip":True,
                "simulationBacked":True,
                "directAllianceEnemyState":False,
                "worldAuthorityCreated":False,
                "resourcesCreated":False,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Social-state proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("relationshipCount") or 0)<1 or int(proof.get("reputationCount") or 0)<5 or int(proof.get("dutyCount") or 0)<3:
                raise RuntimeError(f"Social-state proof is incomplete in frame {index}: {proof}")
        for index,proof in enumerate(proofs[2:],start=3):
            if proof.get("reputationScopeCoverage") is not True or proof.get("dutyStatusCoverage") is not True or proof.get("eventResponseCoverage") is not True:
                raise RuntimeError(f"Social-state event/scope coverage incomplete in frame {index}: {proof}")

        if any(panel.get("profession")!="smith" for panel in panels):
            raise RuntimeError(f"Social proof did not target the deterministic smith resident: {panels}")
        required_scopes=sorted(["role","house","guild","family","settlement"])
        for panel in panels:
            if sorted(panel.get("reputationScopes") or [])!=required_scopes:
                raise RuntimeError(f"Social reputation scopes are incomplete: {panel}")
        if "active" not in (panels[0].get("dutyStatuses") or []):
            raise RuntimeError(f"Baseline active duty is not inspectable: {panels[0]}")
        if not all(state in (panels[1].get("dutyStatuses") or []) for state in ["active","fulfilled"]):
            raise RuntimeError(f"Fulfilled duty progression is not inspectable: {panels[1]}")
        for panel in panels[2:]:
            statuses=panel.get("dutyStatuses") or []
            if not all(state in statuses for state in ["active","fulfilled","breached"]):
                raise RuntimeError(f"Final active/fulfilled/breached duty states are not simultaneously inspectable: {panel}")

        trusts=[float(panel.get("trust") or 0) for panel in panels]
        suspicions=[float(panel.get("suspicion") or 0) for panel in panels]
        if not (trusts[1]>trusts[0] and trusts[2]<trusts[1]):
            raise RuntimeError(f"Trust did not rise after truthful/helpful history then fall after broken obligations: {trusts}")
        if not suspicions[2]>suspicions[1]:
            raise RuntimeError(f"Suspicion did not increase after broken promise/duty: {suspicions}")
        if panels[1].get("dialogueTone")!="friendly" or panels[2].get("dialogueTone") not in {"guarded","hostile"}:
            raise RuntimeError(f"Persistent relationship/reputation did not affect dialogue tone as expected: {panels}")
        if panels[1].get("adviceDecision")!="accepted" or panels[2].get("adviceDecision")!="rejected":
            raise RuntimeError(f"Persistent social state did not affect advice outcome as expected: {panels}")
        if not all(panel.get("eventCount",0)>=8 for panel in panels[2:]):
            raise RuntimeError(f"Social event history lost records: {panels}")

        before=proofs[3].get("snapshot") or {}
        after=proofs[4].get("snapshot") or {}
        if json.dumps(before,sort_keys=True)!=json.dumps(after,sort_keys=True):
            raise RuntimeError("Social state changed after page reload")
        return

    if scenario == "wp-s005-004":
        if len(frames) < 5:
            raise RuntimeError("wp-s005-004 requires five advice resolution evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("adviceResolution") or {} for build in builds]
        panels=[build.get("adviceResolutionPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Advice resolution evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Advice resolution mutated Protagonist world position: {protagonists}")
        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,
                "adviceStatusSync":True,
                "memoryLinked":True,
                "memoryEffects":True,
                "simulationValidated":True,
                "executionBoundary":True,
                "decisionsCovered":True,
                "deterministicIds":True,
                "deterministicReplay":True,
                "storageRoundTrip":True,
                "protagonistAgencyPreserved":True,
                "worldMutationApi":False,
                "actionExecutionInvoked":False,
                "relationshipPersistenceIntroduced":False,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Advice resolution proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("entryCount") or 0)!=4:
                raise RuntimeError(f"Advice resolution entry count mismatch in frame {index}: {proof}")
        expected=["accepted","deferred","rejected","modified","accepted"]
        actual=[panel.get("decision") for panel in panels]
        if actual!=expected:
            raise RuntimeError(f"Advice resolution decision sequence mismatch: {actual}")
        if any(int(panel.get("entryCount") or 0)!=4 for panel in panels):
            raise RuntimeError(f"Advice resolution panel lost event records: {panels}")
        for panel in panels:
            decisions=panel.get("eventDecisions") or []
            if sorted(decisions)!=sorted(["accepted","deferred","rejected","modified"]):
                raise RuntimeError(f"Advice decision event log incomplete: {panel}")
            if not str(panel.get("memoryId") or "").startswith("MEM-protagonist-"):
                raise RuntimeError(f"Advice decision memory link missing: {panel}")
        before=proofs[0].get("entries") or []
        after=proofs[4].get("entries") or []
        if json.dumps(before,sort_keys=True)!=json.dumps(after,sort_keys=True):
            raise RuntimeError("Advice resolution ledger changed after page reload")
        accepted=next((entry for entry in before if entry.get("decision")=="accepted"),None)
        modified=next((entry for entry in before if entry.get("decision")=="modified"),None)
        rejected=next((entry for entry in before if entry.get("decision")=="rejected"),None)
        deferred=next((entry for entry in before if entry.get("decision")=="deferred"),None)
        if not accepted or not accepted.get("executionAllowed") or not (accepted.get("finalValidation") or {}).get("ok"):
            raise RuntimeError(f"Accepted advice did not pass Simulation gate: {accepted}")
        if not modified or not modified.get("executionAllowed") or not (modified.get("finalValidation") or {}).get("ok"):
            raise RuntimeError(f"Modified advice did not pass revised Simulation gate: {modified}")
        if (modified.get("originalValidation") or {}).get("ok") is not False:
            raise RuntimeError(f"Modified proof did not demonstrate incompatible original intent: {modified}")
        if rejected and rejected.get("executionAllowed"):
            raise RuntimeError(f"Rejected advice became executable: {rejected}")
        if deferred and deferred.get("executionAllowed"):
            raise RuntimeError(f"Deferred advice became executable: {deferred}")
        return

    if scenario == "wp-s005-003":
        if len(frames) < 5:
            raise RuntimeError("wp-s005-003 requires five dialogue context evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("dialogueContext") or {} for build in builds]
        panels=[build.get("dialoguePanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Dialogue evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Dialogue context mutated Protagonist world position: {protagonists}")
        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,
                "identitiesPresent":True,
                "contextComplete":True,
                "socialComplete":True,
                "tonesExpected":True,
                "statesMeaningful":True,
                "deterministic":True,
                "knowledgeGrounded":True,
                "noInventedFacts":True,
                "relationshipPersistenceIntroduced":False,
                "worldMutationApi":False,
                "factsCreatedByDialogue":False,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Dialogue context proof {key} mismatch in frame {index}: {proof}")
        expected_cases=["public-friendly","home-guarded","work-formal","travel-urgent","sleep-private"]
        expected_tones=["friendly","guarded","formal","urgent","private"]
        expected_activities=["speaking","eating","working","traveling","sleeping"]
        if [panel.get("caseId") for panel in panels]!=expected_cases:
            raise RuntimeError(f"Dialogue case sequence mismatch: {panels}")
        if [panel.get("tone") for panel in panels]!=expected_tones:
            raise RuntimeError(f"Dialogue tone sequence mismatch: {panels}")
        if [panel.get("activity") for panel in panels]!=expected_activities:
            raise RuntimeError(f"Dialogue activity sequence mismatch: {panels}")
        if not all((panel.get("speaker") or "").endswith("(R03)") and panel.get("listener")=="Protagonist" for panel in panels):
            raise RuntimeError(f"Dialogue identity presentation mismatch: {panels}")
        if not all("Grounded memory:" in (panel.get("grounding") or "") and "MEM-R03-" in (panel.get("grounding") or "") for panel in panels):
            raise RuntimeError(f"Dialogue response grounding missing: {panels}")
        ids=[panel.get("dialogueId") for panel in panels]
        if len(set(ids))!=len(ids) or any(not value for value in ids):
            raise RuntimeError(f"Dialogue context IDs are not stable/distinct: {ids}")
        return

    if scenario == "wp-s005-002":
        if len(frames) < 4:
            raise RuntimeError("wp-s005-002 requires four memory evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:4]]
        proofs=[build.get("characterMemory") or {} for build in builds]
        panels=[build.get("memoryPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Memory evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Memory evidence mutated Protagonist world position: {protagonists}")

        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,
                "sharedRecordFormat":True,
                "uniqueIds":True,
                "sequenceStable":True,
                "deterministicIds":True,
                "traceable":True,
                "uncertainPreserved":True,
                "authoritySafe":True,
                "adviceRefsTraceable":True,
                "storageRoundTrip":True,
                "worldMutationApi":False,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Character memory proof {key} mismatch in frame {index}: {proof}")
            if int(proof.get("actorCount") or 0) < 2 or int(proof.get("entryCount") or 0) < 7:
                raise RuntimeError(f"Character memory evidence is incomplete in frame {index}: {proof}")

        expected_actor_keys=["protagonist:protagonist","protagonist:protagonist","resident:R03","protagonist:protagonist"]
        actor_keys=[panel.get("actorKey") for panel in panels]
        if actor_keys!=expected_actor_keys:
            raise RuntimeError(f"Memory debug actor sequence mismatch: {actor_keys}")

        if panels[0].get("renderedEntries")!=5 or panels[2].get("renderedEntries")!=2:
            raise RuntimeError(f"Shared protagonist/resident memory formats not visibly populated: {panels}")
        if int(panels[0].get("uncertainRendered") or 0) < 1 or int(panels[2].get("uncertainRendered") or 0) < 1:
            raise RuntimeError(f"Uncertain memory state not visibly retained: {panels}")

        def actor_entries(proof,kind,actor_id):
            for ledger in proof.get("actors") or []:
                actor=ledger.get("actor") or {}
                if actor.get("kind")==kind and actor.get("id")==actor_id:
                    return ledger.get("entries") or []
            return []
        before=actor_entries(proofs[0],"protagonist","protagonist")
        after=actor_entries(proofs[3],"protagonist","protagonist")
        if json.dumps(before,sort_keys=True)!=json.dumps(after,sort_keys=True):
            raise RuntimeError("Protagonist memory changed after campaign page reload")
        if not any((entry.get("source") or {}).get("type")=="simulation" and entry.get("authority")=="simulation-truth" for entry in before):
            raise RuntimeError("Simulation-sourced world fact is missing from protagonist memory")
        if not any(entry.get("uncertain") is True and (entry.get("source") or {}).get("type")=="rumor" for entry in before):
            raise RuntimeError("Uncertain rumor did not remain explicitly uncertain")
        if not any((entry.get("externalRef") or {}).get("type")=="advice" for entry in before):
            raise RuntimeError("Stable advice reference is missing from protagonist memory")
        return

    if scenario == "wp-s005-001":
        if len(frames) < 4:
            raise RuntimeError("wp-s005-001 requires four advisor evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:4]]
        proofs=[build.get("advisorChannel") or {} for build in builds]
        panels=[build.get("advisorPanel") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Advisor evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Advice mutated Protagonist world position: {protagonists}")

        expected=[
            ["delivered","delivered","delivered","delivered"],
            ["considered","considered","deferred","considered"],
            ["accepted","rejected","deferred","forgotten"],
            ["accepted","rejected","deferred","forgotten"],
        ]
        observed=[[entry.get("status") for entry in (proof.get("entries") or [])] for proof in proofs]
        if observed!=expected:
            raise RuntimeError(f"Advisor status chronology mismatch: expected {expected}, got {observed}")

        for index,proof in enumerate(proofs,start=1):
            required={
                "pass":True,
                "stableAdvisor":True,
                "uniqueIds":True,
                "sequenceStable":True,
                "validFields":True,
                "validHistory":True,
                "deterministicIds":True,
                "storageRoundTrip":True,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Advisor proof {key} mismatch in frame {index}: {proof}")
            if proof.get("entryCount")!=4:
                raise RuntimeError(f"Advisor entry count mismatch in frame {index}: {proof}")
            advisor=proof.get("advisor") or {}
            if advisor.get("campaignSeed")!=seeds[index-1] or advisor.get("protagonistId")!="protagonist":
                raise RuntimeError(f"Stable advisor identity mismatch in frame {index}: {advisor}")

        ids=[[entry.get("id") for entry in (proof.get("entries") or [])] for proof in proofs]
        if any(row!=ids[0] for row in ids[1:]):
            raise RuntimeError(f"Advice entry identity changed across transitions/reload: {ids}")
        topics=[[entry.get("topic") for entry in (proof.get("entries") or [])] for proof in proofs]
        targets=[[entry.get("target",{}).get("label") for entry in (proof.get("entries") or [])] for proof in proofs]
        if any(row!=topics[0] for row in topics[1:]) or any(row!=targets[0] for row in targets[1:]):
            raise RuntimeError("Advice topic/target changed after protagonist reaction or reload")

        if json.dumps(proofs[2].get("entries"),sort_keys=True)!=json.dumps(proofs[3].get("entries"),sort_keys=True):
            raise RuntimeError("Persistent advice log changed after campaign page reload")

        for index,panel in enumerate(panels,start=1):
            if panel.get("present") is not True or panel.get("rowCount")!=4 or panel.get("formPresent") is not True:
                raise RuntimeError(f"Advisor UI incomplete in frame {index}: {panel}")
            if panel.get("deliverEnabled") is not True:
                raise RuntimeError(f"Advisor delivery form unexpectedly disabled in frame {index}: {panel}")
            boundary=(panel.get("boundary") or "").lower()
            if "protagonist decides" not in boundary or "simulation remains authoritative" not in boundary:
                raise RuntimeError(f"Advisor authority boundary missing in frame {index}: {panel}")
            if panel.get("advisorRecordId")!=(proofs[index-1].get("advisor") or {}).get("id"):
                raise RuntimeError(f"Advisor UI record ID mismatch in frame {index}: {panel}")

        final_statuses=set(panels[2].get("statuses") or [])
        for status in ("accepted","rejected","deferred","forgotten"):
            if status not in final_statuses:
                raise RuntimeError(f"Final Advisor UI does not visibly expose {status}: {panels[2]}")
        return

    if scenario == "wp-s004-005":
        if len(frames) < 5:
            raise RuntimeError("wp-s004-005 requires five action evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("residentAction") or {} for build in builds]
        verifies=[build.get("residentActionVerify") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Action evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Action evidence changed Protagonist authority: {protagonists}")
        expected=["arrival-required","sleep-active","sleep-complete-offscreen","route-next-goal","work-active"]
        stages=[proof.get("stage") for proof in proofs]
        if stages!=expected:
            raise RuntimeError(f"Action milestone mismatch: expected {expected}, got {stages}")
        for index,verified in enumerate(verifies,start=1):
            required={
                "pass":True,"requiredActionPass":True,"incompatibleRejected":True,
                "outOfRangeRejected":True,"arrivalRequired":True,
                "genericNpcContract":True,"genericProtagonistContract":True,
                "deterministic":True,"rendererDependency":False,"presentationAuthority":False,
                "economyIntroduced":False,"combatIntroduced":False,
                "fullInventoryIntroduced":False,"externalLlmIntroduced":False,
            }
            for key,value in required.items():
                if verified.get(key)!=value:
                    raise RuntimeError(f"Action contract {key} mismatch in frame {index}: {verified}")
            actions=verified.get("requiredActions") or {}
            for action in ("sleep","rest","sit","eat","work"):
                result=actions.get(action) or {}
                if result.get("start") is not True or result.get("complete") is not True:
                    raise RuntimeError(f"Required action {action} failed contract proof in frame {index}: {result}")
        final=proofs[-1]
        dynamic={
            "pass":True,"arrivalRejected":True,"actionStarted":True,"heldAtTarget":True,
            "actionCompleted":True,"offscreenStatePass":True,"rendererCullingPass":True,
            "scheduleReleasePass":True,"nextGoalRoutingPass":True,"workStarted":True,
            "cameraRoundTripPass":True,
        }
        for key,value in dynamic.items():
            if final.get(key)!=value:
                raise RuntimeError(f"Resident action proof {key} mismatch: {final}")
        if (proofs[1].get("current") or {}).get("action")!="sleep" or (proofs[1].get("current") or {}).get("status")!="active":
            raise RuntimeError(f"Sleep did not start after arrival: {proofs[1]}")
        if (proofs[2].get("current") or {}).get("status")!="complete":
            raise RuntimeError(f"Sleep did not complete/hold at interaction target: {proofs[2]}")
        if proofs[3].get("current") is not None:
            raise RuntimeError(f"Schedule change did not release prior action: {proofs[3]}")
        if (proofs[4].get("current") or {}).get("action")!="work" or (proofs[4].get("current") or {}).get("status")!="active":
            raise RuntimeError(f"Work action did not start at next target: {proofs[4]}")
        for frame_index in (1,2,4):
            ribbon=builds[frame_index].get("residentActionRibbon") or {}
            if ribbon.get("hidden") is not False or not ribbon.get("state"):
                raise RuntimeError(f"Visible action ribbon missing in frame {frame_index+1}: {ribbon}")
        for index,build in enumerate(builds,start=1):
            live=build.get("residentActionLive") or {}
            if live.get("rendererDependency") is not False or live.get("presentationAuthority") is not False:
                raise RuntimeError(f"Action authority leaked into presentation in frame {index}: {live}")
        return

    if scenario == "wp-s004-004-001":
        if len(frames) < 6:
            raise RuntimeError("wp-s004-004-001 requires six NPC/building coherence evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        evidence=[build.get("npcBuildingCoherence") or {} for build in builds]
        expected=["approach","door","inside","behind","front","overlap"]
        stages=[item.get("stage") for item in evidence]
        if stages!=expected:
            raise RuntimeError(f"NPC building coherence stage mismatch: expected {expected}, got {stages}")
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"NPC building coherence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"NPC building coherence changed Protagonist authority: {protagonists}")

        approach=evidence[0]
        if approach.get("visible") is not True or approach.get("hiddenIndoor") or approach.get("hiddenOccluded"):
            raise RuntimeError(f"NPC is not visible immediately before the real door: {approach}")
        if approach.get("currentBuildingId") is not None or approach.get("nextDoorwayKind")!="exterior-door":
            raise RuntimeError(f"NPC approach did not stop one legal step before exterior door: {approach}")
        if int(approach.get("distanceToDoor") or 0)!=1:
            raise RuntimeError(f"NPC approach is not adjacent to door: {approach}")
        if approach.get("doorSide") not in ("S","E"):
            raise RuntimeError(f"NPC home door is on a hidden camera face: {approach}")

        door=evidence[1]
        if door.get("visible") is not False or door.get("hiddenIndoor") is not True:
            raise RuntimeError(f"NPC did not disappear at exterior doorway: {door}")
        if not door.get("currentBuildingId") or door.get("doorwayKind")!="exterior-door":
            raise RuntimeError(f"Door disappearance is not tied to real exterior-door occupancy: {door}")

        inside=evidence[2]
        if inside.get("visible") is not False or inside.get("hiddenIndoor") is not True:
            raise RuntimeError(f"Indoor NPC remained visibly rendered: {inside}")
        if not inside.get("currentBuildingId"):
            raise RuntimeError(f"Indoor NPC lacks authoritative building occupancy: {inside}")
        if inside.get("cutawayActive") is not False or int(inside.get("hiddenRoofCount") or 0)!=0:
            raise RuntimeError(f"NPC movement incorrectly cut away the building roof: {inside}")

        behind=evidence[3]
        if behind.get("visible") is not False or behind.get("hiddenOccluded") is not True or behind.get("hiddenIndoor"):
            raise RuntimeError(f"Outdoor NPC behind building was not fully occluded: {behind}")
        front=evidence[4]
        if front.get("visible") is not True or front.get("hiddenOccluded") or front.get("hiddenIndoor"):
            raise RuntimeError(f"Outdoor NPC on camera-facing building side was not visible: {front}")

        overlap=evidence[5]
        if int(overlap.get("pairCount") or 0)!=2 or overlap.get("sameAuthoritativeWorld") is not True or overlap.get("separated") is not True:
            raise RuntimeError(f"NPC billboard separation proof failed: {overlap}")
        separated_instances=overlap.get("instances") or []
        if not any(item.get("separationApplied") is True for item in separated_instances):
            raise RuntimeError(f"NPC separation telemetry did not record a presentation-only shift: {separated_instances}")

        for index,build in enumerate(builds,start=1):
            if (build.get("gpuRenderer") or {}).get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"NPC building coherence changed Simulation authority in frame {index}")
            houses=build.get("housePlans") or {}
            lots=build.get("specialLots") or {}
            if houses.get("visibleEntranceSidesPass") is not True:
                raise RuntimeError(f"House entrance visible-face policy failed in frame {index}: {houses}")
            if lots.get("visibleEntranceSidesPass") is not True:
                raise RuntimeError(f"Special-building entrance visible-face policy failed in frame {index}: {lots}")
            movement_verify=build.get("residentMovementVerify") or {}
            if movement_verify.get("pass") is not True or movement_verify.get("wallClearancePass") is not True:
                raise RuntimeError(f"Resident wall-clearance/deterministic movement proof failed in frame {index}: {movement_verify}")
            if int(movement_verify.get("wallClearanceViolationCount") or 0)!=0:
                raise RuntimeError(f"Resident route still hugs ordinary exterior walls in frame {index}: {movement_verify}")
        return

    if scenario == "wp-s004-004":
        if len(frames) < 5:
            raise RuntimeError("wp-s004-004 requires five movement evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:5]]
        proofs=[build.get("residentMovement") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Movement evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Movement/camera proof changed Protagonist authority: {protagonists}")
        expected=["outside-start","door-entering","inside-arrived","door-leaving","outside-arrived"]
        stages=[proof.get("stage") for proof in proofs]
        if stages!=expected:
            raise RuntimeError(f"Movement milestone mismatch: expected {expected}, got {stages}")
        positions=[json.dumps(proof.get("position"),sort_keys=True) for proof in proofs]
        if len(set(positions))<4:
            raise RuntimeError(f"Resident did not visibly progress across movement evidence: {positions}")
        final=proofs[-1]
        required={
            "pass":True,"insideArrivalPass":True,"outsideArrivalPass":True,
            "inboundDoorPass":True,"outboundDoorPass":True,"walkabilityPass":True,
            "adjacencyPass":True,"interiorTargetPass":True,"finalTargetPass":True,
            "roadSpeedPass":True,"physicalSpeedIndependent":True,
            "routePlanningPerFrame":False,"noTeleport":True,"noDirectPlayerControl":True,
            "cameraIndependencePass":True,"offscreenSimulationPass":True,"rendererCullingPass":True,
            "actionExecutionIntroduced":False,"dialogueEconomyCombatIntroduced":False,
            "deterministic":True,"verifiedPass":True,
        }
        for key,value in required.items():
            if final.get(key)!=value:
                raise RuntimeError(f"Resident movement {key} mismatch: {final}")
        if int(final.get("blockedTraversals") or 0)!=0 or int(final.get("invalidSegmentReplans") or 0)!=0:
            raise RuntimeError(f"Movement crossed/encountered invalid segment: {final}")
        if int(final.get("routeRequests") or 0)!=2:
            raise RuntimeError(f"RoutePlanner request count should equal the two schedule-target legs: {final}")
        for index,build in enumerate(builds,start=1):
            live=build.get("residentMovementLive") or {}
            if int(live.get("residentCount") or 0)!=12:
                raise RuntimeError(f"Movement Simulation resident count mismatch in frame {index}: {live}")
            presentation=(build.get("gpuRenderer") or {}).get("characterPresentation") or {}
            simulated=int(presentation.get("simulatedCharacterCount") or 0)
            active=int(presentation.get("activeCharacterCount") or 0)
            if simulated!=13:
                raise RuntimeError(f"Expected 12 residents + protagonist in renderer simulation count, frame {index}: {presentation}")
            if active>simulated:
                raise RuntimeError(f"Renderer character activation exceeds Simulation count in frame {index}: {presentation}")
        return

    if scenario == "wp-s004-003":
        if len(frames) < 4:
            raise RuntimeError("wp-s004-003 requires four representative fantasy-time frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:4]]
        proofs=[build.get("residentSchedules") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Schedule evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Schedule evidence changed Protagonist authority: {protagonists}")
        required={
            "pass":True,"residentCount":12,"completeSchedules":True,
            "targetsActionsValid":True,"homeWorkAssignmentsMatch":True,
            "deterministic":True,"representativeSelectionPass":True,
            "identityAssignmentsStable":True,"currentStatesValid":True,
            "timeSource":"authoritative fantasy time","directRealClockRead":False,
            "movementExecutionIntroduced":False,"actionExecutionIntroduced":False,
            "dialogueEconomyCombatIntroduced":False,
        }
        state_signatures=[]
        sample_hours=[]
        for index,proof in enumerate(proofs,start=1):
            if proof.get("error"):
                raise RuntimeError(f"Schedule proof errored in frame {index}: {proof}")
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Resident schedule {key} mismatch in frame {index}: {proof}")
            summaries=proof.get("scheduleSummaries") or []
            states=proof.get("currentStates") or []
            if len(summaries)!=12 or any(int(item.get("blockCount") or 0)!=9 for item in summaries):
                raise RuntimeError(f"Resident schedule completeness mismatch in frame {index}: {summaries}")
            if len(states)!=12:
                raise RuntimeError(f"Current schedule state count mismatch in frame {index}: {len(states)}")
            for state in states:
                if state.get("intendedAction") not in (state.get("supportedActions") or []):
                    raise RuntimeError(f"Unsupported intended action in frame {index}: {state}")
                if not state.get("target") or not state.get("targetSource"):
                    raise RuntimeError(f"Missing authoritative schedule target in frame {index}: {state}")
            sample=proof.get("sampleTime") or {}
            sample_hours.append(int(sample.get("hour") or 0))
            state_signatures.append(tuple((s.get("residentId"),s.get("state"),s.get("intendedAction")) for s in states))
        if sample_hours != [2,7,12,19]:
            raise RuntimeError(f"Representative fantasy times mismatch: {sample_hours}")
        if len(set(state_signatures))<3:
            raise RuntimeError(f"Representative fantasy times did not produce meaningful deterministic state changes: {state_signatures}")
        return

    if scenario == "wp-s004-002":
        if len(frames) < 3:
            raise RuntimeError("wp-s004-002 requires three evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:3]]
        proofs=[build.get("residentAssignments") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Assignment evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Assignment evidence changed Protagonist authority: {protagonists}")
        signatures=[]
        for index,proof in enumerate(proofs,start=1):
            if proof.get("error"):
                raise RuntimeError(f"Assignment proof errored in frame {index}: {proof}")
            required={
                "pass":True,"residentCount":12,"homeCount":6,"homesValid":True,
                "homeCapacityPass":True,"professionsCompatible":True,"targetsPass":True,
                "interactionTargetsPass":True,"routesPass":True,"doorsPass":True,
                "deterministic":True,"assignmentBasis":"Campaign SEED + resident ID",
                "movementExecutionIntroduced":False,"actionExecutionIntroduced":False,
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Resident assignment {key} mismatch in frame {index}: {proof}")
            occupancy=proof.get("homeOccupancy") or []
            if len(occupancy)!=6 or any(int(item.get("count") or 0)!=2 for item in occupancy):
                raise RuntimeError(f"Home capacity/coverage mismatch in frame {index}: {occupancy}")
            assignments=proof.get("assignments") or []
            routes=proof.get("routes") or []
            if len(assignments)!=12 or len(routes)!=12:
                raise RuntimeError(f"Assignment/route count mismatch in frame {index}: assignments={len(assignments)}, routes={len(routes)}")
            if any(not route.get("pass") for route in routes):
                raise RuntimeError(f"Continuous route failed in frame {index}: {routes}")
            signatures.append([
                {key:item.get(key) for key in ("residentId","homeId","homeTarget","profession","workFunction","workplaceId","workTarget")}
                for item in assignments
            ])
        if len({json.dumps(item,sort_keys=True) for item in signatures})!=1:
            raise RuntimeError(f"Same-SEED assignments changed across evidence frames: {signatures}")
        return

    if scenario == "wp-s004-001":
        if len(frames) < 3:
            raise RuntimeError("wp-s004-001 requires three evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:3]]
        proofs=[build.get("residentRoster") or {} for build in builds]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Resident roster evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Resident roster evidence changed Protagonist authority: {protagonists}")
        static_rosters=[]
        for index,proof in enumerate(proofs,start=1):
            if proof.get("error"):
                raise RuntimeError(f"Resident roster proof errored in frame {index}: {proof}")
            required={
                "pass":True,"residentCount":12,"requiredFieldsPass":True,
                "uniqueIdsPass":True,"namesPass":True,"birthplacePass":True,
                "deterministic":True,"identityStableAcrossTime":True,
                "ageDerivedPass":True,"agesAdvanceOneYear":True,
                "protagonistSeparate":True,"foundationOnly":True,
                "randomnessSource":"PRNG.foundationUint32",
            }
            for key,value in required.items():
                if proof.get(key)!=value:
                    raise RuntimeError(f"Resident roster {key} mismatch in frame {index}: {proof}")
            residents=proof.get("residents") or []
            if len(residents)!=12:
                raise RuntimeError(f"Resident roster row count mismatch in frame {index}: {residents}")
            ids=[resident.get("id") for resident in residents]
            if len(set(ids))!=12:
                raise RuntimeError(f"Resident IDs are not unique in frame {index}: {ids}")
            for resident in residents:
                if not all(resident.get(key) not in (None,"") for key in ("id","name","gender","birthDate","birthplace")):
                    raise RuntimeError(f"Resident identity field missing in frame {index}: {resident}")
                if not isinstance(resident.get("age"),int) or resident.get("age")<0:
                    raise RuntimeError(f"Resident age invalid in frame {index}: {resident}")
            static_rosters.append([
                {key:resident.get(key) for key in ("id","name","gender","birthDate","birthplace","birthplaceCenter")}
                for resident in residents
            ])
        if len({json.dumps(item,sort_keys=True) for item in static_rosters})!=1:
            raise RuntimeError(f"Same-SEED identity roster changed across evidence frames: {static_rosters}")
        return

    if scenario == "wp-s003-008-002":
        if len(frames) < 9:
            raise RuntimeError("wp-s003-008-002 requires nine scene-loading evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:9]]
        loadings=[build.get("sceneLoading") or {} for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Scene-loading proof changed/missed protagonist authority: {protagonists}")

        expected_phases=("renderer","world","assets","finalizing")
        for index,phase in enumerate(expected_phases):
            loading=loadings[index]
            overlay=loading.get("overlay") or {}
            proof=loading.get("proofOverride") or {}
            if proof.get("phase")!=phase:
                raise RuntimeError(f"Scene-loading proof override mismatch in frame {index+1}: expected {phase}, got {loading}")
            if overlay.get("hidden") is True or overlay.get("state")!="loading" or overlay.get("phase")!=phase:
                raise RuntimeError(f"Scene-loading overlay phase mismatch in frame {index+1}: {loading}")
            if not overlay.get("title") or not overlay.get("message"):
                raise RuntimeError(f"Scene-loading copy missing in frame {index+1}: {loading}")
            if str(overlay.get("titleAnimationName") or "none")=="none":
                raise RuntimeError(f"Colorful loading title is not animated in frame {index+1}: {overlay}")
            if str(overlay.get("emblemAnimationName") or "none")=="none":
                raise RuntimeError(f"Loading emblem is not animated in frame {index+1}: {overlay}")
            if str(overlay.get("dotAnimationName") or "none")=="none":
                raise RuntimeError(f"Loading trail is not animated in frame {index+1}: {overlay}")
            if loading.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Scene-loading presentation changed Simulation authority in frame {index+1}: {loading}")

        ready=loadings[4]
        ready_overlay=ready.get("overlay") or {}
        if ready.get("proofOverride") is not None or ready_overlay.get("hidden") is not True:
            raise RuntimeError(f"Ready scene did not remove loading presentation in frame 5: {ready}")
        current=ready.get("current") or {}
        if current.get("state")!="hidden" or current.get("origin")!="new-campaign":
            raise RuntimeError(f"Actual loading cycle is not a completed new-campaign transition: {current}")
        startup_gate=ready.get("startupGate") or {}
        early_click=builds[4].get("sceneLoadingEarlyClick") or {}
        if startup_gate.get("state")!="ready" or int(startup_gate.get("queuedCampaignStarts") or 0)<1:
            raise RuntimeError(f"Immediate campaign start was not queued behind application startup: {startup_gate}")
        gate_started=int(startup_gate.get("startedAtMs") or 0)
        queued_at=int(startup_gate.get("lastQueuedAtMs") or 0)
        gate_ready=int(startup_gate.get("readyAtMs") or 0)
        released_at=int(startup_gate.get("lastReleasedAtMs") or 0)
        campaign_started=int(current.get("startedAtMs") or 0)
        if not (gate_started>0 and gate_started<=queued_at<=gate_ready<=released_at<=campaign_started):
            raise RuntimeError(
                f"Application/campaign startup serialization order is invalid: "
                f"gate={startup_gate}, campaign={current}"
            )
        if early_click.get("clicked") is not True or (early_click.get("gateBefore") or {}).get("state")!="pending":
            raise RuntimeError(f"Evidence did not click New Campaign during pending application startup: {early_click}")
        if current.get("renderSucceeded") is not True or (current.get("readiness") or {}).get("playableReady") is not True:
            raise RuntimeError(f"Loading ended without playable scene readiness: {current}")
        started=int(current.get("startedAtMs") or 0)
        ready_at=int(current.get("readyAtMs") or 0)
        hidden_at=int(current.get("hiddenAtMs") or 0)
        if started<=0 or ready_at<started or hidden_at<ready_at:
            raise RuntimeError(f"Scene-loading timestamps are not monotonic: {current}")
        events=current.get("phaseEvents") or []
        phases=[str(event.get("phase") or "") for event in events]
        for required in ("world","assets","finalizing","ready"):
            if required not in phases:
                raise RuntimeError(f"Actual campaign loading phase {required!r} missing: {events}")
        ready_event=next((event for event in events if event.get("phase")=="ready"),None)
        if not ready_event or (ready_event.get("readiness") or {}).get("playableReady") is not True:
            raise RuntimeError(f"Ready event was recorded before playable readiness: {events}")
        for event in events:
            if event.get("phase")=="ready":
                continue
            if (event.get("readiness") or {}).get("playableReady") is True:
                raise RuntimeError(f"Loading had already declared playable before ready transition: {events}")

        cycles=ready.get("cycles") or []
        application=next((cycle for cycle in cycles if cycle.get("origin")=="application-start"),None)
        if not application:
            raise RuntimeError(f"Application-start loading cycle missing from telemetry: {cycles}")
        app_events=application.get("phaseEvents") or []
        renderer_event=next((event for event in app_events if event.get("phase")=="renderer"),None)
        if not renderer_event or (renderer_event.get("readiness") or {}).get("rendererReady") is True:
            raise RuntimeError(f"Application loading did not begin before renderer readiness: {application}")
        if not any(event.get("phase")=="ready" for event in app_events):
            raise RuntimeError(f"Application loading never reached ready: {application}")

        error=loadings[5]
        error_overlay=error.get("overlay") or {}
        if (error.get("proofOverride") or {}).get("phase")!="error":
            raise RuntimeError(f"Startup-error proof override missing: {error}")
        if error_overlay.get("state")!="error" or error_overlay.get("hidden") is True or error_overlay.get("retryVisible") is not True:
            raise RuntimeError(f"Startup-error state is not readable/retryable: {error}")

        portrait=frames[6].get("runtime",{}).get("viewport",{})
        landscape=frames[7].get("runtime",{}).get("viewport",{})
        if int(portrait.get("height") or 0)<=int(portrait.get("width") or 0):
            raise RuntimeError(f"Phone portrait loading evidence missing: {portrait}")
        if int(landscape.get("width") or 0)<=int(landscape.get("height") or 0):
            raise RuntimeError(f"Phone landscape loading evidence missing: {landscape}")
        for index in (6,7):
            overlay=(loadings[index].get("overlay") or {})
            if overlay.get("hidden") is True or overlay.get("state")!="loading":
                raise RuntimeError(f"Mobile loading overlay missing in frame {index+1}: {loadings[index]}")

        reduced=loadings[8]
        reduced_overlay=reduced.get("overlay") or {}
        if reduced.get("reducedMotionPreferred") is not True:
            raise RuntimeError(f"Reduced-motion media preference was not active: {reduced}")
        if reduced_overlay.get("reducedMotionProof") is not True:
            raise RuntimeError(f"Reduced-motion proof class missing: {reduced}")
        for key in ("titleAnimationName","emblemAnimationName","dotAnimationName"):
            if str(reduced_overlay.get(key) or "")!="none":
                raise RuntimeError(f"Reduced-motion loading still animates {key}: {reduced_overlay}")
        if reduced_overlay.get("hidden") is True or reduced_overlay.get("phase")!="finalizing":
            raise RuntimeError(f"Reduced-motion loading fallback is not readable: {reduced}")
        return

    if scenario == "wp-s003-008-003":
        if len(frames) < 8:
            raise RuntimeError("wp-s003-008-003 requires eight Mini Map evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:8]]
        maps=[(build.get("responsiveControlDeck") or {}).get("miniMap") or {} for build in builds]
        protagonist_positions=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonist_positions))!=1 or not protagonist_positions[0]:
            raise RuntimeError(f"Mini Map exercise changed Protagonist authority: {protagonist_positions}")
        for index,item in enumerate(maps,start=1):
            columns=int(item.get("columns") or 0)
            rows=int(item.get("rows") or 0)
            tile_count=int(item.get("tileCount") or 0)
            if item.get("ready") is not True or item.get("source")!="renderer-frame":
                raise RuntimeError(f"Mini Map frame {index} has no prepared renderer-frame terrain: {item}")
            if columns<=0 or rows<=0 or tile_count!=columns*rows:
                raise RuntimeError(f"Mini Map frame {index} source dimensions are invalid: {item}")
            if item.get("usesPreparedRendererFrame") is not True or item.get("generatedForMiniMap") is not False:
                raise RuntimeError(f"Mini Map frame {index} generated/used unexpected world data: {item}")
            if item.get("orientationMatchesGameplay") is not True:
                raise RuntimeError(f"Mini Map frame {index} orientation does not match dimetric gameplay: {item}")
            if item.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Mini Map frame {index} changed Simulation authority: {item}")
            if not item.get("cameraMarker") or not item.get("protagonistMarker"):
                raise RuntimeError(f"Mini Map frame {index} is missing camera/protagonist markers: {item}")
            world_range=item.get("worldRange") or {}
            if not all(world_range.get(key) is not None for key in ("minX","maxX","minY","maxY")):
                raise RuntimeError(f"Mini Map frame {index} does not record source world range: {item}")

        start_map=maps[0]
        panned_map=maps[1]
        start_camera=start_map.get("camera") or {}
        start_protagonist=start_map.get("protagonist") or {}
        if start_camera.get("x")!=start_protagonist.get("x") or start_camera.get("y")!=start_protagonist.get("y"):
            raise RuntimeError(f"Mini Map start frame is not centered on protagonist: {start_map}")
        if start_map.get("cameraProtagonistDistinct") is True:
            raise RuntimeError(f"Mini Map start markers should coincide: {start_map}")
        if panned_map.get("cameraProtagonistDistinct") is not True:
            raise RuntimeError(f"Mini Map panned frame did not separate camera and protagonist markers: {panned_map}")
        if start_map.get("revisionKey")==panned_map.get("revisionKey"):
            raise RuntimeError("Mini Map did not refresh after camera pan")

        boundary_map=maps[2]
        chunk_size=int(boundary_map.get("chunkSize") or 0)
        boundary_camera=boundary_map.get("camera") or {}
        if chunk_size<=0 or abs(int(boundary_camera.get("x") or 0))<=chunk_size:
            raise RuntimeError(f"Mini Map chunk-boundary frame did not cross a chunk boundary: {boundary_map}")
        if boundary_map.get("revisionKey")==panned_map.get("revisionKey"):
            raise RuntimeError("Mini Map stayed stale across chunk-boundary movement")

        if builds[3].get("cameraZoom")!="0.50×":
            raise RuntimeError(f"Mini Map 0.50x evidence missing: {builds[3].get('cameraZoom')}")
        if builds[4].get("cameraZoom")!="1.00×":
            raise RuntimeError(f"Mini Map 1.00x evidence missing: {builds[4].get('cameraZoom')}")

        portrait=frames[5].get("runtime",{}).get("viewport",{})
        landscape=frames[6].get("runtime",{}).get("viewport",{})
        if int(portrait.get("height") or 0)<=int(portrait.get("width") or 0):
            raise RuntimeError(f"Mini Map phone portrait evidence missing: {portrait}")
        if int(landscape.get("width") or 0)<=int(landscape.get("height") or 0):
            raise RuntimeError(f"Mini Map phone landscape evidence missing: {landscape}")
        landscape_canvas=maps[6].get("canvasVisibility") or {}
        if float(landscape_canvas.get("visibleHeight") or 0)<20 or float(landscape_canvas.get("visibleWidth") or 0)<120:
            raise RuntimeError(f"Mini Map canvas is not visibly usable in short phone landscape: {landscape_canvas}")
        return

    if scenario == "wp-s003-008-001":
        if len(frames) < 16:
            raise RuntimeError("wp-s003-008-001 requires sixteen evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:16]]
        protagonists=[build.get("protagonistLocation") for build in builds]
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Screen-space navigation changed/missed Protagonist authority: {protagonists}")
        navs=[(build.get("cameraNavigation") or {}).get("last") for build in builds]
        expected={
            1:(-1,0,"pointer:mouse"),2:(1,0,"pointer:mouse"),
            3:(0,-1,"pointer:mouse"),4:(0,1,"pointer:mouse"),
            5:(-1,0,"keyboard:arrowleft"),6:(1,0,"keyboard:arrowright"),
            7:(0,-1,"keyboard:arrowup"),8:(0,1,"keyboard:arrowdown"),
            9:(-1,0,"keyboard:a"),10:(1,0,"keyboard:d"),
            11:(0,-1,"keyboard:w"),12:(0,1,"keyboard:s"),
            13:(-1,-1,"keyboard:arrowleft"),14:(1,1,"keyboard:d"),
            15:(-1,0,"pointer:touch"),
        }
        def unit(pair):
            x=float(pair.get("x") or 0); y=float(pair.get("y") or 0)
            mag=(x*x+y*y)**0.5
            return (x/mag,y/mag) if mag>1e-9 else (0.0,0.0)
        def world_unit(nav):
            return unit(nav.get("worldDelta") or {})
        for index,(ex,ey,source) in expected.items():
            nav=navs[index]
            if not isinstance(nav,dict):
                raise RuntimeError(f"Missing navigation telemetry in frame {index+1}: {builds[index].get('cameraNavigation')}")
            if nav.get("mappingSource")!="playcanvas-screen-to-ground":
                raise RuntimeError(f"Frame {index+1} bypassed live camera mapping: {nav}")
            if str(nav.get("source") or "")!=source:
                raise RuntimeError(f"Frame {index+1} input path mismatch: expected {source}, got {nav}")
            req=unit(nav.get("requestedScreen") or {})
            exp_mag=(ex*ex+ey*ey)**0.5
            exp=(ex/exp_mag,ey/exp_mag)
            if req[0]*exp[0]+req[1]*exp[1] < 0.999:
                raise RuntimeError(f"Frame {index+1} requested wrong screen direction: expected {(ex,ey)}, got {nav}")
            projected=unit(nav.get("projectedScreen") or {})
            if projected[0]*exp[0]+projected[1]*exp[1] < 0.965:
                raise RuntimeError(f"Frame {index+1} visible motion is not aligned within the 15-degree integer-grid tolerance: expected {(ex,ey)}, got {nav}")
            angle_error=nav.get("angleErrorDegrees")
            if angle_error is None or float(angle_error)>15:
                raise RuntimeError(f"Frame {index+1} screen-direction error exceeds 15-degree integer-grid tolerance: {nav}")
            if int(nav.get("sequence") or 0)!=index:
                raise RuntimeError(f"Frame {index+1} produced more/fewer than one camera transition for one input action: {nav}")
            if nav.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Frame {index+1} changed Protagonist/Simulation authority: {nav}")
            before=nav.get("centerBefore") or {}; after=nav.get("centerAfter") or {}
            if before==after:
                raise RuntimeError(f"Frame {index+1} did not move camera: {nav}")
            if int(nav.get("logicalSteps") or 0)<1:
                raise RuntimeError(f"Frame {index+1} recorded no logical screen step: {nav}")
        for left,right in ((1,2),(3,4),(5,6),(7,8),(9,10),(11,12)):
            before=navs[left].get("centerBefore")
            after=navs[right].get("centerAfter")
            if before!=after:
                raise RuntimeError(f"Opposite screen directions did not cancel for frames {left+1}/{right+1}: before={before}, after={after}")
        for arrow_idx,wasd_idx in ((5,9),(6,10),(7,11),(8,12)):
            if world_unit(navs[arrow_idx])!=world_unit(navs[wasd_idx]):
                raise RuntimeError(f"Arrow/WASD mapping diverged: arrow={navs[arrow_idx]}, wasd={navs[wasd_idx]}")
        cardinal_screen_magnitudes=[]
        for index in (5,6,7,8,9,10,11,12):
            projected=navs[index].get("projectedScreen") or {}
            cardinal_screen_magnitudes.append((float(projected.get("x") or 0)**2+float(projected.get("y") or 0)**2)**0.5)
        max_cardinal=max(cardinal_screen_magnitudes or [0])
        for index in (13,14):
            nav=navs[index]
            if int(nav.get("logicalSteps") or 0)!=1:
                raise RuntimeError(f"Diagonal keyboard movement inflated logical step count in frame {index+1}: {nav}")
            projected=nav.get("projectedScreen") or {}
            magnitude=(float(projected.get("x") or 0)**2+float(projected.get("y") or 0)**2)**0.5
            if max_cardinal>0 and magnitude>max_cardinal*1.05:
                raise RuntimeError(f"Diagonal keyboard movement is faster than single-axis screen movement in frame {index+1}: diagonal={magnitude}, cardinalMax={max_cardinal}, nav={nav}")
        gpu=[build.get("gpuRenderer") or {} for build in builds]
        if any((item.get("navigationHotPath") or {}).get("fullSceneRebuilds") not in (0,None) for item in gpu):
            raise RuntimeError("Screen-space navigation triggered a full scene rebuild")
        return

    if scenario == "wp-s003-007-001":
        if len(frames) < 6:
            raise RuntimeError("wp-s003-007-001 requires six evidence frames")
        builds=[frame.get("runtime",{}).get("currentBuild",{}) for frame in frames[:6]]
        gpus=[build.get("gpuRenderer") or {} for build in builds]
        qualities=[gpu.get("quality") or {} for gpu in gpus]
        materials=[gpu.get("materialTextureQuality") or {} for gpu in gpus]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        expected_modes=["low","standard","high","auto","auto","auto"]
        expected_levels=["low","standard","high","low","standard","low"]
        expected_scales=[0.65,0.85,1.0,0.65,0.85,0.65]
        expected_dpr=[1.0,1.25,1.5,1.0,1.25,1.0]
        expected_textures=["low","standard","high","low","standard","low"]
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Render-quality cycle changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Render-quality cycle changed Protagonist authority: {protagonists}")
        for index,(quality,material) in enumerate(zip(qualities,materials)):
            if quality.get("mode")!=expected_modes[index] or quality.get("activeLevel")!=expected_levels[index]:
                raise RuntimeError(f"Render-quality mode/level mismatch in frame {index+1}: {quality}")
            if quality.get("persistedMode")!=expected_modes[index]:
                raise RuntimeError(f"Render-quality persistence mismatch in frame {index+1}: {quality}")
            if abs(float(quality.get("renderScale") or 0)-expected_scales[index])>0.001:
                raise RuntimeError(f"Render scale mismatch in frame {index+1}: {quality}")
            if abs(float(quality.get("maxPixelRatio") or 0)-expected_dpr[index])>0.001:
                raise RuntimeError(f"Pixel-ratio cap mismatch in frame {index+1}: {quality}")
            if material.get("profile")!=expected_textures[index]:
                raise RuntimeError(f"Texture/material profile mismatch in frame {index+1}: {material}")
            if int(quality.get("lightCount") or 0)!=(1 if expected_levels[index]=="low" else 2):
                raise RuntimeError(f"Light-count quality mismatch in frame {index+1}: {quality}")
            if quality.get("shadowQuality")!="off":
                raise RuntimeError(f"Unexpected shadow quality in frame {index+1}: {quality}")
            if quality.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Render-quality state lost Simulation boundary in frame {index+1}: {quality}")
            perf=gpus[index].get("performance") or {}
            if float(perf.get("frameMs") or 0)<0 or int(perf.get("drawCalls") or 0)<0 or int(perf.get("triangles") or 0)<0:
                raise RuntimeError(f"Invalid performance telemetry in frame {index+1}: {perf}")
        for index in (0,1,2):
            if qualities[index].get("deviceClass")!="desktop":
                raise RuntimeError(f"Explicit desktop frame {index+1} was not classified as desktop: {qualities[index]}")
        for index in (3,4,5):
            if qualities[index].get("deviceClass")!="phone":
                raise RuntimeError(f"Auto mobile frame {index+1} was not classified as phone: {qualities[index]}")
            deck=builds[index].get("responsiveControlDeck") or {}
            if deck.get("horizontalOverflow"):
                raise RuntimeError(f"Auto mobile frame {index+1} has horizontal overflow: {deck}")
        if qualities[4].get("lastTransitionReason")!="sustained-near-60-fps":
            raise RuntimeError(f"Auto quality did not recover after sustained good performance: {qualities[4]}")
        if qualities[5].get("lastTransitionReason")!="sustained-below-30-fps":
            raise RuntimeError(f"Auto quality did not reduce after sustained low performance: {qualities[5]}")
        return
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

    if scenario == "wp-s003-006-005":
        if len(frames) < 7:
            raise RuntimeError("wp-s003-006-005 requires seven evidence frames")
        runtimes=[frame.get("runtime",{}) for frame in frames[:7]]
        builds=[runtime.get("currentBuild",{}) for runtime in runtimes]
        gpus=[(build.get("gpuRenderer") or {}) for build in builds]
        chunks=[(gpu.get("terrainChunks") or {}) for gpu in gpus]
        preloads=[(gpu.get("terrainPreload") or {}) for gpu in gpus]
        perf=[(gpu.get("performance") or {}) for gpu in gpus]
        chars=[(gpu.get("characterPresentation") or {}) for gpu in gpus]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        cameras=[build.get("cameraCoordinate") for build in builds]
        expected=("(0,0)","(16,0)","(32,0)","(64,0)","(32,0)","(0,0)","(0,0)")
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Culling/batching evidence changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Culling/batching evidence changed protagonist authority: {protagonists}")
        if tuple(cameras)!=expected:
            raise RuntimeError(f"Culling/batching camera path mismatch: {cameras}")
        max_saved=0
        max_instanced=0
        max_batched=0
        max_culled=0
        for index,(gpu,chunk,preload,frame_perf,char) in enumerate(zip(gpus,chunks,preloads,perf,chars),start=1):
            if gpu.get("engine")!="PlayCanvas" or not gpu.get("ready"):
                raise RuntimeError(f"PlayCanvas renderer missing in frame {index}: {gpu}")
            if chunk.get("chunkLocalStaticBatching") is not True or chunk.get("hardwareInstancing") is not True or chunk.get("frustumCulling") is not True:
                raise RuntimeError(f"3D optimization flags missing in frame {index}: {chunk}")
            if int(preload.get("queueDepth") or 0)!=0:
                raise RuntimeError(f"Chunk preparation queue not settled in frame {index}: {preload}")
            if int(chunk.get("activeMeshCount") or 0)<=0 or int(chunk.get("preparedMeshCount") or 0)<=0:
                raise RuntimeError(f"Chunk-local activation/preparation missing in frame {index}: {chunk}")
            if int(chunk.get("cullEnabledMeshInstanceCount") or 0)<=0:
                raise RuntimeError(f"Frustum-cullable mesh instances missing in frame {index}: {chunk}")
            if int(chunk.get("optimizedPresentationDrawCalls") or 0)>int(chunk.get("unoptimizedPresentationDrawCalls") or 0):
                raise RuntimeError(f"Optimization increased presentation draw-call estimate in frame {index}: {chunk}")
            if int(chunk.get("presentationEntityCount") or 0)>int(chunk.get("sourcePresentationEntityCount") or 0):
                raise RuntimeError(f"Optimization increased static presentation entity count in frame {index}: {chunk}")
            if int(preload.get("visibleAssetLoads") or 0)!=0 or int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleGltfParses") or 0)!=0:
                raise RuntimeError(f"Visible navigation performed asset/decode/parse work in frame {index}: {preload}")
            if float(frame_perf.get("frameMs") or 0)<0 or int(frame_perf.get("triangles") or 0)<0 or int(frame_perf.get("drawCalls") or 0)<0:
                raise RuntimeError(f"Invalid performance telemetry in frame {index}: {frame_perf}")
            if char.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Dynamic character path lost Simulation authority in frame {index}: {char}")
            max_saved=max(max_saved,int(chunk.get("savedDrawCalls") or 0))
            max_instanced=max(max_instanced,int(chunk.get("instancedObjectCount") or 0))
            max_batched=max(max_batched,int(chunk.get("staticBatchSourcePrimitiveCount") or 0))
            max_culled=max(max_culled,int(chunk.get("culledMeshInstanceCount") or 0))
        if max_saved<=0:
            raise RuntimeError(f"No measurable draw-call reduction was recorded: {chunks}")
        if max_instanced<=0:
            raise RuntimeError(f"No repeated world objects used hardware instancing: {chunks}")
        if max_batched<=0:
            raise RuntimeError(f"No static source primitives were chunk-batched: {chunks}")
        if max_culled<=0:
            raise RuntimeError(f"No active mesh instances were observed as frustum culled: {chunks}")
        if int(chunks[5].get("savedDrawCalls") or 0)<=0:
            raise RuntimeError(f"Origin revisit lost optimized presentation: {chunks[5]}")
        if int(preloads[5].get("evictions") or 0)>int(preloads[0].get("evictions") or 0):
            raise RuntimeError(f"Bounded revisit unexpectedly evicted retained geometry: origin={preloads[0]}, return={preloads[5]}")
        return

    if scenario == "wp-s003-006-004":
        if len(frames) < 9:
            raise RuntimeError("wp-s003-006-004 requires nine evidence frames")
        runtimes=[frame.get("runtime",{}) for frame in frames[:9]]
        builds=[runtime.get("currentBuild",{}) for runtime in runtimes]
        gpus=[(build.get("gpuRenderer") or {}) for build in builds]
        preloads=[(gpu.get("terrainPreload") or {}) for gpu in gpus]
        chunks=[(gpu.get("terrainChunks") or {}) for gpu in gpus]
        nav=[(gpu.get("navigationHotPath") or {}) for gpu in gpus]
        assets=[(gpu.get("worldAssetCache") or {}) for gpu in gpus]
        seeds=[build.get("campaignSeed") for build in builds]
        protagonists=[build.get("protagonistLocation") for build in builds]
        cameras=[build.get("cameraCoordinate") for build in builds]
        expected=("(0,0)","(2,0)","(4,0)","(16,0)","(32,0)","(16,0)","(0,0)","(0,0)","(0,0)")
        if len(set(seeds))!=1 or not seeds[0]:
            raise RuntimeError(f"Persistent navigation changed/missed Campaign SEED: {seeds}")
        if len(set(protagonists))!=1 or not protagonists[0]:
            raise RuntimeError(f"Persistent navigation changed protagonist authority: {protagonists}")
        if tuple(cameras)!=expected:
            raise RuntimeError(f"Persistent navigation camera path mismatch: {cameras}")
        baseline_visible_waits=int(preloads[0].get("visibleWaits") or 0)
        baseline_network=int(assets[0].get("networkLoads") or 0)
        baseline_parses=int(assets[0].get("containerParses") or 0)
        initial_bulk=int(nav[0].get("bulkChunkRepositions") or 0)
        for index,(gpu,preload,chunk,navigation,asset) in enumerate(zip(gpus,preloads,chunks,nav,assets),start=1):
            if gpu.get("engine")!="PlayCanvas" or not gpu.get("ready"):
                raise RuntimeError(f"PlayCanvas renderer missing in frame {index}: {gpu}")
            if navigation.get("persistentSceneGraph") is not True or int(navigation.get("fullSceneRebuilds") or 0)!=0:
                raise RuntimeError(f"Persistent scene graph contract failed in frame {index}: {navigation}")
            if int(navigation.get("redundantStateCallbacks") or 0)!=0:
                raise RuntimeError(f"Redundant chunk state callback detected in frame {index}: {navigation}")
            if int(navigation.get("sceneAnchorRebases") or 0)!=0:
                raise RuntimeError(f"Ordinary navigation unexpectedly rebased scene anchor in frame {index}: {navigation}")
            if int(navigation.get("bulkChunkRepositions") or 0)!=initial_bulk:
                raise RuntimeError(f"Ordinary navigation bulk-repositioned cached chunks in frame {index}: {navigation}")
            if int(preload.get("visibleWaits") or 0)!=baseline_visible_waits:
                raise RuntimeError(f"Prepared navigation introduced a visible chunk composition wait in frame {index}: {preload}")
            if int(preload.get("visibleAssetLoads") or 0)!=0 or int(preload.get("visibleTextureDecodes") or 0)!=0 or int(preload.get("visibleGltfParses") or 0)!=0:
                raise RuntimeError(f"Visible navigation performed asset/decode/parse work in frame {index}: {preload}")
            if int(asset.get("networkLoads") or 0)!=baseline_network or int(asset.get("containerParses") or 0)!=baseline_parses:
                raise RuntimeError(f"World assets reloaded/reparsed during navigation in frame {index}: {asset}")
            if int(preload.get("Cached") or 0)>int((preload.get("settings") or {}).get("maxCachedChunks") or 0):
                raise RuntimeError(f"Persistent chunk cache exceeded budget in frame {index}: {preload}")
            if chunk.get("resourceKind")!="chunk-mesh" or int(chunk.get("visibleChunkCount") or 0)<1:
                raise RuntimeError(f"Persistent terrain chunk presentation missing in frame {index}: {chunk}")
            if navigation.get("simulationAuthorityPreserved") is not True:
                raise RuntimeError(f"Navigation telemetry lost Simulation authority in frame {index}: {navigation}")

        # Two small pans remain inside the origin chunk: no static scene resources
        # should be created or destroyed merely because the camera moved.
        for idx in (1,2):
            if int(nav[idx].get("chunkResourceCreations") or 0)!=int(nav[0].get("chunkResourceCreations") or 0):
                raise RuntimeError(f"Small prepared pan created static chunk resources in frame {idx+1}: origin={nav[0]}, frame={nav[idx]}")
            if int(nav[idx].get("staticEntityCreations") or 0)!=int(nav[0].get("staticEntityCreations") or 0):
                raise RuntimeError(f"Small prepared pan created static entities in frame {idx+1}: origin={nav[0]}, frame={nav[idx]}")
            if int(nav[idx].get("staticEntityDestructions") or 0)!=int(nav[0].get("staticEntityDestructions") or 0):
                raise RuntimeError(f"Small prepared pan destroyed static entities in frame {idx+1}: origin={nav[0]}, frame={nav[idx]}")

        # Reverse travel and origin revisit must reactivate retained scene entities;
        # no eviction/destruction is allowed with the deliberately large cache.
        # Retained chunks can remain Prepared rather than Cached, so reuse must be
        # proved from lifecycle counters instead of requiring the Cached-only
        # cacheReuses metric to increment.
        if int(nav[5].get("stateReuses") or 0)<=int(nav[4].get("stateReuses") or 0):
            raise RuntimeError(f"Reverse travel did not reuse retained chunk state: forward={nav[4]}, reverse={nav[5]}")
        if int(nav[6].get("stateReuses") or 0)<=int(nav[5].get("stateReuses") or 0):
            raise RuntimeError(f"Origin revisit did not reuse retained chunk state: reverse={nav[5]}, return={nav[6]}")
        if int(nav[5].get("chunkResourceCreations") or 0)!=int(nav[4].get("chunkResourceCreations") or 0):
            raise RuntimeError(f"Reverse travel recreated retained chunk resources: forward={nav[4]}, reverse={nav[5]}")
        if int(nav[6].get("chunkResourceCreations") or 0)!=int(nav[5].get("chunkResourceCreations") or 0):
            raise RuntimeError(f"Origin revisit recreated retained chunk resources: reverse={nav[5]}, return={nav[6]}")
        if int(nav[6].get("staticEntityCreations") or 0)!=int(nav[5].get("staticEntityCreations") or 0):
            raise RuntimeError(f"Origin revisit recreated retained static entities: reverse={nav[5]}, return={nav[6]}")
        if int(nav[6].get("staticEntityDestructions") or 0)!=int(nav[0].get("staticEntityDestructions") or 0):
            raise RuntimeError(f"Revisit destroyed retained static entities: origin={nav[0]}, return={nav[6]}")
        if int(preloads[6].get("evictions") or 0)!=int(preloads[0].get("evictions") or 0):
            raise RuntimeError(f"Revisit evicted retained chunks under non-pressured cache: origin={preloads[0]}, return={preloads[6]}")
        if int(nav[8].get("cameraTransformCalls") or 0)<=int(nav[6].get("cameraTransformCalls") or 0):
            raise RuntimeError(f"Zoom path did not execute camera transforms: before={nav[6]}, after={nav[8]}")
        if float(nav[8].get("maxCameraTransformMs") or 0)<0 or float(nav[8].get("maxPreloadUpdateMs") or 0)<0:
            raise RuntimeError(f"Navigation timing telemetry invalid: {nav[8]}")
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
            "TerrainPreloadRoot",
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
            chunks = gpu.get("terrainChunks") or {}
            if int(scene.get("terrainEntityCount") or 0) < 1 or int(scene.get("structureEntityCount") or 0) < 1:
                raise RuntimeError(f"PlayCanvas scene roots are incomplete in frame {index}: {scene}")
            if chunks.get("resourceKind") != "chunk-mesh" or int(chunks.get("activeMeshCount") or 0) < 1:
                raise RuntimeError(f"PlayCanvas active chunk geometry is incomplete in frame {index}: {chunks}")
            if chunks.get("completeChunkMeshes") is not True or chunks.get("completeChunkWorldData") is not True:
                raise RuntimeError(f"PlayCanvas chunk/world presentation contract failed in frame {index}: {chunks}")
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
                hidden_roofs = int(presentation.get("hiddenRoofCount") or 0)
                total_roofs = int(presentation.get("totalRoofCount") or 0)
                if expected_cutaway:
                    if presentation.get("cutawayLocal") is not True or not presentation.get("cutawayBuildingId"):
                        raise RuntimeError(f"WP-S003-007 cutaway is not building-local in frame {index}: {presentation}")
                    if hidden_roofs <= 0 or total_roofs <= hidden_roofs:
                        raise RuntimeError(f"WP-S003-007 local cutaway hid all/no roofs in frame {index}: {presentation}")
                elif hidden_roofs != 0:
                    raise RuntimeError(f"WP-S003-007 outside/leaving state retained hidden roofs in frame {index}: {presentation}")
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
            preload = (item.get("gpuRenderer") or {}).get("terrainPreload") or {}
            if preload.get("activeStateComplete") is not True:
                raise RuntimeError(
                    f"WP-S003-008 active terrain chunks were demoted during responsive reflow in frame {index}: {preload}"
                )

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
        evidence_revision = os.environ.get("GITHUB_SHA", "").strip()
        if evidence_revision and browser_url.startswith(("https://", "http://")):
            browser_url += ("&" if "?" in browser_url else "?") + "evidence_revision=" + quote(evidence_revision[:16])
        if scenario == "wp-s003-005-002":
            browser_url = browser_url.rstrip("/") + "/asset-standard-proof.html"
        if scenario in {"playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-006-002", "wp-s003-006-001", "wp-s003-006-008", "wp-s003-006-009", "wp-s003-007-001", "wp-s003-008-002"}:
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
            delay = 0.0 if scenario == "wp-s003-008-002" else (wait_min + wait_max) / 2.0
            print(f"Opening: {browser_url}")
            print(f"Viewport: {width}x{height}")
            print(f"Waiting {delay:.2f}s before capture")
            time.sleep(delay)

            prep_action = prepare_current_build(driver, min(ready_timeout, 10.0), scenario) if auto_start else "auto-start-disabled"
            if scenario == "wp-s003-004-002":
                proof_action = _set_character_proof_state(driver, "open")
                prep_action = prep_action + "+" + proof_action

            if force_max_zoom and scenario not in {"building-presentation", "playcanvas-foundation", "playcanvas-scene", "wp-s003-003", "wp-s003-004-002", "wp-s003-005-002", "wp-s003-005-006", "wp-s003-006-002", "wp-s003-006-001", "playcanvas-root-cutover", "wp-s003-006", "wp-s003-006-003", "wp-s003-006-004", "wp-s003-006-005", "wp-s003-007-001", "wp-s003-008-001", "wp-s003-008-002", "wp-s003-008-003", "wp-s003-009-001", "wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s004-001", "wp-s004-002", "wp-s004-003", "wp-s004-004", "wp-s004-004-001", "wp-s004-005", "wp-s005-001", "wp-s005-002", "wp-s005-003","wp-s005-004","wp-s005-005","wp-s006-001","wp-s006-002","wp-s006-003","wp-s006-004","wp-s006-005","wp-s006-006","wp-s007-001","wp-s007-002","wp-s007-003"}:
                force_max_zoom_out(driver)

            frames: list[dict] = []
            for index, path in enumerate(paths):
                if scenario in {"building-presentation", "building-occlusion", "wp-s003-005", "wp-s003-005-006", "wp-s003-003", "wp-s003-006-001", "wp-s003-006-004", "wp-s003-006-005", "wp-s003-006-008", "wp-s003-007-001", "wp-s003-008-002", "wp-s003-008-003", "wp-s003-009-001", "wp-s003-009-002", "wp-s003-009-003", "wp-s003-009-004", "wp-s004-001", "wp-s004-002", "wp-s004-003", "wp-s004-004", "wp-s004-004-001", "wp-s005-001", "wp-s005-002", "wp-s005-003","wp-s005-004","wp-s005-005","wp-s006-001","wp-s006-002","wp-s006-003","wp-s006-004","wp-s006-005","wp-s006-006","wp-s007-001","wp-s007-002","wp-s007-003"}:
                    action = _run_scenario_step(driver, scenario, index, width, height)
                    time.sleep(interval)
                elif index:
                    action = _run_scenario_step(driver, scenario, index, width, height)
                    time.sleep(interval)
                else:
                    action = prep_action
                if scenario in {"wp-s003-009-003", "wp-s003-009-004"}:
                    WebDriverWait(driver, max(30.0, ready_timeout)).until(
                        lambda d: d.execute_script(
                            """
                            const state=document.querySelector('#campaignState')?.textContent?.trim();
                            const loading=window.AppUI?.sceneLoadingSnapshot?.() || {};
                            return Boolean(
                              state==='ACTIVE' &&
                              loading?.current?.state==='hidden' &&
                              loading?.current?.readiness?.playableReady===true &&
                              loading?.overlay?.hidden===true
                            );
                            """
                        )
                    )
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

            if evidence_json:
                manifest_path = screenshots_directory() / Path(evidence_json).name
                _write_evidence_manifest(
                    manifest_path,
                    target=browser_url,
                    scenario=scenario,
                    issue=issue,
                    frames=frames,
                )

            validate_scenario_frames(scenario, frames)

            if pause_seconds > 0:
                print(f"Pausing browser for {pause_seconds:.1f}s before close")
                time.sleep(pause_seconds)

            prune_capture_history()
            return True
        finally:
            driver.quit()
    except Exception as exc:
        print(f"Error taking screenshot: {type(exc).__name__}: {exc}", file=sys.stderr)
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
