from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Final WP15 adapter: routing consumes the same composed terrain/traversal
# authority used by world height/cells instead of the old macro-only sampler.
path = "src/routing.ts"
text = read(path)
text = replace_once(
    text,
    "seeded macro-geography authority) plus explicit road/bridge segments",
    "final composed surface authority) plus explicit road/bridge segments",
    "routing header authority",
)
text = replace_once(
    text,
    'import { macroSampleAt } from "./macro-geography.ts";\n',
    'import { surfaceAt as finalSurfaceAt } from "./surface.ts";\n',
    "routing surface import",
)
text = replace_once(
    text,
    "  greatCircleDistance,\n  positionToEnu,",
    "  greatCircleDistance,\n  lonLatToSource,\n  positionToEnu,",
    "routing source-coordinate import",
)
text = replace_once(
    text,
    '''export type SurfaceSample = {\n  water: boolean;\n  /** Ground height in metres; only differences between cells are used. */\n  heightM: number;\n  /** 0..1 mountain/highland intensity; high values are difficult to cross. */\n  highland: number;\n};''',
    '''export type SurfaceSample = {\n  water: boolean;\n  /** Canonical cliff/obstacle from the final traversal authority. */\n  blocked?: boolean;\n  /** Ground height in metres; only differences between cells are used. */\n  heightM: number;\n  /** 0..1 terrain difficulty signal; high values are difficult to cross. */\n  highland: number;\n};''',
    "routing surface sample type",
)
text = replace_once(
    text,
    '''export const macroTerrainSampler: TerrainSampler = (position) => {\n  const sample = macroSampleAt(position);\n  return {\n    water: !sample.land,\n    heightM: sample.reliefM,\n    highland: sample.mountainIntensity,\n  };\n};''',
    '''export const finalTerrainSampler: TerrainSampler = (position) => {\n  const source = lonLatToSource(position.lon, position.lat),\n    sample = finalSurfaceAt(source.x, source.z);\n  return {\n    water: sample.water !== "none",\n    blocked: sample.traversal === "blocked-cliff",\n    heightM: sample.elevation,\n    highland: sample.traversal === "difficult" ? 1 : 0,\n  };\n};''',
    "routing final terrain sampler",
)
text = replace_once(
    text,
    '''const FLAG_WATER = 1,\n  FLAG_HIGHLAND = 2,\n  FLAG_ROAD = 4,\n  FLAG_BRIDGE = 8;''',
    '''const FLAG_WATER = 1,\n  FLAG_HIGHLAND = 2,\n  FLAG_ROAD = 4,\n  FLAG_BRIDGE = 8,\n  FLAG_BLOCKED = 16;''',
    "routing blocked flag",
)
text = replace_once(
    text,
    '''    if (surface.water) flag |= FLAG_WATER;\n    if (surface.highland >= HIGHLAND_DIFFICULT) flag |= FLAG_HIGHLAND;''',
    '''    if (surface.water) flag |= FLAG_WATER;\n    if (surface.blocked) flag |= FLAG_BLOCKED;\n    if (surface.highland >= HIGHLAND_DIFFICULT) flag |= FLAG_HIGHLAND;''',
    "routing surface flags",
)
text = replace_once(
    text,
    '''  const passable = (idx: number) =>\n    !(flags[idx] & FLAG_WATER) || !!(flags[idx] & FLAG_BRIDGE);''',
    '''  const passable = (idx: number) => {\n    const flag = flags[idx];\n    if (flag & FLAG_WATER) return !!(flag & FLAG_BRIDGE);\n    if (flag & FLAG_BLOCKED) return !!(flag & FLAG_ROAD);\n    return true;\n  };''',
    "routing passability",
)
text = replace_once(
    text,
    "  const terrain = request.terrain ?? macroTerrainSampler,",
    "  const terrain = request.terrain ?? finalTerrainSampler,",
    "routing default sampler",
)
write(path, text)

# Remove the stale transitional note now that settlement legality really queries
# canonical hydrology rather than the deleted sine-river corridor.
path = "src/geography.ts"
text = read(path)
text = replace_once(
    text,
    '''/**\n * Transitional settlement-site guard for the current local terrain prototype.\n * Political ownership still comes exclusively from countryAtPosition(). Until the\n * hydrology WP replaces the old source-domain river, placement simply rejects its\n * known wet corridor and a narrow coastal margin instead of filling water under a\n * city or village.\n */''',
    '''/**\n * Settlement-site legality reads canonical macro land plus priority-0..4 natural\n * hydrology. Political ownership still comes exclusively from countryAtPosition();\n * siting cannot fill or relocate authoritative water to rescue a candidate.\n */''',
    "geography settlement comment",
)
write(path, text)

# Keep the routing regression test aligned with the authority contract rather than
# preserving the old macro-only sampler name.
path = "tests/routing.test.ts"
text = read(path)
text = replace_once(text, "  macroTerrainSampler,", "  finalTerrainSampler,", "routing test import")
text = replace_once(
    text,
    'test("the real macro terrain sampler agrees with macro-geography water and relief", () => {\n  const sample = macroTerrainSampler(villages[0].canonicalPosition);',
    'test("the default terrain sampler reads the final composed surface authority", () => {\n  const sample = finalTerrainSampler(villages[0].canonicalPosition);',
    "routing test final sampler",
)
write(path, text)

print("WP-S002-004-005 final routing adapter applied")
