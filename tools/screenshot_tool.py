#!/usr/bin/env python3
"""Screenshot capture for The Advisor Game (PlayCanvas world atlas).

Loads a running build in Chromium (headless by default), drives it with a small step
language, and writes PNG screenshots plus a capture.json describing each image
(renderer backend, view, tile counts, console and page errors). Score visuals
from the images only; the JSON is supporting evidence.

Setup: pip install playwright && python -m playwright install chromium

Examples:
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots \\
        --scenario village,street,realm --profile desktop,phone
    python tools/screenshot_tool.py http://127.0.0.1:4173/ --out shots --name pan \\
        --steps "drag:50%,50%>30%,60%;settle;shot:moved;wheel:400;settle;shot:far"

Steps, separated by ';' (write '\\;' for a semicolon inside eval):
    click:<css>  check:<css>  uncheck:<css>  select:<css>=<value>
    visible:<css>          wait until the element is visible
    zoom-in[:N]  zoom-out[:N]   click the map zoom buttons N times
    wheel:<deltaY>[@x,y]   mouse wheel over the canvas
    drag:x1,y1>x2,y2       mouse drag across the page
    tap[:x,y]              click the canvas; fails if a panel covers that point
    key:<Key>[@ms]         focus the canvas and hold the key (default 250 ms)
    settle                 wait for ready and settled terrain, then two frames
    until:<js expression>  poll an on-demand condition at 500ms intervals (max 60s)
    coverage               wait for current-view terrain submitted to a valid layer
    wait:<ms>  eval:<javascript>
    shot[:<suffix>]        capture now; put 'settle' first for a stable image
Coordinates are viewport pixels or percentages ("50%,40%"). Without x,y, tap and
wheel use the uncovered canvas point nearest the canvas centre. Every scenario
starts with page load + settle and, if it has no shot step, ends with settle +
one capture. The exit code is 1 when any scenario failed.
"""
from __future__ import annotations

import argparse
import base64
import glob
import struct
import json
import os
import re
import shutil
import subprocess
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError, Locator, Page, Playwright, sync_playwright

PROFILES: dict[str, tuple[int, int]] = {
    "desktop": (1440, 900), "laptop": (1280, 720), "tablet": (1024, 768),
    "phone": (390, 844), "phone-landscape": (844, 390),
    "phone-small": (360, 800), "tablet-portrait": (768, 1024),
    "fullhd-landscape": (1920, 1080), "fullhd-portrait": (1080, 1920),
}

# Verify the displayed point against the exact composed source queried through
# its reported canonical coordinates. This detects nearby-cell snapping and
# submerged-bed/deck confusion without redefining the world in the capture tool.
POINT_INSPECTION = (
    "tap:50%,50%;visible:#cell-panel;"
    "eval:window.hit=document.getElementById('cell-height').title.match(/lon ([^,]+), lat ([^,]+), elevation ([^ ]+) m/);"
    "eval:window.picked=window.advisorWorld.planet.lonLatToSource(+window.hit[1],+window.hit[2]);"
    "eval:window.composed=window.advisorWorld.surface.finalAtSource(window.picked.x,window.picked.z);"
    "eval:window.visibleElevation=window.composed.deckHeight??(window.composed.water.kind==='none'?window.composed.groundHeight:window.composed.water.level);"
    "eval:Math.abs(parseFloat(document.getElementById('cell-height').textContent)-window.visibleElevation)<0.065||Promise.reject(new Error('Point elevation differs from visible final surface'));"
    "eval:document.getElementById('cell-walkable').textContent===(window.composed.walkable?'Yes':'No')||Promise.reject(new Error('Point walkability differs from final surface'));"
    "eval:document.getElementById('cell-biome').textContent===window.composed.material||Promise.reject(new Error('Point material differs from final surface'));"
)

# Named step presets. Add a line here to give a new scene a name.
SCENARIOS: dict[str, str] = {
    "streaming-coverage": (
        "eval:window.advisorWorld.navigation.setFocus(-0.5235987755982988,-1.064650843716541);"
        "select:#map-scale=250;coverage;shot:coast-preview;settle;shot:coast-final;"
        "eval:window.advisorWorld.navigation.setFocus(0.8,Math.PI/2);"
        "coverage;shot:pole-preview;settle;shot:pole-final;"
        "eval:window.advisorWorld.navigation.setFocus(Math.PI-0.00001,0.4);"
        "coverage;shot:wrap-preview;settle;shot:wrap-final"
    ),
    "macro-roads": (
        "eval:window.j=window.advisorWorld.geography.roadJunctions[0];"
        "eval:window.advisorWorld.navigation.setFocus(window.j.canonicalPosition.lon,window.j.canonicalPosition.lat);"
        "select:#map-scale=50;settle;shot:shared-y;select:#map-scale=100;settle;shot:y-100;select:#map-scale=250;settle;shot:y-hidden;"
        "eval:window.r=window.advisorWorld.geography.roads.filter(r=>r.networkKind!=='detour'&&r.centerline.length>4).sort((a,b)=>b.centerline.length-a.centerline.length)[0];"
        "eval:window.p=window.r.centerline[Math.floor(window.r.centerline.length/2)].position;"
        "eval:window.advisorWorld.navigation.setFocus(window.p.lon,window.p.lat);select:#map-scale=100;settle;shot:terrain-bend"
    ),
    "macro-population": (
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.continents[0].canonicalPosition.lon,window.advisorWorld.geography.continents[0].canonicalPosition.lat);"
        "click:#overview;settle;shot:eldermere;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.continents[1].canonicalPosition.lon,window.advisorWorld.geography.continents[1].canonicalPosition.lat);settle;shot:westreach;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.continents[2].canonicalPosition.lon,window.advisorWorld.geography.continents[2].canonicalPosition.lat);settle;shot:dawnlands;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.countries[0].canonicalPosition.lon,window.advisorWorld.geography.countries[0].canonicalPosition.lat);"
        "select:#map-scale=1000;settle;shot:country-interior;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.villages[0].canonicalPosition.lon,window.advisorWorld.geography.villages[0].canonicalPosition.lat);"
        "select:#map-scale=50;settle;shot:village-symbol;select:#map-scale=100;settle;shot:road-100;select:#map-scale=250;settle;shot:road-250;select:#map-scale=10;settle;shot:village-close"
    ),
    "settlement-icons": (
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.villages[0].canonicalPosition.lon,window.advisorWorld.geography.villages[0].canonicalPosition.lat);"
        "select:#map-scale=20;settle;shot:close;"
        "select:#map-scale=50;settle;shot:village-icon;"
        "select:#map-scale=100;settle;shot:farther;"
        "select:#map-scale=20;settle;shot:restored;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.cities[0].canonicalPosition.lon,window.advisorWorld.geography.cities[0].canonicalPosition.lat);"
        "select:#map-scale=50;settle;shot:city-icon"
    ),
    # Owner regression: inspect the ordinary starting village during movement,
    # including intermediate frames rather than only settled hydrology fixtures.
    "alderwick-pan-zoom": (
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.villages[0].canonicalPosition.lon,window.advisorWorld.geography.villages[0].canonicalPosition.lat);"
        "eval:window.advisorWorld.setHalfHeight(160);settle;shot:village;"
        "drag:45%,50%>60%,55%;wait:250;shot:pan-transient;settle;shot:pan-settled;"
        "wheel:-900;wait:250;shot:zoom-transient;settle;shot:street;"
        "wheel:900;wait:250;shot:return-transient;settle;shot:return-settled"
    ),
    # WP-S003-004-001: real character-scale capture. Overview 1/10 and 1/20
    # intentionally omit small buildings and residents, so they cannot prove
    # Hero/Close terrain or feet/door grounding. Run with fullhd-landscape and
    # fullhd-portrait profiles, using the owner-approved WebGL2 evidence path.
    # WP-S003-004-001: each distinct geography gets a fresh real browser page.
    # The previous five-shot single-page sequence reproduced a compositor
    # readback stall after the first two actual inhabited PNGs. This isolates
    # the known stale-GPU capture path without inventing pixels or game state.
    "s003-hero-close-village": (
        "eval:window.advisorWorld.navigation.setFocus(window.advisorWorld.geography.villages[0].canonicalPosition.lon,window.advisorWorld.geography.villages[0].canonicalPosition.lat);"
        "select:#map-scale=0.5;settle;shot:inhabited-close;"
        "select:#map-scale=0.2;settle;shot:inhabited-hero"
    ),
    # A genuine selected resident in the original PlayCanvas viewport, not
    # a count of enabled actors or a synthetic foot marker. Reuse the S006
    # proven real-canvas pick/focus controls, then save contact alongside PNG.
    "s003-hero-close-resident": (
        "eval:(p=>window.advisorWorld.navigation.setFocus(p.lon,p.lat))(window.advisorWorld.geography.villages[0].canonicalPosition);"
        "eval:window.advisorWorld.setHalfHeight(10);"
        "until:window.advisorWorld.residentEvidencePick(true);"
        # First prove the chosen actor survives the real GPU-depth / structural
        # screen hit; then actually click that same pixel in Chromium.
        "eval:window.advisorWorld.verifiedResidentEvidencePick().then(r=>r?(window.__s006Resident=r,window.__wp550SelectedCode=r.code):Promise.reject(new Error('No GPU-confirmed resident tap in the current real view')));"
        "tap:resident-verified;visible:#npc-popup:not([hidden]);"
        # The exact resident SEED code lives in a collapsed <details> region
        # by default. It remains in the DOM but is intentionally not visible;
        # requiring its CSS visibility falsely times out after a successful
        # real click. Verify the open popup AND exact hidden technical ID.
        "eval:document.querySelector('#npc-popup #npc-seed-code')?.textContent?.trim()===window.__wp550SelectedCode||Promise.reject(new Error('Actual NPC popup identity does not match GPU-tapped resident'));"
        # The real tap must inspect that exact original 2D resident. The
        # old follow-on popup button intermittently remained covered/absent
        # and timed out despite a fully live scene. Focus the actually picked
        # Simulation actor through the same camera-only navigator, never a
        # camera-invented point or another resident. A wrong/occluded click
        # still fails this exact identity check instead of producing a PNG.
        "until:(window.__foot=window.advisorWorld.residentFootRingEvidence())&&window.__foot.code===window.__wp550SelectedCode&&window.__foot.actorCode===window.__wp550SelectedCode&&window.__foot.surfaceContact;"
        "eval:(ll=>(window.advisorWorld.navigation.setFocus(ll.lon,ll.lat),window.advisorWorld.setHalfHeight(0.52)))(window.advisorWorld.hydrology.toLonLat(window.__foot.surfaceContact.source.x,window.__foot.surfaceContact.source.z));"
        "until:(window.__foot=window.advisorWorld.residentFootRingEvidence())&&window.__foot.code===window.__wp550SelectedCode&&window.__foot.shown&&window.__foot.grounded&&window.__foot.surfaceContact&&Number.isFinite(window.__foot.surfaceContact.gapM);"
        "until:window.advisorWorld.state.settled;"
        "eval:window.advisorWorld.state.view.halfHeight<=0.76||Promise.reject(new Error('Selected original resident is not at true Hero/Close scale'));"
        "shot:selected-foot-surface;"
        "click:#npc-popup [data-go^=home];settle;"
        "visible:#selected-home-door-marker:not([hidden]);"
        "eval:document.getElementById(\'selected-home-door-marker\')?.dataset.homeEntrance===document.getElementById(\'npc-home-entrance\')?.textContent?.trim()||Promise.reject(new Error(\'Viewed owned doorway lost the original SEED entrance identity\'));"
        "shot:owned-home-front-relief"
    ),
    "s003-hero-close-slope": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-24190.289130830573,28768.45437654417);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "select:#map-scale=0.5;settle;" + POINT_INSPECTION +
        "eval:(window.composed.walkable&&window.composed.traversal==='difficult')||Promise.reject(new Error('Canonical steep slope must remain difficult and walkable'));"
        "click:#relief-view;settle;shot:legal-steep-relief;"
        "eval:window.advisorWorld.setHalfHeight(8);settle;shot:legal-steep-relief-context"
    ),
    "s003-hero-close-cliff": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-26817.80086086045,27316.75066655874);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "select:#map-scale=0.5;settle;" + POINT_INSPECTION +
        "eval:window.composed.walkable===false||Promise.reject(new Error('Canonical cliff must be blocked'));"
        "click:#relief-view;settle;shot:blocked-cliff-relief;"
        "eval:window.advisorWorld.setHalfHeight(8);settle;shot:blocked-cliff-relief-context"
    ),
    # Targeted WP #550 visual retry: one exact real terrain location and ONE
    # authentic settled context PNG per fresh Chromium process. This prevents
    # the reproduced zero-CDP-frame / stale-X11 readback after the prior shot
    # from consuming the entire bounded original landscape capture. Original
    # selected resident, door and close-up PNGs remain preserved separately.
    "s003-hero-close-cliff-context": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-26817.80086086045,27316.75066655874);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(8);settle;" + POINT_INSPECTION +
        "eval:window.composed.walkable===false||Promise.reject(new Error('Original cliff must remain blocked'));"
        "click:#relief-view;settle;shot:blocked-cliff-relief-context"
    ),
    "s003-hero-close-slope-context": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-24190.289130830573,28768.45437654417);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(8);settle;" + POINT_INSPECTION +
        "eval:(window.composed.walkable&&window.composed.traversal==='difficult')||Promise.reject(new Error('Original difficult slope must remain walkable'));"
        "click:#relief-view;settle;shot:legal-steep-relief-context"
    ),
    "hydrology-point-inspection": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-26817.80086086045,27316.75066655874);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;" + POINT_INSPECTION +
        "eval:window.composed.walkable===false||Promise.reject(new Error('Cliff must remain blocked'));"
        "shot:cliff;click:#close-cell;"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-24190.289130830573,28768.45437654417);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;" + POINT_INSPECTION +
        "eval:window.composed.traversal==='difficult'||Promise.reject(new Error('Real slope must be difficult and walkable'));"
        "shot:difficult-slope;click:#close-cell;"
        "eval:window.a=window.advisorWorld.hydrology.anchors();"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(window.a.bridge.x,window.a.bridge.z);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;" + POINT_INSPECTION +
        "eval:window.composed.material==='Bridge'||Promise.reject(new Error('Visible deck must be the legal bridge'));shot:bridge"
    ),
    # Canonical current-campaign fixtures: real dry bank cliff and walkable slope,
    # selected from bounded drainage probes, rather than a decorative height wall.
    "hydrology-steep": (
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-26817.80086086045,27316.75066655874);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;shot:cliff;"
        "tap:50%,50%;visible:#cell-panel;shot:cliff-inspected;click:#close-cell;"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(-24190.289130830573,28768.45437654417);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;shot:difficult-slope;"
        "tap:50%,50%;visible:#cell-panel;shot:slope-inspected"
    ),
    "hydrology": (
        "eval:window.r=window.advisorWorld.hydrology.recipes[0];"
        "eval:window.p=window.r.points[Math.floor(window.r.points.length*.55)];"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(window.p.x,window.p.z);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(95);settle;shot:river;"
        "eval:window.advisorWorld.setHalfHeight(450);settle;shot:tributary;"
        "eval:window.ll=window.advisorWorld.hydrology.mountains[0].path[Math.floor(window.advisorWorld.hydrology.mountains[0].path.length/2)];"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(850);settle;shot:mountain;eval:window.advisorWorld.setHalfHeight(5000);settle;shot:mountain-range;"
        "eval:window.ll=window.advisorWorld.hydrology.lakes[0].center;"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(900);settle;shot:lake;"
        "eval:window.a=window.advisorWorld.hydrology.anchors();"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(window.a.bridge.x,window.a.bridge.z);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24);settle;shot:bank-bridge;eval:window.advisorWorld.setHalfHeight(95);settle;shot:bank-context;"
        "eval:window.advisorWorld.setHalfHeight(24000);settle;shot:realm-coast"
    ),
    "hydrology-context": (
        "eval:window.r=window.advisorWorld.hydrology.recipes[0];"
        "eval:window.p=window.r.tributary[Math.floor(window.r.tributary.length*.65)];"
        "eval:window.ll=window.advisorWorld.hydrology.toLonLat(window.p.x,window.p.z);"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(1500);settle;shot:tributary-basin;"
        "eval:window.v=window.advisorWorld.geography.villages.find(v=>window.advisorWorld.hydrology.access(v.canonicalPosition).nearby);"
        "eval:window.advisorWorld.navigation.setFocus(window.v.canonicalPosition.lon,window.v.canonicalPosition.lat);"
        "eval:window.advisorWorld.setHalfHeight(450);settle;shot:freshwater-village;"
        "eval:window.v=window.advisorWorld.geography.villages.find(v=>(a=>a.arid&&!a.nearby)(window.advisorWorld.hydrology.access(v.canonicalPosition)));"
        "eval:window.advisorWorld.navigation.setFocus(window.v.canonicalPosition.lon,window.v.canonicalPosition.lat);"
        "eval:window.advisorWorld.setHalfHeight(95);settle;shot:dry-village;"
        "eval:window.ll=window.advisorWorld.geography.continents[0].canonicalPosition;"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);"
        "eval:window.advisorWorld.setHalfHeight(24000);settle;shot:continent-0;"
        "eval:window.ll=window.advisorWorld.geography.continents[1].canonicalPosition;"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);settle;shot:continent-1;"
        "eval:window.ll=window.advisorWorld.geography.continents[2].canonicalPosition;"
        "eval:window.advisorWorld.navigation.setFocus(window.ll.lon,window.ll.lat);settle;shot:continent-2"
    ),
    "village": "",
    "street": "zoom-in:2",
    # 97 m half-height x 1.4^3 = 266 m: the 230-900 m "Province" band in src/main.ts.
    "province": "zoom-out:3",
    "realm": "click:#overview",
    "continuity": (
        "click:#overview;settle;"
        "eval:window.advisorContinuityRoad=window.advisorWorld.geography.roads[0];"
        "eval:window.advisorContinuityPort=window.advisorWorld.continuity.inspect({lon:(window.advisorContinuityRoad.fromPosition.lon+window.advisorContinuityRoad.toPosition.lon)/2,lat:(window.advisorContinuityRoad.fromPosition.lat+window.advisorContinuityRoad.toPosition.lat)/2}).ports[0].position;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorContinuityPort.lon,window.advisorContinuityPort.lat);"
        "eval:window.advisorWorld.setHalfHeight(900);settle;shot:ordinary;"
        "eval:window.advisorWorld.continuity.setOverlay(true);wait:200;shot:ports;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorContinuityPort.lon+0.002,window.advisorContinuityPort.lat);settle;shot:neighbor;"
        "eval:window.advisorWorld.continuity.setOverlay(false);"
        "eval:window.advisorWorld.navigation.setFocus(2.1,0.3);settle;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorContinuityPort.lon,window.advisorContinuityPort.lat);"
        "eval:window.advisorWorld.setHalfHeight(230);settle;shot:revisit"
    ),
    "continuity-obstacle": (
        "click:#overview;settle;"
        "eval:window.advisorDetour=window.advisorWorld.geography.roads.find(r=>r.networkKind==='detour');"
        "eval:window.advisorDetourPoint=window.advisorDetour.centerline[16].position;"
        "eval:window.advisorWorld.navigation.setFocus(window.advisorDetourPoint.lon,window.advisorDetourPoint.lat);"
        "eval:window.advisorWorld.setHalfHeight(1800);settle;shot:shore;"
        "eval:window.advisorWorld.setHalfHeight(450);settle;"
        "eval:window.advisorWorld.continuity.setOverlay(true);wait:200;shot:joined;"
        "eval:window.advisorWorld.continuity.setOverlay(false);"
        "eval:window.advisorWorld.setHalfHeight(97);settle;shot:road"
    ),
    "information-panel": (
        "settle;shot:minimized;click:#toggle-region-panel;shot:expanded;"
        "eval:document.getElementById('region-panel').scrollTop=document.getElementById('region-panel').scrollHeight;shot:controls;"
        "click:#toggle-region-panel;shot:restored"
    ),
    "zoom-country": (
        "click:#overview;settle;"
        "eval:window.advisorWorld.navigation.setFocus(-69.7953*Math.PI/180,-10.3192*Math.PI/180);"
        "eval:window.advisorWorld.setHalfHeight(4168);settle;shot:before;"
        "eval:window.advisorWorld.setHalfHeight(4172.15134);settle;shot:middle;"
        "eval:window.advisorWorld.setHalfHeight(4176);settle;shot:after;"
        "eval:window.advisorWorld.setHalfHeight(4700);settle;shot:handoff;"
        "eval:window.advisorWorld.setHalfHeight(11000);settle;shot:globe"
    ),
    "navigation": "select:#map-scale=10;settle;shot:local;select:#map-scale=10000;settle;shot:realm",
    "realm-tiles": "click:#overview;check:#grid",
    "handoff": (
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.18);settle;shot:in-25;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:in-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.88);settle;shot:in-80;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*1.04);settle;shot:globe;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight*0.86);settle;shot:out-80;"
        "eval:window.advisorWorld.setHalfHeight(Math.sqrt(window.advisorWorld.handoff.localHalfHeight*window.advisorWorld.handoff.globeHalfHeight));settle;shot:out-50;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*1.16);settle;shot:out-25;"
        "eval:window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.localHalfHeight*0.92);settle;shot:flat-return"
    ),
    "cell": "tap;visible:#cell-panel",
    "travel-city": "click:#open-travel;select:#continent-select=1;click:#visit-city",
    # WP-S002-004-008 walking routes. Seeded 6 km road pair (the travel-panel click flow is covered by tests/browser/routes.spec.js).
    "route-road": "eval:window.advisorRoutes.select('2/3/1/1','2/3/1/0');settle;shot:road",
    # Real seeded pair whose highland makes the walk far slower than the straight line.
    "route-mountain": "eval:window.advisorRoutes.select('1/8/0/2','1/8/1/2');settle;shot:mountain",
    # Real seeded pair whose straight line crosses water: the route detours around it.
    "route-water": (
        "eval:window.advisorRoutes.select('1/0/0/0','1/7/2/2');settle;"
        # No semicolons inside an eval step: wait until the handoff blend reaches its target.
        "eval:new Promise(done=>{const t=Date.now(),f=()=>(h=>(!window.advisorRoutes.framing&&!h.active&&Math.abs(h.projectionTransition-h.desiredTransition)<0.002)||Date.now()-t>60000?done():setTimeout(f,250))(window.advisorWorld.state.handoff),_=f()});"
        "settle;shot:water"
    ),
}

# Software rendering flags from playwright.fallback.config.js and playwright.webgpu.config.js.
WEBGL2_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
# Use Chromium's coherent, verified Linux Vulkan/SwiftShader presentation path:
# ANGLE's Vulkan device and Dawn's WebGPU device must share the compositor.
# The previous split GLES/Vulkan mode showed a real running WebGPU actor but
# NO compositor frames on either viewport. --disable-vulkan-surface avoids the
# unsupported software swapchain; Mesa's ICD is installed in the workflow.
# Keep the actual backend=webgpu and native pixel/freshness checks unchanged.
WEBGPU_ARGS = [
    "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-gpu",
    "--enable-features=Vulkan", "--use-angle=vulkan",
    "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader",
    "--disable-vulkan-surface",
]

# True when settled, 'error' when the page failed, otherwise false (keep waiting).
SETTLED_JS = """() => {
  const box = document.getElementById('error'), world = window.advisorWorld;
  if ((box && !box.hidden) || (world && world.state.error)) return 'error';
  const loading = document.getElementById('loading');
  if (!world || (loading && !loading.hidden && getComputedStyle(loading).opacity !== '0')) return false;
  return world.state.ready && world.state.settled;
}"""
READY_JS = SETTLED_JS.replace("world.state.ready && world.state.settled", "world.state.ready")
TWO_FRAMES_JS = "() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))"
# An owned-home PNG is admissible only after both the authoritative state
# and the *painted* tile-status element remain settled over two genuine
# animation frames. A transient one-poll settled flag previously reverted to
# refining before screenshot-tool captured the portrait image.
SETTLED_FRAMES_JS = """() => new Promise(done => {
  const ready = () => {
    const state = window.advisorWorld?.state;
    const label = document.getElementById('tile-status')?.textContent?.toLowerCase() ?? '';
    return !!state?.ready && !!state?.settled && state.pending === 0 &&
      label.includes('ready') && !label.includes('refining');
  };
  if (!ready()) return done(false);
  requestAnimationFrame(() => requestAnimationFrame(() => done(ready())));
})"""
# The keys below are written to capture.json unchanged.
STATE_JS = """() => {
  const world = window.advisorWorld, state = world ? world.state : {};
  const renderer = (world && world.renderer) || {};
  const transport = window.advisorTransport ? window.advisorTransport.telemetry() : null;
  const box = document.getElementById('error'), detail = document.getElementById('detail-name');
  return {
    ready: state.ready ?? false, settled: state.settled ?? false, fps: state.fps ?? null, simulation: state.simulation ?? null,
    display: {devicePixelRatio,cssWidth:innerWidth,cssHeight:innerHeight,canvasWidth:document.getElementById('world')?.width,canvasHeight:document.getElementById('world')?.height},
    backend: renderer.backend || '', phase: renderer.phase || '',
    fallbackReason: renderer.fallbackReason || '', presentation: state.presentation ?? null,
    view: state.view ?? null, active: state.active ?? null,
    cached: state.cached ?? null, pending: state.pending ?? null,
    handoff: state.handoff ?? null, scaleLabel: state.scaleLabel ?? null,
    roadPresentation: state.roadPresentation ?? null,
    roadRepresentation: state.roadRepresentation ?? null,
    canonicalFootprintM: state.canonicalFootprintM ?? null,
    navigation: state.navigation ?? null,
    globe: state.globe ?? null, macroGeography: state.macroGeography ?? null,
    performance: state.performance ?? null, coverage: state.coverage ?? null,
    visibleMeshes: state.visibleMeshes ?? null, visibleGeometryTriangles: state.visibleGeometryTriangles ?? null, residentPresentation: state.residentPresentation ?? null,
    // Read-only same-frame measured render-foot / authoritative surface pair.
    residentFootContact: world?.residentFootRingEvidence?.() ?? null,
    continuity: world && world.continuity ? world.continuity.telemetry() : null,
    transportInspection: transport ? {
      digest: transport.digest, selected: transport.selection,
      firstRoadInspectionMs: transport.firstRoadInspectionMs,
      firstRoadInspectionStatus: transport.firstRoadInspectionStatus,
      // Graph preview response only; physical travel is not inferred.
      firstSiteRouteMs: transport.firstSiteRouteMs,
      firstSiteRouteStatus: transport.firstSiteRouteStatus,
      siteRouteEdges: transport.siteRouteEdges,
      siteAccessProbeStatus: transport.siteAccessProbeStatus,
      siteAccessProbeMs: transport.siteAccessProbeMs,
      localRoads: transport.localRoads,
      queryCacheEntries: transport.queryCacheEntries,
    } : null,
    informationExpanded: document.getElementById('toggle-region-panel')?.getAttribute('aria-expanded') === 'true',
    detailName: detail ? detail.textContent.trim() : null,
    tileStatusText: document.getElementById('tile-status')?.textContent ?? null,
    error: state.error || (box && !box.hidden ? box.textContent.trim() : ''),
  };
}"""
# Uncovered canvas point nearest the canvas centre as [x, y, distance], or null.
FREE_POINT_JS = """() => {
  const canvas = document.getElementById('world'), box = canvas.getBoundingClientRect(), points = [];
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++)
    points.push([box.left + box.width * i / 24, box.top + box.height * j / 24, Math.hypot(i - 12, j - 12)]);
  const free = points.filter(([x, y]) => document.elementFromPoint(x, y) === canvas);
  return free.sort((a, b) => a[2] - b[2])[0] || null;
}"""


def resident_scene_flat_fraction(path: Path) -> float:
    """Flag near-monochrome real PNGs; never invent or replace their pixels.

    A screenshot can contain a freshly painted popup/marker but no 3D scene.
    This conservative 60% guard is a CI failure hint, never visual acceptance.
    """
    from collections import Counter
    from PIL import Image
    with Image.open(path) as image:
        sampled = image.convert("RGB").resize((120, 90))
        bins = Counter(tuple(channel >> 3 for channel in rgb) for rgb in sampled.getdata())
    return bins.most_common(1)[0][1] / (120 * 90)


class CaptureError(Exception):
    """A step, wait or page check failed."""


def launch(playwright: Playwright, renderer: str, chromium: str | None, channel: str | None = None,
           headed: bool = False) -> Browser:
    # Headed Xvfb captures use Mesa/OpenGL rather than Chromium SwiftShader:
    # the original software ANGLE path repeatedly lost WebGL2 under real
    # close-scene streaming, even at <250MB and one upload/frame. Headless
    # default and WebGPU backend setup retain their existing proven flags.
    webgl2_args = ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist"] if headed and renderer == "webgl2" else WEBGL2_ARGS
    options: dict[str, Any] = {"headless": not headed, "args": webgl2_args}
    if renderer == "webgpu":
        # Keep Playwright's default --disable-dev-shm-usage. Forcing Chromium
        # back onto the Xvfb runner's shared-memory-backed path can leave the
        # live WebGPU world responsive but its compositor unable to paint.
        options.update(args=WEBGPU_ARGS)
    if channel:
        # Installed Chromium channels can use their native adapter on Windows;
        # Linux SwiftShader/Vulkan flags are reserved for the bundled CI browser.
        options.update(channel=channel, args=["--enable-gpu", "--ignore-gpu-blocklist"] +
                       (["--enable-unsafe-webgpu"] if renderer == "webgpu" else []))
    try:
        return playwright.chromium.launch(executable_path=chromium, **options)
    except PlaywrightError as error:
        # Playwright wants a browser revision that is not installed: use the newest one that is.
        root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / ".cache/ms-playwright")
        found = glob.glob(os.path.join(root, "chromium-*", "chrome-linux", "chrome"))
        if chromium or not found or "Executable doesn't exist" not in str(error):
            raise
        newest = max(found, key=lambda path: int(re.findall(r"chromium-(\d+)", path)[-1]))
        print(f"WARNING: Playwright's own Chromium is missing; using {newest}", file=sys.stderr)
        return playwright.chromium.launch(executable_path=newest, **options)


def parse_point(text: str, viewport: tuple[int, int]) -> tuple[float, float]:
    """Parse "x,y" in viewport pixels; either value may be a percentage."""
    x, y = (float(part.strip().rstrip("%")) * (size / 100 if "%" in part else 1)
            for part, size in zip(text.split(","), viewport, strict=True))
    return x, y


# Measure normal, settled gameplay BEFORE any screenshot, freeze or compositor
# readback. This is diagnostic evidence, never a pass/fail criterion. It avoids
# confusing PlayCanvas' 300-frame startup rolling window with stable gameplay.
# Sampling latest counters periodically is light but not an exhaustive frame trace.
UNINTERRUPTED_RENDER_JS = """async () => {
  const readings = [], started = performance.now();
  while (readings.length < 20 && performance.now() - started < 3000) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const s = window.advisorWorld?.state, p = s?.performance;
    if (!p || p.cpuRenderMs?.latest == null) continue;
    readings.push({
      renderMs: p.cpuRenderMs.latest,
      frameMs: p.cpuFrameMs?.latest ?? null,
      drawCalls: p.drawCalls ?? null,
      fps: s.fps ?? null,
      settled: !!s.settled,
      pending: s.pending ?? null,
    });
  }
  const pct = (key, fraction) => {
    const values = readings.map(r => r[key]).filter(v => Number.isFinite(v)).sort((a,b) => a-b);
    return values.length ? values[Math.ceil(fraction * values.length) - 1] : null;
  };
  return {
    context: "normal gameplay before screenshot/quiescence",
    approximateIntervalMs: 100,
    observedWallMs: Math.round(performance.now() - started),
    samples: readings.length,
    settledSamples: readings.filter(r => r.settled && r.pending === 0).length,
    cpuRenderSampledP50Ms: pct("renderMs", 0.5),
    cpuRenderSampledP95Ms: pct("renderMs", 0.95),
    cpuFrameSampledP95Ms: pct("frameMs", 0.95),
    drawCallSampledP95: pct("drawCalls", 0.95),
    fpsSampledP50: pct("fps", 0.5),
  };
}"""


def write_records(out: str, records: list[dict[str, Any]]) -> None:
    (Path(out) / "capture.json").write_text(json.dumps(records, indent=2) + "\n")


class Session:
    """One page load of one scenario in one profile."""

    def __init__(self, page: Page, args: argparse.Namespace, name: str, profile: str,
                 viewport: tuple[int, int], records: list[dict[str, Any]]) -> None:
        self.page, self.args, self.name = page, args, name
        self.profile, self.viewport, self.records = profile, viewport, records
        self.console_errors: list[str] = []
        self.page_errors: list[str] = []
        self.shots = 0
        self.uninterrupted_render_probe: dict[str, Any] | None = None
        page.on("console", lambda m: self.console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    def settle(self, ready_only: bool = False) -> None:
        deadline = time.monotonic() + self.args.timeout
        while time.monotonic() < deadline:
            try:
                result = self.page.wait_for_function(READY_JS if ready_only else SETTLED_JS, polling=250, timeout=min(5000, max(1, (deadline-time.monotonic())*1000))).json_value()
                if result == "error":
                    raise CaptureError("page reports an error")
                break
            except PlaywrightTimeoutError:
                try:
                    state = self.page.wait_for_function("""() => {const s=window.advisorWorld?.state; return s ? {ready:s.ready,settled:s.settled,pending:s.pending,active:s.active,cached:s.cached,coverage:s.coverage?.complete,workers:s.coverage?.readyWorkers,busy:s.coverage?.busyWorkers,fps:s.fps,residents:s.simulation,error:s.error} : {loading:true};}""", timeout=3000).json_value()
                    print("SETTLE " + json.dumps(state), flush=True)
                except PlaywrightTimeoutError:
                    print("SETTLE main thread not responding", flush=True)
        else:
            raise CaptureError("world did not become ready within the capture timeout" if ready_only else "world did not settle within the capture timeout")
        # Software WebGPU can render coherently but take over 15 seconds for
        # two initial frames while cold terrain/resident workers contend.
        # Honour a finite frame cap (at most 60s), never bypass actual frames.
        self.page.wait_for_function(TWO_FRAMES_JS, timeout=min(60000, self.args.timeout * 1000))

    def locate(self, selector: str) -> Locator:
        locator = self.page.locator(selector).first
        if not locator.count():
            raise CaptureError(f"selector not found: {selector}")
        return locator

    def canvas_point(self, text: str) -> tuple[float, float]:
        """An explicit x,y, or the uncovered canvas point nearest the centre."""
        if text:
            return parse_point(text, self.viewport)
        point = self.page.evaluate(FREE_POINT_JS)
        if not point:
            raise CaptureError("the canvas is completely covered")
        return point[0], point[1]

    def step(self, name: str, arg: str) -> None:
        page = self.page
        restore_minimized = False
        if name in ("click", "check", "uncheck") and arg in ("#home", "#overview", "#open-travel", "#grid", "#nature", "#structures"):
            toggle = page.locator("#toggle-region-panel")
            if toggle.count() and toggle.get_attribute("aria-expanded") != "true":
                toggle.click()
                restore_minimized = True
        if name == "click":
            if arg.startswith('#npc-popup [data-go^="'):
                # Chromium software WebGPU can keep animating the popup while
                # locator.click() waits forever for Playwright's stable-layout
                # heuristic. Find the genuinely visible, unobstructed button,
                # then send a real CDP mouse click at its centre. The following
                # S006 steps still verify the actual camera/SEED result.
                # Locator.evaluate can block for 15s on software WebGPU
                # even when the same live DOM, selected actor, and canonical
                # popup fields already passed. Poll the live document directly
                # (finite 15s); keep the real browser mouse click and exact
                # post-click SEED/camera assertions. A hidden/clipped control
                # is scrolled into the real popup viewport, never force-clicked.
                point = page.wait_for_function("""selector => {
                    const element = document.querySelector(selector);
                    if (!element) return false;
                    const r = element.getBoundingClientRect();
                    const panel = element.closest('#npc-popup')?.getBoundingClientRect();
                    if (!r.width || !r.height || r.top >= innerHeight || r.bottom <= 0) return false;
                    if (panel && (r.top < panel.top || r.bottom > panel.bottom)) {
                        element.scrollIntoView({block:'center', inline:'nearest'});
                        return false;
                    }
                    const x = Math.round((Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2);
                    const y = Math.round((Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2);
                    const action = element.getAttribute('data-go');
                    const hit = document.elementFromPoint(x, y)?.closest('[data-go]');
                    return action && hit?.getAttribute('data-go') === action ? [x, y] : false;
                }""", arg=arg, polling=250,
                    timeout=min(15000, self.args.timeout * 1000)).json_value()
                if not point:
                    raise CaptureError(f"resident popup control not genuinely clickable: {arg}")
                page.mouse.click(*point)
            else:
                self.locate(arg).click()
        elif name in ("check", "uncheck"):
            self.locate(arg).set_checked(name == "check")
        elif name == "select":
            selector, value = arg.rsplit("=", 1)
            self.locate(selector.strip()).select_option(value.strip())
        elif name == "visible":
            # An asynchronously installed actor/door marker may not exist yet.
            # Playwright must wait for the real element, not fail a count() precheck.
            page.locator(arg).first.wait_for(state="visible", timeout=self.args.timeout * 1000)
        elif name in ("zoom-in", "zoom-out"):
            for _ in range(int(arg or 1)):
                self.locate(f"#{name}").click()
        elif name == "wheel":
            delta, _, at = arg.partition("@")
            page.mouse.move(*self.canvas_point(at.strip()))
            page.mouse.wheel(0, float(delta))
        elif name == "drag":
            start, end = arg.split(">")
            page.mouse.move(*parse_point(start, self.viewport))
            page.mouse.down()
            page.mouse.move(*parse_point(end, self.viewport), steps=12)
            page.mouse.up()
        elif name == "tap":
            if arg in ("resident", "resident-feet", "resident-verified"):
                point = page.evaluate("""mode => {
                  // WP #550 uses the GPU-confirmed resident's ORIGINAL pixel,
                  // not a new CPU-only candidate that might hit a roof.
                  const r = mode === 'resident-verified'
                    ? window.__s006Resident
                    : window.advisorWorld?.residentEvidencePick?.(mode === 'resident-feet');
                  if (!r || !Number.isFinite(r.clientX) || !Number.isFinite(r.clientY))
                    return null;
                  window.__s006Resident = r;
                  return [r.clientX, r.clientY];
                }""", arg=arg)
                if point is None:
                    raise CaptureError("no selected resident pixel available for actual browser tap")
                x, y = point
            else:
                x, y = self.canvas_point(arg)
            if page.evaluate("([x, y]) => document.elementFromPoint(x, y)?.id", [x, y]) != "world":
                raise CaptureError(f"tap at {x:g},{y:g} is outside the canvas or covered by a panel")
            page.mouse.click(x, y)
        elif name == "key":
            key, _, hold = arg.partition("@")
            self.locate("#world").focus()
            page.keyboard.press(key.strip(), delay=float(hold or 250))
        elif name == "settle":
            self.settle()
        elif name == "coverage":
            page.wait_for_function("""() => {
              const s=window.advisorWorld?.state,c=s?.coverage,p=s?.performance;
              if(!c?.complete || !c.layerDebug?.valid)return false;
              const active=new Set(p.activeCanonicalKeys);
              if(p.wantedCanonicalKeys.length && p.wantedCanonicalKeys.every(k=>active.has(k)))return true;
              const visible=new Set(c.visibleCanonicalKeys);
              return c.layerDebug.culled>0 && c.canonicalKeys.length && c.canonicalKeys.every(k=>visible.has(k));
            }""")
            page.wait_for_function(TWO_FRAMES_JS, timeout=15000)
        elif name == "wait":
            page.wait_for_timeout(float(arg))
        elif name == "eval":
            page.wait_for_function("async source => { await (0, eval)(source); return true; }", arg=arg, timeout=self.args.timeout * 1000)
        elif name == "until":
            # Cold SEED residents can need more than 60s to finish their first
            # legal door/route query on software GPU runners. Honour the
            # configured per-wait timeout; the CI job still has its own hard
            # 840s cap. Never treat a pending/absent actor as a visual PASS.
            try:
                page.wait_for_function("source => (0, eval)(source)", arg=arg, polling=500,
                                       timeout=self.args.timeout * 1000)
            except PlaywrightTimeoutError:
                try:
                    diagnosis = page.wait_for_function("""() => {
                      const s = window.advisorWorld?.state;
                      return {ready:s?.ready, settled:s?.settled, halfHeight:s?.view?.halfHeight,
                        visibleActors:s?.visibleResidents, residentWorkerBusy:s?.simulation?.residentWorkerBusy,
                        snapshotReady:s?.simulation?.residentSnapshotReady,
                        snapshotTick:s?.simulation?.residentSnapshotTick,
                        query:s?.simulation?.query, backend:window.advisorWorld?.renderer?.backend,
                        actorEvidence:window.advisorWorld?.residentEvidenceDiagnosis?.(),
                        error:s?.error};
                    }""", timeout=3000).json_value()
                    print("UNTIL no real resident actor: " + json.dumps(diagnosis), flush=True)
                except PlaywrightError:
                    print("UNTIL actor diagnostics unavailable: main thread unresponsive", flush=True)
                raise
        elif name == "shot":
            self.shot(arg)
        else:
            raise ValueError("unknown step name")
        if restore_minimized:
            page.locator("#toggle-region-panel").evaluate("button => button.click()")

    def capture_x11_viewport(self, path: Path) -> bool:
        """Read an actual headed Chromium framebuffer when CDP GPU capture stalls.

        This is not a rendered substitute: the pixels are from Xvfb's live
        display at the real Chrome content window, and require manual visual
        inspection even when a dimensionally valid PNG is produced.
        """
        display = os.environ.get("DISPLAY")
        if not self.args.headed or not display:
            return False
        try:
            box = self.page.wait_for_function("""() => ({
                x: window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2),
                y: window.screenY + Math.max(0, window.outerHeight - window.innerHeight),
                width: window.innerWidth, height: window.innerHeight
            })""", timeout=min(15000, self.args.timeout * 1000)).json_value()
            if (box["width"], box["height"]) != self.viewport:
                print(f"X11 fallback skipped: browser content {box['width']}x{box['height']} != {self.viewport}", flush=True)
                return False
            x, y = round(box["x"]), round(box["y"])
            if x < 0 or y < 0:
                return False

            def exact_png() -> bool:
                pixels = path.read_bytes() if path.exists() else b""
                return (len(pixels) >= 24 and
                        pixels[:8] == bytes((137, 80, 78, 71, 13, 10, 26, 10)) and
                        struct.unpack(">II", pixels[16:24]) == self.viewport)

            ffmpeg = shutil.which("ffmpeg")
            if ffmpeg:
                result = subprocess.run(
                    [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                     "-f", "x11grab", "-video_size", f"{self.viewport[0]}x{self.viewport[1]}",
                     "-i", f"{display}+{x},{y}", "-frames:v", "1", "-update", "1",
                     "-y", str(path)],
                    capture_output=True, text=True, timeout=12, check=False,
                )
                if result.returncode == 0 and exact_png():
                    print(f"X11 real framebuffer (ffmpeg) {self.viewport} at ({x},{y}); INSPECTION REQUIRED", flush=True)
                    return True
                print(f"X11 ffmpeg readback unavailable: {result.stderr[-220:]}", flush=True)
            # CI's Playwright FFmpeg codec bundle is not necessarily a system
            # x11grab binary. mss reads actual X11 framebuffer pixels directly.
            try:
                from mss import mss
                from mss.tools import to_png
                with mss() as display_capture:
                    region = {
                        "left": x, "top": y,
                        "width": self.viewport[0], "height": self.viewport[1],
                    }
                    # A valid PNG alone is not enough: software WebGPU has
                    # yielded a frozen 100%-loading X11 framebuffer while
                    # the page's DOM and Simulation continued progressing.
                    # Probe actual compositor responsiveness with a temporary
                    # bright square, remove it, and capture only AFTER its
                    # removal is physically visible in the X11 pixels.
                    # The diagnostic square must never enter an evidence PNG.
                    before = display_capture.grab(region).pixel(24, 24)
                    self.page.evaluate("""() => {
                        const marker = document.createElement('div');
                        marker.id = 'advisor-capture-freshness-probe';
                        marker.style.cssText = 'position:fixed;left:0;top:0;width:48px;height:48px;background:#ff00ff;z-index:2147483647;pointer-events:none';
                        document.body.append(marker);
                    }""")
                    try:
                        probe_seen = False
                        for _ in range(12):
                            self.page.wait_for_timeout(250)
                            pixel = display_capture.grab(region).pixel(24, 24)
                            if pixel == (255, 0, 255) and pixel != before:
                                probe_seen = True
                                break
                    finally:
                        self.page.evaluate("""() => document.getElementById('advisor-capture-freshness-probe')?.remove()""")
                    if not probe_seen:
                        raise CaptureError("X11 compositor is stale: DOM changed but the live framebuffer did not paint the freshness probe")
                    for _ in range(12):
                        self.page.wait_for_timeout(250)
                        frame = display_capture.grab(region)
                        if frame.pixel(24, 24) != (255, 0, 255):
                            break
                    else:
                        raise CaptureError("X11 compositor is stale: freshness probe did not disappear from live framebuffer")
                    to_png(frame.rgb, frame.size, output=str(path))
                if exact_png():
                    print(f"X11 real framebuffer (mss) {self.viewport} at ({x},{y}); INSPECTION REQUIRED", flush=True)
                    return True
                print("X11 mss readback had wrong PNG dimensions", flush=True)
            except Exception as error:
                print(f"X11 mss readback unavailable: {str(error)[:220]}", flush=True)
        except (PlaywrightError, subprocess.TimeoutExpired, OSError, ValueError, KeyError) as error:
            print(f"X11 fallback unavailable: {str(error)[:250]}", flush=True)
        path.unlink(missing_ok=True)
        return False

    def capture_viewport(self, path: Path, require_fresh_paint: bool = False) -> None:
        # Live software WebGL2/WebGPU rendering can make Playwright's ordinary
        # full-resolution screenshot hang. Only actual exact-size compositor
        # PNGs count: do not substitute DOM state or manufacture a frame.
        #
        # A static owned-door camera can yield just the initial (possibly
        # stale) screencast frame. Once, within a separate finite budget, close
        # and re-open the CDP stream to solicit a new real compositor frame.
        # Both attempts must independently discard their first frame.
        # The browser's DOM/camera may be newer than its GPU compositor.
        # For required resident evidence, accept a genuine PNG only after CDP
        # has *painted* a temporary magenta probe and then visibly removed it.
        # The probe never appears in an accepted screenshot.
        def probe_visible(pixels: bytes) -> bool:
            from io import BytesIO
            from PIL import Image
            with Image.open(BytesIO(pixels)) as image:
                return image.convert("RGB").getpixel((24, 24)) == (255, 0, 255)

        deadline = time.monotonic() + min(30, self.args.timeout)
        for attempt, budget in ((1, 20), (2, 10)):
            session = self.page.context.new_cdp_session(self.page)
            frames: list[dict[str, Any]] = []
            session.on("Page.screencastFrame", lambda frame: frames.append(frame))
            started = False
            received = 0
            try:
                if require_fresh_paint:
                    session.send("Runtime.evaluate", {"expression": """(() => {
                        document.getElementById('advisor-capture-freshness-probe')?.remove();
                        const marker = document.createElement('div');
                        marker.id = 'advisor-capture-freshness-probe';
                        marker.style.cssText = 'position:fixed;left:0;top:0;width:48px;height:48px;background:#ff00ff;z-index:2147483647;pointer-events:none';
                        document.body.append(marker);
                    })()"""})
                session.send("Page.startScreencast", {
                    "format": "png", "maxWidth": self.viewport[0],
                    "maxHeight": self.viewport[1], "everyNthFrame": 1,
                })
                started = True
                marker_seen = False

                def request_real_repaint() -> None:
                    # Invalidate the genuine DOM overlay and HUD so Chrome can
                    # paint a new actual canvas composition. Opacity changes
                    # neither ground/door geometry nor Simulation authority.
                    session.send("Runtime.evaluate", {
                        "expression": """(() => {
                            for (const marker of [
                                document.querySelector('#selected-home-door-marker:not([hidden]), #selected-resident-marker:not([hidden])'),
                                document.querySelector('#tile-status')
                            ]) if (marker) marker.style.opacity =
                                marker.style.opacity === '0.999' ? '0.998' : '0.999';
                        })()""",
                    })

                request_real_repaint()
                attempt_deadline = min(deadline, time.monotonic() + budget)
                while time.monotonic() < attempt_deadline:
                    if not frames:
                        self.page.wait_for_timeout(100)
                        continue
                    frame = frames.pop(0)
                    session.send("Page.screencastFrameAck", {"sessionId": frame["sessionId"]})
                    received += 1
                    if received == 1:
                        # An initial CDP snapshot can predate the latest
                        # selected actor, camera focus or settled HUD.
                        request_real_repaint()
                        continue
                    pixels = base64.b64decode(frame["data"], validate=True)
                    dimensions = (struct.unpack(">II", pixels[16:24])
                                  if len(pixels) >= 24 and pixels[:8] == bytes((137, 80, 78, 71, 13, 10, 26, 10))
                                  else None)
                    if dimensions == self.viewport:
                        if require_fresh_paint:
                            painted = probe_visible(pixels)
                            if not marker_seen:
                                if painted:
                                    marker_seen = True
                                    session.send("Runtime.evaluate", {"expression":
                                        "document.getElementById('advisor-capture-freshness-probe')?.remove()"})
                                    request_real_repaint()
                                continue
                            if painted:
                                continue  # Await a real compositor frame AFTER removal.
                        path.write_bytes(pixels)
                        print(f"SCREENCAST attested compositor attempt {attempt} frame #{received} {dimensions} to {path.name}", flush=True)
                        return
                    print(f"SCREENCAST rejected non-exact viewport {dimensions}; expected {self.viewport}", flush=True)
                print(f"SCREENCAST attempt {attempt}: only {received} real compositor frame(s); retrying only with another real CDP stream" if attempt == 1
                      else f"SCREENCAST attempt {attempt}: only {received} real compositor frame(s); no valid image",
                      flush=True)
            finally:
                if require_fresh_paint:
                    session.send("Runtime.evaluate", {"expression":
                        "document.getElementById('advisor-capture-freshness-probe')?.remove()"})
                if started:
                    session.send("Page.stopScreencast")
                session.detach()
        # A real Xvfb viewport can still exist even when both Chromium GPU
        # readback APIs stall. Never forge pixels or accept an uninspected frame.
        if self.capture_x11_viewport(path):
            return
        # Retain the strictly bounded existing genuine-Chromium fallback.
        # A stalled GPU makes this fail honestly without a fake screenshot.
        self.page.screenshot(path=str(path), timeout=min(15000, self.args.timeout * 1000),
                             animations="disabled")
    def shot(self, suffix: str = "") -> None:
        file = f"{self.name}-{self.profile}{'-' + suffix if suffix else ''}.png"
        path = Path(self.args.out) / file
        resident_proof = suffix in ("resident-canonical-details", "owned-home-entrance", "selected-foot-surface")
        if resident_proof:
            # A transient `until:state.settled` can precede more terrain uploads.
            # Both the actual resident and owned doorway must be captured only
            # after fully settled geometry, two rendered frames and ready HUD;
            # the canonical on-canvas actor and identity checks remain required.
            # This never creates pixels or changes Simulation/rendering authority.
            self.settle()
            self.page.wait_for_function(
                SETTLED_FRAMES_JS, polling=250,
                timeout=min(60000, self.args.timeout * 1000),
            )
            if self.uninterrupted_render_probe is None:
                # One bounded observation per resident evidence session.
                # Keep the game running and avoid GPU/scene quiescence here.
                # A missing probe is UNKNOWN, never a reason to fail a real PNG.
                try:
                    self.uninterrupted_render_probe = self.page.evaluate(UNINTERRUPTED_RENDER_JS)
                except PlaywrightError as error:
                    self.uninterrupted_render_probe = {"status": "unavailable", "reason": str(error).splitlines()[0]}
        # The renderer can begin optional prefetch between a settled probe
        # and the screenshot. Acquire a genuinely settled frame and block
        # ONLY new streaming work atomically in the real page; neither actor
        # Simulation nor resident queries stop. WebGL2 keeps rendering live;
        # WebGPU submits a verified real frame before draining its GPU queue.
        quiesced = False
        try:
            if resident_proof:
                token = 0
                for _ in range(24):
                    token = self.page.evaluate(
                        # Real Chromium compositor readback (especially SwiftShader
                        # WebGPU) needs continuing frames. Hold only new geometry
                        # streaming, exactly as the proven WebGL2 captures do.
                        "() => window.advisorWorld.capturePresentation?.quiesceStreaming(false) ?? 0",
                    )
                    if token:
                        quiesced = True
                        break
                    self.page.wait_for_timeout(250)
                if not quiesced:
                    raise CaptureError("no genuinely settled frame for atomic resident/door capture")

            # Pre/post HUD and canonical world state are sampled WHILE the
            # same genuine current-view geometry remains held, not after
            # release when optional prefetch could legitimately resume.
            state = self.page.evaluate(STATE_JS)
            tile_status_before = state["tileStatusText"]
            readback_started = time.monotonic()
            self.capture_viewport(path, require_fresh_paint=resident_proof)
            readback_wall_ms = round((time.monotonic() - readback_started) * 1000, 2)
            post_capture_state = self.page.evaluate(STATE_JS)
            tile_status_after = post_capture_state["tileStatusText"]
        finally:
            if quiesced:
                self.page.evaluate(
                    "window.advisorWorld.capturePresentation?.resumeStreaming()")
        if not path.is_file() or path.stat().st_size == 0:
            raise CaptureError(f"screenshot was not written: {path}")
        self.shots += 1
        scene_flat_fraction = resident_scene_flat_fraction(path) if resident_proof else None
        frame_settled_consistent = (
            all(sample["ready"] and sample["settled"] and sample["pending"] == 0
                for sample in (state, post_capture_state))
            and all(label is not None and "ready" in label.lower() and "refining" not in label.lower()
                    for label in (tile_status_before, tile_status_after))
        )
        fell_back = self.args.renderer == "webgpu" and state["backend"] != "webgpu"
        record = {
            "file": file, "scenario": self.name, "profile": self.profile,
            "viewport": {"width": self.viewport[0], "height": self.viewport[1]},
            "url": self.page.url,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "deviceScaleFactor": self.args.device_scale_factor, "mobileEmulation":self.args.touch,
            "browserVersion":self.page.context.browser.version,
            "requestedRenderer": self.args.renderer, "webgpuFellBack": fell_back, **state,
            "postCaptureReadiness": {
                "ready": post_capture_state["ready"],
                "settled": post_capture_state["settled"],
                "pending": post_capture_state["pending"],
                "active": post_capture_state["active"],
                "tileStatusBefore": tile_status_before,
                "tileStatusAfter": tile_status_after,
                "consistent": frame_settled_consistent,
            },
            "residentSceneLargestColorBinFraction": scene_flat_fraction,
            # Distinguish scene/render CPU from the independent screenshot
            # compositor readback; no new performance pass/fail threshold.
            "uninterruptedRenderProbe": self.uninterrupted_render_probe if resident_proof else None,
            "captureReadbackWallMs": readback_wall_ms,
            "performanceAfterReadback": post_capture_state.get("performance"),
            "browserChannel": self.args.browser_channel,
            "consoleErrors": list(self.console_errors), "pageErrors": list(self.page_errors),
        }
        if record["presentation"] is None:
            del record["presentation"]
        self.records.append(record)
        write_records(self.args.out, self.records)
        print(f"captured {path}  backend={state['backend'] or '?'} detail={state['detailName']}"
              f" active={state['active']} pending={state['pending']}")
        if fell_back:
            print(f"WARNING: {file}: WebGPU was requested but the page rendered with "
                  f"{state['backend'] or 'no backend'}: {state['fallbackReason']}", file=sys.stderr)
        if state["error"] or post_capture_state["error"]:
            raise CaptureError(f"page reports an error: {state['error'] or post_capture_state['error']}")
        if scene_flat_fraction is not None and scene_flat_fraction > 0.60:
            raise CaptureError(f"real PNG appears to contain no rendered 3D world: "
                               f"{scene_flat_fraction:.1%} of pixels share one 8-bit RGB bin; "
                               "retain PNG for required manual inspection")
        if resident_proof and not frame_settled_consistent:
            raise CaptureError(
                f"{suffix} PNG cannot prove fully settled geometry: "
                f"pre={state['ready']}/{state['settled']}/{state['pending']} "
                f"post={post_capture_state['ready']}/{post_capture_state['settled']}/{post_capture_state['pending']} "
                f"HUD={tile_status_before!r} -> {tile_status_after!r}"
            )

    def run(self, steps: list[str]) -> None:
        print(f"OPEN {self.name}-{self.profile}", flush=True)
        self.page.goto(self.args.url, wait_until="domcontentloaded")
        print("DOM READY; waiting for ready world" if self.args.initial_ready_only else
              "DOM READY; waiting for settled world", flush=True)
        self.settle(ready_only=self.args.initial_ready_only)
        print("INITIAL WORLD READY" if self.args.initial_ready_only else "INITIAL WORLD SETTLED", flush=True)
        for step in steps:
            print(f"STEP {step[:100]}", flush=True)
            try:
                self.step(*(part.strip() for part in step.partition(":")[::2]))
            except ValueError as error:
                raise CaptureError(f"bad step '{step}': {error}") from None
        if not any(step.partition(":")[0].strip() == "shot" for step in steps):
            self.settle()
            self.shot()
        if self.page_errors:
            message = f"uncaught page error: {self.page_errors[0]}"
            if not self.args.allow_errors:
                raise CaptureError(message)
            print(f"WARNING: {self.name}-{self.profile}: {message}", file=sys.stderr)


def split_steps(text: str) -> list[str]:
    parts = (part.replace("\\;", ";").strip() for part in re.split(r"(?<!\\);", text))
    return [part for part in parts if part]


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="address of the running build")
    parser.add_argument("--out", required=True, help="output directory (created if missing)")
    parser.add_argument("--scenario", default="", help=f"comma-separated: {', '.join(SCENARIOS)}")
    parser.add_argument("--steps", help="custom steps separated by ';'")
    parser.add_argument("--name", default="custom", help="file name stem for --steps (default: custom)")
    parser.add_argument("--profile", default="desktop", help=f"comma-separated: {', '.join(PROFILES)}")
    parser.add_argument("--width", type=int, help="viewport width override")
    parser.add_argument("--height", type=int, help="viewport height override")
    parser.add_argument("--touch", action="store_true", help="emulate mobile viewport/touch; does not emulate phone hardware")
    parser.add_argument("--device-scale-factor", type=float, default=1, help="emulated display DPR, not device GPU/RAM emulation")
    parser.add_argument("--renderer", choices=("webgl2", "webgpu"), default="webgl2")
    parser.add_argument("--headed", action="store_true", help="use a real headed Chromium compositor (Linux requires Xvfb or a display)")
    parser.add_argument("--timeout", type=float, default=120, help="seconds per wait (default 120)")
    parser.add_argument("--fixed-time-ms", type=int, help="optional fixed UTC epoch milliseconds for reproducible Fantasy Time; browser timers and animation continue")
    parser.add_argument("--initial-ready-only", action="store_true", help="initial load waits only for coherent world readiness; explicit settle steps still wait for full detail")
    parser.add_argument("--allow-errors", action="store_true", help="report page errors as warnings")
    parser.add_argument("--chromium", default=os.environ.get("ADVISOR_CHROMIUM"),
                        help="Chromium executable (default: env ADVISOR_CHROMIUM)")
    parser.add_argument("--browser-channel", choices=("chrome", "msedge"), help="installed browser channel with its native adapter")
    args = parser.parse_args(argv)
    args.profiles = [name.strip() for name in args.profile.split(",") if name.strip()]
    names = [name.strip() for name in args.scenario.split(",") if name.strip()]
    for name, known in [(n, PROFILES) for n in args.profiles] + [(n, SCENARIOS) for n in names]:
        if name not in known:
            parser.error(f"unknown name '{name}'; choose from {', '.join(known)}")
    if not names and not args.steps:
        names = ["village"]
    # Each job is (file name stem, steps); --steps runs after any named scenarios.
    args.jobs = [(name, split_steps(SCENARIOS[name])) for name in names]
    if args.steps:
        args.jobs.append((args.name, split_steps(args.steps)))
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    failures = 0
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))  # close the browser when terminated
    write_records(args.out, records)
    with sync_playwright() as playwright:
        browser = launch(playwright, args.renderer, args.chromium, args.browser_channel, args.headed)
        try:
            for profile in args.profiles:
                viewport = (args.width or PROFILES[profile][0], args.height or PROFILES[profile][1])
                context = browser.new_context(
                    viewport={"width": viewport[0], "height": viewport[1]}, device_scale_factor=args.device_scale_factor, is_mobile=args.touch, has_touch=args.touch)
                context.set_default_timeout(args.timeout * 1000)
                # Enables a one-frame renderer quiescence handshake only
                # within this required real-game evidence session.
                context.add_init_script("Object.defineProperty(window, '__advisorCaptureMode', {value:true})")
                if args.renderer == "webgl2":
                    context.add_init_script("Object.defineProperty(navigator, 'gpu', {value: undefined, configurable: true})")
                for name, steps in args.jobs:
                    page = context.new_page()
                    if args.fixed_time_ms is not None:
                        page.clock.set_fixed_time(datetime.fromtimestamp(args.fixed_time_ms / 1000, timezone.utc))
                    session = Session(page, args, name, profile, viewport, records)
                    try:
                        session.run(steps)
                    except (CaptureError, PlaywrightError) as error:
                        failures += 1
                        reason = str(error).strip().splitlines()[0]
                        try:
                            failure_state = session.page.wait_for_function(STATE_JS, timeout=5000).json_value()
                        except PlaywrightError:
                            failure_state = {}
                        (Path(args.out) / f"{name}-{profile}-failure.json").write_text(
                            json.dumps({"reason": reason, "shots": session.shots,
                                        "state": failure_state}, indent=2), encoding="utf-8")
                        print(f"FAILED {name}-{profile} after {session.shots} image(s): {reason}",
                              file=sys.stderr)
                    finally:
                        session.page.close()
                context.close()
        finally:
            browser.close()
    print(f"{len(records)} image(s) written to {args.out}; {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
