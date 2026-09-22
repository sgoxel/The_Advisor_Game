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
let buildingOcclusionProofState=null;
const TERRAIN_CHUNK_SIZE=16;
const TERRAIN_CACHE_LIMIT=36;
const terrainChunkCache=new Map();
let terrainFrameSerial=0;
let terrainCacheTotals={hits:0,misses:0,compositions:0,invalidations:0,evictions:0};
const PROOF_STATES=new Set(["outside","entering","inside","behind","leaving"]);
const OCCLUSION_PROOF_STATES=new Set(["front","behind","clear","inside","restored"]);
const MAX_LOCAL_OCCLUSION_ENTITIES=12;
const MAX_LOCAL_OCCLUSIONS_PER_BUILDING=4;
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
  for(const entry of terrainChunkCache.values()){
    if(entry.sprite){
      entry.sprite.removeFromParent();
      entry.sprite.destroy();
    }
    entry.texture?.destroy?.(true);
  }
  terrainChunkCache.clear();
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

function worldGridPoint(model,originX,originY,x,y){
  const dx=BigInt(String(x))-BigInt(String(model.center.x));
  const dy=BigInt(String(y))-BigInt(String(model.center.y));
  const projected=projectOffset(model.tileSize,Number(dx),Number(dy));
  return Object.freeze({x:originX+projected.x,y:originY+projected.y});
}

function buildingFootprint(model,originX,originY,building){
  const minX=BigInt(String(building.bounds.minX));
  const minY=BigInt(String(building.bounds.minY));
  const maxX=BigInt(String(building.bounds.maxX))+1n;
  const maxY=BigInt(String(building.bounds.maxY))+1n;
  return Object.freeze([
    worldGridPoint(model,originX,originY,minX,minY),
    worldGridPoint(model,originX,originY,maxX,minY),
    worldGridPoint(model,originX,originY,maxX,maxY),
    worldGridPoint(model,originX,originY,minX,maxY)
  ]);
}

function buildingVisible(model,originX,originY,building){
  const points=buildingFootprint(model,originX,originY,building);
  const xs=points.map(point=>point.x);
  const ys=points.map(point=>point.y);
  const margin=model.tileSize;
  return Math.max(...xs)>=-margin&&Math.max(...ys)>=-margin&&
    Math.min(...xs)<=model.width+margin&&Math.min(...ys)<=model.height+margin;
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

function diamondPoints(x,y,tileSize){
  const eastX=tileSize*DIMETRIC_X;
  const downY=tileSize*DIMETRIC_Y;
  return Object.freeze({
    n:Object.freeze({x,y}),
    e:Object.freeze({x:x+eastX,y:y+downY}),
    s:Object.freeze({x,y:y+downY*2}),
    w:Object.freeze({x:x-eastX,y:y+downY})
  });
}

function edgeForDirection(points,direction){
  return {
    n:[points.n,points.e],
    e:[points.e,points.s],
    s:[points.w,points.s],
    w:[points.n,points.w]
  }[direction]||[points.w,points.s];
}

function structureDirections(tile,door=false){
  const key=String(tile.textureKey||"");
  const prefix=door?"door-":"wall-";
  const cornerMatch=!door&&key.match(/wall-corner-([nesw]{2})$/);
  if(cornerMatch)return [...cornerMatch[1]];
  const sideMatch=key.match(new RegExp(prefix+"([nesw])$"));
  if(sideMatch)return [sideMatch[1]];
  return ["s"];
}

function lerpPoint(a,b,t){
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}

function buildingHeightFactor(building){
  if(!building)return 0.62;
  if(building.kind==="cabin")return 0.48;
  if(building.source==="house")return 0.62;
  return {
    tavern:0.84,
    shop:0.70,
    workshop:0.72,
    storehouse:0.68,
    barn:0.74,
    "meeting-hall":0.86
  }[building.kind]||0.72;
}

function buildingVisualHeight(building,tileSize){
  return Math.max(tileSize*0.42,tileSize*buildingHeightFactor(building));
}

function buildingHeightMap(visibleBuildings,tileSize){
  return new Map(visibleBuildings.map(building=>[
    building.id,
    buildingVisualHeight(building,tileSize)
  ]));
}

function quadPoint(quad,u,v){
  const top=lerpPoint(quad[0],quad[1],u);
  const bottom=lerpPoint(quad[3],quad[2],u);
  return lerpPoint(top,bottom,v);
}

function cutoutAlphaScale(x,y,cutouts){
  let scale=1;
  for(const cutout of cutouts||[]){
    const dx=(x-cutout.centerX)/Math.max(1,cutout.radiusX);
    const dy=(y-cutout.centerY)/Math.max(1,cutout.radiusY);
    const distance=Math.sqrt(dx*dx+dy*dy);
    if(distance>=1)continue;
    const feather=Math.max(0,Math.min(1,(distance-0.52)/0.48));
    scale=Math.min(scale,0.07+feather*0.55);
  }
  return scale;
}

function drawQuadWithCutouts(layer,quad,color,alpha,cutouts,columns=8,rows=4){
  const active=(cutouts||[]).slice(0,MAX_LOCAL_OCCLUSIONS_PER_BUILDING);
  if(!active.length){
    const graphic=new PIXI.Graphics();
    graphic.poly(quad.flatMap(point=>[point.x,point.y]))
      .fill({color,alpha});
    layer.addChild(graphic);
    return 0;
  }

  let fadedPatchCount=0;
  for(let row=0;row<rows;row++){
    const v0=row/rows,v1=(row+1)/rows;
    for(let col=0;col<columns;col++){
      const u0=col/columns,u1=(col+1)/columns;
      const p00=quadPoint(quad,u0,v0);
      const p10=quadPoint(quad,u1,v0);
      const p11=quadPoint(quad,u1,v1);
      const p01=quadPoint(quad,u0,v1);
      const center=quadPoint(quad,(u0+u1)/2,(v0+v1)/2);
      const scale=cutoutAlphaScale(center.x,center.y,active);
      if(scale<0.99)fadedPatchCount++;
      const patch=new PIXI.Graphics();
      patch.poly([
        p00.x,p00.y,p10.x,p10.y,p11.x,p11.y,p01.x,p01.y
      ]).fill({color,alpha:alpha*scale});
      layer.addChild(patch);
    }
  }
  return fadedPatchCount;
}

function resolveOcclusionProofPlacement(building,state){
  if(!building||!state)return null;
  const minX=BigInt(String(building.bounds.minX));
  const maxX=BigInt(String(building.bounds.maxX));
  const minY=BigInt(String(building.bounds.minY));
  const maxY=BigInt(String(building.bounds.maxY));
  const midX=(minX+maxX)/2n;
  const midY=(minY+maxY)/2n;
  if(state==="front")return Object.freeze({x:String(midX),y:String(maxY+2n),level:0});
  if(state==="behind")return Object.freeze({x:String(midX),y:String(minY-1n),level:0});
  if(state==="clear"||state==="restored")return Object.freeze({x:String(maxX+3n),y:String(maxY+2n),level:0});
  if(state==="inside")return building.interiorTarget||building.entrance?.immediateInside||null;
  return null;
}

function occlusionProofScreenOverride(model,originX,originY,building,state){
  if(!building||state!=="behind")return null;
  const footprint=buildingFootprint(model,originX,originY,building);
  const frontEdgePoint=lerpPoint(footprint[3],footprint[2],0.56);
  return Object.freeze({
    x:frontEdgePoint.x,
    y:frontEdgePoint.y-model.tileSize*DIMETRIC_Y*2
  });
}

function isNorthWestBehind(point,bounds){
  if(!point||!bounds||pointInsideBounds(point,bounds))return false;
  const x=BigInt(String(point.x)),y=BigInt(String(point.y));
  const minX=BigInt(String(bounds.minX)),maxX=BigInt(String(bounds.maxX));
  const minY=BigInt(String(bounds.minY)),maxY=BigInt(String(bounds.maxY));
  const behind=x<minX||y<minY;
  const decisivelyFront=x>maxX||y>maxY;
  return behind&&!decisivelyFront;
}

function resolveLocalOcclusions(model,originX,originY,visibleBuildings,heightByBuilding,entities){
  const byBuilding=new Map();
  let considered=0;
  let accepted=0;
  const candidates=(entities||[]).slice(0,MAX_LOCAL_OCCLUSION_ENTITIES);

  for(const entity of candidates){
    const point=entity?.point;
    if(!point)continue;
    considered++;
    const screen=entity.screenOverride||worldToScreen(model,originX,originY,point.x,point.y);
    const footX=screen.x;
    const footY=screen.y+model.tileSize*DIMETRIC_Y*2;
    const spriteTop=footY-model.tileSize*0.94;

    for(const building of visibleBuildings){
      if(pointInsideBounds(point,building.bounds))continue;
      const forced=entity.forceBehindBuildingId===building.id;
      if(!forced&&!isNorthWestBehind(point,building.bounds))continue;

      const footprint=buildingFootprint(model,originX,originY,building);
      const xs=footprint.map(p=>p.x),ys=footprint.map(p=>p.y);
      const lift=heightByBuilding.get(building.id)||buildingVisualHeight(building,model.tileSize);
      const minScreenX=Math.min(...xs)-model.tileSize*0.22;
      const maxScreenX=Math.max(...xs)+model.tileSize*0.22;
      const minScreenY=Math.min(...ys)-lift-model.tileSize*0.24;
      const maxScreenY=Math.max(...ys)+model.tileSize*0.18;
      const overlaps=
        footX+model.tileSize*0.30>=minScreenX&&
        footX-model.tileSize*0.30<=maxScreenX&&
        footY>=minScreenY&&
        spriteTop<=maxScreenY;
      if(!overlaps&&!forced)continue;

      if(!byBuilding.has(building.id))byBuilding.set(building.id,[]);
      const list=byBuilding.get(building.id);
      if(list.length>=MAX_LOCAL_OCCLUSIONS_PER_BUILDING)continue;
      list.push(Object.freeze({
        entityId:String(entity.id||"entity"),
        centerX:footX,
        centerY:footY-model.tileSize*0.54,
        radiusX:model.tileSize*0.42,
        radiusY:model.tileSize*0.56
      }));
      accepted++;
    }
  }
  return Object.freeze({byBuilding,considered,accepted});
}

function drawWallDepth(tile,x,y,tileSize,cutawayBuildingId,heightByBuilding,occlusionsByBuilding){
  const movement=tile.movement||{};
  const outer=movement.barrierKind==="outer-wall";
  const inner=movement.barrierKind==="interior-wall";
  const wall=outer||inner;
  const door=movement.doorwayKind==="exterior-door"||movement.doorwayKind==="interior-door";
  if(!wall&&!door)return Object.freeze({cap:0,depth:0,cutaway:0,cutoutPatches:0});

  const buildingLift=heightByBuilding?.get(tile.buildingId)||Math.max(8,tileSize*0.62);
  const lift=outer||movement.doorwayKind==="exterior-door"
    ?buildingLift
    :Math.max(6,tileSize*0.30);
  const cutaway=Boolean(cutawayBuildingId&&tile.buildingId===cutawayBuildingId);
  const cutouts=cutaway?[]:(occlusionsByBuilding?.get(tile.buildingId)||[]);
  const points=diamondPoints(x,y,tileSize);
  let depth=0;
  let cutoutPatches=0;

  if(wall){
    const directions=structureDirections(tile,false);
    if(outer){
      const visibleDirections=cutaway
        ?directions
        :directions.filter(direction=>direction==="e"||direction==="s");
      const depthAlpha=cutaway?0.055:0.84;
      const colors={n:0x665044,e:0x604b3e,s:0x6b5141,w:0x71594b};
      for(const direction of visibleDirections){
        const [a,b]=edgeForDirection(points,direction);
        const quad=[
          {x:a.x,y:a.y-lift},
          {x:b.x,y:b.y-lift},
          {x:b.x,y:b.y},
          {x:a.x,y:a.y}
        ];
        cutoutPatches+=drawQuadWithCutouts(
          lowerStructureLayer,
          quad,
          colors[direction]||0x5f493c,
          depthAlpha,
          cutouts,
          12,8
        );
        depth++;
      }
    }

    const cap=new PIXI.Graphics();
    cap.poly([
      points.n.x,points.n.y-lift,
      points.e.x,points.e.y-lift,
      points.s.x,points.s.y-lift,
      points.w.x,points.w.y-lift
    ]).fill({color:outer?0x9a806c:0x826f61,alpha:cutaway?0.22:0.94});
    upperStructureLayer.addChild(cap);
    return Object.freeze({cap:1,depth,cutaway:cutaway?1:0,cutoutPatches});
  }

  const doorDirection=structureDirections(tile,true)[0];
  if(!cutaway&&movement.doorwayKind==="exterior-door"&&doorDirection!=="e"&&doorDirection!=="s"){
    return Object.freeze({cap:0,depth:0,cutaway:0,cutoutPatches:0});
  }
  const [edgeA,edgeB]=edgeForDirection(points,doorDirection);
  const leftEnd=lerpPoint(edgeA,edgeB,0.22);
  const rightStart=lerpPoint(edgeA,edgeB,0.78);
  const jambColor=0x6f5543;
  const doorCutouts=cutouts;

  cutoutPatches+=drawQuadWithCutouts(
    lowerStructureLayer,
    [
      {x:edgeA.x,y:edgeA.y-lift},
      {x:leftEnd.x,y:leftEnd.y-lift},
      {x:leftEnd.x,y:leftEnd.y},
      {x:edgeA.x,y:edgeA.y}
    ],
    jambColor,cutaway?0.08:0.88,doorCutouts,4,8
  );
  cutoutPatches+=drawQuadWithCutouts(
    lowerStructureLayer,
    [
      {x:rightStart.x,y:rightStart.y-lift},
      {x:edgeB.x,y:edgeB.y-lift},
      {x:edgeB.x,y:edgeB.y},
      {x:rightStart.x,y:rightStart.y}
    ],
    jambColor,cutaway?0.08:0.88,doorCutouts,4,8
  );

  const lintelA=lerpPoint(edgeA,edgeB,0.18);
  const lintelB=lerpPoint(edgeA,edgeB,0.82);
  const lintel=new PIXI.Graphics();
  lintel.poly([
    lintelA.x,lintelA.y-lift,
    lintelB.x,lintelB.y-lift,
    lintelB.x,lintelB.y-lift*0.77,
    lintelA.x,lintelA.y-lift*0.77
  ]).fill({color:0x7a5b3c,alpha:cutaway?0.24:0.92});
  upperStructureLayer.addChild(lintel);
  return Object.freeze({cap:0,depth:2,cutaway:cutaway?1:0,cutoutPatches});
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
    const cx=p.x;
    const cy=p.y+size*DIMETRIC_Y*1.25;
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

function drawRoofs(model,originX,originY,visibleBuildings,cutawayBuildingId,heightByBuilding,occlusionsByBuilding){
  let roofCount=0;
  let cutawayRoofCount=0;
  let proofRoofAlpha=null;
  let projectedFootprintCount=0;
  let localCutoutPatchCount=0;

  for(const building of visibleBuildings){
    const footprint=buildingFootprint(model,originX,originY,building);
    const lift=heightByBuilding?.get(building.id)||buildingVisualHeight(building,model.tileSize);
    const rise=Math.max(5,model.tileSize*0.16);
    const raised=footprint.map(point=>({x:point.x,y:point.y-lift}));

    const isCutaway=building.id===cutawayBuildingId;
    let alpha=isCutaway?0.15:0.98;
    if(isCutaway&&buildingProofState==="entering")alpha=0.40;
    if(isCutaway&&(buildingProofState==="outside"||buildingProofState==="leaving"))alpha=0.98;
    if(isCutaway&&alpha<0.5)cutawayRoofCount++;
    if(isCutaway)proofRoofAlpha=alpha;

    const [leftColor,rightColor]=roofColors(building);
    const cutouts=isCutaway?[]:(occlusionsByBuilding?.get(building.id)||[]);
    const shadowPoints=footprint.flatMap(point=>[
      point.x+model.tileSize*0.05,
      point.y+model.tileSize*0.07
    ]);
    const shadow=new PIXI.Graphics();
    shadow.poly(shadowPoints).fill({color:0x000000,alpha:isCutaway?0.025:0.08});
    shadowLayer.addChild(shadow);

    const roof=new PIXI.Container();

    const widthTiles=Number(building.bounds?.w||(
      BigInt(String(building.bounds.maxX))-BigInt(String(building.bounds.minX))+1n
    ));
    const heightTiles=Number(building.bounds?.h||(
      BigInt(String(building.bounds.maxY))-BigInt(String(building.bounds.minY))+1n
    ));

    let ridgeA,ridgeB,panelA,panelB;
    if(widthTiles>=heightTiles){
      ridgeA=lerpPoint(raised[0],raised[3],0.5);
      ridgeB=lerpPoint(raised[1],raised[2],0.5);
      ridgeA.y-=rise; ridgeB.y-=rise;
      panelA=[raised[0],raised[1],ridgeB,ridgeA];
      panelB=[ridgeA,ridgeB,raised[2],raised[3]];
    }else{
      ridgeA=lerpPoint(raised[0],raised[1],0.5);
      ridgeB=lerpPoint(raised[3],raised[2],0.5);
      ridgeA.y-=rise; ridgeB.y-=rise;
      panelA=[raised[0],ridgeA,ridgeB,raised[3]];
      panelB=[ridgeA,raised[1],raised[2],ridgeB];
    }

    if(cutouts.length){
      localCutoutPatchCount+=drawQuadWithCutouts(roof,panelA,leftColor,alpha,cutouts,12,6);
      localCutoutPatchCount+=drawQuadWithCutouts(roof,panelB,rightColor,alpha,cutouts,12,6);
    }else{
      const leftPanel=new PIXI.Graphics();
      leftPanel.poly(panelA.flatMap(point=>[point.x,point.y]))
        .fill({color:leftColor,alpha});
      const rightPanel=new PIXI.Graphics();
      rightPanel.poly(panelB.flatMap(point=>[point.x,point.y]))
        .fill({color:rightColor,alpha});
      roof.addChild(leftPanel,rightPanel);
    }
    const ridge=new PIXI.Graphics();
    ridge.moveTo(ridgeA.x,ridgeA.y)
      .lineTo(ridgeB.x,ridgeB.y)
      .stroke({color:0x352a24,width:Math.max(1.5,model.tileSize*0.025),alpha:alpha*0.82});
    const outline=new PIXI.Graphics();
    outline.moveTo(raised[0].x,raised[0].y)
      .lineTo(raised[1].x,raised[1].y)
      .lineTo(raised[2].x,raised[2].y)
      .lineTo(raised[3].x,raised[3].y)
      .lineTo(raised[0].x,raised[0].y)
      .stroke({color:0x3d3029,width:Math.max(1,model.tileSize*0.018),alpha:alpha*0.60});

    roof.addChild(ridge,outline);
    roofLayer.addChild(roof);
    roofCount++;
    projectedFootprintCount++;
  }

  return Object.freeze({
    roofCount,
    cutawayRoofCount,
    proofRoofAlpha,
    projectedFootprintCount,
    localCutoutPatchCount
  });
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

function floorDivBigInt(value,divisor){
  let q=value/divisor;
  const r=value%divisor;
  if(r<0n)q-=1n;
  return q;
}

function terrainChunkKey(tile){
  const x=BigInt(String(tile.x)),y=BigInt(String(tile.y));
  return floorDivBigInt(x,BigInt(TERRAIN_CHUNK_SIZE))+","+floorDivBigInt(y,BigInt(TERRAIN_CHUNK_SIZE));
}

function terrainTileSignature(tile){
  return [tile.x,tile.y,tile.type,tile.color,tile.textureKey||"",tile.overlayTextureKey||"",...(tile.blends||[]).map(b=>[b.terrain,b.maskKey,b.shape,b.variant].join("/"))].join("|");
}

function buildTerrainChunk(model,tiles,key){
  const [chunkXText,chunkYText]=key.split(",");
  const chunkX=BigInt(chunkXText),chunkY=BigInt(chunkYText);
  const baseX=chunkX*BigInt(TERRAIN_CHUNK_SIZE),baseY=chunkY*BigInt(TERRAIN_CHUNK_SIZE);
  const pad=model.tileSize*2;
  const width=Math.ceil(TERRAIN_CHUNK_SIZE*2*model.tileSize*DIMETRIC_X+pad*2);
  const height=Math.ceil(TERRAIN_CHUNK_SIZE*2*model.tileSize*DIMETRIC_Y+pad*2);
  const offsetX=pad+TERRAIN_CHUNK_SIZE*model.tileSize*DIMETRIC_X;
  const offsetY=pad;
  const source=new PIXI.Container();
  for(const tile of tiles){
    const lx=Number(BigInt(String(tile.x))-baseX);
    const ly=Number(BigInt(String(tile.y))-baseY);
    const p=projectOffset(model.tileSize,lx,ly);
    const cell=new PIXI.Container();
    applyGroundProjection(cell,offsetX+p.x,offsetY+p.y);
    cell.addChild(makeColorSprite(tile.color,model.tileSize,model.tileSize));
    if(tile.textureKey){const texture=TextureAssets.get(tile.textureKey);if(texture)cell.addChild(makeSprite(texture,model.tileSize,model.tileSize));}
    if(tile.overlayTextureKey){const overlay=TextureAssets.get(tile.overlayTextureKey);if(overlay)cell.addChild(makeSprite(overlay,model.tileSize,model.tileSize));}
    for(const blend of tile.blends||[])addBlend(cell,blend,model.tileSize);
    source.addChild(cell);
  }
  const texture=PIXI.RenderTexture.create({width,height,resolution:1});
  app.renderer.render({container:source,target:texture,clear:true});
  source.destroy({children:true});
  return {key,baseX,baseY,texture,width,height,offsetX,offsetY,lastUsed:terrainFrameSerial};
}

function renderTerrainChunks(model,originX,originY){
  terrainFrameSerial++;
  const grouped=new Map();
  for(const tile of model.tiles){
    const key=terrainChunkKey(tile);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(tile);
  }
  for(const entry of terrainChunkCache.values()){
    if(entry.sprite)entry.sprite.visible=false;
  }
  const active=new Set();
  let hits=0,misses=0,compositions=0,invalidations=0;
  let createdSprites=0,reusedSprites=0;
  for(const [key,tiles] of grouped){
    active.add(key);
    const incoming=new Map(tiles.map(tile=>[String(tile.x)+","+String(tile.y),tile]));
    let entry=terrainChunkCache.get(key);
    let requiresComposition=!entry||entry.tileSize!==model.tileSize;
    if(entry&&!requiresComposition){
      for(const [tileKey,tile] of incoming){
        if(entry.tileSignatures?.get(tileKey)!==terrainTileSignature(tile)){
          requiresComposition=true;
          break;
        }
      }
    }
    if(!requiresComposition){
      hits++;terrainCacheTotals.hits++;
    }else{
      const previous=entry||null;
      const merged=new Map(previous?.tiles||[]);
      for(const pair of incoming)merged.set(pair[0],pair[1]);
      entry=buildTerrainChunk(model,[...merged.values()],key);
      entry.tileSize=model.tileSize;
      entry.tiles=merged;
      entry.tileSignatures=new Map([...merged].map(([tileKey,tile])=>[tileKey,terrainTileSignature(tile)]));
      if(previous?.sprite){
        entry.sprite=previous.sprite;
        entry.sprite.texture=entry.texture;
      }
      if(previous){
        previous.texture.destroy(true);
        invalidations++;
        terrainCacheTotals.invalidations++;
      }
      terrainChunkCache.set(key,entry);
      misses++;compositions++;
      terrainCacheTotals.misses++;
      terrainCacheTotals.compositions++;
    }
    entry.lastUsed=terrainFrameSerial;
    const dx=Number(entry.baseX-BigInt(String(model.center.x)));
    const dy=Number(entry.baseY-BigInt(String(model.center.y)));
    const p=projectOffset(model.tileSize,dx,dy);
    if(!entry.sprite){
      entry.sprite=new PIXI.Sprite(entry.texture);
      terrainLayer.addChild(entry.sprite);
      createdSprites++;
    }else{
      if(entry.sprite.parent!==terrainLayer)terrainLayer.addChild(entry.sprite);
      reusedSprites++;
    }
    entry.sprite.visible=true;
    entry.sprite.position.set(originX+p.x-entry.offsetX,originY+p.y-entry.offsetY);
  }
  const protectedKeys=new Set(active);
  let removedSprites=0;
  if(terrainChunkCache.size>TERRAIN_CACHE_LIMIT){
    const candidates=[...terrainChunkCache.values()]
      .filter(e=>!protectedKeys.has(e.key)&&!e.sprite?.visible)
      .sort((a,b)=>a.lastUsed-b.lastUsed);
    while(terrainChunkCache.size>TERRAIN_CACHE_LIMIT&&candidates.length){
      const old=candidates.shift();
      terrainChunkCache.delete(old.key);
      if(old.sprite){
        old.sprite.removeFromParent();
        old.sprite.destroy();
        removedSprites++;
      }
      old.texture.destroy(true);
      terrainCacheTotals.evictions++;
    }
  }
  return Object.freeze({
    chunkSize:TERRAIN_CHUNK_SIZE,
    visibleChunkCount:active.size,
    preparedChunkCount:terrainChunkCache.size,
    hits,misses,compositions,invalidations,
    createdSprites,reusedSprites,removedSprites,
    evictions:terrainCacheTotals.evictions,
    cacheLimit:TERRAIN_CACHE_LIMIT,
    visibleWaitedForComposition:compositions>0
  });
}

function prepareTerrain(model){
  if(!initialized||!model?.tiles?.length)return Object.freeze({prepared:false,compositions:0,hits:0,preparedChunkCount:terrainChunkCache.size});
  terrainFrameSerial++;
  const grouped=new Map();
  for(const tile of model.tiles){
    const key=terrainChunkKey(tile);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(tile);
  }
  let hits=0,compositions=0,invalidations=0;
  for(const [key,tiles] of grouped){
    const incoming=new Map(tiles.map(tile=>[String(tile.x)+","+String(tile.y),tile]));
    let entry=terrainChunkCache.get(key);
    let requiresComposition=!entry||entry.tileSize!==model.tileSize;
    if(entry&&!requiresComposition){
      for(const [tileKey,tile] of incoming){
        if(entry.tileSignatures?.get(tileKey)!==terrainTileSignature(tile)){
          requiresComposition=true;
          break;
        }
      }
    }
    if(!requiresComposition){
      hits++;
      terrainCacheTotals.hits++;
      entry.lastUsed=terrainFrameSerial;
      continue;
    }
    const previous=entry||null;
    const merged=new Map(previous?.tiles||[]);
    for(const pair of incoming)merged.set(pair[0],pair[1]);
    entry=buildTerrainChunk(model,[...merged.values()],key);
    entry.tileSize=model.tileSize;
    entry.tiles=merged;
    entry.tileSignatures=new Map([...merged].map(([tileKey,tile])=>[tileKey,terrainTileSignature(tile)]));
    if(previous?.sprite){
      entry.sprite=previous.sprite;
      entry.sprite.texture=entry.texture;
    }
    if(previous){
      previous.texture.destroy(true);
      invalidations++;
      terrainCacheTotals.invalidations++;
    }
    terrainChunkCache.set(key,entry);
    entry.lastUsed=terrainFrameSerial;
    compositions++;
    terrainCacheTotals.misses++;
    terrainCacheTotals.compositions++;
  }
  if(terrainChunkCache.size>TERRAIN_CACHE_LIMIT){
    const candidates=[...terrainChunkCache.values()]
      .filter(e=>!e.sprite?.visible)
      .sort((a,b)=>a.lastUsed-b.lastUsed);
    while(terrainChunkCache.size>TERRAIN_CACHE_LIMIT&&candidates.length){
      const old=candidates.shift();
      terrainChunkCache.delete(old.key);
      if(old.sprite){
        old.sprite.removeFromParent();
        old.sprite.destroy();
      }
      old.texture.destroy(true);
      terrainCacheTotals.evictions++;
    }
  }
  return Object.freeze({prepared:true,hits,compositions,invalidations,preparedChunkCount:terrainChunkCache.size});
}

function render(model){
  if(!initialized)throw new Error("GameRenderer is not initialized");
  lastModel=model;
  app.renderer.resize(model.width,model.height);
  app.canvas.style.width=model.width+"px";
  app.canvas.style.height=model.height+"px";
  destroyLayer(lowerStructureLayer);
  destroyLayer(shadowLayer);
  destroyLayer(entityLayer);
  destroyLayer(upperStructureLayer);
  destroyLayer(roofLayer);
  destroyLayer(routeLayer);

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
  let visibleWallDepthCount=0;
  let cutawayWallDepthCount=0;
  const blendShapes=new Set();
  const blendVariants=new Set();
  let visibleRouteTileCount=0;
  let visibleDestinationTileCount=0;
  let logicalTextureKeyPass=true;

  for(const tile of model.tiles){
    terrainTypes[tile.type]=(terrainTypes[tile.type]||0)+1;
    if(tile.textureKey){
      const texture=TextureAssets.get(tile.textureKey); if(!texture)logicalTextureKeyPass=false;
      const url=TextureAssets.source(tile.textureKey)||"";
      if(/\\.svg(?:$|[?#])/i.test(url))svgTileCount++;
      if(/\\.png(?:$|[?#])/i.test(url))pngTileCount++;
    }
    if(tile.overlayTextureKey&&!TextureAssets.get(tile.overlayTextureKey))logicalTextureKeyPass=false;
    for(const blend of tile.blends||[]){
      blendLayerCount++; if(blend.shape==="diagonal")diagonalBlendLayerCount++;
      if(blend.shape)blendShapes.add(blend.shape); if(blend.variant)blendVariants.add(blend.variant);
    }
    if(tile.specialKind)visibleKinds.add(tile.specialKind);
    if(tile.buildingId)visibleIds.add(tile.buildingId);
    if(tile.movement){
      walkCategories.add(tile.movement.category);
      if(tile.movement.walkable)visibleWalkableCount++; else visibleBlockedCount++;
      if(tile.movement.barrierKind==="outer-wall")visibleOuterWalls++;
      if(tile.movement.barrierKind==="interior-wall")visibleInteriorWalls++;
      if(tile.movement.doorwayKind==="exterior-door")visibleExteriorDoors++;
      if(tile.movement.doorwayKind==="interior-door")visibleInteriorDoors++;
    }
    if(tile.routeStep!==null&&tile.routeStep!==undefined){
      const colOffset=tile.col-Math.floor(model.columns/2),rowOffset=tile.row-Math.floor(model.rows/2);
      const projected=projectOffset(model.tileSize,colOffset,rowOffset),x=originX+projected.x,y=originY+projected.y;
      const marker=new PIXI.Graphics(); const isDestination=tile.routeStep===model.routeLastIndex;
      if(isDestination){const size=model.tileSize*0.46;marker.rect(x+(model.tileSize-size)/2,y+(model.tileSize-size)/2,size,size).fill({color:0xfff4b5,alpha:0.96});visibleDestinationTileCount++;}
      else marker.circle(x+model.tileSize/2,y+model.tileSize/2,model.tileSize*0.15).fill({color:0xffde70,alpha:0.92});
      routeLayer.addChild(marker);visibleRouteTileCount++;
    }
  }
  const terrainChunks=renderTerrainChunks(model,originX,originY);

  const objectMetrics=drawInteriorObjects(model,originX,originY);
  const visibleBuildings=(model.buildingInteriors||[])
    .filter(building=>buildingVisible(model,originX,originY,building));
  const proofBuilding=buildingProofState?resolveProofBuilding(model,visibleBuildings):null;
  const occlusionProofBuilding=buildingOcclusionProofState?resolveProofBuilding(model,visibleBuildings):null;
  const occlusionProofPoint=resolveOcclusionProofPlacement(occlusionProofBuilding,buildingOcclusionProofState);
  const occlusionProofScreen=occlusionProofScreenOverride(
    model,originX,originY,occlusionProofBuilding,buildingOcclusionProofState
  );
  const actualOccupied=visibleBuildings.find(building=>pointInsideBounds(model.protagonistWorld,building.bounds))||null;
  const occlusionProofInside=buildingOcclusionProofState==="inside"?occlusionProofBuilding:null;
  const cutawayBuildingId=proofBuilding?.id||actualOccupied?.id||occlusionProofInside?.id||null;
  const heightByBuilding=buildingHeightMap(visibleBuildings,model.tileSize);

  const occlusionEntities=[];
  if(model.protagonistWorld){
    occlusionEntities.push(Object.freeze({id:"protagonist",point:model.protagonistWorld}));
  }
  for(const entity of (model.visibleEntities||model.entities||[]).slice(0,MAX_LOCAL_OCCLUSION_ENTITIES-1)){
    const point=entity?.world||entity?.coordinate||entity?.position||null;
    if(point)occlusionEntities.push(Object.freeze({id:entity.id||entity.key||"entity",point}));
  }
  if(buildingOcclusionProofState==="behind"&&occlusionProofPoint&&occlusionProofBuilding){
    occlusionEntities.unshift(Object.freeze({
      id:"occlusion-proof",
      point:occlusionProofPoint,
      screenOverride:occlusionProofScreen,
      forceBehindBuildingId:occlusionProofBuilding.id
    }));
  }
  const localOcclusions=resolveLocalOcclusions(
    model,originX,originY,visibleBuildings,heightByBuilding,occlusionEntities
  );

  let localWallCutoutPatchCount=0;
  for(const tile of model.tiles){
    const colOffset=tile.col-Math.floor(model.columns/2);
    const rowOffset=tile.row-Math.floor(model.rows/2);
    const projected=projectOffset(model.tileSize,colOffset,rowOffset);
    const wallMetrics=drawWallDepth(
      tile,
      originX+projected.x,
      originY+projected.y,
      model.tileSize,
      cutawayBuildingId,
      heightByBuilding,
      localOcclusions.byBuilding
    );
    visibleWallCapCount+=wallMetrics.cap;
    visibleWallDepthCount+=wallMetrics.depth;
    cutawayWallDepthCount+=wallMetrics.cutaway;
    localWallCutoutPatchCount+=wallMetrics.cutoutPatches||0;
  }
  const roofMetrics=drawRoofs(
    model,originX,originY,visibleBuildings,cutawayBuildingId,
    heightByBuilding,localOcclusions.byBuilding
  );

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
      let proofScreenX=p.x;
      let proofScreenY=p.y+model.tileSize*DIMETRIC_Y*2;
      if(buildingProofState==="behind"&&placement.object){
        const objectPoint=worldToScreen(
          model,originX,originY,
          placement.object.coordinate.x,placement.object.coordinate.y
        );
        // Presentation-only interpolation keeps the authoritative proof
        // coordinate unchanged while making the intended foreground
        // occlusion visually inspectable. The upper object layer still
        // provides the actual occlusion.
        proofScreenX=p.x+(objectPoint.x-p.x)*0.72;
        proofScreenY=(p.y+(objectPoint.y-p.y)*0.72)+model.tileSize*DIMETRIC_Y*2;
      }
      if(pointVisible(model,p,1)){
        const texture=TextureAssets.get("character:protagonist-male");
        const sprite=addCharacterSprite(
          texture,
          proofScreenX,
          proofScreenY,
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

  let occlusionProofCoordinate=null;
  if(occlusionProofBuilding&&occlusionProofPoint){
    occlusionProofCoordinate=occlusionProofPoint;
    const worldPoint=worldToScreen(model,originX,originY,occlusionProofPoint.x,occlusionProofPoint.y);
    const p=occlusionProofScreen||worldPoint;
    if(pointVisible(model,worldPoint,3)){
      const texture=TextureAssets.get("character:protagonist-male");
      addCharacterSprite(
        texture,
        p.x,
        p.y+model.tileSize*DIMETRIC_Y*2,
        model.tileSize,
        0.98,
        0x9ee7ff
      );
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
      projectedFootprintRoofCount:roofMetrics.projectedFootprintCount,
      projectedFootprintRoofs:true,
      edgeAwareWallDepth:true,
      visibleInteriorObjectCount:objectMetrics.visibleCount,
      foregroundObjectCount:objectMetrics.foregroundCount,
      visibleWallCapCount,
      visibleWallDepthCount,
      cutawayWallDepthCount,
      adaptiveWallDepth:true,
      unifiedRoofWallCutaway:true,
      lightDirection:Object.freeze({x:1,y:1}),
      uprightBillboards:true,
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
      simulationAuthorityPreserved:true,
      minVisibleHeightFactor:visibleBuildings.length
        ?Math.min(...visibleBuildings.map(building=>buildingHeightFactor(building)))
        :null,
      maxVisibleHeightFactor:visibleBuildings.length
        ?Math.max(...visibleBuildings.map(building=>buildingHeightFactor(building)))
        :null,
      tallBuildingMass:true
    }),
    buildingOcclusion:Object.freeze({
      proofState:buildingOcclusionProofState,
      proofBuildingId:occlusionProofBuilding?.id||null,
      proofCoordinate:occlusionProofCoordinate?Object.freeze({
        x:String(occlusionProofCoordinate.x),
        y:String(occlusionProofCoordinate.y),
        level:Number(occlusionProofCoordinate.level??0)
      }):null,
      localCutoutCount:localOcclusions.accepted,
      affectedBuildingCount:localOcclusions.byBuilding.size,
      consideredEntityCount:localOcclusions.considered,
      wallCutoutPatchCount:localWallCutoutPatchCount,
      roofCutoutPatchCount:roofMetrics.localCutoutPatchCount||0,
      wholeBuildingFade:false,
      maxEntities:MAX_LOCAL_OCCLUSION_ENTITIES,
      maxCutoutsPerBuilding:MAX_LOCAL_OCCLUSIONS_PER_BUILDING,
      insideUsesLargeCutaway:Boolean(
        buildingOcclusionProofState==="inside"&&
        cutawayBuildingId===occlusionProofBuilding?.id
      ),
      simulationAuthorityPreserved:true
    }),
    protagonistVisible,
    textureCache:TextureAssets.stats(),
    terrainChunks:Object.freeze({...terrainChunks,totals:Object.freeze({...terrainCacheTotals})}),
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

function setBuildingOcclusionProofState(state){
  if(state===null||state===undefined||state==="off")buildingOcclusionProofState=null;
  else if(OCCLUSION_PROOF_STATES.has(String(state)))buildingOcclusionProofState=String(state);
  else throw new Error("Unknown building occlusion proof state: "+state);
  if(lastModel&&initialized)render(lastModel);
  return snapshot();
}

function clear(){
  destroyPresentationLayers();
  lastModel=null;
  buildingProofState=null;
  buildingOcclusionProofState=null;
  if(host)host.hidden=true;
}

function snapshot(){
  return lastSnapshot;
}

window.GameRenderer=Object.freeze({
  init,
  render,
  prepareTerrain,
  clear,
  snapshot,
  setBuildingProofState,
  setBuildingOcclusionProofState,
  projectionBasis:Object.freeze({x:DIMETRIC_X,y:DIMETRIC_Y}),
  proofStates:Object.freeze([...PROOF_STATES]),
  occlusionProofStates:Object.freeze([...OCCLUSION_PROOF_STATES])
});
})();