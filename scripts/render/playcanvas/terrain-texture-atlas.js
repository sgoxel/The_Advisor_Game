(function(){
"use strict";

const CORE_TYPES=Object.freeze([
  "grass","forest","dirt","mud","road","bridge","square","path","plot",
  "water","rock","sand","farmland"
]);
const COLUMNS=4;
const PAD=2;
const FALLBACK=Object.freeze({
  grass:"#567d46",forest:"#355c38",dirt:"#8b6545",mud:"#70584a",
  road:"#88765f",bridge:"#7d6243",square:"#8b8172",path:"#9a8061",
  plot:"#725a3f",water:"#3f7897",rock:"#777b78",sand:"#b9a46c",farmland:"#7c7040"
});

function create({pc,device}={}){
  if(!pc||!device)throw new Error("PlayCanvasTerrainTextureAtlas requires pc/device");
  let texture=null,detailTexture=null,signature="",prepareCalls=0,atlasBuilds=0,cacheReuses=0;
  let lastStats=Object.freeze({
    ready:false,preparationOnly:true,gpuTextureCount:0,sharedAtlas:true,
    detailGpuTextureCount:0,totalGpuTextureCount:0,
    detailTextureReady:false,detailTextureShared:true,detailTextureSourceKey:null,
    frameDecodeCount:0,frameRasterizeCount:0,frameAtlasBuildCount:0,
    simulationAuthorityPreserved:true
  });

  function sourceStats(){return window.TextureAssets?.stats?.()||{}}
  function runtimeSignature(){
    const stats=sourceStats();
    return String(stats.runtimeTextureCacheSignature||("tile-texture@"+Number(stats.runtimeTextureResolution||32)+"px"));
  }
  function runtimeResolution(){
    return Math.max(16,Number(sourceStats().runtimeTextureResolution||window.RuntimeTextureResolution?.get?.()||32));
  }
  function logicalKey(type){return window.TileTextures?.assetKey?.(type)||("tile:"+type)}
  function slotFor(type){
    const index=CORE_TYPES.includes(String(type||""))?CORE_TYPES.indexOf(String(type)):0;
    return {index,col:index%COLUMNS,row:Math.floor(index/COLUMNS)};
  }
  function uvRect(type){
    const slot=slotFor(type),size=runtimeResolution(),rows=Math.ceil(CORE_TYPES.length/COLUMNS);
    const stride=size+PAD*2,width=COLUMNS*stride,height=rows*stride;
    const x=slot.col*stride+PAD,y=slot.row*stride+PAD,half=0.5;
    return Object.freeze({
      u0:(x+half)/width,
      // Canvas rows are top-down while PlayCanvas UV V=0 samples from the
      // texture bottom. Flip the atlas row so every terrain family samples
      // its authored slot instead of the vertically mirrored row.
      v0:(height-(y+size)+half)/height,
      u1:(x+size-half)/width,
      v1:(height-y-half)/height,
      type:CORE_TYPES[slot.index]
    });
  }
  function fillFallback(ctx,type,x,y,size){
    ctx.fillStyle=FALLBACK[type]||FALLBACK.grass;
    ctx.fillRect(x,y,size,size);
    ctx.globalAlpha=0.20;
    ctx.strokeStyle="#ffffff";
    ctx.lineWidth=Math.max(1,size/32);
    const step=Math.max(4,Math.round(size/4));
    for(let i=-size;i<size*2;i+=step){
      ctx.beginPath();ctx.moveTo(x+i,y);ctx.lineTo(x+i+size,y+size);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  async function prepare(){
    prepareCalls++;
    if(!window.TextureAssets||!window.TileTextures)throw new Error("Terrain texture source pipeline is unavailable");
    const nextSignature=runtimeSignature();
    if(texture&&signature===nextSignature){
      cacheReuses++;
      lastStats=Object.freeze({...lastStats,prepareCalls,cacheReuses});
      return lastStats;
    }

    const size=runtimeResolution(),rows=Math.ceil(CORE_TYPES.length/COLUMNS),stride=size+PAD*2;
    const canvas=document.createElement("canvas");
    canvas.width=COLUMNS*stride;canvas.height=rows*stride;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)throw new Error("Terrain atlas canvas context unavailable");
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";

    const pngResolvedKeys=[],svgFallbackKeys=[],colorFallbackKeys=[],failedKeys=[],resolvedSources={};
    for(const type of CORE_TYPES){
      const key=logicalKey(type),slot=slotFor(type),x=slot.col*stride+PAD,y=slot.row*stride+PAD;
      let source=null,error=null;
      try{
        await window.TextureAssets.preloadKeys([key]);
        source=window.TextureAssets.get(key);
      }catch(caught){error=caught}
      if(source){
        // The current SVG terrain artwork is detail/overlay art with transparent
        // regions. Composite it over the terrain family's opaque base color so
        // transparent texels never become black in the StandardMaterial path.
        // Future opaque PNGs simply cover this underlay; transparent PNGs retain
        // the same safe behavior.
        ctx.fillStyle=FALLBACK[type]||FALLBACK.grass;
        ctx.fillRect(x,y,size,size);
        ctx.drawImage(source,x,y,size,size);
        const resolved=String(window.TextureAssets.source(key)||"");
        resolvedSources[key]=resolved;
        if(/\.png(?:$|[?#])/i.test(resolved))pngResolvedKeys.push(key);
        else if(/\.svg(?:$|[?#])/i.test(resolved))svgFallbackKeys.push(key);
      }else{
        fillFallback(ctx,type,x,y,size);
        colorFallbackKeys.push(key);
        failedKeys.push(Object.freeze({key,error:String(error?.message||error||"source-unavailable")}));
        resolvedSources[key]="color-fallback";
      }
      // Duplicate edge pixels into the local gutter so linear filtering cannot
      // sample a neighboring terrain family.
      try{
        ctx.drawImage(canvas,x,y,size,1,x,y-PAD,size,PAD);
        ctx.drawImage(canvas,x,y+size-1,size,1,x,y+size,size,PAD);
        ctx.drawImage(canvas,x,y,1,size,x-PAD,y,PAD,size);
        ctx.drawImage(canvas,x+size-1,y,1,size,x+size,y,PAD,size);
      }catch(_){}
    }

    // Shared indexed heightfield vertices need one continuous UV stream.
    // Prepare a neutral repeating detail texture once, then tint it with
    // semantic terrain vertex colors without duplicating terrain vertices.
    const detailCanvas=document.createElement("canvas");
    detailCanvas.width=size;detailCanvas.height=size;
    const detailCtx=detailCanvas.getContext("2d",{alpha:false});
    if(!detailCtx)throw new Error("Terrain detail canvas context unavailable");
    const detailSourceKey=logicalKey("grass");
    let detailSource=null;
    try{
      await window.TextureAssets.preloadKeys([detailSourceKey]);
      detailSource=window.TextureAssets.get(detailSourceKey);
    }catch(_){}
    if(detailSource){
      detailCtx.fillStyle=FALLBACK.grass;
      detailCtx.fillRect(0,0,size,size);
      detailCtx.drawImage(detailSource,0,0,size,size);
    }else fillFallback(detailCtx,"grass",0,0,size);
    try{
      const image=detailCtx.getImageData(0,0,size,size),data=image.data;
      for(let i=0;i<data.length;i+=4){
        const luma=(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)/255;
        const neutral=Math.round((0.64+luma*0.36)*255);
        data[i]=neutral;data[i+1]=neutral;data[i+2]=neutral;data[i+3]=255;
      }
      detailCtx.putImageData(image,0,0);
    }catch(_){}
    const nextDetail=new pc.Texture(device,{
      name:"terrain-shared-detail-"+nextSignature,
      width:size,height:size,format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:true,minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_REPEAT,addressV:pc.ADDRESS_REPEAT
    });
    nextDetail.setSource(detailCanvas);

    const next=new pc.Texture(device,{
      name:"terrain-surface-atlas-"+nextSignature,
      width:canvas.width,height:canvas.height,
      format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:false,
      minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE
    });
    next.setSource(canvas);
    const previous=texture,previousDetail=detailTexture;
    texture=next;detailTexture=nextDetail;signature=nextSignature;atlasBuilds++;
    if(previous&&previous!==next)try{previous.destroy()}catch(_){}
    if(previousDetail&&previousDetail!==nextDetail)try{previousDetail.destroy()}catch(_){}

    const stats=sourceStats();
    lastStats=Object.freeze({
      ready:true,signature,runtimeResolution:size,
      atlasWidth:canvas.width,atlasHeight:canvas.height,
      coreTypeCount:CORE_TYPES.length,
      resolvedTextureKeyCount:CORE_TYPES.length-colorFallbackKeys.length,
      pngResolvedKeys:Object.freeze(pngResolvedKeys.slice()),
      svgFallbackKeys:Object.freeze(svgFallbackKeys.slice()),
      colorFallbackKeys:Object.freeze(colorFallbackKeys.slice()),
      failedKeys:Object.freeze(failedKeys.slice()),
      resolvedSources:Object.freeze({...resolvedSources}),
      pngFirstPolicy:Boolean(stats.pngFirstTerrainPolicyPass),
      pngAttemptCount:Number(stats.terrainPngAttemptCount||0),
      pngSuccessCount:Number(stats.terrainPngSuccessCount||0),
      svgAttemptCount:Number(stats.terrainSvgAttemptCount||0),
      svgFallbackCount:Number(stats.terrainSvgFallbackCount||0),
      prepareCalls,atlasBuilds,cacheReuses,
      gpuTextureCount:1,sharedAtlas:true,preparationOnly:true,
      detailGpuTextureCount:1,totalGpuTextureCount:2,
      detailTextureReady:true,detailTextureShared:true,detailTextureSourceKey,
      heightfieldSurfaceMode:"shared-neutral-detail+semantic-vertex-color",
      frameDecodeCount:0,frameRasterizeCount:0,frameAtlasBuildCount:0,
      simulationAuthorityPreserved:true
    });
    return lastStats;
  }
  function getTexture(){return texture}
  function getDetailTexture(){return detailTexture}
  function stats(){return lastStats}
  function destroy(){
    if(texture)try{texture.destroy()}catch(_){}
    if(detailTexture)try{detailTexture.destroy()}catch(_){}
    texture=null;detailTexture=null;signature="";
    lastStats=Object.freeze({...lastStats,ready:false,gpuTextureCount:0,detailGpuTextureCount:0,totalGpuTextureCount:0,detailTextureReady:false});
  }
  return Object.freeze({prepare,uvRect,texture:getTexture,detailTexture:getDetailTexture,stats,destroy,coreTypes:CORE_TYPES});
}
window.PlayCanvasTerrainTextureAtlas=Object.freeze({create,coreTypes:CORE_TYPES});
})();