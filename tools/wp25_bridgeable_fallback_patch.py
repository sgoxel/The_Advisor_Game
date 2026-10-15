from pathlib import Path

path = Path("src/transport-network.ts")
text = path.read_text()
text = text.replace(
    'import { freshwaterCrossingAt, freshwaterSegmentsAround, naturalSurfaceAt } from "./hydrology.ts";',
    'import { freshwaterCrossingAt, freshwaterCrossingSpanMAt, freshwaterSegmentsAround, naturalSurfaceAt } from "./hydrology.ts";',
    1,
)
old = '''        return {
          water: outsideOwner || natural.water.kind !== "none",
          heightM: natural.groundHeight,
          highland: Math.max(macro.mountainIntensity, natural.cliff ? 1 : natural.slope),
        };'''
new = '''        const unbridgeableRiver = natural.water.kind === "river" &&
          freshwaterCrossingSpanMAt(source.x, source.z) > TRANSPORT_LIMITS.ruralBridgeMaxM;
        return {
          // The planner may propose a narrow-river corridor, but it grants no
          // crossing authority. routeCandidate below still rejects every river
          // unless the actual centreline has an exact legal crossing and records
          // the bridge, while lake/ocean and political ownership stay impassable.
          water: outsideOwner || natural.water.kind === "lake" || natural.water.kind === "ocean" || unbridgeableRiver,
          heightM: natural.groundHeight,
          highland: Math.max(macro.mountainIntensity, natural.cliff ? 1 : natural.slope),
        };'''
if new in text:
    raise SystemExit(0)
if old not in text:
    raise SystemExit("bridgeable fallback anchor missing")
path.write_text(text.replace(old, new, 1))
