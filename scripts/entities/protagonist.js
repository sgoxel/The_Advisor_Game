(function(){
"use strict";

function getPosition(){
  const campaign=SeedSystem.getCampaign();
  if(!campaign)return null;
  const stored=campaign.protagonist||WorldCoordinates.origin();
  return WorldCoordinates.position(stored.x,stored.y);
}

function isAtOrigin(){
  const pos=getPosition();
  return !!pos&&WorldCoordinates.isOrigin(pos);
}

window.Protagonist=Object.freeze({getPosition,isAtOrigin});
})();
