(function(){
"use strict";
const base=window.GameRenderer;
if(!base||base.__dimetricPresentationFix)return;

function safePresentationBuilding(building,model){
  if(!building?.bounds)return building;
  const b=building.bounds;
  const minX=BigInt(String(b.minX));
  const maxX=BigInt(String(b.maxX));
  const minY=BigInt(String(b.minY));
  const maxY=BigInt(String(b.maxY));
  const width=maxX-minX;
  const height=maxY-minY;
  const centerX=(minX+maxX)/2n;
  const centerY=(minY+maxY)/2n;
  const cameraX=BigInt(String(model.center.x));
  const cameraY=BigInt(String(model.center.y));
  const halfCols=BigInt(Math.floor(model.columns/2));
  const halfRows=BigInt(Math.floor(model.rows/2));
  const margin=2n;
  if(centerX<cameraX-halfCols-margin||centerX>cameraX+halfCols+margin||
     centerY<cameraY-halfRows-margin||centerY>cameraY+halfRows+margin)return null;

  // drawRoofs currently expects a screen-positive span between min/max. Under a
  // dimetric transform equal X/Y growth collapses that span into a tall slab.
  // Keep Simulation bounds untouched outside this renderer-only model copy and
  // provide a stable roof span along the building's wider logical axis.
  const roofMaxX=maxX;
  const roofMaxY=width>=height?minY:maxY;
  const roofMinX=width>=height?minX:maxX;
  const roofMinY=minY;
  return Object.freeze({...building,bounds:Object.freeze({
    ...b,
    minX:String(roofMinX),minY:String(roofMinY),
    maxX:String(roofMaxX),maxY:String(roofMaxY)
  }),simulationBounds:b});
}

function render(model){
  const buildings=[];
  for(const building of model.buildingInteriors||[]){
    const prepared=safePresentationBuilding(building,model);
    if(prepared)buildings.push(prepared);
  }
  return base.render({...model,buildingInteriors:buildings});
}

window.GameRenderer=Object.freeze({
  ...base,
  render,
  __dimetricPresentationFix:true
});
})();
