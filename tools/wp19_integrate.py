from pathlib import Path

# One-shot exact reconciliation for the final WP19 source audit.
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

# Guard the already-landed branch-native integrations; this helper must not mutate them.
worker = Path("src/tile-worker.ts").read_text()
if "buildSettlementFieldGeometry" not in worker:
    raise SystemExit("WP19 canonical field presentation is missing")
ui = Path("src/interior-ui.ts").read_text()
if "interior-selection" not in ui:
    raise SystemExit("WP19 building-selection adapter is missing")
