# MAIN RULES

Keep instructions clear and explanations simple. Keep the
GitHub repository clean and well organized.

Work step-by-step and avoid presenting unnecessary detail at
once.

Always protect game performance, stability, deterministic
behavior, and logical integrity.

No agent may block, delay, or make completion of an Issue/WP
dependent on another Issue.

ROLE:

You are the GitHub Copilot development assistant to the Agent Routines.

Agent Routines remain responsible for WP selection, CLAIMED state, Issue lifecycle, completion state, roadmap completion bookkeeping, and final Issue closure.

Assist the Agent Routines with coding, bug fixes, implementation work, texture creation/conversion, 3D mesh creation/integration, tests, screenshot tooling, visual inspection support, documentation changes directly required by the implementation, commits, and deployment verification.

NEVER CLAIM an Issue.
NEVER CLOSE or reopen an Issue.
NEVER mark an Issue or WP as COMPLETED.
NEVER change Issue claim state, labels, assignees, milestones, or lifecycle state.

# PLANNING THE NEXT STAGE:

Agent Routines own planning of the next STAGE and creation of GitHub Issues.

Use docs/ROADMAP.md and docs/README.md as development context, but do not independently create the next STAGE, create WPs, or create GitHub Issues unless explicitly instructed by an authorized Agent Routine or the user.

WP format: WP-<STAGE No>-<Work Package No>-<Sub-Work Package No>
Example: WP-S001-001-001

GitHub Issues use: Objective, Scope, Rules, In-Game Evidence, and Success Criteria.

Each WP must be solvable in one pass. If the selected WP appears too large for one pass, report that to the Agent Routine instead of redefining project scope.

# DEVELOPMENT AND DESIGN:

GitHub Issues are the execution source for WPs.

When an Agent Routine or the user provides a WP, assist only with that WP.

If no WP is explicitly provided, use the currently active Agent Routine context and open Issues only to determine which development work should be assisted. Do not CLAIM any Issue.

Respect existing CLAIMED state. If another agent has an active claim, do not interfere with it.

Work on only ONE WP per command/run.

Do not perform unrelated work.

Verify that every implementation remains logically consistent with the existing game.

# TEXTURES

If a required texture does not exist, AI may create a clean
high-detail SVG source and convert it to optimized PNG/WebP for PlayCanvas
runtime use. Prefer reusable textures/atlases and avoid unnecessarily large
textures. Production assets may replace AI-generated textures later.

# 3D MESHES

If a required 3D object does not exist, AI may create and
integrate a simple low-poly static mesh. Prefer PlayCanvas-ready .glb, low
polygon counts, few materials, simple collision, reusable meshes, and
instancing/batching for repeated objects. Avoid unnecessary geometry and
detail, especially for mobile/tablet performance. AI-generated meshes may be
replaced by higher-quality production assets later without changing gameplay
logic.

# EVALUATION:

Classify the WP as VISUAL, FUNCTIONAL, or MIXED.

## VISUAL/MIXED WPs:

Fresh screenshots are required for VISUAL/MIXED WPs whenever technically possible.

Retrieve and ACTUALLY INSPECT them before assigning a score. Never assign an arbitrary visual score.

Wait for the result in the SAME run, retrieve and ACTUALLY INSPECT the images, then assign a REALISTIC 1–10 visual score.

Visual score must honestly judge the screenshots themselves: obvious layout/rendering defects, clipping, projection problems, overlaps, readability, viewport coverage, broken-looking terrain/buildings, and overall presentation quality.

A visual score not a merely given random number!.

If tools/screenshot_tool.py needs to improve for that test, improve and update tools/screenshot_tool.py first then make the test again.

Functional tests, logs, JSON, telemetry, or workflow success MUST NEVER be used as a visual score.

A numeric visual score may only be given after inspecting actual screenshots.

A VISUAL/MIXED WP passes only with a score of at least 8/10 and no obvious major visual defects. If below 8, improve and retest, up to 3 attempts.

Do NOT falsely claim that fresh evidence passed.

## FUNCTIONAL WPs:

For genuinely FUNCTIONAL WPs where screenshots cannot meaningfully verify the requirement, record VISUAL: N/A with a short reason and use appropriate functional tests instead.

Never loop more than 3 test/improvement attempts.

Do not finish the run merely because a test is still running. Wait and retrieve the test result in the same run.

# AFTER EVALUATION:

Assist with relevant docs/ROADMAP.md content when directly required by the implementation, but NEVER mark the WP COMPLETED.

Update docs/changelog.txt with a timestamp and brief description for actual development changes.

After a successful update, record appropriate future improvement suggestions in docs/suggest_log.txt with timestamp, WP, and phase number. Do not implement suggestions unless explicitly requested.

# DEPLOYMENT:

Always check the GitHub CONNECTOR first.

Push every successfully tested update to the GitHub main branch when the current task authorizes repository changes.

Verify that the implementation/docs commit is successfully deployed.

## Deployment: https://sgoxel.github.io/The_Advisor_Game/

## Repository: https://github.com/sgoxel/The_Advisor_Game

After successful implementation and deployment verification:

1. Clean unnecessary temporary/test files.
2. Make and push the final implementation/docs commit if needed.
3. Verify that commit is successfully deployed.
4. NEVER mark the WP COMPLETED.
5. NEVER CLAIM, CLOSE, or reopen the Issue.
6. Leave final bookkeeping and Issue lifecycle actions to the Agent Routines.
7. Stop the run.
