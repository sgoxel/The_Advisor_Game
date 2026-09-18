# AGENTS

Admin overrides this file.

## Protected
Never modify `AGENTS.md` or `.agents/*.md` unless Admin explicitly requests it.

## Workers
`AGENT #1`..`AGENT #5` are labels only; never ownership or fixed Role.

## Loop
1. Read this file.
2. Scan all open Issues; repair safe workflow defects, stale locks, and legacy invalid states.
3. Eligible: valid fields; `Claim: NONE`; dependencies satisfied; `READY`, or `VERIFY` for Tester/Reviewer.
4. Select highest Priority globally; tie -> lowest Issue number. Skip any Issue already attempted without material progress during this run.
5. Adopt Issue `Role`; read `.agents/<role>.md` + selected Issue only.
6. Re-read Issue; changed -> restart selection.
7. Set `Claim: <run-id>@<UTC timestamp>` + `Status: ACTIVE`; wait random 2-8s; re-fetch; continue only if Claim is yours and Status `ACTIVE`.
8. Before every material repo/Issue write after locking, re-fetch and confirm ownership. Lost Claim -> stop touching that Issue; rescan.
9. Work only that Issue until Result routing or safe checkpoint. Never hold >1 active Claim.
10. Release Claim; rescan immediately; continue.
11. No claimable Issue -> run Visual Idle Audit once if needed, then rescan with backoff 30s -> 60s -> 120s cap. Never end merely because the queue is empty; continue until the execution environment ends the run.

Never bind work to a named worker/session. Do not read README/ROADMAP/unrelated Issues. Inspect only files required by the selected Issue. Dependency Issues are workflow state only.

`AGENTS.md` and the applicable `.agents/<role>.md` are the sole authority for agent operating behavior. Issues define task-specific work, constraints, acceptance, checks, and evidence only. Generic workflow/role instructions embedded in legacy Issues are non-authoritative and may be removed as a safe Repair when task intent and acceptance meaning stay unchanged.

`DELAYED` and `WAITING` are forbidden workflow statuses. Never assign, create, preserve, or route an Issue to either status.

## Checkpoint
Never abandon `ACTIVE` work. If the run must end mid-Issue: leave work safe; record done/remaining/checks/next step; clear Claim; keep Role; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`.

If required source material, evidence, tooling, execution capability, or another external condition is unavailable, do not invent progress and do not create a blocked status. Record the exact missing condition when useful, clear Claim, restore Coder/Designer to `READY` or Tester/Reviewer to `VERIFY`, mark the Issue as attempted-without-progress for this run only, and continue the queue. The attempted-without-progress set is ephemeral and must never be persisted as project state.

## Repair
Repair only `Claim: NONE` or stale locks. Never alter a valid `ACTIVE` Issue owned by another run.
May repair workflow fields, legacy roles/states/claims, stale locks, dependencies/handoffs, obsolete ownership, removed-governance references, and conflicting operational instructions when product intent is unchanged. Add one compact `Repair:` note only when metadata changes.
Never change Objective, acceptance meaning, product intent, or technical requirements unless the Issue explicitly defines the correction.

Aliases: Game Programmer -> Coder; Game Designer | UX Designer | Texture Artist -> Designer; Test | Tester -> Tester; Review | Reviewer -> Reviewer.
Legacy `WAITING` or `DELAYED`: clear Claim; Tester/Reviewer -> `VERIFY`; Coder/Designer -> `READY`.
Locks >3h are stale. Stale `ACTIVE`: clear Claim; Tester/Reviewer -> `VERIFY`; others -> `READY`.
Missing requirement/source/tool/evidence/external condition: never change to a blocked status; checkpoint as defined above and continue queue.
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
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- else consume first Handoff role; set Role; remove it; empty -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role, or a smallest responsible correction role proven by the concrete failure -> set correction Role; prepend failed verification role unless already first; `READY`; `Claim: NONE`
- correction role cannot be determined truthfully -> record the exact missing routing fact; keep Tester/Reviewer role; `VERIFY`; `Claim: NONE`; mark attempted-without-progress for this run only; continue queue

After routing, rescan immediately.

## Visual
Primary evidence: latest successful Actions visual-review artifact for current tested `main`. Fallback: `tools/screenshot_tool.py`.
Standard: phone `720x1280` + tablet `1280x800`. NPC/action/flicker: 2 frames/view, `0.2s` apart. Evidence must match commit and identify viewport/mode/run/time; stale evidence invalid.

### Visual Idle Audit
Only when no Issue is claimable, use idle time for one visual QA pass before backing off. Do not create or maintain a tracking Issue for screenshot availability or audit completion.
1. Inspect the newest valid current-main phone/tablet screenshots first. Use `tools/screenshot_tool.py` only when valid current-main evidence is unavailable or when a task needs a capture mode the latest evidence does not provide.
2. Look for concrete bugs or worthwhile visual/UX improvements. Use commit/build, viewport, mode, run/time as evidence when available.
3. Search all open Issues for the same or substantially similar finding before creating anything.
4. Existing actionable finding -> update that Issue only when the screenshot adds materially useful evidence. New concrete actionable finding -> open one small atomic Coder/Designer bug-fix or improvement Issue, normally `Handoff: Tester`, with factual screenshot evidence, observation/reproduction details, acceptance criteria, and valid workflow fields.
5. Never create an Issue or comment merely because a new screenshot/capture exists, an audit ran, or no new finding was discovered. Do not create visual-review tracking Issues.
6. Do not create duplicate, speculative, unsupported, roadmap/feature-expansion, or cosmetic-only Issues.
Capture/audit failure never blocks queue. Never commit ad-hoc review screenshots. Never invent evidence.

## Admin
Only mandatory Admin execution step: push Admin-created texture-tile binaries already staged in configured Drive mirror.
Texture push pending -> record exact Drive/repo paths; clear Claim; keep Coder/Designer `READY` or Tester/Reviewer `VERIFY`; mark attempted-without-progress for this run only; continue queue.
Other external conditions -> use the same no-progress checkpoint rule. Do not require Admin action.

Never invent evidence or requirements. Record only real actions/results. All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
