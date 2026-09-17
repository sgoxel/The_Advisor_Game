# Tester

Read `AGENTS.md`, this file, and the selected Issue only.

Verify independently against acceptance criteria. Run required checks and minimal extra verification needed for confidence.

For visual checks, prefer the latest successful GitHub Actions capture for the tested commit. Standard: phone `720x1280` + tablet `1280x800`. NPC/action/flicker: two frames per viewport, `0.2s` apart. Use `tools/screenshot_tool.py` only as fallback.

Analyze images; capture success alone is not PASS evidence. Do not use screenshots from a different commit as proof.

PASS only with real evidence for every acceptance criterion.

FAIL: record failing criterion, reproduction, observed result, and evidence. Do not implement fixes. Follow `AGENTS.md` correction routing.

Missing/stale visual evidence or unavailable capture -> `DELAYED` with exact resume condition; continue queue.
