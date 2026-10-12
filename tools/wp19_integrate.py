from pathlib import Path


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    p = Path(path)
    text = p.read_text()
    if marker in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one visual reconciliation target for {marker}, found {count}")
    p.write_text(text.replace(old, new, 1))


# Preserve current-main seeded-road walkability while also allowing canonical settlement streets.
path = Path("src/world.ts")
text = path.read_text()
old = '      Boolean(bridge) || (elevation > 0.1 && (street || slope < 2)),'
new = '      Boolean(road) || Boolean(bridge) || (elevation > 0.1 && (street || slope < 2)),'
old_count = text.count(old)
new_count = text.count(new)
if old_count == 1 and new_count == 0:
    path.write_text(text.replace(old, new, 1))
elif old_count == 0 and new_count == 1:
    pass
else:
    raise SystemExit(f"unexpected walkability reconciliation counts old={old_count} new={new_count}")

# Attempt 2: make city belts genuinely irregular and non-concentric while keeping the same
# seeded street/plot legality authority. Offsets and extra jitter are SEED-addressed only.
replace_once(
    "src/settlement-layout.ts",
    '''function makeRing(w: Work, salt: string, n: number, radius: number, radialJitter: number, angularJitter: number): Point[] {
  const ctrl: Point[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (TAU * (k + (w.rand(`ring/${salt}/angle`, k) - 0.5) * angularJitter)) / n,
      r = radius * (1 + radialJitter * (2 * w.rand(`ring/${salt}/radius`, k) - 1));
    ctrl.push({ x: w.cx + r * Math.cos(theta), z: w.cz + r * Math.sin(theta) });
  }''',
    '''function makeRing(w: Work, salt: string, n: number, radius: number, radialJitter: number, angularJitter: number): Point[] {
  // WP19_ATTEMPT2_ORGANIC_BELTS: city belts are seeded neighbourhood traces, not
  // concentric geometry. Each belt has its own offset centre and stronger irregularity.
  const shift = salt === "middle" ? 0.2 : 0.12,
    offsetX = (w.rand(`ring/${salt}/offset-x`) - 0.5) * radius * shift,
    offsetZ = (w.rand(`ring/${salt}/offset-z`) - 0.5) * radius * shift,
    effectiveJitter = radialJitter + (salt === "middle" ? 0.12 : 0.08),
    ctrl: Point[] = [];
  for (let k = 0; k < n; k++) {
    const theta = (TAU * (k + (w.rand(`ring/${salt}/angle`, k) - 0.5) * angularJitter * 1.35)) / n,
      r = radius * (1 + effectiveJitter * (2 * w.rand(`ring/${salt}/radius`, k) - 1));
    ctrl.push({ x: w.cx + offsetX + r * Math.cos(theta), z: w.cz + offsetZ + r * Math.sin(theta) });
  }''',
    "WP19_ATTEMPT2_ORGANIC_BELTS",
)

replace_once(
    "src/settlement-layout.ts",
    '''    // Inner ring road around the core and a middle ring, both irregular and smoothed.
    const inner = makeRing(w, "inner", 12 + Math.floor(u(5) * 3), 105 + 22 * u(6), 0.16, 0.5);
    for (const index of addDryRuns(w, inner, laneWidth)) w.fixed.add(index);
    const middle = makeRing(w, "middle", 14 + Math.floor(u(9) * 3), 165 + 20 * u(10), 0.1, 0.45);''',
    '''    // WP19_ATTEMPT2_CITY_DISTRICTS: fewer, rougher control points and independent
    // offset centres prevent the two urban belts from reading as stamped concentric rings.
    const inner = makeRing(w, "inner", 9 + Math.floor(u(5) * 4), 100 + 30 * u(6), 0.24, 0.72);
    for (const index of addDryRuns(w, inner, laneWidth)) w.fixed.add(index);
    const middle = makeRing(w, "middle", 10 + Math.floor(u(9) * 4), 158 + 34 * u(10), 0.24, 0.82);''',
    "WP19_ATTEMPT2_CITY_DISTRICTS",
)

replace_once(
    "src/settlement-layout.ts",
    '''  } else {
    const lanes = 2 + Math.floor(u(8) * 3);
    for (let k = 0, added = 0; added < lanes && k < lanes * 4; k++)
      if (addLane(w, k, laneWidth, 18, 34)) added++;
  }''',
    '''  } else {
    // WP19_ATTEMPT2_ARCHETYPE_LANES: each village family now has a materially different
    // street density instead of every archetype receiving the same 2-4 branch recipe.
    const lanes =
      w.archetype === "roadside"
        ? 1 + Math.floor(u(8) * 2)
        : w.archetype === "green"
          ? 1 + Math.floor(u(8) * 2)
          : w.archetype === "crossroads"
            ? 3 + Math.floor(u(8) * 2)
            : 2 + Math.floor(u(8) * 2);
    const minLane = w.archetype === "roadside" ? 16 : w.archetype === "crossroads" ? 22 : 18,
      maxLane = w.archetype === "crossroads" ? 42 : w.archetype === "riverside" ? 38 : 34;
    for (let k = 0, added = 0; added < lanes && k < lanes * 5; k++)
      if (addLane(w, k, laneWidth, minLane, maxLane)) added++;
  }''',
    "WP19_ATTEMPT2_ARCHETYPE_LANES",
)

# Strengthen functional exterior silhouettes. These are presentation meshes attached to existing
# canonical footprints; they do not move buildings, roads, entrances, or collision authority.
replace_once(
    "src/settlement-render.ts",
    '''const forgeDark: RGB = [83, 82, 77];''',
    '''const forgeDark: RGB = [83, 82, 77];
// WP19_ATTEMPT2_SERVICE_SILHOUETTES: small reusable palette for functional attachments.
const straw: RGB = [174, 139, 76];
const brick: RGB = [126, 72, 58];
const awningGreen: RGB = [87, 112, 79];
const slate: RGB = [77, 88, 96];''',
    "WP19_ATTEMPT2_SERVICE_SILHOUETTES",
)

replace_once(
    "src/settlement-render.ts",
    '''  } else if (feature.role === "market") {
    // Open front canopy and stall counter occupy real exterior service space.
    const canopyX = x + s * (depth / 2 + 2.2),
      canopyZ = z + c * (depth / 2 + 2.2);
    structures.box(canopyX, y + 2.6, canopyZ, Math.min(9, width * 0.9), 0.18, 3.8, angle, marketCloth);
    detail.box(canopyX, y + 0.75, canopyZ, Math.min(8, width * 0.8), 1, 0.9, angle, timber);
    for (const side of [-1, 1]) {
      const px = canopyX + c * side * Math.min(3.2, width * 0.35),
        pz = canopyZ - s * side * Math.min(3.2, width * 0.35);
      detail.box(px, y, pz, 0.16, 2.7, 0.16, angle, timber);
    }
  } else if (feature.role === "blacksmith") {''',
    '''  } else if (feature.role === "market") {
    // WP19_ATTEMPT2_MARKET_COURT: an open two-row trading court, not a house with a label.
    const canopyX = x + s * (depth / 2 + 2.8),
      canopyZ = z + c * (depth / 2 + 2.8),
      span = Math.min(10.5, width * 0.95);
    structures.box(canopyX, y + 2.75, canopyZ, span, 0.22, 3.8, angle, marketCloth);
    structures.box(canopyX + s * 3.7, y + 2.45, canopyZ + c * 3.7, span * 0.72, 0.2, 2.8, angle, awningGreen);
    for (const row of [0, 1])
      for (const side of [-1, 0, 1]) {
        const forward = row === 0 ? 0 : 3.7,
          px = canopyX + s * forward + c * side * span * 0.3,
          pz = canopyZ + c * forward - s * side * span * 0.3;
        detail.box(px, y + 0.65, pz, Math.min(2.6, span * 0.27), 1.05, 0.9, angle, row ? straw : timber);
        detail.box(px, y, pz, 0.14, 2.7, 0.14, angle, timber);
      }
    detail.box(canopyX - c * span * 0.44, y + 0.35, canopyZ + s * span * 0.44, 1.15, 0.75, 1.15, angle, [112, 82, 49]);
  } else if (feature.role === "blacksmith") {''',
    "WP19_ATTEMPT2_MARKET_COURT",
)

replace_once(
    "src/settlement-render.ts",
    '''    structures.box(shedX, y - 0.1, shedZ, 3.5, 2.8, depth * 0.72, angle, [126, 112, 88]);
    detail.box(shedX - c * 0.8, y + 2.4, shedZ + s * 0.8, 1, 3.9, 1, angle, [82, 79, 73]);
    detail.box(shedX + c * 0.8, y + 0.8, shedZ - s * 0.8, 1.5, 0.7, 1.2, angle, [67, 65, 62]);''',
    '''    // WP19_ATTEMPT2_SMITHY_YARD: taller brick stack, open forge pad and wood/coal bins.
    structures.box(shedX, y - 0.1, shedZ, 4.4, 3.1, depth * 0.8, angle, [126, 112, 88]);
    detail.box(shedX - c * 1.15, y + 2.4, shedZ + s * 1.15, 1.15, 5.8, 1.15, angle, brick);
    detail.box(shedX + c * 1.0, y + 0.75, shedZ - s * 1.0, 1.8, 0.85, 1.35, angle, forgeDark);
    detail.box(shedX + s * 3.1, y + 0.12, shedZ + c * 3.1, 5.8, 0.2, 4.3, angle, [92, 83, 69]);
    for (const side of [-1, 1])
      detail.box(shedX + c * side * 2.2 + s * 3.1, y + 0.45, shedZ - s * side * 2.2 + c * 3.1, 0.16, 1.15, 4.1, angle, timber);''',
    "WP19_ATTEMPT2_SMITHY_YARD",
)

replace_once(
    "src/settlement-render.ts",
    '''  } else {
    // Ordinary homes vary with their canonical width/depth/floors and retain a small entrance porch.
    const porchX = x + s * (depth / 2 + 0.8),
      porchZ = z + c * (depth / 2 + 0.8);
    detail.box(porchX, y + 0.12, porchZ, Math.min(2.6, width * 0.35), 0.22, 1.5, angle, [116, 91, 62]);
  }''',
    '''  } else {
    // WP19_ATTEMPT2_HOME_VARIANTS: ordinary homes retain their canonical footprint but gain
    // seeded porch/chimney/lean-to silhouettes so a street no longer reads as cloned boxes.
    const porchX = x + s * (depth / 2 + 0.8),
      porchZ = z + c * (depth / 2 + 0.8),
      variant = Math.abs(feature.variant) % 4;
    detail.box(porchX, y + 0.12, porchZ, Math.min(2.6, width * 0.35), 0.22, 1.5, angle, [116, 91, 62]);
    if (variant !== 0) {
      const chimneyX = x + c * width * (variant === 1 ? -0.28 : 0.28),
        chimneyZ = z - s * width * (variant === 1 ? -0.28 : 0.28);
      detail.box(chimneyX, y + height * 0.72, chimneyZ, 0.75, 2.8, 0.75, angle, variant === 3 ? brick : stone);
    }
    if (variant >= 2 && width > 6.5) {
      const leanX = x - c * (width / 2 + 1.15),
        leanZ = z + s * (width / 2 + 1.15);
      structures.box(leanX, y - 0.1, leanZ, 2.3, 2.15, Math.max(3.4, depth * 0.55), angle, variant === 2 ? timber : wall);
      structures.roof(leanX, y + 2.05, leanZ, 2.7, Math.max(3.8, depth * 0.6), 0.9, angle, variant === 2 ? straw : slate);
    }
  }''',
    "WP19_ATTEMPT2_HOME_VARIANTS",
)

# Demand-loaded interior remains the canonical geometry source. Presentation gets stronger wall
# thickness, floor material language, fixture mass and depth without allocating additional interiors.
css = Path("src/interior-ui.css")
css_text = css.read_text()
if "WP19_ATTEMPT2_INTERIOR_DEPTH" not in css_text:
    css_text += r'''

/* WP19_ATTEMPT2_INTERIOR_DEPTH — visual depth for the already-canonical lazy interior. */
.interior-scene-wrap {
  background:
    radial-gradient(ellipse at 52% 25%, rgba(246, 218, 158, 0.16), transparent 42%),
    linear-gradient(145deg, #26372f 0%, #15231d 48%, #0b1310 100%);
}
.interior-room {
  border-width: 3px;
  border-color: rgba(242, 224, 185, 0.92);
  background:
    repeating-linear-gradient(90deg, rgba(66, 49, 32, 0.18) 0 7px, rgba(226, 200, 150, 0.08) 7px 9px),
    linear-gradient(135deg, rgba(176, 143, 94, 0.78), rgba(115, 92, 63, 0.76));
  box-shadow:
    inset 0 0 0 7px rgba(34, 28, 21, 0.34),
    inset 0 0 24px rgba(255, 226, 172, 0.07),
    8px 11px 0 rgba(4, 9, 7, 0.42),
    0 0 0 1px rgba(36, 27, 18, 0.8);
}
.interior-room::before {
  content: "";
  position: absolute;
  inset: -5px;
  pointer-events: none;
  border-top: 7px solid rgba(213, 197, 163, 0.92);
  border-left: 6px solid rgba(133, 119, 96, 0.94);
  border-right: 3px solid rgba(69, 62, 51, 0.9);
  box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.22);
}
.interior-scene[data-environment="craft"] .interior-room {
  background:
    repeating-linear-gradient(45deg, rgba(255,255,255,.025) 0 8px, rgba(0,0,0,.07) 8px 10px),
    linear-gradient(135deg, #746c5e, #4e4b43);
}
.interior-scene[data-environment="commercial"] .interior-room {
  background:
    repeating-linear-gradient(90deg, rgba(111,75,42,.2) 0 9px, rgba(236,207,154,.08) 9px 11px),
    linear-gradient(135deg, #9a7b52, #66523b);
}
.interior-scene[data-environment="guarded"] .interior-room,
.interior-scene[data-environment="fortified"] .interior-room {
  background:
    repeating-linear-gradient(0deg, rgba(230,230,216,.05) 0 10px, rgba(0,0,0,.06) 10px 12px),
    linear-gradient(135deg, #777568, #56564f);
}
.interior-fixture {
  border-width: 2px;
  box-shadow:
    inset 0 2px 0 rgba(255,255,255,.12),
    4px 7px 0 rgba(0,0,0,.38),
    0 0 0 1px rgba(34,25,18,.75);
}
.fixture-bed,
.fixture-bunk {
  background: linear-gradient(90deg, #704737 0 20%, #9f7058 20% 82%, #d0b486 82%);
}
.fixture-counter,
.fixture-workbench {
  background: repeating-linear-gradient(90deg, #6b482b 0 8px, #80583a 8px 10px);
}
.fixture-rack { background: repeating-linear-gradient(0deg, #60442c 0 4px, #96734c 4px 6px); }
.fixture-forge {
  background: radial-gradient(circle at 55% 45%, #d68a43 0 18%, #8b4e2e 19% 42%, #47423d 43%);
  box-shadow: 0 0 18px rgba(226, 137, 63, .42), 4px 7px 0 rgba(0,0,0,.4);
}
.fixture-hearth {
  background: radial-gradient(circle, #c67d42 0 24%, #74452d 25% 55%, #50483e 56%);
}
.interior-door {
  height: 8px;
  background: linear-gradient(#efc878, #9e6c34);
  box-shadow: 0 0 0 3px rgba(43, 30, 18, .82), 0 3px 7px rgba(0,0,0,.35);
}
@media (max-width: 600px) {
  .interior-panel { grid-template-rows: auto auto minmax(220px, 1fr) auto; }
  .interior-meta { font-size: 0.76rem; line-height: 1.25; }
  .interior-scene-wrap { min-height: 250px; }
}
'''
    css.write_text(css_text)

# Guard the already-landed branch-native integrations; this helper must not mutate them unexpectedly.
worker = Path("src/tile-worker.ts").read_text()
if "buildSettlementFieldGeometry" not in worker:
    raise SystemExit("WP19 canonical field presentation is missing")
ui = Path("src/interior-ui.ts").read_text()
if "interior-selection" not in ui:
    raise SystemExit("WP19 building-selection adapter is missing")
