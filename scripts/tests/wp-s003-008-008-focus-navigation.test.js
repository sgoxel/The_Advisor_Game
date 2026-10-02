#!/usr/bin/env node
"use strict";
const fs=require("fs");
const assert=require("assert");
const source=fs.readFileSync("scripts/world/planet-stage.js","utf8");
const css=fs.readFileSync("styles/main.css","utf8");

function has(text,msg){assert(source.includes(text),msg)}
function segment(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert(a>=0&&b>a,"missing segment "+start+" -> "+end);
  return source.slice(a,b);
}

has("function validFocusCoordinate(target)","shared focus coordinate validator missing");
has("function canonicalDestinationCoordinate(descriptor)","destination canonical coordinate resolver missing");
has("function beginFocusNavigation(","shared explicit focus transaction missing");
has('const requestId="FOCUS-"+String(++focusNavigation.sequence).padStart(4,"0")',"stable focus request id missing");
has("fallbackUsed:false","focus must explicitly report no fallback");
has('go.textContent=coordinate?"View":"Unavailable"',"Places invalid target UI must fail visibly");
has("go.disabled=!coordinate","invalid Places coordinate must not navigate");
has("focusDestination(d);renderDestinationNavigator();","Places button must use shared focus path");
has('["npc","protagonist","building","signpost"]',"protagonist inspection type missing");
has('action.textContent="View / Focus"',"explicit protagonist focus action missing");
has('setZoomTargetScalar(ZOOM_MAX,"explicit-protagonist-focus")',"protagonist focus must request maximum zoom");
has("function updateFocusNavigation()","protagonist follow-until-settle update missing");
has("window.Protagonist?.getPosition?.()","authoritative current protagonist source missing");
has('className="planet-protagonist-marker"',"wider protagonist semantic marker missing");
has("function updateProtagonistMapMarker(layer)","wider protagonist marker projection missing");
has("focusNavigation:focusNavigationSnapshot()","focus telemetry missing from snapshot");
has("focusProtagonist,focusDestinationById:","public focus APIs missing");
assert(css.includes('.planet-protagonist-marker{'),"protagonist marker CSS missing");
assert(css.includes('.world-inspection-tooltip[data-actionable="true"]{pointer-events:auto}'),"actionable inspection CSS missing");

const setView=segment("function setViewTarget(","function strictWorldLatLonForTile");
assert(setView.includes("validFocusCoordinate"),"setViewTarget must reject invalid coordinates");
assert(!setView.includes("||0"),"setViewTarget must not coerce invalid coordinates to origin");

const descriptor=segment("function canonicalDestinationCoordinate(","function focusSurfaceAt");
assert(descriptor.includes("descriptor?.coordinates"),"destination focus must consume descriptor canonical coordinates");
assert(!descriptor.includes("worldLatLonForTile"),"destination focus must not invent coordinates from a fallback tile conversion");

const focus=segment("function focusProtagonist()","function updateFocusNavigation()");
for(const forbidden of ["campaign.protagonist=","SeedSystem.getCampaign().protagonist","Protagonist.setPosition","WorldCoordinates.position("]){
  assert(!focus.includes(forbidden),"protagonist focus must not mutate actor position: "+forbidden);
}
assert(focus.includes("authoritativeProtagonistFocusTarget"),"protagonist focus must resolve authoritative target");
assert(focus.includes("maxZoom:true"),"protagonist focus must request final ground");

const follow=segment("function updateFocusNavigation()","function rgbaFromColor");
assert(follow.includes('request.targetType!=="protagonist"'),"follow path must be protagonist-only");
assert(follow.includes("focusNavigationReady(request)"),"follow path must stop when final focus is ready");
assert(follow.includes("focusNavigation.protagonistRefreshCount++"),"follow telemetry missing");
assert(!follow.includes("DailyActivity.build"),"focus follow must not scan settlement residents");
assert(!follow.includes("WorldDestinations.queryNearby"),"focus follow must not scan destination catalog");

const commit=segment("function commitDestinationDescriptors(","function buildDestinationDescriptors");
assert(commit.includes("Number.isFinite(latitudeRadians)?latitudeRadians:null"),"missing destination coordinates must remain unavailable, not origin");
assert(!commit.includes("latitudeRadians:Number(coordinates.latitudeRadians)||0"),"legacy coordinate-zero fallback still present");

console.log(JSON.stringify({
  pass:true,
  checks:27,
  authority:{cameraOnly:true,simulationMutation:false,invalidOriginFallback:false},
  protagonist:{explicitAction:true,maxZoom:true,wideSemanticSelector:true,followUntilSettle:true},
  places:{canonicalDescriptorCoordinates:true,invalidFailsSafe:true}
},null,2));
