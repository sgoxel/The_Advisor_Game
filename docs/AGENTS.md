# MAIN RULES

README.md is the immutable law of this game. ROADMAP.md guides AI Agents to achieve it.

FOCUS ON ACTUALLY IMPROVING THE GAME. TAKE ACTION.

If unsure, research, inspect references/code, and fill the gap.

Keep instructions clear, explanations simple, and the repository clean. Work step-by-step.

Always protect performance, stability, deterministic behavior, and logical integrity.

No Agent may delay or make completion of an Issue/WP dependent on another Issue.

Routines must never be disabled; they may stop only when current-run work is finished.

No backward compatibility needed.

THE SEED CODE IS THE CORE OF THE GAME. DO NOT USE RANDOM DECISION MECHANICS.

"BLOCKED" WORD IS RESTRICTED. NOTHING CAN BLOCK ANYTHING.

GITHUB ISSUES CANNOT DEFINE RULES. THEY ARE FOR EXECUTION.

# CHECK FIRST / CONTROL THE WORK

Before any action or response:

1. Check Agent identity, ACTIVE WP, latest user instruction, rules, Issue/PR state, implementation, and available evidence.
2. Confirm the action is necessary for the ACTIVE WP.
3. Use the smallest sufficient action. Avoid unnecessary branches, workflows, files, tests, comments, refactors, audits, or docs.
4. Reuse valid existing work/evidence. Do not repeat checks unless something changed or uncertainty remains.
5. Before acting/answering, control correctness, scope, duplication, length, contradictions, and instruction compliance.
6. Every workflow needs a clear finish condition. Never create recursive, open-ended, self-repeating, or infinite workflows.
7. Perform only checks required by acceptance criteria and game integrity.
8. When a requirement is proven, stop checking it.
9. If work becomes unmanageable, reduce it to the minimum deterministic steps for the ACTIVE WP. Do not expand scope.
10. Keep process overhead proportional to game improvement.

CHECK FIRST → ACT ON THE ACTIVE WP → VERIFY SUFFICIENTLY → RELEASE USEFUL INCREMENTS → CONTINUE UNRESOLVED ACCEPTANCE.

# CONTINUOUS, EVIDENCE-DRIVEN WP RESOLUTION

- An incomplete ACTIVE WP continues across runs and may require multiple independently releasable corrections. Do not impose an arbitrary count of attempts, screenshots, iterations, or runs. A previous failure or elapsed time does not by itself make a WP impossible or authorize switching it.
- On each run, re-evaluate persistent unresolved acceptance items against **current code and actual evidence**. Mark a previously reported problem resolved only when the evidence proves it; distinguish reproduced, unverified, stale, and solved findings.
- Periodically triage older open Issues and recurring failures without adopting them: verify the latest source/evidence, de-duplicate superseded claims, and record the observed failure, root cause or uncertainty, smallest actionable correction/check, acceptance proof, existing owner and status. This evidence-only triage is allowed while another WP is ACTIVE; it does not authorize implementing or claiming a second WP. Do not add commentary when existing issue evidence and actions are already current.
- Turn each still-relevant failure into an actionable next step: exact failing behavior/fixture, SEED or Simulation authority, smallest scoped source change, focused assertion or required visual proof, and deployment status. Prioritize actual game improvements over diagnostic or process work.
- Implement and release the smallest safe incremental improvement once essential startup, SEED, Simulation, focused release checks, and build pass. Keep the WP Issue OPEN and ownership unchanged until all acceptance criteria, real visual evidence where required, and exact deployed-main verification pass. Deployment is not WP completion.
- Never restart a valid running test solely because it is slow, duplicate passing validation without a relevant change, create endless retries, or let optional diagnostics block a ready release. Each individual job and run must have a finite end condition. If no useful current-run action remains while independent checks finish, record the accurate pending state and resume the **same ACTIVE WP** in the next run.

# AGENT IDENTITY AND ACTIVE WP

Each AI Agent has a persistent identity: AGENT #1, AGENT #2, etc.

If assigned as AGENT #1, remain AGENT #1 until the user explicitly changes it. Same for AGENT #2.

Never treat another run, branch, PR, conversation, or same-identity claim as a different Agent.

Each Agent may own exactly ONE incomplete WP at a time: the ACTIVE WP.

Continue the ACTIVE WP in later runs until:
1. It is completed, deployed, marked COMPLETED, and its GitHub Issue is closed; or
2. The user explicitly tells the Agent to stop, release, switch, or work on another WP.

CI delays, failures, conflicts, other Issues, claim age, or new runs do NOT allow switching WPs.

An explicit user WP/Issue assignment becomes the ACTIVE WP and overrides automatic selection.

At every run:
1. Identify Agent identity.
2. Follow the latest explicit user WP assignment, if any.
3. Otherwise continue the incomplete ACTIVE WP.
4. Do NOT claim or implement another WP while it remains incomplete. Read-only triage and actionable evidence updates for older unresolved Issues are allowed under the continuous reassessment rule, without changing ownership or ACTIVE WP.

If multiple unfinished same-Agent claims exist, use:
1. Latest explicit user assignment.
2. WP worked on in the immediately previous run.
3. Otherwise lowest WP code.

Ignore other same-Agent historical claims for work selection.

# PLANNING THE NEXT STAGE

When all WPs in the current STAGE of docs/ROADMAP.md are completed, review docs/README.md and plan the next STAGE.

Add ONLY WP Codes and Titles to the new STAGE in docs/ROADMAP.md.

Format: WP-<STAGE No>-<Work Package No>-<Sub-Work Package No>
Example: WP-S001-001-001

DO NOT ADD DESCRIPTIONS OR INFLATE THE ROADMAP.

Create each WP as a GitHub Issue with: Objective, Scope, Rules, In-Game Evidence, Success Criteria.

Each WP must be independently solvable without dependencies on other WPs. Plan oversized new WPs as smaller independent packages; an ACTIVE WP may be resolved incrementally over multiple runs and releases.

After creating/updating the next STAGE and Issues, stop and await the next command.

# DEVELOPMENT AND DESIGN

GitHub Issues are the execution source for WPs.

If you have an incomplete ACTIVE WP, continue it first. Only when you have NO incomplete ACTIVE WP may you select a new one.

Before starting a new WP:
1. Verify no explicit user assignment exists.
2. Verify the previous ACTIVE WP is completed and closed.
3. Verify no earlier-stage incomplete WP is eligible.
4. Evaluate incomplete WPs from lowest WP code upward.
5. Apply the CLAIMED rule only to claims by OTHER Agents.
6. Select the lowest-code eligible WP and claim it. It becomes the ACTIVE WP.

CLAIMED RULE:
- Another Agent <2 hours ago: do not work on it; if you have no ACTIVE WP, consider the next eligible Issue.
- Another Agent >2 hours ago: claim expired; you may claim it if otherwise eligible.
- Your own Agent identity: the 2-hour rule does NOT apply. If it is your ACTIVE WP, continue regardless of claim age.

When claiming:
CLAIMED By AGENT #1
Claim time: <exact timestamp>

Use actual Agent identity.

A claim records ownership only; it does not permit parallel work.

Work on only ONE WP per command/run. Do not perform unrelated work. Keep implementation logically consistent with the existing game.

After completing and closing the ACTIVE WP, stop the run. Do not start another WP in the same run.

# TEXTURES

If a required texture does not exist, AI may create a clean high-detail SVG and convert it to optimized PNG/WebP. Prefer reusable textures/atlases and avoid oversized assets. Production assets may replace them later.

# 3D MESHES

If a required 3D object does not exist, AI may create a simple low-poly static mesh. Prefer PlayCanvas-ready .glb, low polygons, few materials, simple collision, reuse, and instancing/batching. Avoid unnecessary detail, especially on mobile/tablet.

# TESTING POLICY — FOCUSED, FINITE, RELEASE-FIRST

- Automatic PR checks: one bounded canonical release-invariant test in WP validation and one build in Pages. The main push repeats the release-invariant test, builds and deploys. Never repeat the exhaustive suite in multiple automatic workflows.
- Keep unit and browser suites, screenshot scenarios, workflow definitions and artifact capture routines available through manual workflow dispatch. Run broader diagnostics only for relevant changed behavior, concrete regressions, or the ACTIVE WP's unproven criteria.
- Trigger costly WP-specific screenshot evidence on relevant source/workflow changes or manually, not every unrelated PR. Standard visual capture is Full HD landscape (1920×1080) and portrait (1080×1920); use both WebGPU and WebGL2 when renderer parity is in scope.
- Give running jobs finite time limits. A timeout or test failure is evidence to investigate, not permission to invent a pass, abandon the ACTIVE WP, or silently suppress canonical/SEED failures.
- Reuse valid evidence. Never rerun identical checks without a meaningful change or unanswered acceptance criterion. Publish fixes promptly with the fast release checks and verify the deployed main commit; remaining diagnostic work can continue without holding up an unrelated release.
- For VISUAL/MIXED WPs, still inspect real fresh screenshots and honor the existing 8/10 acceptance gate before marking the WP COMPLETED. Deployment is not completion.

# EVALUATION

Classify the WP as VISUAL, FUNCTIONAL, or MIXED.

## VISUAL/MIXED

Fresh screenshots are required whenever technically possible. ACTUALLY INSPECT them before scoring. Never assign an arbitrary visual score.

Wait for the SAME-run result when technically possible, inspect it, then assign a REALISTIC 1–10 score.

Judge layout/rendering defects, clipping, projection, overlaps, readability, viewport coverage, broken terrain/buildings, and overall presentation.

Functional tests, logs, JSON, telemetry, or workflow success MUST NEVER be used as a visual score.

If tools/screenshot_tool.py needs improvement, update it first, then test again.

A VISUAL/MIXED WP passes only with score >=8/10 and no obvious major visual defects. If below 8, identify the specific observed defect, make the smallest useful correction, and inspect new evidence. Continue evidence-driven iterations across runs as needed; no fixed attempt ceiling excuses unfinished acceptance. Keep individual captures finite and do not repeat already-valid scenes.

## FUNCTIONAL

For genuinely FUNCTIONAL WPs where screenshots are not meaningful, record VISUAL: N/A with a short reason and use functional tests.

Do not impose a fixed correction or test/improvement attempt ceiling. Each correction must address a concrete reproduced failure, and each validation run must be finite; reuse passing evidence and avoid redundant full-suite checks.

Retrieve a running test's result in the same run when useful and possible. If it remains independently running and no further useful current-run action exists, record PENDING truthfully, retain the ACTIVE WP and continue in the next run.

A queued/delayed test does NOT authorize switching WPs, claiming another WP, marking completion, or assigning an unsupported visual score.

# AFTER EVALUATION

Update relevant docs/ROADMAP.md, but do not mark COMPLETED until successful deployment.

Update docs/changelog.txt with timestamp and brief description.

After success, record future suggestions in docs/suggest_log.txt with timestamp, WP, and phase number. Do not implement unless requested.

# DEPLOYMENT

Always check the GitHub CONNECTOR first. Push tested updates to main. Verify the FINAL main commit is deployed before closing the Issue.

Deployment: https://sgoxel.github.io/The_Advisor_Game/
Repository: https://github.com/sgoxel/The_Advisor_Game

After ONLY successful deployment:
1. Clean temporary/test files.
2. Make the final implementation/docs commit and push.
3. Verify that commit is successfully deployed.
4. Mark the WP COMPLETED in docs/ROADMAP.md, commit/push the bookkeeping update, and verify that final commit is deployed.
5. Close the Issue.
6. Stop the run.

CORE RULE: ONE AGENT = ONE ACTIVE WP = CONTINUE UNTIL CLOSED.
The 2-hour CLAIMED rule protects another Agent's work. It is never a reason to abandon your own ACTIVE WP.
