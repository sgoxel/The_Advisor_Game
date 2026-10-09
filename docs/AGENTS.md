# MAIN RULES
TOKEN-LEAN START: read CLAUDE.md first, run tools/next_wp.sh to pick the WP, read only that Issue and the files it names. Do not read docs/README.md or docs/ROADMAP_ARCHIVE.md whole; grep headings and read sections with offset/limit.
FOCUS ON ACTUALLY IMPROVING THE GAME. TAKE ACTION. All processes are methods and details to how you make improvements in game.
If you're unsure on something then go find more reference, do research and fill in the gap.
Keep instructions clear and explanations simple. Keep the GitHub repository clean and well organized. 
Work step-by-step and avoid presenting unnecessary detail at once. 
Always protect game performance, stability, deterministic behavior, and logical integrity. 
No agent may block, delay, or make completion of an Issue/WP dependent on another Issue.
Routines must never be disabled; they may only stop when their work for the current run is finished. 
No Backward Combability Needed.
NEVER USE ANY OTHER METHOD FOR DECIDING WHAT IS WHAT OTHER THEN THE SEED Except the decisions and actions taken over time which must follow SEED + Fantasy Game Time value.

# PLANNING THE NEXT STAGE: 
When all WPs in the current STAGE of docs/ROADMAP.md are completed, review docs/README.md and plan the next STAGE. 
Add only WP Codes and Titles to the new STAGE in docs/ROADMAP.md. WP format: WP-<STAGE No>-<Work Package No>-<Sub-Work Package No> Example: WP-S001-001-001 
Create each WP as a GitHub Issue with: Objective, Scope, Rules, In-Game Evidence, and Success Criteria.
Each WP must be solvable in one pass. If not, split it into smaller sub-WPs. 
After creating/updating the next STAGE and its Issues, stop the run and await the next command. 

# DEVELOPMENT AND DESIGN: 
GitHub Issues are the execution source for WPs. 
If the previously worked WP is still incomplete and claimable under the CLAIMED rule below, continue it first. Otherwise, work on the claimable incomplete Issue with the lowest WP code.
Check the Issue whether it is CLAIMED. If CLAIMED less than 2 hours ago, select the next non-conflicting unclaimed WP.  If the claim is older than 2 hours, proceed with that WP. 
When CLAIM the issue: Record the exact claim time. Write CLAIMED By <AGENT AI NAME>. 
Before starting a new WP: verify that no earlier-stage WP remains incomplete. If one exists and is claimable, work on that earlier WP instead. 
Work on only ONE WP per command/run. 
Do not perform unrelated work. 
Verify that every implementation remains logically consistent with the existing game. 

# TEXTURES
If a required texture does not exist, AI may create a clean high-detail SVG source and convert it to optimized PNG/WebP for PlayCanvas runtime use. Prefer reusable textures/atlases and avoid unnecessarily large textures. Production assets may replace AI-generated textures later.
# 3D MESHES
If a required 3D object does not exist, AI may create and integrate a simple low-poly static mesh. Prefer PlayCanvas-ready .glb, low polygon counts, few materials, simple collision, reusable meshes, and instancing/batching for repeated objects. Avoid unnecessary geometry and detail, especially for mobile/tablet performance. AI-generated meshes may be replaced by higher-quality production assets later without changing gameplay logic.

# EVALUATION: 
Classify the WP as VISUAL, FUNCTIONAL, or MIXED. 
## VISUAL/MIXED WPs: Fresh screenshots are required for VISUAL/MIXED WPs whenever technically possible. Retrieve and ACTUALLY INSPECT them before assigning a score. Never assign an arbitrary visual score. Wait for the result in the SAME run, retrieve and ACTUALLY INSPECT the images, then assign a REALISTIC 1–10 visual score. Visual score must honestly judge the screenshots themselves: obvious layout/rendering defects, clipping, projection problems, overlaps, readability, viewport coverage, broken-looking terrain/buildings, and overall presentation quality. A visual score not a merely given random number!.
If tools/screenshot_tool.py needs to improve for that test. Improve and update tools/screenshot_tool.py first then make the test again. Functional tests, logs, JSON, telemetry, or workflow success MUST NEVER be used as a visual score.  A numeric visual score may only be given after inspecting actual screenshots. 
A VISUAL/MIXED WP passes only with a score of at least 8/10 and no obvious major visual defects. If below 8, improve and retest, up to 3 attempts. Do NOT falsely claim that fresh evidence passed. 
## FUNCTIONAL WPs: For genuinely FUNCTIONAL WPs where screenshots cannot meaningfully verify the requirement, record VISUAL: N/A with a short reason and use appropriate functional tests instead. 
Never loop more than 3 test/improvement attempts. Do not finish the run merely because a test is still running. Wait and retrieve the test result in the same run. 

# AFTER EVALUATION:
Update relevant docs/ROADMAP.md content, but do not mark the WP COMPLETED until successful deployment.
Update docs/changelog.txt with a timestamp and brief description. After a successful update, record appropriate future improvement suggestions in docs/suggest_log.txt with timestamp, WP, and phase number. Do not implement suggestions unless explicitly requested. 

# DEPLOYMENT: 
Always check the GitHub CONNECTOR first. Push every successfully tested update to the GitHub main branch. Verify that the FINAL main commit is successfully deployed before closing the Issue. 
## Deployment: https://sgoxel.github.io/The_Advisor_Game/ 
## Repository: https://github.com/sgoxel/The_Advisor_Game 
After ONLY successful deployment: 
1.	Clean temporary/test files. 
2.	Make the final implementation/docs commit and push. 
3.	Verify that commit is successfully deployed. 
4.	Mark the WP COMPLETED in docs/ROADMAP.md, commit/push the bookkeeping update, and verify that final commit is deployed. 
5.	Close the Issue. 
6.	Stop the run.
