(function(){
"use strict";

const PNG_URL="assets/environment/trees/tree_oak_atlas.png";
const SVG_URL="assets/environment/trees/tree_oak_atlas.svg";
const VARIANT_COUNT=2;

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.decoding="async";
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("image-load-failed:"+url));
    image.src=url;
  });
}

function create({pc,device,resolutionProvider=()=>320,qualitySignatureProvider=()=>""}={}){
  if(!pc||!device)throw new Error("PlayCanvasTreeSpriteAtlas requires pc/device");
  let texture=null,signature="",prepareCalls=0,atlasBuilds=0,cacheReuses=0;
  let lastStats=Object.freeze({
    ready:false,pngFirstPolicy:true,sharedTexture:true,gpuTextureCount:0,
    variantCount:VARIANT_COUNT,preparationOnly:true,frameDecodeCount:0,frameRasterizeCount:0,
    simulationAuthorityPreserved:true
  });

  function width(){
    const value=Math.round(Number(resolutionProvider?.()||320));
    return Math.max(192,Math.min(384,value));
  }
  function rect(variant){
    const index=Math.max(0,Math.min(VARIANT_COUNT-1,Math.trunc(Number(variant)||0)));
    return Object.freeze({
      variant:index,
      u0:index/VARIANT_COUNT,
      v0:0,
      uScale:1/VARIANT_COUNT,
      vScale:1
    });
  }
  async function prepare(){
    prepareCalls++;
    const targetWidth=width();
    const targetHeight=Math.round(targetWidth*160/256);
    const nextSignature=String(qualitySignatureProvider?.()||"standard")+"|tree-sprite="+targetWidth+"x"+targetHeight;
    if(texture&&signature===nextSignature){
      cacheReuses++;
      lastStats=Object.freeze({...lastStats,prepareCalls,cacheReuses});
      return lastStats;
    }

    let image=null,sourceUrl=null,sourceKind=null,pngError=null,svgError=null;
    let pngAttemptCount=1,pngSuccessCount=0,svgAttemptCount=0,svgFallbackCount=0;
    try{
      image=await loadImage(PNG_URL);
      sourceUrl=PNG_URL;sourceKind="png";pngSuccessCount=1;
    }catch(error){
      pngError=error;svgAttemptCount=1;
      try{
        image=await loadImage(SVG_URL);
        sourceUrl=SVG_URL;sourceKind="svg-fallback";svgFallbackCount=1;
      }catch(caught){svgError=caught}
    }
    if(!image)throw new Error("Tree sprite source unavailable: "+String(pngError?.message||pngError||"")+" | "+String(svgError?.message||svgError||""));

    const canvas=document.createElement("canvas");
    canvas.width=targetWidth;canvas.height=targetHeight;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)throw new Error("Tree sprite atlas canvas context unavailable");
    ctx.clearRect(0,0,targetWidth,targetHeight);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(image,0,0,targetWidth,targetHeight);

    const next=new pc.Texture(device,{
      name:"tree-sprite-atlas-"+nextSignature,
      width:targetWidth,height:targetHeight,
      format:pc.PIXELFORMAT_R8_G8_B8_A8,
      mipmaps:true,
      minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter:pc.FILTER_LINEAR,
      addressU:pc.ADDRESS_CLAMP_TO_EDGE,
      addressV:pc.ADDRESS_CLAMP_TO_EDGE
    });
    next.setSource(canvas);
    const previous=texture;
    texture=next;signature=nextSignature;atlasBuilds++;
    if(previous&&previous!==next)try{previous.destroy()}catch(_){}

    lastStats=Object.freeze({
      ready:true,signature,sourceUrl,sourceKind,
      runtimeWidth:targetWidth,runtimeHeight:targetHeight,
      pngFirstPolicy:true,pngAttemptCount,pngSuccessCount,svgAttemptCount,svgFallbackCount,
      sharedTexture:true,gpuTextureCount:1,variantCount:VARIANT_COUNT,
      transparentSource:true,alphaTested:true,
      preparationOnly:true,frameDecodeCount:0,frameRasterizeCount:0,
      prepareCalls,atlasBuilds,cacheReuses,
      simulationAuthorityPreserved:true
    });
    return lastStats;
  }
  function getTexture(){return texture}
  function stats(){return lastStats}
  function destroy(){
    if(texture)try{texture.destroy()}catch(_){}
    texture=null;signature="";
    lastStats=Object.freeze({...lastStats,ready:false,gpuTextureCount:0});
  }
  return Object.freeze({prepare,texture:getTexture,rect,stats,destroy});
}

window.PlayCanvasTreeSpriteAtlas=Object.freeze({create,PNG_URL,SVG_URL,VARIANT_COUNT});
})();