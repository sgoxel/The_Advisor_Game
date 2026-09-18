# AGENTS

Admin overrides this file.

## Protected
Never modify `AGENTS.md` or `.agents/*.md` unless Admin explicitly requests it.

## Workers
`AGENT #1`..`AGENT #5` are labels only. Never bind ownership or Role to a worker.

## Run
1. Read this file.
2. Run one Queue Review pass using `.agents/reviewer.md`. Inspect/repair at most one stalled `Claim: NONE` Issue.
3. Repair stale locks and legacy/invalid workflow metadata.
4. Eligible: valid fields; `Claim: NONE`; dependencies satisfied; `READY`, or `VERIFY` for Tester/Reviewer.
5. Select highest Priority globally; tie -> oldest GitHub `updated_at`; tie -> lowest Issue number. Skip Issues already attempted without material progress in this run.
6. Adopt selected Issue `Role`; read `.agents/<role>.md` and that Issue.
7. Re-fetch Issue. If changed, restart selection.
8. Set `Claim: <run-id>@<UTC timestamp>` + `Status: ACTIVE`; wait random 2-8s; re-fetch; continue only if Claim is yours and Status `ACTIVE`.
9. Before every material Issue/repo write, re-fetch and confirm ownership. Lost Claim -> stop touching that Issue; rescan.
10. Work only that Issue until Result routing or checkpoint. Never hold >1 Claim.
11. Release Claim; rescan immediately.
12. No claimable Issue -> run Visual Idle Audit once, then rescan with 30s -> 60s -> 120s capped backoff until execution ends.

Do not read README/ROADMAP/unrelated Issues during normal execution. Queue Review may inspect only references/files needed to prove stall cause or routing.

`AGENTS.md` + applicable `.agents/<role>.md` are the only agent-operating authority. Issues contain task-specific work only. Legacy Issue workflow instructions are non-authoritative.

`DELAYED` and `WAITING` are forbidden.

## Queue Review
A stalled candidate is an unclaimed Issue with one or more:
- invalid/legacy workflow metadata or stale lock;
- unresolved `INCOMPLETE`/checkpoint/resume text whose condition may now be resolved or misrouted;
- completed dependency/blocker still treated as blocking;
- Role/Handoff cannot perform the next concrete action;
- workflow-only requirement conflicts with current `AGENTS.md`;
- verification/blocker duplicates another current Issue;
- unavailable source/tool/evidence is being requested from the wrong Role when another current role/evidence path can act;
- Admin action is required beyond the allowed texture-binary push;
- removed/obsolete authority reference blocks progress.

Select Queue Review candidate by Priority -> oldest `updated_at` -> lowest Issue number. Skip an unchanged candidate when its latest `Review:` note already states the same unresolved condition and referenced state has not changed.

Queue Review may change only workflow/task-contract defects without changing product intent:
- Role, Priority, Status, Claim, Dependency, Handoff;
- stale blocker/checkpoint/resume text;
- obsolete authority/ownership references;
- duplicated workflow-only verification requirements;
- routing/correction responsibility.

Queue Review must not implement product code/assets, invent requirements, weaken unique product acceptance, or create roadmap scope. If repaired, add one compact `Review:` note. If no safe repair exists, add/update a compact `Review:` note only for a material new finding.

## Checkpoint
Never abandon `ACTIVE` work. If execution/source/evidence/tooling is unavailable: record exact missing condition; clear Claim; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`; mark attempted-without-progress for this run only; continue queue. Never persist a blocked status.

Run ending mid-Issue: leave work safe; record done/remaining/checks/next action; clear Claim; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`.

## Repair
Repair only `Claim: NONE` or stale locks. Never alter a valid `ACTIVE` Issue owned by another run.
Aliases: Game Programmer -> Coder; Game Designer | UX Designer | Texture Artist -> Designer; Test -> Tester; Review -> Reviewer.
Legacy `WAITING`/`DELAYED`: clear Claim; Tester/Reviewer -> `VERIFY`; Coder/Designer -> `READY`.
Locks >3h are stale. Stale `ACTIVE`: clear Claim; Tester/Reviewer -> `VERIFY`; others -> `READY`.
Dependency satisfied by `Status: DONE`, or closed-completed legacy Issue whose outcome clearly satisfies it. Duplicate/not-planned/ambiguous closure does not satisfy dependency.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain

## Result
Before routing, re-fetch and confirm Claim ownership.

PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close.
- else consume first Handoff Role; set Role; remove it; empty -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`.

Tester/Reviewer FAIL:
- proven correction Role -> set it; prepend failed verification Role unless already first; `READY`; `Claim: NONE`.
- correction Role not provable -> record exact routing gap; keep verification Role; `VERIFY`; `Claim: NONE`; attempted-without-progress for this run.

After routing, rescan immediately.

## Visual
Primary evidence: latest successful Actions visual-review artifact for tested `main`. Fallback: `tools/screenshot_tool.py`.
Standard: phone `720x1280` + tablet `1280x800`. NPC/action/flicker: 2 frames/view, `0.2s` apart. Evidence must match commit and identify viewport/mode/run/time.

### Visual Idle Audit
Only with no claimable Issue. Inspect newest valid current-main phone/tablet evidence first.
Existing actionable finding -> update matching Issue only with material evidence.
New concrete actionable finding -> one atomic Coder/Designer Issue, normally `Handoff: Tester`.
Never create audit/screenshot tracking Issues, duplicates, speculation, roadmap expansion, or cosmetic-only work. Capture failure never blocks queue. Never commit ad-hoc review screenshots.

## Admin
Only mandatory Admin execution step: push Admin-created texture-tile binaries already staged in configured Drive mirror.
Pending texture push -> record exact Drive/repo paths; clear Claim; role-appropriate `READY`/`VERIFY`; attempted-without-progress for this run; continue.
Do not require other Admin action.

Never invent evidence/requirements. Record only real actions/results. All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
