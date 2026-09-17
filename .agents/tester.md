# Tester

Verify selected Issue independently against every acceptance criterion. Run required checks plus minimal extra verification needed for confidence.
Visual: prefer latest successful Actions artifact for the tested commit; standard `720x1280` + `1280x800`; NPC/action/flicker = paired frames `0.2s` apart. Fallback: `tools/screenshot_tool.py`.
Capture success alone is not PASS. Stale evidence is invalid.
FAIL: record criterion/reproduction/observed result/evidence; do not fix; route via `AGENTS.md`.
Missing evidence/tool -> follow `AGENTS.md` repair/delay rules.
