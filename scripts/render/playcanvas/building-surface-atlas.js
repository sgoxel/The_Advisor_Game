(function(){
"use strict";

const SURFACES=Object.freeze([
  Object.freeze({material:"building-house-wall",logicalKey:"building:house-wall",base:"assets/buildings/surfaces/house_wall"}),
  Object.freeze({material:"building-special-wall",logicalKey:"building:special-wall",base:"assets/buildings/surfaces/special_wall"}),
  Object.freeze({material:"building-roof",logicalKey:"building:roof",base:"assets/buildings/surfaces/roof_tiles"}),
  Object.freeze({material:"building-door",logicalKey:"building:door",base:"assets/buildings/surfaces/door_wood"})
]);
const QUALITY_RESOLUTION=Object.freeze({low:64,standard:128,high:256,ultra:512});

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.decoding="async";
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("image-load-failed:"+url));
    image.src=url;
  });
}
function canvasStats(ctx,size){
  try{
    const data=ctx.getImageData(0,0,size,size).data;
    const step=Math.max(1,Math.floor(size/32));
    let samples=0,sum=0,min=255,max=0,hash=2166136261>>>0;
    for(let y=0;y<size;y+=step){
      for(let x=0;x<size;x+=step){
        const i=(y*size+x)*4;
        const r=data[i],g=data[i+1],b=data[i+2];
        const lum=Math.round(r*0.2126+g*0.7152+b*0.0722);
        samples++;sum+=lum;min=Math.min(min,lum);max=Math.max(max,lum);
        hash^=r;hash=Math.imul(hash,16777619)>>>0;
        hash^=g;hash=Math.imul(hash,16777619)>>>0;
        hash^=b;hash=Math.imul(hash,16777619)>>>0;
      }
    }
    return Object.freeze({
      sampleCount:samples,
      averageLuminance:samples?Number((sum/samples).toFixed(3)):0,
      minLuminance:min,
      maxLuminance:max,
      checksum:("00000000"+hash.toString(16)).slice(-8)
    });
  }catch(error){
    return Object.freeze({sampleCount:0,averageLuminance:0,minLuminance:0,maxLuminance:0,checksum:"",error:String(error?.message||error)});
  }
}

function create({pc,device,resolutionProvider=()=>128,qualitySignatureProvider=()=>""}={}){
  if(!pc||!device)throw new Error("PlayCanvasBuildingSurfaceAtlas requires pc/device");
  let texturesByMaterial=new Map(),signature="",prepareCalls=0,textureSetBuilds=0,cacheReuses=0;
  let textureGeneration=0,textureDestructions=0;
  const retiredTextures=[];
  let lastStats=Object.freeze({
    ready:false,sharedAtlas:false,sharedSurfaceTextures:true,gpuTextureCount:0,retiredTextureCount:0,
    textureGeneration:0,textureDestructions:0,preparationOnly:true,
    frameDecodeCount:0,frameRasterizeCount:0,simulationAuthorityPreserved:true
  });

  function qualityProfile(){
    const signature=String(qualitySignatureProvider?.()||"").toLowerCase();
    const match=/pc-material-quality@([a-z]+)/.exec(signature);
    return QUALITY_RESOLUTION[match?.[1]]?match[1]:null;
  }
  function resolution(){
    const profile=qualityProfile();
    if(profile)return QUALITY_RESOLUTION[profile];
    const value=Math.round(Number(resolutionProvider?.()||128));
    return Math.max(64,Math.min(512,value));
  }
  function rectForMaterial(materialName){
    const surface=SURFACES.find(item=>item.material===String(materialName||""));
    if(!surface)return null;
    return Object.freeze({
      logicalKey:surface.logicalKey,
      material:surface.material,
      u0:0,v0:0,u1:1,v1:1,uScale:1,vScale:1,
      fullTexture:true
    });
  }
  async function prepare(){
    prepareCalls++;
    const size=resolution();
    const nextSignature=String(qualitySignatureProvider?.()||"standard")+"|building-surface="+size+"px";
    if(texturesByMaterial.size===SURFACES.length&&signature===nextSignature){
      cacheReuses++;
      lastStats=Object.freeze({...lastStats,prepareCalls,cacheReuses});
      return lastStats;
    }

    const nextTextures=new Map();
    const pngResolvedKeys=[],svgFallbackKeys=[],colorFallbackKeys=[],failedKeys=[],resolvedSources={};
    const surfacePixelStats={};
    let pngAttemptCount=0,pngSuccessCount=0,svgAttemptCount=0,svgFallbackCount=0;
    for(let index=0;index<SURFACES.length;index++){
      const surface=SURFACES[index];
      const canvas=document.createElement("canvas");
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext("2d",{alpha:false});
      if(!ctx)throw new Error("Building surface canvas context unavailable");
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality="high";

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
        ctx.drawImage(image,0,0,size,size);
        resolvedSources[surface.logicalKey]=source;
      }else{
        ctx.fillStyle=index===2?"#6f3327":index===3?"#5b331d":index===1?"#8f826d":"#a78f67";
        ctx.fillRect(0,0,size,size);
        colorFallbackKeys.push(surface.logicalKey);
        failedKeys.push(Object.freeze({
          key:surface.logicalKey,
          pngError:String(pngError?.message||pngError||""),
          svgError:String(svgError?.message||svgError||"")
        }));
        resolvedSources[surface.logicalKey]="color-fallback";
      }
      surfacePixelStats[surface.logicalKey]=canvasStats(ctx,size);

      const texture=new pc.Texture(device,{
        name:"building-surface-"+surface.logicalKey.replace(/[^a-z0-9]+/gi,"-")+"-"+nextSignature,
        width:size,height:size,
        format:pc.PIXELFORMAT_R8_G8_B8_A8,
        mipmaps:true,
        minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter:pc.FILTER_LINEAR,
        addressU:pc.ADDRESS_CLAMP_TO_EDGE,
        addressV:pc.ADDRESS_CLAMP_TO_EDGE
      });
      texture.setSource(canvas);
      nextTextures.set(surface.material,texture);
    }

    for(const prior of texturesByMaterial.values())if(prior&&!nextTextures.has(prior))retiredTextures.push(prior);
    texturesByMaterial=nextTextures;
    signature=nextSignature;
    textureSetBuilds++;
    textureGeneration++;

    lastStats=Object.freeze({
      ready:true,signature,runtimeResolution:size,contentResolution:size,
      textureWidth:size,textureHeight:size,
      aggregateBaseTexels:size*size*SURFACES.length,
      layout:"shared-per-surface-textures",
      sourceFamilyCount:SURFACES.length,
      logicalKeys:Object.freeze(SURFACES.map(item=>item.logicalKey)),
      resolvedSourceCount:SURFACES.length-colorFallbackKeys.length,
      pngAttemptCount,pngSuccessCount,svgAttemptCount,svgFallbackCount,
      pngResolvedKeys:Object.freeze(pngResolvedKeys.slice()),
      svgFallbackKeys:Object.freeze(svgFallbackKeys.slice()),
      colorFallbackKeys:Object.freeze(colorFallbackKeys.slice()),
      failedKeys:Object.freeze(failedKeys.slice()),
      resolvedSources:Object.freeze({...resolvedSources}),
      surfacePixelStats:Object.freeze({...surfacePixelStats}),
      prepareCalls,textureSetBuilds,cacheReuses,
      textureGeneration,textureDestructions,retiredTextureCount:retiredTextures.length,
      sharedAtlas:false,sharedSurfaceTextures:true,gpuTextureCount:SURFACES.length,preparationOnly:true,
      mipmaps:true,samplingPolicy:"profile-controlled-standalone",
      frameDecodeCount:0,frameRasterizeCount:0,
      simulationAuthorityPreserved:true
    });
    return lastStats;
  }
  function textureForMaterial(materialName){return texturesByMaterial.get(String(materialName||""))||null}
  function getTexture(){return textureForMaterial(SURFACES[0].material)}
  function getTextures(){return Object.freeze([...texturesByMaterial.values()])}
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
    for(const texture of texturesByMaterial.values()){
      try{texture?.destroy?.()}catch(_){}
      textureDestructions++;
    }
    texturesByMaterial.clear();signature="";
    lastStats=Object.freeze({...lastStats,ready:false,gpuTextureCount:0,textureDestructions,retiredTextureCount:0});
  }
  return Object.freeze({prepare,texture:getTexture,textures:getTextures,textureForMaterial,rectForMaterial,stats,releaseRetiredTextures,destroy,surfaces:SURFACES});
}
window.PlayCanvasBuildingSurfaceAtlas=Object.freeze({create,surfaces:SURFACES});
})();