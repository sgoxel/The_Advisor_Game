(function(){
"use strict";

let app=null;
let host=null;
let worldLayer=null;
let terrainLayer=null;
let lowerStructureLayer=null;
let shadowLayer=null;
let entityLayer=null;
let upperStructureLayer=null;
let roofLayer=null;
let routeLayer=null;
let initialized=false;
let lastModel=null;
let buildingProofState=null;
const PROOF_STATES=new Set(["outside","entering","inside","behind","leaving"]);
const LAYER_ORDER=Object.freeze([
  "ground-floor",
  "lower-structure-objects",
  "shadows",
  "characters-entities",
  "upper-walls-foreground",
  "roof-ceiling",
  "verification-route"
]);
let lastSnapshot=Object.freeze({
  ready:false,
  tileCount:0,
  cells:[],
  terrainTypes:{}
});

function colorNumber(value){
  const text=String(value||"#000000").replace("#","");
  const parsed=Number.parseInt(text,16);
  return Number.isFinite(parsed)?parsed:0;
}

function makeSprite(texture,width,height){
  const sprite=new PIXI.Sprite(texture);
  sprite.width=width;
  sprite.height=height;
  return sprite;
}

function makeColorSprite(color,width,height){
  const graphic=new PIXI.Graphics();
  graphic.rect(0,0,width,height).fill({color:colorNumber(color)});
  return graphic;
}

function destroyLayer(container){
  if(!container)return;
  const children=container.removeChildren();
  for(const child of children){
    child.destroy({children:true});
  }
}

function destroyPresentationLayers(){
  destroyLayer(terrainLayer);
  destroyLayer(lowerStructureLayer);
  destroyLayer(shadowLayer);
  destroyLayer(entityLayer);
  destroyLayer(upperStructureLayer);
  destroyLayer(roofLayer);
  destroyLayer(routeLayer);
}

const DIMETRIC_X=0.66;
const DIMETRIC_Y=0.28;

function projectOffset(tileSize,dx,dy){
  return Object.freeze({
    x:(dx-dy)*tileSize*DIMETRIC_X,
    y:(dx+dy)*tileSize*DIMETRIC_Y
  });
}

function worldToScreen(model,originX,originY,x,y){
  const dx=BigInt(String(x))-BigInt(String(model.center.x));
  const dy=BigInt(String(y))-BigInt(String(model.center.y));
  const col=Math.floor(model.columns/2)+Number(dx);
  const row=Math.floor(model.rows/2)+Number(dy);
  const projected=projectOffset(model.tileSize,Number(dx),Number(dy));
  return Object.freeze({
    x:originX+projected.x,
    y:originY+projected.y,
    col,row
  });
}

function applyGroundProjection(container,x,y){
  container.setFromMatrix(new PIXI.Matrix(
    DIMETRIC_X,DIMETRIC_Y,
    -DIMETRIC_X,DIMETRIC_Y,
    x,y
  ));
}

function pointVisible(model,point,marginTiles=1){
  return point.col>=-marginTiles&&point.col<model.columns+marginTiles&&
    point.row>=-marginTiles&&point.row<model.rows+marginTiles;
}

function buildingVisible(model,originX,originY,building){
  const min=worldToScreen(model,originX,originY,building.bounds.minX,building.bounds.minY);
  const max=worldToScreen(model,originX,originY,building.bounds.maxX,building.bounds.maxY);
  const right=max.x+model.tileSize;
  const bottom=max.y+model.tileSize;
  return right>=-model.tileSize&&bottom>=-model.tileSize&&
    min.x<=model.width+model.tileSize&&min.y<=model.height+model.tileSize;
}

function pointInsideBounds(point,bounds){
  if(!point||!bounds)return false;
  const x=BigInt(String(point.x)),y=BigInt(String(point.y));
  return x>=BigInt(String(bounds.minX))&&x<=BigInt(String(bounds.maxX))&&
    y>=BigInt(String(bounds.minY))&&y<=BigInt(String(bounds.maxY));
}

function distanceToCenter(model,point){
  if(!point)return Number.MAX_SAFE_INTEGER;
  const dx=BigInt(String(point.x))-BigInt(String(model.center.x));
  const dy=BigInt(String(point.y))-BigInt(String(model.center.y));
  const ax=dx<0n?-dx:dx,ay=dy<0n?-dy:dy;
  const sum=ax+ay;
  return sum>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:Number(sum);
}

function resolveProofBuilding(model,visibleBuildings){
  const objects=model.interiorObjects||[];
  return visibleBuildings.slice().sort((a,b)=>{
    const aTall=objects.some(o=>o.buildingId===a.id&&["counter","workbench","storage","hearth"].includes(o.type))?0:1;
    const bTall=objects.some(o=>o.buildingId===b.id&&["counter","workbench","storage","hearth"].includes(o.type))?0:1;
    return aTall-bTall||
      distanceToCenter(model,a.entrance?.door)-distanceToCenter(model,b.entrance?.door)||
      String(a.id).localeCompare(String(b.id));
  })[0]||null;
}

function resolveProofPlacement(model,building){
  if(!building||!buildingProofState)return Object.freeze({point:null,object:null});
  const objects=(model.interiorObjects||[]).filter(o=>o.buildingId===building.id);
  const tall=objects.find(o=>["counter","workbench","storage","hearth"].includes(o.type))||objects[0]||null;
  if(buildingProofState==="outside"||buildingProofState==="leaving"){
    return Object.freeze({point:building.entrance?.immediateOutside||building.entrance?.outdoorAccess||building.entrance?.door||null,object:null});
  }
  if(buildingProofState==="entering"){
    return Object.freeze({point:building.entrance?.door||null,object:null});
  }
  if(buildingProofState==="behind"&&tall){
    return Object.freeze({point:tall.interactionPositions?.[0]||building.interiorTarget||null,object:tall});
  }
  return Object.freeze({point:building.interiorTarget||building.entrance?.immediateInside||building.entrance?.door||null,object:null});
}

function drawWallDepth(tile,x,y,tileSize){
  const movement=tile.movement||{};
  const wall=movement.barrierKind==="outer-wall"||movement.barrierKind==="interior-wall";
  const door=movement.doorwayKind==="exterior-door"||movement.doorwayKind==="interior-door";
  if(!wall&&!door)return 0;

  const lift=Math.max(4,tileSize*0.16);
  if(wall){
    const side=new PIXI.Graphics();
    side.rect(x,y-lift,x===x?tileSize:tileSize,lift+tileSize*0.18)
      .fill({color:0x4b3b32,alpha:0.42});
    lowerStructureLayer.addChild(side);

    const cap=new PIXI.Graphics();
    cap.rect(x,y-lift,tileSize,Math.max(3,tileSize*0.18))
      .fill({color:movement.barrierKind==="outer-wall"?0x9a806c:0x826f61,alpha:0.94});
    upperStructureLayer.addChild(cap);
    return 1;
  }

  const lintel=new PIXI.Graphics();
  lintel.rect(x+tileSize*0.08,y-lift*0.72,tileSize*0.84,Math.max(2,tileSize*0.10))
    .fill({color:0x7a5b3c,alpha:0.88});
  upperStructureLayer.addChild(lintel);
  return 0;
}

function objectPalette(type){
  return {
    bed:0x7b6358,
    chair:0x72513b,
    table:0x765238,
    counter:0x67452f,
    workbench:0x5f4633,
    hearth:0x514842,
    storage:0x6b4f35
  }[type]||0x6d5845;
}

function drawInteriorObjects(model,originX,originY){
  let visibleCount=0;
  let foregroundCount=0;
  for(const object of model.interiorObjects||[]){
    const p=worldToScreen(model,originX,originY,object.coordinate.x,object.coordinate.y);
    if(!pointVisible(model,p,1))continue;
    visibleCount++;
    const size=model.tileSize;
    const cx=p.x+size/2;
    const cy=p.y+size*0.66;
    const bodyColor=objectPalette(object.type);

    const shadow=new PIXI.Graphics();
    shadow.ellipse(cx+size*0.03,cy+size*0.16,size*0.30,size*0.10)
      .fill({color:0x000000,alpha:0.22});
    shadowLayer.addChild(shadow);

    const body=new PIXI.Graphics();
    if(object.type==="table"){
      body.circle(cx,cy,size*0.23).fill({color:bodyColor,alpha:0.96});
    }else if(object.type==="chair"){
      body.rect(cx-size*0.15,cy-size*0.17,size*0.30,size*0.30).fill({color:bodyColor,alpha:0.96});
    }else if(object.type==="bed"){
      body.rect(cx-size*0.31,cy-size*0.24,size*0.62,size*0.42).fill({color:bodyColor,alpha:0.96});
      body.rect(cx-size*0.25,cy-size*0.19,size*0.22,size*0.10).fill({color:0xd6c7aa,alpha:0.90});
    }else{
      body.rect(cx-size*0.30,cy-size*0.24,size*0.60,size*0.38).fill({color:bodyColor,alpha:0.96});
    }
    lowerStructureLayer.addChild(body);

    if(["counter","workbench","storage","hearth"].includes(object.type)){
      const top=new PIXI.Graphics();
      top.rect(cx-size*0.32,cy-size*0.34,size*0.64,size*0.14)
        .fill({color:0xb49a78,alpha:0.92});
      upperStructureLayer.addChild(top);
      foregroundCount++;
    }
  }
  return Object.freeze({visibleCount,foregroundCount});
}

function roofColors(building){
  if(building.kind==="cabin")return [0x604733,0x76533a];
  if(building.source==="special")return [0x5f5547,0x776a55];
  return [0x704a34,0x86593d];
}

function drawRoofs(model,originX,originY,visibleBuildings,cutawayBuildingId){
  let roofCount=0;
  let cutawayRoofCount=0;
  let proofRoofAlpha=null;
  for(const building of visibleBuildings){
    const min=worldToScreen(model,originX,originY,building.bounds.minX,building.bounds.minY);
    const max=worldToScreen(model,originX,originY,building.bounds.maxX,building.bounds.maxY);
    const x=min.x;
    const y=min.y;
    const width=max.x-min.x+model.tileSize;
    const height=max.y-min.y+model.tileSize;
    const lift=Math.max(4,model.tileSize*0.18);
    const isCutaway=building.id===cutawayBuildingId;
    let alpha=isCutaway?0.15:0.84;
    if(building.id===cutawayBuildingId&&buildingProofState==="entering")alpha=0.42;
    if(building.id===cutawayBuildingId&&(buildingProofState==="outside"||buildingProofState==="leaving"))alpha=0.84;
    if(isCutaway&&alpha<0.5)cutawayRoofCount++;
    if(building.id===cutawayBuildingId)proofRoofAlpha=alpha;
    const [leftColor,rightColor]=roofColors(building);

    const shadow=new PIXI.Graphics();
    shadow.rect(x+model.tileSize*0.07,y-lift+model.tileSize*0.10,width,height)
      .fill({color:0x000000,alpha:isCutaway?0.04:0.16});
    shadowLayer.addChild(shadow);

    const roof=new PIXI.Container();
    const ridgeX=x+width/2;
    const left=new PIXI.Graphics();
    left.poly([
      x,y-lift,
      ridgeX,y,
      ridgeX,y+height-lift*0.15,
      x,y+height-lift
    ]).fill({color:leftColor,alpha});
    const right=new PIXI.Graphics();
    right.poly([
      ridgeX,y,
      x+width,y-lift,
      x+width,y+height-lift,
      ridgeX,y+height-lift*0.15
    ]).fill({color:rightColor,alpha});
    const ridge=new PIXI.Graphics();
    ridge.rect(ridgeX-Math.max(1,model.tileSize*0.018),y-lift*0.18,Math.max(2,model.tileSize*0.036),Math.max(2,height-lift*0.45))
      .fill({color:0x352a24,alpha:alpha*0.72});
    roof.addChild(left,right,ridge);
    roofLayer.addChild(roof);
    roofCount++;
  }
  return Object.freeze({roofCount,cutawayRoofCount,proofRoofAlpha});
}

function addCharacterSprite(texture,screenX,screenY,tileSize,alpha=1,tint=null){
  if(!texture)return null;
  const sprite=new PIXI.Sprite(texture);
  sprite.anchor.set(0.5,1);
  sprite.height=tileSize*0.94;
  const ratio=texture.width&&texture.height?texture.width/texture.height:0.75;
  sprite.width=Math.min(tileSize*0.90,sprite.height*ratio);
  sprite.position.set(screenX,screenY);
  sprite.alpha=alpha;
  if(tint!==null)sprite.tint=tint;
  sprite.zIndex=screenY;
  entityLayer.addChild(sprite);
  return sprite;
}

async function init(target){
  if(initialized)return snapshot();
  if(!window.PIXI)throw new Error("PixiJS 8 is required");
  host=target;
  app=new PIXI.Application();
  await app.init({
    preference:"webgl",
    resizeTo:host,
    backgroundColor:0x20251d,
    antialias:false,
    autoDensity:true,
    resolution:Math.min(2,window.devicePixelRatio||1)
  });
  app.canvas.id="gameCanvas";
  app.canvas.className="game-canvas";
  app.canvas.setAttribute("aria-label","GPU-rendered gameplay world");

  worldLayer=new PIXI.Container();
  terrainLayer=new PIXI.Container();
  lowerStructureLayer=new PIXI.Container();
  shadowLayer=new PIXI.Container();
  entityLayer=new PIXI.Container();
  upperStructureLayer=new PIXI.Container();
  roofLayer=new PIXI.Container();
  routeLayer=new PIXI.Container();
  entityLayer.sortableChildren=true;
  worldLayer.addChild(
    terrainLayer,
    lowerStructureLayer,
    shadowLayer,
    entityLayer,
    upperStructureLayer,
    roofLayer,
    routeLayer
  );
  app.stage.addChild(worldLayer);
  host.appendChild(app.canvas);
  initialized=true;
  lastSnapshot=Object.freeze({
    ready:true,
    backend:"WebGL",
    webgl:true,
    canvasCount:host.querySelectorAll("canvas").length,
    tileCount:0,
    cells:[],
    terrainTypes:{},
    buildingPresentation:Object.freeze({
      layerOrder:LAYER_ORDER,
      proofState:null,
      roofCount:0,
      cutawayRoofCount:0,
      visibleInteriorObjectCount:0,
      visibleWallCapCount:0
    }),
    textureCache:TextureAssets?.stats?.()||null
  });
  return lastSnapshot;
}

function addBlend(cell,blend,tileSize){
  const targetColor=TerrainPalette.get(blend.terrain).color;
  const blendContainer=new PIXI.Container();
  blendContainer.addChild(makeColorSprite(targetColor,tileSize,tileSize));
  const targetKey=TileTextures.assetKey(blend.terrain);
  const targetTexture=TextureAssets.get(targetKey);
  if(targetTexture)blendContainer.addChild(makeSprite(targetTexture,tileSize,tileSize));

  const maskTexture=TextureAssets.get(blend.maskKey);
  if(!maskTexture)return;
  const maskSprite=makeSprite(maskTexture,tileSize,tileSize);
  maskSprite.renderable=false;
  blendContainer.mask=maskSprite;
  cell.addChild(blendContainer,maskSprite);
}

function render(model){
  if(!initialized)throw new Error("GameRenderer is not initialized");
  lastModel=model;
  app.renderer.resize(model.width,model.height);
  app.canvas.style.width=model.width+"px";
  app.canvas.style.height=model.height+"px";
  destroyPresentationLayers();

  const gridWidth=model.columns*model.tileSize;
  const gridHeight=model.rows*model.tileSize;
  const projectedWidth=(model.columns+model.rows)*model.tileSize*DIMETRIC_X;
  const projectedHeight=(model.columns+model.rows)*model.tileSize*DIMETRIC_Y;
  const originX=Math.floor(model.width/2);
  const originY=Math.floor(model.height/2);

  worldLayer.position.set(0,0);

  const terrainTypes={};
  const visibleKinds=new Set();
  const visibleIds=new Set();
  const walkCategories=new Set();
  let visibleBlockedCount=0;
  let visibleWalkableCount=0;
  let visibleOuterWalls=0;
  let visibleInteriorWalls=0;
  let visibleExteriorDoors=0;
  let visibleInteriorDoors=0;
  let svgTileCount=0;
  let pngTileCount=0;
  let blendLayerCount=0;
  let diagonalBlendLayerCount=0;
  let visibleWallCapCount=0;
  const blendShapes=new Set();
  const blendVariants=new Set();
  let visibleRouteTileCount=0;
  let visibleDestinationTileCount=0;
  let logicalTextureKeyPass=true;

  for(const tile of model.tiles){
    terrainTypes[tile.type]=(terrainTypes[tile.type]||0)+1;
    const colOffset=tile.col-Math.floor(model.columns/2);
    const rowOffset=tile.row-Math.floor(model.rows/2);
    const projected=projectOffset(model.tileSize,colOffset,rowOffset);
    const x=originX+projected.x;
    const y=originY+projected.y;
    const cell=new PIXI.Container();
    applyGroundProjection(cell,x,y);
    cell.addChild(makeColorSprite(tile.color,model.tileSize,model.tileSize));

    if(tile.textureKey){
      const texture=TextureAssets.get(tile.textureKey);
      if(texture)cell.addChild(makeSprite(texture,model.tileSize,model.tileSize));
      else logicalTextureKeyPass=false;
      const url=TextureAssets.source(tile.textureKey)||"";
      if(/\.svg(?:$|[?#])/i.test(url))svgTileCount++;
      if(/\.png(?:$|[?#])/i.test(url))pngTileCount++;
    }

    if(tile.overlayTextureKey){
      const overlay=TextureAssets.get(tile.overlayTextureKey);
      if(overlay)cell.addChild(makeSprite(overlay,model.tileSize,model.tileSize));
      else logicalTextureKeyPass=false;
    }

    for(const blend of tile.blends||[]){
      addBlend(cell,blend,model.tileSize);
      blendLayerCount++;
      if(blend.shape==="diagonal")diagonalBlendLayerCount++;
      if(blend.shape)blendShapes.add(blend.shape);
      if(blend.variant)blendVariants.add(blend.variant);
    }

    terrainLayer.addChild(cell);
    visibleWallCapCount+=drawWallDepth(tile,x,y,model.tileSize);

    if(tile.specialKind)visibleKinds.add(tile.specialKind);
    if(tile.buildingId)visibleIds.add(tile.buildingId);
    if(tile.movement){
      walkCategories.add(tile.movement.category);
      if(tile.movement.walkable)visibleWalkableCount++;
      else visibleBlockedCount++;
      if(tile.movement.barrierKind==="outer-wall")visibleOuterWalls++;
      if(tile.movement.barrierKind==="interior-wall")visibleInteriorWalls++;
      if(tile.movement.doorwayKind==="exterior-door")visibleExteriorDoors++;
      if(tile.movement.doorwayKind==="interior-door")visibleInteriorDoors++;
    }

    if(tile.routeStep!==null&&tile.routeStep!==undefined){
      const marker=new PIXI.Graphics();
      const isDestination=tile.routeStep===model.routeLastIndex;
      if(isDestination){
        const size=model.tileSize*0.46;
        marker.rect(x+(model.tileSize-size)/2,y+(model.tileSize-size)/2,size,size)
          .fill({color:0xfff4b5,alpha:0.96});
        visibleDestinationTileCount++;
      }else{
        marker.circle(x+model.tileSize/2,y+model.tileSize/2,model.tileSize*0.15)
          .fill({color:0xffde70,alpha:0.92});
      }
      routeLayer.addChild(marker);
      visibleRouteTileCount++;
    }
  }

  const objectMetrics=drawInteriorObjects(model,originX,originY);
  const visibleBuildings=(model.buildingInteriors||[])
    .filter(building=>buildingVisible(model,originX,originY,building));
  const proofBuilding=buildingProofState?resolveProofBuilding(model,visibleBuildings):null;
  const actualOccupied=visibleBuildings.find(building=>pointInsideBounds(model.protagonistWorld,building.bounds))||null;
  const cutawayBuildingId=proofBuilding?.id||actualOccupied?.id||null;
  const roofMetrics=drawRoofs(model,originX,originY,visibleBuildings,cutawayBuildingId);

  let protagonistVisible=false;
  if(model.protagonistOffset){
    const dx=BigInt(model.protagonistOffset.x);
    const dy=BigInt(model.protagonistOffset.y);
    const maxX=BigInt(Math.floor(model.columns/2));
    const maxY=BigInt(Math.floor(model.rows/2));
    protagonistVisible=dx>=-maxX&&dx<=maxX&&dy>=-maxY&&dy<=maxY;
    if(protagonistVisible){
      const texture=TextureAssets.get("character:protagonist-male");
      addCharacterSprite(
        texture,
        originX+projectOffset(model.tileSize,Number(dx),Number(dy)).x,
        originY+projectOffset(model.tileSize,Number(dx),Number(dy)).y+model.tileSize*DIMETRIC_Y*2,
        model.tileSize
      );
    }
  }

  let proofCoordinate=null;
  let proofObjectId=null;
  if(proofBuilding&&buildingProofState){
    const placement=resolveProofPlacement(model,proofBuilding);
    proofCoordinate=placement.point;
    proofObjectId=placement.object?.id||null;
    if(proofCoordinate){
      const p=worldToScreen(model,originX,originY,proofCoordinate.x,proofCoordinate.y);
      if(pointVisible(model,p,1)){
        const texture=TextureAssets.get("character:protagonist-male");
        const sprite=addCharacterSprite(
          texture,
          p.x,
          p.y+model.tileSize*DIMETRIC_Y*2,
          model.tileSize,
          0.94,
          0xffd28b
        );
        if(sprite){
          const ring=new PIXI.Graphics();
          ring.ellipse(p.x,p.y+model.tileSize*DIMETRIC_Y*1.55,model.tileSize*0.24,model.tileSize*0.10)
            .fill({color:0xffd26d,alpha:0.20});
          ring.zIndex=sprite.zIndex-1;
          entityLayer.addChild(ring);
        }
      }
    }
  }

  const coverage=projectedWidth>=model.width&&projectedHeight>=model.height;
  lastSnapshot=Object.freeze({
    ready:true,
    backend:"WebGL",
    webgl:true,
    canvasCount:host.querySelectorAll("canvas").length,
    domTerrainTileCount:document.querySelectorAll(".terrain-tile").length,
    logicalTextureKeyPass,
    tileCount:model.tiles.length,
    cells:model.tiles.map(tile=>tile.type),
    terrainTypes:Object.freeze({...terrainTypes}),
    grid:Object.freeze({
      columns:model.columns,
      rows:model.rows,
      tileSize:model.tileSize,
      viewportWidth:model.width,
      viewportHeight:model.height,
      gridWidth,
      gridHeight,
      projectedWidth,
      projectedHeight,
      projection:"soft-dimetric",
      projectionBasis:Object.freeze({x:DIMETRIC_X,y:DIMETRIC_Y}),
      simulationCoordinatesUnchanged:true,
      coveragePass:coverage,
      centerPass:model.columns%2===1&&model.rows%2===1
    }),
    regionKey:model.regionKey||null,
    housePlans:Object.freeze({
      svgTileCount,
      pngTileCount,
      blendLayerCount,
      diagonalBlendLayerCount,
      blendShapes:[...blendShapes].sort(),
      blendVariants:[...blendVariants].sort()
    }),
    specialLots:Object.freeze({
      visibleSpecialCellCount:model.tiles.filter(tile=>Boolean(tile.specialKind)).length,
      visibleKinds:[...visibleKinds].sort(),
      visibleIds:[...visibleIds].sort()
    }),
    walkability:Object.freeze({
      visibleTileCount:model.tiles.length,
      visibleClassifiedCount:model.tiles.filter(tile=>Boolean(tile.movement)).length,
      visibleCoveragePass:model.tiles.length>0&&model.tiles.every(tile=>Boolean(tile.movement)),
      visibleCategories:[...walkCategories].sort(),
      visibleBlockedCount,
      visibleWalkableCount,
      visibleOuterWalls,
      visibleInteriorWalls,
      visibleExteriorDoors,
      visibleInteriorDoors
    }),
    route:Object.freeze({
      visibleRouteTileCount,
      visibleDestinationTileCount
    }),
    buildingPresentation:Object.freeze({
      layerOrder:LAYER_ORDER,
      visibleBuildingCount:visibleBuildings.length,
      roofCount:roofMetrics.roofCount,
      cutawayRoofCount:roofMetrics.cutawayRoofCount,
      visibleInteriorObjectCount:objectMetrics.visibleCount,
      foregroundObjectCount:objectMetrics.foregroundCount,
      visibleWallCapCount,
      proofState:buildingProofState,
      proofBuildingId:proofBuilding?.id||null,
      proofCoordinate:proofCoordinate?Object.freeze({
        x:String(proofCoordinate.x),y:String(proofCoordinate.y),level:Number(proofCoordinate.level??0)
      }):null,
      proofObjectId,
      roofAlpha:roofMetrics.proofRoofAlpha,
      cutawayActive:Boolean(cutawayBuildingId&&roofMetrics.cutawayRoofCount>0),
      actualOccupiedBuildingId:actualOccupied?.id||null,
      ySortedEntities:Boolean(entityLayer.sortableChildren),
      simulationAuthorityPreserved:true
    }),
    protagonistVisible,
    textureCache:TextureAssets.stats(),
    standardTerrainTexturePx:100
  });
  return lastSnapshot;
}

function setBuildingProofState(state){
  if(state===null||state===undefined||state==="off")buildingProofState=null;
  else if(PROOF_STATES.has(String(state)))buildingProofState=String(state);
  else throw new Error("Unknown building presentation proof state: "+state);
  if(lastModel&&initialized)render(lastModel);
  return snapshot();
}

function clear(){
  destroyPresentationLayers();
  lastModel=null;
  buildingProofState=null;
  if(host)host.hidden=true;
}

function snapshot(){
  return lastSnapshot;
}

window.GameRenderer=Object.freeze({
  init,
  render,
  clear,
  snapshot,
  setBuildingProofState,
  proofStates:Object.freeze([...PROOF_STATES])
});
})();