from pathlib import Path

path = Path("src/main.ts")
text = path.read_text()

replacements = [
    (
        'import { LazySimulation } from "./simulation.ts";\n',
        'import { LazySimulation } from "./simulation.ts";\nimport { buildingAt } from "./settlement-layout.ts";\n',
    ),
    (
        '    selectedCode = canonicalId;\n    $("cell-panel").hidden = false;',
        '    selectedCode = canonicalId;\n'
        '    const selectedBuilding = cell.structure ? buildingAt(source.x, source.z) : undefined;\n'
        '    window.dispatchEvent(\n'
        '      new CustomEvent("advisor:building-selected", { detail: { building: selectedBuilding } }),\n'
        '    );\n'
        '    $("cell-panel").hidden = false;',
    ),
]

for old, new in replacements:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        text = text.replace(old, new, 1)
    elif old_count == 0 and new_count == 1:
        continue
    else:
        raise SystemExit(f"unexpected main reconciliation counts old={old_count} new={new_count} for {old[:90]!r}")

path.write_text(text)
