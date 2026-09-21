(function(){
"use strict";

let app=null;
let host=null;
let worldLayer=null;
let terrainLayer=null;
let routeLayer=null;
let entityLayer=null;
let initialized=false;
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
  const sprite=makeSprite(PIXI.Texture.WHITE,width,height);
  sprite.tint=colorNumber(color);
  return sprite;
}

function destroyLayer(container){
  if(!container)return;
  const children=container.removeChildren();
  for(const child of children){
    child.destroy({children:true});
  }
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
  routeLayer=new PIXI.Container();
  entityLayer=new PIXI.Container();
  worldLayer.addChild(terrainLayer,routeLayer,entityLayer);
  app.stage.addChild(worldLayer);
  host.appendChild(app.canvas);
  initialized=true;
  lastSnapshot=Object.freeze({
    ready:true,
    backend:app.renderer?.constructor?.name||"UnknownRenderer",
    webgl:/webgl/i.test(app.renderer?.constructor?.name||""),
    canvasCount:host.querySelectorAll("canvas").length,
    tileCount:0,
    cells:[],
    terrainTypes:{},
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
  app.renderer.resize(model.width,model.height);
  app.canvas.style.width=model.width+"px";
  app.canvas.style.height=model.height+"px";
  destroyLayer(terrainLayer);
  destroyLayer(routeLayer);
  destroyLayer(entityLayer);

  const gridWidth=model.columns*model.tileSize;
  const gridHeight=model.rows*model.tileSize;
  const originX=Math.floor((model.width-gridWidth)/2);
  const originY=Math.floor((model.height-gridHeight)/2);

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
  const blendShapes=new Set();
  const blendVariants=new Set();
  let visibleRouteTileCount=0;
  let visibleDestinationTileCount=0;
  let logicalTextureKeyPass=true;

  for(const tile of model.tiles){
    terrainTypes[tile.type]=(terrainTypes[tile.type]||0)+1;
    const x=originX+tile.col*model.tileSize;
    const y=originY+tile.row*model.tileSize;
    const cell=new PIXI.Container();
    cell.position.set(x,y);
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

  let protagonistVisible=false;
  if(model.protagonistOffset){
    const dx=BigInt(model.protagonistOffset.x);
    const dy=BigInt(model.protagonistOffset.y);
    const maxX=BigInt(Math.floor(model.columns/2));
    const maxY=BigInt(Math.floor(model.rows/2));
    protagonistVisible=dx>=-maxX&&dx<=maxX&&dy>=-maxY&&dy<=maxY;
    if(protagonistVisible){
      const texture=TextureAssets.get("character:protagonist-male");
      if(texture){
        const sprite=new PIXI.Sprite(texture);
        sprite.anchor.set(0.5,1);
        sprite.height=model.tileSize*0.94;
        const ratio=texture.width&&texture.height?texture.width/texture.height:0.75;
        sprite.width=Math.min(model.tileSize*0.90,sprite.height*ratio);
        sprite.position.set(
          originX+(Math.floor(model.columns/2)+Number(dx))*model.tileSize+model.tileSize/2,
          originY+(Math.floor(model.rows/2)+Number(dy)+1)*model.tileSize
        );
        entityLayer.addChild(sprite);
      }
    }
  }

  const coverage=gridWidth>=model.width&&gridHeight>=model.height;
  lastSnapshot=Object.freeze({
    ready:true,
    backend:app.renderer?.constructor?.name||"UnknownRenderer",
    webgl:/webgl/i.test(app.renderer?.constructor?.name||""),
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
      coveragePass:coverage,
      centerPass:model.columns%2===1&&model.rows%2===1
    }),
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
    protagonistVisible,
    textureCache:TextureAssets.stats(),
    standardTerrainTexturePx:100
  });
  return lastSnapshot;
}

function clear(){
  destroyLayer(terrainLayer);
  destroyLayer(routeLayer);
  destroyLayer(entityLayer);
  if(host)host.hidden=true;
}

function snapshot(){
  return lastSnapshot;
}

window.GameRenderer=Object.freeze({init,render,clear,snapshot});
})();