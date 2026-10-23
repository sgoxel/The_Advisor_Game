/**
 * Regenerate the build-time world cache (src/generated/road-network.json).
 * Run after changing settlements, the road generator or the SEED:
 *   node --experimental-strip-types tools/build-world-cache.ts
 */
import { writeFileSync } from "node:fs";
import { ROAD_NETWORK_FINGERPRINT, ROAD_NETWORK_FINGERPRINT_PARTS, generateRoadNetworkLive } from "../src/geography.ts";
import { TRANSPORT_EXTENSIONS_FINGERPRINT, buildTransportExtensionsLive } from "../src/transport-network.ts";

const started = performance.now(), network = generateRoadNetworkLive(),
  text = JSON.stringify({ fingerprint: ROAD_NETWORK_FINGERPRINT, parts: ROAD_NETWORK_FINGERPRINT_PARTS, network });
writeFileSync(new URL("../src/generated/road-network.json", import.meta.url), text);
console.log(`road network cache: ${network.edges.length} edges, ${(text.length / 1e6).toFixed(2)} MB, generated in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const transportStarted = performance.now(), extensions = buildTransportExtensionsLive(),
  transportText = JSON.stringify({ fingerprint: TRANSPORT_EXTENSIONS_FINGERPRINT, extensions });
writeFileSync(new URL("../src/generated/transport-extensions.json", import.meta.url), transportText);
console.log(`transport extensions cache: ${(transportText.length / 1e6).toFixed(2)} MB, generated in ${((performance.now() - transportStarted) / 1000).toFixed(1)} s`);
