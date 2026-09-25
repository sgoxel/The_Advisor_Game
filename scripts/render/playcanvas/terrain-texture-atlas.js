(function(){
"use strict";

const CORE_TYPES=Object.freeze([
  "grass","forest","dirt","mud","road","bridge","square","path","plot",
  "water","rock","sand","farmland"
]);
const COLUMNS=4;
function padFor(size){return Math.max(1,Math.round(Math.max(16,Number(size)||16)/16));}
const FALLBACK=Object.freeze({
  grass:"#668d4a",forest:"#315c3a",dirt:"#a36f43",mud:"#644a36",
  road:"#a7885f",bridge:"#835e3b",square:"#a39b8d",path:"#b18d5f",
  plot:"#79583d",water:"#3d7798",rock:"#747771",sand:"#c1aa6b",farmland:"#7d8447"
});

function create({pc,device}={}){
  if(!pc||!device)throw new Error("PlayCanvasTerrainTextureAtlas requires pc/device");
  let texture=null,detailTexture=null,normalDetailTexture=null,signature="",prepareCalls=0,atlasBuilds=0,cacheReuses=0;
  let textureGeneration=0,textureDestructions=0;
  const retiredTextures=[];
  let lastStats=Object.freeze({
    ready:false,preparationOnly:true,gpuTextureCount:0,sharedAtlas:true,
    detailGpuTextureCount:0,normalDetailGpuTextureCount:0,totalGpuTextureCount:0,
    detailTextureReady:false,detailTextureShared:true,detailTextureSourceKey:null,
    normalDetailTextureReady:false,normalDetailTextureShared:true,normalDetailStrength:1.25,
    frameDecodeCount:0,frameRasterizeCount:0,frameAtlasBuildCount:0,
    textureGeneration:0,textureDestructions:0,retiredTextureCount:0,
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
    const slot=slotFor(type),size=runtimeResolution(),rows=Math.ceil(CORE_TYPES.length/COLUMNS),pad=padFor(size);
    const stride=size+pad*2,width=COLUMNS*stride,height=rows*stride;
    const x=slot.col*stride+pad,y=slot.row*stride+pad,half=0.5;
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

    const size=runtimeResolution(),rows=Math.ceil(CORE_TYPES.length/COLUMNS),pad=padFor(size),stride=size+pad*2;
    const canvas=document.createElement("canvas");
    canvas.width=COLUMNS*stride;canvas.height=rows*stride;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)throw new Error("Terrain atlas canvas context unavailable");
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";

    const pngResolvedKeys=[],svgFallbackKeys=[],colorFallbackKeys=[],failedKeys=[],resolvedSources={};
    for(const type of CORE_TYPES){
      const key=logicalKey(type),slot=slotFor(type),x=slot.col*stride+pad,y=slot.row*stride+pad;
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
        ctx.drawImage(canvas,x,y,size,1,x,y-pad,size,pad);
        ctx.drawImage(canvas,x,y+size-1,size,1,x,y+size,size,pad);
        ctx.drawImage(canvas,x,y,1,size,x-pad,y,pad,size);
        ctx.drawImage(canvas,x+size-1,y,1,size,x+size,y,pad,size);
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
    // Derive one shared tangent-space normal texture from the already-prepared
    // neutral terrain detail. This is preparation-time work only: no per-frame
    // decode/rasterization, no extra geometry, and no per-tile material variants.
    const normalCanvas=document.createElement("canvas");
    normalCanvas.width=size;normalCanvas.height=size;
    const normalCtx=normalCanvas.getContext("2d",{alpha:false});
    if(!normalCtx)throw new Error("Terrain normal-detail canvas context unavailable");
    try{
      const source=detailCtx.getImageData(0,0,size,size),out=normalCtx.createImageData(size,size);
      const data=source.data,dst=out.data,heightAt=(x,y)=>{
        const xx=(x+size)%size,yy=(y+size)%size,i=(yy*size+xx)*4;
        return (data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)/255;
      };
      const strength=1.25;
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const dx=(heightAt(x+1,y)-heightAt(x-1,y))*strength;
        const dy=(heightAt(x,y+1)-heightAt(x,y-1))*strength;
        const inv=1/Math.hypot(dx,dy,1),i=(y*size+x)*4;
        dst[i]=Math.round(((-dx*inv)*0.5+0.5)*255);
        dst[i+1]=Math.round(((dy*inv)*0.5+0.5)*255);
        dst[i+2]=Math.round(((1*inv)*0.5+0.5)*255);
        dst[i+3]=255;
      }
      normalCtx.putImageData(out,0,0);
    }catch(_){
      normalCtx.fillStyle="rgb(128,128,255)";
      normalCtx.fillRect(0,0,size,size);
    }

    const nextDetail=new pc.Texture(device,{
      name:"terrain-shared-detail-"+nextSignature,
      width:size,height:size,format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:true,minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_REPEAT,addressV:pc.ADDRESS_REPEAT
    });
    nextDetail.setSource(detailCanvas);
    const nextNormalDetail=new pc.Texture(device,{
      name:"terrain-shared-normal-detail-"+nextSignature,
      width:size,height:size,format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:true,minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_REPEAT,addressV:pc.ADDRESS_REPEAT
    });
    nextNormalDetail.setSource(normalCanvas);

    const next=new pc.Texture(device,{
      name:"terrain-surface-atlas-"+nextSignature,
      width:canvas.width,height:canvas.height,
      format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:false,
      minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE
    });
    next._advisorDisableMipSampling=true;
    next.setSource(canvas);
    const previous=texture,previousDetail=detailTexture,previousNormalDetail=normalDetailTexture;
    texture=next;detailTexture=nextDetail;normalDetailTexture=nextNormalDetail;signature=nextSignature;atlasBuilds++;textureGeneration++;
    // Do not destroy a superseded shared terrain texture until the caller has
    // rebound the long-lived terrain material to the new generation.
    for(const retired of [previous,previousDetail,previousNormalDetail]){
      if(retired&&retired!==next&&retired!==nextDetail&&retired!==nextNormalDetail)retiredTextures.push(retired);
    }

    const stats=sourceStats();
    lastStats=Object.freeze({
      ready:true,signature,runtimeResolution:size,
      atlasWidth:canvas.width,atlasHeight:canvas.height,
      atlasPaddingPixels:pad,atlasPaddingRatio:Number((pad/size).toFixed(4)),
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
      detailGpuTextureCount:1,normalDetailGpuTextureCount:1,totalGpuTextureCount:3,
      detailTextureReady:true,detailTextureShared:true,detailTextureSourceKey:detailSourceKey,
      normalDetailTextureReady:true,normalDetailTextureShared:true,normalDetailStrength:1.25,
      microReliefMode:"shared-normal-map",microReliefGeometryVerticesAdded:0,microReliefMaterialVariantsAdded:0,
      heightfieldSurfaceMode:"semantic-atlas-per-logical-tile+uv1-normal-detail",
      semanticSurfaceAtlas:true,semanticSurfaceInteriorOpacity:1,
      atlasMipmaps:false,atlasFilterMode:"linear-no-mip",
      frameDecodeCount:0,frameRasterizeCount:0,frameAtlasBuildCount:0,
      textureGeneration,textureDestructions,retiredTextureCount:retiredTextures.length,
      simulationAuthorityPreserved:true
    });
    return lastStats;
  }
  function getTexture(){return texture}
  function getDetailTexture(){return detailTexture}
  function getNormalDetailTexture(){return normalDetailTexture}
  function stats(){return lastStats}
  function releaseRetiredTextures(){
    let released=0;
    while(retiredTextures.length){
      const retired=retiredTextures.shift();
      try{retired?.destroy?.()}catch(_){}
      released++;textureDestructions++;
    }
    lastStats=Object.freeze({...lastStats,textureDestructions,retiredTextureCount:retiredTextures.length});
    return released;
  }
  function destroy(){
    releaseRetiredTextures();
    for(const current of [texture,detailTexture,normalDetailTexture]){
      if(current){try{current.destroy()}catch(_){}textureDestructions++;}
    }
    texture=null;detailTexture=null;normalDetailTexture=null;signature="";
    lastStats=Object.freeze({...lastStats,ready:false,gpuTextureCount:0,detailGpuTextureCount:0,normalDetailGpuTextureCount:0,totalGpuTextureCount:0,detailTextureReady:false,normalDetailTextureReady:false,textureDestructions,retiredTextureCount:0});
  }
  return Object.freeze({prepare,uvRect,texture:getTexture,detailTexture:getDetailTexture,normalDetailTexture:getNormalDetailTexture,stats,releaseRetiredTextures,destroy,coreTypes:CORE_TYPES});
}
window.PlayCanvasTerrainTextureAtlas=Object.freeze({create,coreTypes:CORE_TYPES});
})();