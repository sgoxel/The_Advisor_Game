import fs from "node:fs";
import { execFileSync } from "node:child_process";

const worldPath = "src/world.ts";
const exteriorPath = "src/settlement-exterior.ts";
let exterior = fs.readFileSync(exteriorPath, "utf8");

if (!exterior.includes("/EXTERIOR/WATER-MORPH")) {
  execFileSync(process.execPath, ["tools/agent1-wp-s004-patch-v6.mjs"], { stdio: "inherit" });
  exterior = fs.readFileSync(exteriorPath, "utf8");
}
if (!exterior.includes('/EXTERIOR/WATER-MORPH')) throw new Error("settlement archetype fix did not apply");
execFileSync("git", ["add", exteriorPath], { stdio: "inherit" });

const world = fs.readFileSync(worldPath, "utf8");
if (!world.includes("function settlementStreetAt"))
  execFileSync(process.execPath, ["tools/agent1-wp-s004-patch-v4.mjs"], { stdio: "inherit" });

const boundedWorld = fs.readFileSync(worldPath, "utf8");
if (!boundedWorld.includes("nearbyPlaces, places"))
  execFileSync(process.execPath, ["tools/agent1-wp-s004-patch-v5.mjs"], { stdio: "inherit" });

console.log("AGENT #1 WP-S004 acceptance fixes and runtime integration applied");
