(function(){
"use strict";
const base=window.GameRenderer;
if(!base||base.__dimetricPresentationFix)return;

// The former temporary guard reduced each building to a narrow entrance-span
// presentation bound to protect the old axis-aligned roof primitive. The
// renderer now builds roofs and wall depth from the authoritative four-corner
// dimetric footprint, so presentation can safely consume the original building
// bounds again without touching Simulation, collision, routing, or interiors.
function render(model){
  return base.render(model);
}

window.GameRenderer=Object.freeze({
  ...base,
  render,
  __dimetricPresentationFix:true,
  __legacyRoofGuardRemoved:true
});
})();