from pathlib import Path

# Retained temporarily only so already-queued reconciliation runs are harmless.
# The active WP19 branch now carries these integrations directly.
world = Path("src/world.ts").read_text()
if "roadAt, roadDistanceAt" not in world or "if (tile.size <= 512)" not in world:
    raise SystemExit("WP19 current-main world reconciliation is missing")
worker = Path("src/tile-worker.ts").read_text()
if "buildSettlementFieldGeometry" not in worker:
    raise SystemExit("WP19 canonical field presentation is missing")
ui = Path("src/interior-ui.ts").read_text()
if "interior-selection" not in ui:
    raise SystemExit("WP19 building-selection adapter is missing")
