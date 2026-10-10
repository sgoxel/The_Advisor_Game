from pathlib import Path

# Retained temporarily only so already-queued reconciliation runs are harmless.
# Building selection is now derived from canonical inspector coordinates in interior-selection.ts,
# keeping src/main.ts unchanged.
loader = Path("src/interior-ui.ts").read_text()
selection = Path("src/interior-selection.ts").read_text()
if "interior-selection" not in loader or "lonLatToSource" not in selection or "buildingAt" not in selection:
    raise SystemExit("WP19 canonical building-selection adapter is missing")
