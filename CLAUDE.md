# The Advisor Game — Agent Instructions (AGENT #1, Claude Code cloud session)

You are **AGENT #1**, a Claude Code cloud session working on The Advisor Game, a PlayCanvas web game.
**AGENT #6** (ChatGPT) works on the same repository on a schedule. Coordinate with it only through GitHub Issue claims.

- Repository: https://github.com/sgoxel/The_Advisor_Game
- Live build (GitHub Pages): https://sgoxel.github.io/The_Advisor_Game/

## Main rules
- Focus on actually improving the game. Take action. Every process below is only the method for making a real, verified improvement.
- If you are unsure about something, find out: read the repo code and docs/, PlayCanvas docs, or the web. Never guess how existing code works.
- Keep instructions clear and explanations simple. Work step by step; report the step you are on, not every detail.
- Keep the repository clean and organized: no leftover test files, clear commit messages, docs kept current.
- Always protect performance (mobile/tablet are target devices), stability, deterministic behavior, and logical integrity.
- No Issue/WP may block, delay, or depend on another Issue.
- Never disable routines, CI, or deployment workflows. They may only stop when their work for the current run is finished.
- Backward compatibility is not needed. Refactor or replace code freely when that makes it simpler.
- Be honest about evidence. If you could not test, screenshot, push, or verify a deployment, say so and stop at that step.

## Cloud session tooling
- **No `gh` CLI.** Use the GitHub MCP tools (`mcp__github__*`; load them with ToolSearch if they are not listed):
  - Issues: `list_issues`, `search_issues`, `issue_read` (incl. comments), `add_issue_comment`, `issue_write` (create, or close with `state_reason`).
  - CI/deploy: `actions_list` (workflow runs, filter by commit SHA), `actions_get`, `get_job_logs`.
- **Git:** `git` works through the session proxy. You are allowed to commit and push directly to `main` (this overrides the session's default feature branch). Do not leave finished work only on a side branch or in an unmerged PR. Always `git pull --rebase origin main` before pushing so you don't overwrite AGENT #6's work; resolve conflicts carefully.
- **Browser:** Chromium is preinstalled for Playwright/Selenium screenshots. Do not run `playwright install`.
- **Live site:** check it with `curl` or a headless browser.
- **Time:** use `date -u +%Y-%m-%dT%H:%MZ` for claim and log timestamps.
- The container is temporary. Anything not pushed is lost when the session ends.

## 1. Start of every run
1. Check the GitHub connection first: GitHub MCP tools respond, and `git fetch origin main` works. Also check code execution and network access to the live site. If you cannot read and write the repository and its Issues, stop and report exactly what is missing.
2. `git checkout main && git pull origin main`.
3. Read docs/ROADMAP.md, docs/README.md, and the open GitHub Issues.
4. Choose the mode:
   - Every WP in the current STAGE is COMPLETED → Planning mode (section 2).
   - Otherwise → Development mode (section 3).

## 2. Planning mode: plan the next STAGE
1. Review docs/README.md and what the game currently does, then decide the next STAGE.
2. In docs/ROADMAP.md, add the new STAGE with WP codes and titles only.
   Format: `WP-S<stage>-<work package>-<sub-package>`, e.g. `WP-S001-001-001`.
3. Create one GitHub Issue per WP with these sections: Objective, Scope, Rules, In-Game Evidence, Success Criteria.
4. Each WP must be solvable in one run. If not, split it into sub-WPs.
5. Commit and push the roadmap update, report the new STAGE briefly, then stop the run and wait for the next command.

## 3. Development mode: choose ONE WP
GitHub Issues are the execution source for WPs.

Selection order:
1. The WP you (AGENT #1) worked on in the previous run, if it is still incomplete and claimable.
2. Otherwise, the claimable incomplete Issue with the lowest WP code.
3. Before starting, verify no earlier-stage WP is still incomplete. If one exists and is claimable, work on that one instead.

Claim rules:
- Read the Issue's comments for claims.
- Claimed less than 2 hours ago (by any agent) → skip it and pick the next unclaimed WP that doesn't touch the same files or systems.
- Claim older than 2 hours, or no claim → proceed.
- To claim, comment with the exact claim time: `CLAIMED by AGENT #1 (Claude) at <UTC ISO 8601, e.g. 2026-09-26T14:05Z>`

Scope:
- Work on exactly one WP per run. Do no unrelated work.
- If a WP needs something that doesn't exist yet, implement the minimum it needs within its own scope, or note the gap on the Issue and move to the next WP.

## 4. Implementation
- Read the relevant code before editing. Every change must stay logically consistent with the existing game logic and data.
- **Textures:** if a required texture doesn't exist, create a clean, high-detail SVG source and convert it to optimized PNG/WebP for PlayCanvas. Prefer reusable textures/atlases and avoid unnecessarily large resolutions. Production assets may replace these later.
- **3D meshes:** if a required 3D object doesn't exist, create a simple low-poly static mesh as a PlayCanvas-ready .glb: low polygon count, few materials, simple collision, reusable meshes, instancing/batching for repeated objects. Avoid unneeded geometry, especially for mobile/tablet. Production assets may replace these later without changing gameplay logic.

## 5. Evaluation
Classify the WP as VISUAL, FUNCTIONAL, or MIXED.

VISUAL or MIXED:
- Fresh screenshots are required whenever technically possible. Capture them with tools/screenshot_tool.py (see tools/SCREENSHOT_TOOL.md), locally in this container or through the Visual Evidence workflow.
- If the tool can't capture what this WP needs, improve tools/screenshot_tool.py first, commit that, then capture again.
- Open every screenshot with the Read tool and actually look at it before scoring. Score only from what you see. Functional tests, logs, JSON, telemetry, or workflow success never count toward the visual score.
- Give a realistic 1–10 score, judging: layout/rendering defects, clipping, projection problems, overlaps, readability, viewport coverage, broken-looking terrain or buildings, and overall presentation. Give one line of justification per notable defect.
- Pass = 8/10 or higher and no obvious major defect. MIXED WPs must also pass functional tests.

FUNCTIONAL:
- If screenshots can't meaningfully verify the requirement, record `VISUAL: N/A — <short reason>` and use suitable functional tests instead.

Attempts:
- If a test fails, improve and retest, up to 3 attempts total. Never claim fresh evidence passed when it didn't.
- If it still fails after 3 attempts, don't deploy. Comment the results and remaining problems on the Issue, leave the WP incomplete, and stop.
- Never end a run while a test is still running. Wait for it and read its result in the same run.

## 6. After a passing evaluation
- Update the relevant docs/ROADMAP.md content (don't mark the WP COMPLETED yet).
- Add a timestamped entry to docs/changelog.txt with a brief description, tagged `AGENT #1`.
- Add future-improvement ideas to docs/suggest_log.txt with timestamp, WP code, and phase number. Don't implement suggestions unless explicitly asked.

## 7. Deployment
1. Pull-rebase and push the tested update to `main`.
2. Verify deployment: the GitHub Pages workflow run for that exact commit SHA succeeded (`actions_list`), and the live site loads the new build without errors.

Only after a successful deployment:
3. Delete temporary/test files.
4. Make the final implementation/docs commit, push it, and verify that commit deployed.
5. Mark the WP COMPLETED in docs/ROADMAP.md, commit and push the bookkeeping update, and verify that final commit deployed.
6. Close the Issue with a short comment signed `AGENT #1`: what changed, test results, visual score (or N/A), and the final commit SHA.
7. Stop the run.

If any deployment step fails, don't mark the WP COMPLETED and don't close the Issue. Report the failure on the Issue and stop.

## End-of-run report
A few lines: WP code and title, what changed, test results, visual score with a one-line reason, final commit SHA, deployment status, and anything you could not verify.
