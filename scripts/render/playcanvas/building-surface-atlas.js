(function(){
"use strict";

const SURFACES=Object.freeze([
  Object.freeze({material:"building-house-wall",logicalKey:"building:house-wall",base:"assets/buildings/surfaces/house_wall"}),
  Object.freeze({material:"building-special-wall",logicalKey:"building:special-wall",base:"assets/buildings/surfaces/special_wall"}),
  Object.freeze({material:"building-roof",logicalKey:"building:roof",base:"assets/buildings/surfaces/roof_tiles"}),
  Object.freeze({material:"building-door",logicalKey:"building:door",base:"assets/buildings/surfaces/door_wood"})
]);
const COLUMNS=2;
const PAD=2;

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.decoding="async";
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("image-load-failed:"+url));
    image.src=url;
  });
}

function create({pc,device,resolutionProvider=()=>128,qualitySignatureProvider=()=>""}={}){
  if(!pc||!device)throw new Error("PlayCanvasBuildingSurfaceAtlas requires pc/device");
  let texture=null,signature="",prepareCalls=0,atlasBuilds=0,cacheReuses=0;
  let lastStats=Object.freeze({
    ready:false,sharedAtlas:true,gpuTextureCount:0,preparationOnly:true,
    frameDecodeCount:0,frameRasterizeCount:0,simulationAuthorityPreserved:true
  });

  function resolution(){
    const value=Math.round(Number(resolutionProvider?.()||128));
    return Math.max(64,Math.min(128,value));
  }
  function slotFor(materialName){
    const index=Math.max(0,SURFACES.findIndex(item=>item.material===String(materialName||"")));
    return {index,col:index%COLUMNS,row:Math.floor(index/COLUMNS)};
  }
  function rectForMaterial(materialName){
    const index=SURFACES.findIndex(item=>item.material===String(materialName||""));
    if(index<0)return null;
    const size=resolution(),rows=Math.ceil(SURFACES.length/COLUMNS),stride=size+PAD*2;
    const slot={index,col:index%COLUMNS,row:Math.floor(index/COLUMNS)};
    const width=COLUMNS*stride,height=rows*stride;
    const x=slot.col*stride+PAD,y=slot.row*stride+PAD;
    const half=0.5;
    return Object.freeze({
      logicalKey:SURFACES[index].logicalKey,
      material:SURFACES[index].material,
      u0:(x+half)/width,
      v0:(y+half)/height,
      u1:(x+size-half)/width,
      v1:(y+size-half)/height,
      uScale:(size-1)/width,
      vScale:(size-1)/height
    });
  }
  async function prepare(){
    prepareCalls++;
    const size=resolution();
    const nextSignature=String(qualitySignatureProvider?.()||"standard")+"|building-surface="+size+"px";
    if(texture&&signature===nextSignature){
      cacheReuses++;
      lastStats=Object.freeze({...lastStats,prepareCalls,cacheReuses});
      return lastStats;
    }

    const rows=Math.ceil(SURFACES.length/COLUMNS),stride=size+PAD*2;
    const canvas=document.createElement("canvas");
    canvas.width=COLUMNS*stride;canvas.height=rows*stride;
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)throw new Error("Building surface atlas canvas context unavailable");
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";

    const pngResolvedKeys=[],svgFallbackKeys=[],colorFallbackKeys=[],failedKeys=[],resolvedSources={};
    let pngAttemptCount=0,pngSuccessCount=0,svgAttemptCount=0,svgFallbackCount=0;
    for(let index=0;index<SURFACES.length;index++){
      const surface=SURFACES[index],col=index%COLUMNS,row=Math.floor(index/COLUMNS);
      const x=col*stride+PAD,y=row*stride+PAD;
      let image=null,source="",pngError=null,svgError=null;
      pngAttemptCount++;
      try{
        image=await loadImage(surface.base+".png");
        source=surface.base+".png";
        pngSuccessCount++;
        pngResolvedKeys.push(surface.logicalKey);
      }catch(error){
        pngError=error;
        svgAttemptCount++;
        try{
          image=await loadImage(surface.base+".svg");
          source=surface.base+".svg";
          svgFallbackCount++;
          svgFallbackKeys.push(surface.logicalKey);
        }catch(caught){
          svgError=caught;
        }
      }
      if(image){
        ctx.drawImage(image,x,y,size,size);
        resolvedSources[surface.logicalKey]=source;
      }else{
        // Safe warm neutral fallback only if both authored sources are absent.
        ctx.fillStyle=index===2?"#6f3327":index===3?"#5b331d":index===1?"#8f826d":"#a78f67";
        ctx.fillRect(x,y,size,size);
        colorFallbackKeys.push(surface.logicalKey);
        failedKeys.push(Object.freeze({
          key:surface.logicalKey,
          pngError:String(pngError?.message||pngError||""),
          svgError:String(svgError?.message||svgError||"")
        }));
        resolvedSources[surface.logicalKey]="color-fallback";
      }
      // Duplicate edge pixels into gutters to prevent atlas bleeding.
      try{
        ctx.drawImage(canvas,x,y,size,1,x,y-PAD,size,PAD);
        ctx.drawImage(canvas,x,y+size-1,size,1,x,y+size,size,PAD);
        ctx.drawImage(canvas,x,y,1,size,x-PAD,y,PAD,size);
        ctx.drawImage(canvas,x+size-1,y,1,size,x+size,y,PAD,size);
      }catch(_){}
    }

    const next=new pc.Texture(device,{
      name:"building-surface-atlas-"+nextSignature,
      width:canvas.width,height:canvas.height,
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
      ready:true,signature,runtimeResolution:size,
      atlasWidth:canvas.width,atlasHeight:canvas.height,
      sourceFamilyCount:SURFACES.length,
      logicalKeys:Object.freeze(SURFACES.map(item=>item.logicalKey)),
      resolvedSourceCount:SURFACES.length-colorFallbackKeys.length,
      pngAttemptCount,pngSuccessCount,svgAttemptCount,svgFallbackCount,
      pngResolvedKeys:Object.freeze(pngResolvedKeys.slice()),
      svgFallbackKeys:Object.freeze(svgFallbackKeys.slice()),
      colorFallbackKeys:Object.freeze(colorFallbackKeys.slice()),
      failedKeys:Object.freeze(failedKeys.slice()),
      resolvedSources:Object.freeze({...resolvedSources}),
      prepareCalls,atlasBuilds,cacheReuses,
      sharedAtlas:true,gpuTextureCount:1,preparationOnly:true,
      frameDecodeCount:0,frameRasterizeCount:0,
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
  return Object.freeze({prepare,texture:getTexture,rectForMaterial,stats,destroy,surfaces:SURFACES});
}
window.PlayCanvasBuildingSurfaceAtlas=Object.freeze({create,surfaces:SURFACES});
})();