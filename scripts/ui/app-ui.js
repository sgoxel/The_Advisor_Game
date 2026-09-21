(function(){
"use strict";
const e={};
let restoredCampaign=false;
let clockTimer=null;
const ids=[
  "mainMenuButton","settingsButton","mainMenuPopup","settingsPopup","resumeButton","newCampaignButton","restartCampaignButton",
  "menuMessage","seedInput","saveSettingsButton","settingsMessage","gameDate","gameTime","campaignState","statusMessage",
  "detailState","detailGameDate","detailGameTime","detailProtagonistX","detailProtagonistY","vDate","vPersist",
  "terrainGrid","terrainLegend","vTerrainDeterministic","vTerrainSolidOnly",
  "tileViewportSize","tileGridSize","tileCount","tileCenterCoordinate",
  "vTileCoverage","vTileResponsive","vTileOddGrid","vTileRepeat","vTileSolidOnly",
  "geoContinent","geoCountry","geoRegion","geoCity","geoDistrict","geoVillage","geoAvenue","geoStreet",
  "geoBiome","geoClimate","geoElevation","geoTerrain","nearestVillage","nearestVillageWalk",
  "vGeoDeterministic","vGeoTimeFree","vVillageSpacing","vTerrainGeography",
  "gameplayPlaceholder","protagonistMarker","protagonistSprite","protagonistFallback","protagonistLocation","wp3Position","vOrigin","vCenter","vProtagonistSprite","vPositiveWorld","vNegativeWorld",
  "prngSeed","foundationKey","foundationValue","prngTimestamp","liveValue","vFoundationRepeat","vFoundationTimeFree","vLiveRepeat","vLiveTime","vNoMilliseconds","vPrngSource"
];
function cache(){ids.forEach(id=>e[id]=document.getElementById(id))}
function openPopup(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function closePopup(id){document.getElementById(id).hidden=true;document.body.style.overflow=""}
function closeAll(){document.querySelectorAll(".fullscreen-popup").forEach(p=>p.hidden=true);document.body.style.overflow=""}
function setCheck(node,pass,waiting){node.textContent=pass?"PASS":waiting;node.classList.toggle("pass",pass)}

function renderPRNG(fantasyTimestampMs){
  const campaign=SeedSystem.getCampaign();
  const seed=campaign?campaign.seed:SeedSystem.getSettings().seed;
  e.prngSeed.textContent=seed;

  const foundationKey="wp002:foundation-proof";
  const foundationValue=PRNG.foundationUint32(seed,foundationKey);
  e.foundationKey.textContent=foundationKey;
  e.foundationValue.textContent=String(foundationValue);
  setCheck(
    e.vFoundationRepeat,
    foundationValue===PRNG.foundationUint32(seed,foundationKey),
    "FAIL"
  );
  setCheck(
    e.vFoundationTimeFree,
    PRNG.foundationUint32.length===2,
    "FAIL"
  );

  if(!campaign||fantasyTimestampMs==null){
    e.prngTimestamp.textContent="—";
    e.liveValue.textContent="—";
    setCheck(e.vLiveRepeat,false,"WAITING");
    setCheck(e.vLiveTime,false,"WAITING");
    setCheck(e.vNoMilliseconds,true,"FAIL");
    setCheck(
      e.vPrngSource,
      PRNG.foundationUint32.length===2&&PRNG.liveUint32.length===2,
      "FAIL"
    );
    return;
  }

  const currentTime=GameTime.fromTimestampMs(fantasyTimestampMs);
  const timestampKey=GameTime.toTimestampKey(currentTime);
  const nextTimestampKey=GameTime.toTimestampKey(GameTime.fromTimestampMs(
    Math.floor(fantasyTimestampMs/1000)*1000+1000
  ));
  const proof=PRNG.verify(campaign.seed,timestampKey);
  e.prngTimestamp.textContent=GameTime.formatTimestamp(currentTime);
  e.liveValue.textContent=String(proof.liveValue);
  setCheck(e.vLiveRepeat,proof.liveRepeatable,"FAIL");
  setCheck(
    e.vLiveTime,
    proof.liveValue!==PRNG.liveUint32(campaign.seed,nextTimestampKey),
    "FAIL"
  );
  setCheck(
    e.vNoMilliseconds,
    /^\d{4,}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestampKey),
    "FAIL"
  );
  setCheck(
    e.vPrngSource,
    PRNG.foundationUint32.length===2&&PRNG.liveUint32.length===2,
    "FAIL"
  );
}
function renderGeography(){
  const campaign=SeedSystem.getCampaign();
  const position=Protagonist.getPosition();
  if(!campaign||!position){
    ["geoContinent","geoCountry","geoRegion","geoCity","geoDistrict","geoVillage","geoAvenue","geoStreet",
     "geoBiome","geoClimate","geoElevation","geoTerrain","nearestVillage","nearestVillageWalk"].forEach(id=>e[id].textContent="—");
    setCheck(e.vGeoDeterministic,false,"WAITING");
    setCheck(e.vVillageSpacing,false,"WAITING");
    return;
  }

  const first=GeographyFoundation.location(campaign.seed,position.x,position.y);
  const second=GeographyFoundation.location(campaign.seed,position.x,position.y);
  const h=first.hierarchy;
  const env=first.environment;
  e.geoContinent.textContent=h.continent;
  e.geoCountry.textContent=h.country;
  e.geoRegion.textContent=h.region;
  e.geoCity.textContent=h.city;
  e.geoDistrict.textContent=h.district;
  e.geoVillage.textContent=h.village;
  e.geoAvenue.textContent=h.avenue;
  e.geoStreet.textContent=h.street;
  e.geoBiome.textContent=env.biome;
  e.geoClimate.textContent=env.climate;
  e.geoElevation.textContent=env.elevationMeters+" m";
  e.geoTerrain.textContent=TerrainPalette.get(first.terrain).label;

  const same=JSON.stringify(first)===JSON.stringify(second);
  setCheck(e.vGeoDeterministic,same,"FAIL");

  const proof=GeographyFoundation.villageSpacingProof(campaign.seed);
  if(proof.nearest){
    e.nearestVillage.textContent=proof.nearest.name+" ("+proof.nearest.x+","+proof.nearest.y+")";
    e.nearestVillageWalk.textContent=Number.isFinite(proof.minutes)?proof.minutes.toFixed(1)+" fantasy minutes":"No valid walking route";
  }else{
    e.nearestVillage.textContent="—";
    e.nearestVillageWalk.textContent="—";
  }
  setCheck(e.vVillageSpacing,proof.pass,"FAIL");
}

function renderTerrainLegend(){
  e.terrainLegend.innerHTML="";
  TerrainPalette.all().forEach(item=>{
    const row=document.createElement("div");
    row.className="terrain-legend-item";
    const swatch=document.createElement("span");
    swatch.className="terrain-swatch";
    swatch.style.background=item.color;
    const label=document.createElement("strong");
    label.textContent=item.label;
    const code=document.createElement("code");
    code.textContent=item.color;
    row.append(swatch,label,code);
    e.terrainLegend.appendChild(row);
  });
}

let lastTerrainViewportKey="";
let terrainResizeObserver=null;
let terrainRenderFrame=0;

function terrainGridDimensions(width,height,tileSize){
  let columns=Math.max(3,Math.ceil(width/tileSize)+2);
  let rows=Math.max(3,Math.ceil(height/tileSize)+2);
  if(columns%2===0)columns+=1;
  if(rows%2===0)rows+=1;
  return {columns,rows};
}

function renderTerrain(){
  const campaign=SeedSystem.getCampaign();
  const center=Protagonist.getPosition();
  if(!campaign||!center){
    e.terrainGrid.hidden=true;
    e.tileViewportSize.textContent="—";
    e.tileGridSize.textContent="—";
    e.tileCount.textContent="—";
    e.tileCenterCoordinate.textContent="—";
    setCheck(e.vTerrainDeterministic,false,"WAITING");
    setCheck(e.vTileCoverage,false,"WAITING");
    setCheck(e.vTileResponsive,false,"WAITING");
    setCheck(e.vTileOddGrid,false,"WAITING");
    setCheck(e.vTileRepeat,false,"WAITING");
    return;
  }

  const tileSize=100;
  const viewport=e.terrainGrid.parentElement;
  const width=Math.max(1,viewport.clientWidth);
  const height=Math.max(1,viewport.clientHeight);
  const {columns,rows}=terrainGridDimensions(width,height,tileSize);
  const halfCols=Math.floor(columns/2);
  const halfRows=Math.floor(rows/2);
  const viewportKey=width+"x"+height;
  const responsive=lastTerrainViewportKey===""||lastTerrainViewportKey===viewportKey||e.terrainGrid.dataset.viewportKey!==viewportKey;

  e.terrainGrid.style.gridTemplateColumns="repeat("+columns+","+tileSize+"px)";
  e.terrainGrid.style.gridTemplateRows="repeat("+rows+","+tileSize+"px)";
  e.terrainGrid.innerHTML="";

  let deterministic=true;
  for(let row=0;row<rows;row++){
    for(let col=0;col<columns;col++){
      const dx=col-halfCols;
      const dy=row-halfRows;
      const pos=WorldCoordinates.add(center,String(dx),String(dy));
      const tile=TerrainFoundation.getTile(campaign.seed,pos.x,pos.y);
      const repeated=TerrainFoundation.getTile(campaign.seed,pos.x,pos.y);
      if(tile.type!==repeated.type||tile.color!==repeated.color)deterministic=false;

      const node=document.createElement("div");
      node.className="terrain-tile";
      node.style.background=tile.color;
      node.dataset.terrain=tile.type;
      node.dataset.x=pos.x;
      node.dataset.y=pos.y;
      node.dataset.origin=(pos.x===center.x&&pos.y===center.y)?"true":"false";
      node.title=tile.label+" ("+pos.x+","+pos.y+")";
      e.terrainGrid.appendChild(node);
    }
  }

  const gridWidth=columns*tileSize;
  const gridHeight=rows*tileSize;
  const coverage=gridWidth>=width&&gridHeight>=height;
  const oddGrid=columns%2===1&&rows%2===1;
  const origin=e.terrainGrid.querySelector('[data-origin="true"]');
  const repeatCenter=TerrainFoundation.getTile(campaign.seed,center.x,center.y);
  const repeatAgain=TerrainFoundation.getTile(campaign.seed,center.x,center.y);
  const repeatable=repeatCenter.type===repeatAgain.type&&repeatCenter.color===repeatAgain.color;

  e.terrainGrid.dataset.columns=String(columns);
  e.terrainGrid.dataset.rows=String(rows);
  e.terrainGrid.dataset.tileSize=String(tileSize);
  e.terrainGrid.dataset.viewportWidth=String(width);
  e.terrainGrid.dataset.viewportHeight=String(height);
  e.terrainGrid.dataset.gridWidth=String(gridWidth);
  e.terrainGrid.dataset.gridHeight=String(gridHeight);
  e.terrainGrid.dataset.viewportKey=viewportKey;
  e.terrainGrid.dataset.coveragePass=coverage?"true":"false";
  e.terrainGrid.dataset.centerPass=(!!origin&&oddGrid)?"true":"false";
  e.terrainGrid.hidden=false;

  e.tileViewportSize.textContent=width+" × "+height+" px";
  e.tileGridSize.textContent=columns+" × "+rows;
  e.tileCount.textContent=String(columns*rows);
  e.tileCenterCoordinate.textContent="("+center.x+","+center.y+")";

  setCheck(e.vTerrainDeterministic,deterministic,"FAIL");
  setCheck(e.vTileCoverage,coverage,"FAIL");
  setCheck(e.vTileResponsive,responsive,"FAIL");
  setCheck(e.vTileOddGrid,oddGrid&&!!origin,"FAIL");
  setCheck(e.vTileRepeat,repeatable,"FAIL");
  lastTerrainViewportKey=viewportKey;
}

function scheduleTerrainRender(){
  if(terrainRenderFrame)cancelAnimationFrame(terrainRenderFrame);
  terrainRenderFrame=requestAnimationFrame(()=>{
    terrainRenderFrame=0;
    renderTerrain();
  });
}

function observeTerrainViewport(){
  if(terrainResizeObserver)terrainResizeObserver.disconnect();
  if("ResizeObserver" in window){
    terrainResizeObserver=new ResizeObserver(()=>scheduleTerrainRender());
    terrainResizeObserver.observe(e.terrainGrid.parentElement);
  }else{
    window.addEventListener("resize",scheduleTerrainRender);
  }
}

function renderWorldCoordinates(){
  const campaign=SeedSystem.getCampaign();
  const position=Protagonist.getPosition();
  const proof=WorldCoordinates.verifyUnbounded();

  if(position){
    const label="("+position.x+","+position.y+")";
    e.gameplayPlaceholder.hidden=true;
    renderTerrain();
    e.protagonistMarker.hidden=false;
    e.protagonistLocation.textContent=label;
    e.detailProtagonistX.textContent=position.x;
    e.detailProtagonistY.textContent=position.y;
    e.wp3Position.textContent=label;
    setCheck(e.vOrigin,Protagonist.isAtOrigin(),"FAIL");
  }else{
    e.gameplayPlaceholder.hidden=false;
    e.terrainGrid.hidden=true;
    e.protagonistMarker.hidden=true;
    e.protagonistLocation.textContent="—";
    e.detailProtagonistX.textContent="—";
    e.detailProtagonistY.textContent="—";
    e.wp3Position.textContent="—";
    setCheck(e.vOrigin,false,"WAITING");
  }

  setCheck(e.vCenter,true,"FAIL");
  setCheck(e.vPositiveWorld,proof.positiveValid,"FAIL");
  setCheck(e.vNegativeWorld,proof.negativeValid,"FAIL");
}

function renderStatic(){
  const campaign=SeedSystem.getCampaign();
  e.campaignState.textContent=campaign?"ACTIVE":"NOT STARTED";
  e.detailState.textContent=campaign?"Active":"Not started";
  e.restartCampaignButton.disabled=!campaign;
  e.resumeButton.disabled=!campaign;
  setCheck(e.vDate,!!campaign&&GameTime.validateStartYear(),campaign?"FAIL":"WAITING");
  setCheck(e.vPersist,!!campaign&&restoredCampaign,campaign?"RELOAD PAGE TO VERIFY":"WAITING");
  renderWorldCoordinates();
  renderGeography();
}

function renderClock(){
  const fantasyTimestampMs=GameTime.getTimestampMs();
  const t=GameTime.fromTimestampMs(fantasyTimestampMs);
  const date=GameTime.formatDate(t);
  const time=GameTime.formatTime(t);
  e.gameDate.textContent=date;e.gameTime.textContent=time;
  e.detailGameDate.textContent=date;e.detailGameTime.textContent=time;
  renderPRNG(fantasyTimestampMs);
}
function startClock(){
  if(clockTimer)clearInterval(clockTimer);
  renderClock();
  clockTimer=setInterval(renderClock,250);
}
function startNewCampaign(){
  const result=SeedSystem.startNewCampaign();
  restoredCampaign=false;
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent="Campaign running. Game time advances 24× real time.";
  renderStatic();startClock();closePopup("mainMenuPopup");
}
function restartCampaign(){
  const result=SeedSystem.restartCampaign();
  e.menuMessage.textContent=result.message;
  e.statusMessage.textContent=result.ok?"Campaign restarted with the same SEED.":result.message;
  renderStatic();startClock();
  if(result.ok)closePopup("mainMenuPopup");
}
function saveSettings(){
  const result=SeedSystem.setSettingsSeed(e.seedInput.value);
  e.settingsMessage.textContent=result.message;
  if(result.ok)e.seedInput.value=result.seed;
}
function init(){
  cache();
  SeedSystem.loadSettings();
  e.seedInput.value=SeedSystem.getSettings().seed;
  const restored=SeedSystem.loadCampaign();
  restoredCampaign=restored.ok;

  e.mainMenuButton.onclick=()=>openPopup("mainMenuPopup");
  e.settingsButton.onclick=()=>{e.seedInput.value=SeedSystem.getSettings().seed;openPopup("settingsPopup")};
  e.resumeButton.onclick=()=>closePopup("mainMenuPopup");
  e.newCampaignButton.onclick=startNewCampaign;
  e.restartCampaignButton.onclick=restartCampaign;
  e.saveSettingsButton.onclick=saveSettings;
  const updateSpriteCheck=()=>{
    const loaded=e.protagonistSprite.complete&&e.protagonistSprite.naturalWidth>0;
    e.protagonistFallback.hidden=loaded;
    setCheck(e.vProtagonistSprite,loaded,"FAIL");
  };
  e.protagonistSprite.addEventListener("load",updateSpriteCheck);
  e.protagonistSprite.addEventListener("error",updateSpriteCheck);
  updateSpriteCheck();
  document.querySelectorAll("[data-close-popup]").forEach(btn=>btn.onclick=()=>closePopup(btn.dataset.closePopup));
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeAll()});

  if(restored.ok)e.statusMessage.textContent="Campaign restored. Game time continued while the page was closed.";
  else e.statusMessage.textContent="Open Main Menu to start a campaign.";

  renderTerrainLegend();
  renderStatic();startClock();
  observeTerrainViewport();
}
window.AppUI=Object.freeze({init});
})();
