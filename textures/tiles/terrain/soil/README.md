# Starting Village soil and mud ground family

WP-102/I02 production source assets.

- `soil_worn_256px.svg` — warm worn soil for yards and work areas.
- `mud_damp_256px.svg` — darker damp mud variation.

Both sources use an explicit 256×256 view box, uniform edge fill, and repeating internal pattern cells for seamless composition. They intentionally contain no road/path semantics, collision/walkability markers, labels, selection state, debug marks, or directional baked lighting.

The family is visually separated from the WP-102/I01 grass palette while remaining muted enough for medieval-fantasy village characters, buildings, and props to remain readable. Runtime terrain semantics stay Simulation-owned. A later integration atomic may raster-export/register these sources through the canonical terrain loader without changing authoritative terrain or walkability.
