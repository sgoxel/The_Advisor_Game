import fs from "node:fs";

const mainPath = "src/main.ts";
let main = fs.readFileSync(mainPath, "utf8");
const replaceOnce = (source, search, replacement, label) => {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`S006 patch target missing: ${label}`);
  return next;
};

main = replaceOnce(
  main,
  /function characterMaterial\(variant: number\): pc\.StandardMaterial \{.*?\n\}\n(?=async function start\(\))/s,
  `function characterMaterial(variant: number): pc.StandardMaterial {
  const image = document.createElement("canvas");
  image.width = 64;
  image.height = 96;
  const ctx = image.getContext("2d")!;
  const coats = ["#785137", "#687b69", "#aa7950", "#5d6f83", "#855d6d", "#8b7b4d", "#4f736f", "#76658d", "#8b5f46"],
    hairs = ["#30241d", "#4e3525", "#745238", "#a77a4c", "#b8a17a", "#6f6b62", "#2d2a28", "#8a4f37"],
    silhouette = variant % 5,
    coat = coats[(variant * 5 + Math.floor(variant / 3)) % coats.length],
    hair = hairs[(variant * 3 + Math.floor(variant / 5)) % hairs.length],
    torsoHalf = 12 + (silhouette % 3) * 2,
    shoulderY = 35 + (silhouette === 4 ? 2 : 0);
  ctx.fillStyle = "#3a382c";
  ctx.fillRect(22 - (silhouette === 1 ? 2 : 0), 69, 9, 22);
  ctx.fillRect(35 + (silhouette === 1 ? 2 : 0), 69, 9, 22);
  ctx.fillStyle = "#d2b17e";
  ctx.fillRect(16 - (silhouette === 3 ? 2 : 0), 40, 8, 27);
  ctx.fillRect(44 + (silhouette === 3 ? 2 : 0), 40, 8, 27);
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(33 - torsoHalf, shoulderY);
  ctx.lineTo(33 + torsoHalf, shoulderY);
  ctx.lineTo(49 - (silhouette === 2 ? 3 : 0), 75);
  ctx.lineTo(17 + (silhouette === 2 ? 3 : 0), 75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#463b2c";
  ctx.fillRect(20, 61 + (silhouette % 2), 26, 4);
  ctx.fillStyle = "#d7b487";
  ctx.beginPath();
  ctx.ellipse(33, 25, silhouette === 2 ? 12 : 11, silhouette === 4 ? 15 : 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hair;
  if (variant % 4 === 0) {
    ctx.fillRect(20, 13, 26, 8);
    ctx.fillRect(20, 18, 5, 14);
  } else if (variant % 4 === 1) {
    ctx.beginPath(); ctx.ellipse(33, 16, 14, 9, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(20, 15, 27, 4);
  } else if (variant % 4 === 2) {
    ctx.fillRect(24, 10, 18, 11);
    ctx.fillRect(21, 17, 24, 4);
  } else {
    ctx.beginPath(); ctx.arc(33, 16, 13, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(42, 16, 5, 13);
  }
  ctx.fillStyle = "#493b2c";
  ctx.fillRect(27, 26, 2, 2);
  ctx.fillRect(37, 26, 2, 2);
  if (variant % 6 === 0) ctx.fillRect(29, 34, 9, 3);
  const texture = new pc.Texture(app.graphicsDevice, { width: 64, height: 96, mipmaps: true });
  texture.setSource(image);
  const material = new pc.StandardMaterial();
  material.diffuseMap = texture;
  material.opacityMap = texture;
  material.opacityMapChannel = "a";
  material.alphaTest = 0.4;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  return material;
}
function residentMaterialIndex(resident: { appearance: { silhouette: number; hair: number; clothing: number } }) {
  return (resident.appearance.silhouette * 72 + resident.appearance.hair * 9 + resident.appearance.clothing) % 24;
}
`,
  "resident material generator",
);
main = replaceOnce(
  main,
  "  const characterMaterials = [0, 1, 2].map(characterMaterial);\n  const actors: pc.Entity[] = [];",
  `  const characterMaterials = Array.from({ length: 24 }, (_, variant) => characterMaterial(variant));
  const actors: pc.Entity[] = [];
  let lastActorFacingX = Number.NaN,
    lastActorFacingY = Number.NaN,
    lastActorFacingZ = Number.NaN,
    lastActorFacingW = Number.NaN;
  const orientActor = (actor: pc.Entity) => {
    actor.setRotation(camera.getRotation());
    actor.rotateLocal(90, 0, 0);
  };`,
  "bounded material pool",
);
main = replaceOnce(
  main,
  /simulation\n\s+\.focusedResidents\(view\.x, view\.z, view\.halfHeight \* 1\.5\)\n\s+\.slice\(0, 96\)/,
  "simulation\n              .focusedResidents(view.x, view.z, view.halfHeight * 1.5, 96)",
  "actor-budget query",
);
main = replaceOnce(
  main,
  "            material: characterMaterials[visible[i].variant % 3],",
  "            material: characterMaterials[residentMaterialIndex(visible[i])],",
  "seed-derived actor material",
);
main = replaceOnce(
  main,
  "        actors[i].enabled = true;\n        actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });",
  `        const residentMaterial = characterMaterials[residentMaterialIndex(visible[i])];
        for (const meshInstance of actors[i].render?.meshInstances ?? [])
          if (meshInstance.material !== residentMaterial) meshInstance.material = residentMaterial;
        actors[i].enabled = true;
        orientActor(actors[i]);
        actorSources.set(actors[i], { x: visible[i].x, z: visible[i].z });`,
  "pooled actor material refresh",
);
main = replaceOnce(
  main,
  "      for (let i = visible.length; i < actors.length; i++)\n        actors[i].enabled = false;\n    }\n    for (const actor of actors)\n      if (actor.enabled) {\n        actor.setRotation(camera.getRotation());\n        actor.rotateLocal(90, 0, 0);\n      }",
  [
    "      for (let i = visible.length; i < actors.length; i++)",
    "        actors[i].enabled = false;",
    "      $(\"simulation-status\").textContent =",
    "        `${simulation.stats.logicalResidents.toLocaleString()} logical residents · ${visible.length} visible actors · ${actors.length} pooled actors · ${simulation.stats.query.evaluatedResidents.toLocaleString()} spatial candidates evaluated.`;",
    "    }",
    "    const actorFacing = camera.getRotation();",
    "    if (",
    "      Math.abs(actorFacing.x - lastActorFacingX) > 1e-7 ||",
    "      Math.abs(actorFacing.y - lastActorFacingY) > 1e-7 ||",
    "      Math.abs(actorFacing.z - lastActorFacingZ) > 1e-7 ||",
    "      Math.abs(actorFacing.w - lastActorFacingW) > 1e-7",
    "    ) {",
    "      lastActorFacingX = actorFacing.x;",
    "      lastActorFacingY = actorFacing.y;",
    "      lastActorFacingZ = actorFacing.z;",
    "      lastActorFacingW = actorFacing.w;",
    "      for (const actor of actors) if (actor.enabled) orientActor(actor);",
    "    }",
  ].join("\n"),
  "camera-facing update gate",
);
main = replaceOnce(
  main,
  "          visibleResidents: actors.filter(actor => actor.enabled).length,",
  `          visibleResidents: actors.filter(actor => actor.enabled).length,
          residentPresentation: {
            logicalResidents: simulation.stats.logicalResidents,
            pooledActors: actors.length,
            visibleActors: actors.filter(actor => actor.enabled).length,
            reusableMaterials: characterMaterials.length,
            activeScheduleRecords: simulation.stats.activeScheduleRecords,
            evaluatedCandidates: simulation.stats.query.evaluatedResidents,
          },`,
  "resident presentation telemetry",
);
fs.writeFileSync(mainPath, main);

const simPath = "src/simulation.ts";
let simulation = fs.readFileSync(simPath, "utf8");
simulation = replaceOnce(
  simulation,
  "    const sample = visible.slice(0, 16),",
  "    const sample = [...visible].sort((a, b) => a.index - b.index).slice(0, 16),",
  "inspectable service and guard ordering",
);
fs.writeFileSync(simPath, simulation);

const evidencePath = ".github/workflows/agent1-s006-resident-evidence.yml";
let evidence = fs.readFileSync(evidencePath, "utf8");
evidence = replaceOnce(
  evidence,
  "eval:window.advisorWorld.setHalfHeight(97);wait:1500;settle;click:#open-travel;",
  "eval:window.advisorWorld.setHalfHeight(48);wait:1500;settle;shot:resident-scene;click:#open-travel;",
  "resident scene screenshot",
);
evidence = replaceOnce(
  evidence,
  "s.selectedIndex=Math.min(5,s.options.length-1)",
  "s.selectedIndex=Math.min(6,s.options.length-1)",
  "guard screenshot selection",
);
evidence = evidence.replace("shot:resident-second", "shot:resident-guard");
fs.writeFileSync(evidencePath, evidence);
