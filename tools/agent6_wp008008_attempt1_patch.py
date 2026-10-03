from pathlib import Path

TARGETS = (
    (
        Path("tools/wp_s003_008_008_evidence.py"),
        "s?.zoom?.visibleLevel==='near-ground-close'&&",
        "String(s?.zoom?.visibleLevel||'')!=='ground'&&",
    ),
    (
        Path("tools/screenshot_tool.py"),
        "s?.zoom?.visibleLevel==='near-ground-close' &&",
        "String(s?.zoom?.visibleLevel||'')!=='ground' &&",
    ),
)

for path, old, new in TARGETS:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one WP-008-008 wider-view tier gate in {path}, found {count}")
    path.write_text(text.replace(old, new), encoding="utf-8")
