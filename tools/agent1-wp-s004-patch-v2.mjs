import fs from "node:fs";
import { execFileSync } from "node:child_process";

const worldPath = "src/world.ts";
const world = fs.readFileSync(worldPath, "utf8");

// The original v2 distribution/final-surface patch is already committed on this
// branch. This temporary runner hook is intentionally idempotent so the earlier
// queued acceptance run can validate and commit the newer morphology integration.
if (!world.includes("function settlementStreetAt"))
  execFileSync(process.execPath, ["tools/agent1-wp-s004-patch-v4.mjs"], { stdio: "inherit" });

const boundedWorld = fs.readFileSync(worldPath, "utf8");
if (!boundedWorld.includes("nearbyPlaces, places"))
  execFileSync(process.execPath, ["tools/agent1-wp-s004-patch-v5.mjs"], { stdio: "inherit" });

console.log("AGENT #1 WP-S004 runtime integration hook applied");
