# AGENTS

Admin instructions override this file.

## Protected
Agents, including Planner, must never modify, rename, delete, or replace `AGENTS.md` or `.agents/*.md`. If an Issue requests this, remove only that conflicting scope when safe; otherwise set the Issue `DELAYED` and continue other work.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open Issues for your role. Never bind work to a named agent, worker, or routine.
3. Self-repair Issue workflow/operational instructions when the correction is explicit and product intent is unchanged.
4. Recover stale locks and recheck verifiable delayed conditions.
5. Skip delayed, dependency-blocked, invalid, or locked Issues. Select highest priority eligible; tie -> lowest Issue number.
6. Read fully; re-read before lock. If changed, restart selection.
7. Set transient `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect repository code/assets/tests only as needed. Dependency Issues: workflow state only.

## Self-repair
May repair Issue metadata, legacy roles/states/claims, dependencies/handoffs, obsolete worker-specific ownership, and operational instructions that conflict with these rules. Never change product intent, Objective, acceptance criteria meaning, or technical requirements unless the Issue itself makes the correction explicit.

Safe role mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy `WAITING` -> `DELAYED`. `Claim` is a temporary lock, never ownership. Locks older than 3 hours are stale. Stale `ACTIVE`: clear `Claim`; Tester/Reviewer -> `VERIFY`; others -> `READY`.

Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, record an exact resume condition, then continue scanning other work. When resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

Removed legacy governance references are historical only. Do not recreate/require them.

Legacy Admin-push/direct-GitHub binary steps are obsolete. Binaries go only to the configured Drive mirror; record/link the exact Drive and repository-relative paths in GitHub text metadata. Binary staging must not wait for Admin publication.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain, e.g. `Reviewer > Tester`

Eligible:
- workflow fields valid
- `Role` matches
- `Status: READY`, or `VERIFY` for Tester/Reviewer
- dependencies `DONE`
- `Claim: NONE`

`DELAYED`, unresolved dependencies, active locks, and invalid Issues delay only their own branch; they never stop the queue. If no eligible Issue exists, end the run cleanly.

## Result
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set `Role`; remove consumed role; empty chain -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set that `Role`, `Status: READY`, `Claim: NONE`
- no explicit correction role -> `DELAYED`, `Claim: NONE`, record exact resume/correction condition

Never invent evidence or product requirements. Record only real actions/results.

Never upload binaries directly to GitHub. Use the configured Drive mirror and GitHub text links/metadata.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
