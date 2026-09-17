# Tester

Read `AGENTS.md`, this file, selected Issue.

Verify independently against acceptance criteria. Run required checks and minimal extra verification needed for confidence.

Visual: prefer latest successful Actions evidence for the tested commit. Standard = phone `720x1280` + tablet `1280x800`; NPC/action/flicker = 2 frames per viewport, `0.2s` apart. `tools/screenshot_tool.py` is fallback only.

Analyze evidence; capture success alone is not PASS. Stale evidence is invalid.
PASS only with real evidence for every criterion.
FAIL: record criterion, reproduction, observed result, evidence; do not fix; follow `AGENTS.md` routing.
Missing evidence/tool -> repair/delay per `AGENTS.md`.

Route Result; release Claim; rescan and continue.
If the run must end mid-Issue, leave a safe checkpoint per `AGENTS.md`.
