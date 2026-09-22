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
  const centerX=(minX+maxX)/2n;
  const centerY=(minY+maxY)/2n;
  const cameraX=BigInt(String(model.center.x));
  const cameraY=BigInt(String(model.center.y));
  const halfCols=BigInt(Math.floor(model.columns/2));
  const halfRows=BigInt(Math.floor(model.rows/2));
  const margin=1n;
  if(centerX<cameraX-halfCols-margin||centerX>cameraX+halfCols+margin||
     centerY<cameraY-halfRows-margin||centerY>cameraY+halfRows+margin)return null;

  // The legacy roof primitive assumes an axis-aligned screen rectangle. A full
  // square Simulation footprint collapses under dimetric projection and becomes
  // a tall slab. Until the roof primitive is replaced by a true four-corner
  // projected polygon, constrain its presentation-only cue to the entrance span.
  // Simulation topology/collision remains on the untouched source building.
  const door=building.entrance?.door;
  const anchorX=door?BigInt(String(door.x)):centerX;
  const anchorY=door?BigInt(String(door.y)):centerY;
  return Object.freeze({...building,bounds:Object.freeze({
    ...b,
    minX:String(anchorX-1n),minY:String(anchorY),
    maxX:String(anchorX+1n),maxY:String(anchorY)
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

window.GameRenderer=Object.freeze({...base,render,__dimetricPresentationFix:true});
})();
