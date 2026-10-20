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

CHECK FIRST → ACT ONLY WHEN NECESSARY → VERIFY SUFFICIENTLY → STOP WHEN REQUIRED WORK IS DONE.

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
4. Do NOT search for, claim, or work on another WP while it remains incomplete.

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

Each WP must be solvable in one pass. If not, split it into smaller sub-WPs.

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

A VISUAL/MIXED WP passes only with score >=8/10 and no obvious major visual defects. If below 8, improve and retest, up to 3 attempts.

If 3 attempts are exhausted, stop the run with the same WP still ACTIVE. Do NOT switch WPs.

## FUNCTIONAL

For genuinely FUNCTIONAL WPs where screenshots are not meaningful, record VISUAL: N/A with a short reason and use functional tests.

Never loop more than 3 test/improvement attempts.

Do not finish merely because a test is still running. Wait and retrieve the result in the same run when technically possible.

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
