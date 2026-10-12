from pathlib import Path

# Retained temporarily only so already-queued reconciliation runs are harmless.
# Building selection is now derived from canonical inspector coordinates in interior-selection.ts,
# keeping src/main.ts unchanged.
loader = Path("src/interior-ui.ts").read_text()
selection = Path("src/interior-selection.ts").read_text()
if "interior-selection" not in loader or "lonLatToSource" not in selection or "buildingAt" not in selection:
    raise SystemExit("WP19 canonical building-selection adapter is missing")

# WP19 Attempt 2 follow-up: preserve the new offset/irregular city districts while keeping
# fixed belt streets close enough to the inhabited footprint that the canonical wall can hug
# actual buildings. This changes seeded geometry, not the acceptance threshold.
layout_path = Path("src/settlement-layout.ts")
layout = layout_path.read_text()
marker = "WP19_ATTEMPT2_BORDER_TIGHTEN"
if marker not in layout:
    old = '''  const shift = salt === "middle" ? 0.2 : 0.12,
    offsetX = (w.rand(`ring/${salt}/offset-x`) - 0.5) * radius * shift,
    offsetZ = (w.rand(`ring/${salt}/offset-z`) - 0.5) * radius * shift,
    effectiveJitter = radialJitter + (salt === "middle" ? 0.12 : 0.08),'''
    new = '''  // WP19_ATTEMPT2_BORDER_TIGHTEN: keep asymmetric belts inside the inhabited envelope.
  const shift = salt === "middle" ? 0.12 : 0.1,
    offsetX = (w.rand(`ring/${salt}/offset-x`) - 0.5) * radius * shift,
    offsetZ = (w.rand(`ring/${salt}/offset-z`) - 0.5) * radius * shift,
    effectiveJitter = radialJitter,'''
    if layout.count(old) != 1:
        raise SystemExit("WP19 organic belt tightening target missing")
    layout = layout.replace(old, new, 1)
    old = '''    const inner = makeRing(w, "inner", 9 + Math.floor(u(5) * 4), 100 + 30 * u(6), 0.24, 0.72);
    for (const index of addDryRuns(w, inner, laneWidth)) w.fixed.add(index);
    const middle = makeRing(w, "middle", 10 + Math.floor(u(9) * 4), 158 + 34 * u(10), 0.24, 0.82);'''
    new = '''    const inner = makeRing(w, "inner", 9 + Math.floor(u(5) * 4), 98 + 24 * u(6), 0.22, 0.72);
    for (const index of addDryRuns(w, inner, laneWidth)) w.fixed.add(index);
    const middle = makeRing(w, "middle", 10 + Math.floor(u(9) * 4), 145 + 18 * u(10), 0.18, 0.82);'''
    if layout.count(old) != 1:
        raise SystemExit("WP19 city district radius tightening target missing")
    layout = layout.replace(old, new, 1)
    layout_path.write_text(layout)
