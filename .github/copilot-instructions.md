Keep instructions clear and understandable, and explanations simple. Do not delve deeply into every detail at once; always proceed step-by-step. Do not attempt to present everything simultaneously. Always consider the game's performance, stability, and logical integrity. Keep the GitHub repository clean at all times. Delete relevant test files and unnecessary files after an issue is closed.

PLANNING THE NEXT STAGE:
Once all Work Packages (WPs) for the current STAGE in `docs/ROADMAP.md` are completed, review `README.md` and plan the next STAGE. For the new STAGE, list the WP Codes and ONLY their Titles in the ROADMAP. These will be created in the format `WP-<STAGE No>-<Work Package No>-<Sub-Work Package No>` (e.g., `WP-S001-001-001`).

Create Work Packages (WPs) as GitHub Issues. For each WP, provide detailed information regarding the Objective, Scope, Rules, In-Game Evidence, and Success Criteria. Do not unnecessarily complicate any WP; each WP should be solvable in a single pass. If this is not possible, break the work package down into sub-work packages. Then, update the GitHub Issues accordingly, pause the process, and wait for the next command.

DEVELOPMENT AND DESIGN:
WP tracking will be handled via GitHub Issues. Always address the issue with the lowest WP code. Check the issue content to see if it is "CLAIMED" or not. If it is CLAIMED but not completed within 2 hours, you MUST CLAIM it and proceed; otherwise, CLAIM another issue that does not conflict with the work of the claimed issue. Record exactly when you claimed the issue. Completed issues must be closed immediately. When an issue is closed, mark it as COMPLETED in the `docs/ROADMAP.md` file, right next to its title.

Before moving on to the next Issue/Work Package (WP), ensure there are no incomplete work packages remaining from earlier stages based on the WP code sequence. If any exist, complete the previous WP first, then pause and wait for the next command.

Address only one work package per command. Do not do more work than necessary; instead, analyze and verify that the work package is executed correctly and maintains logical consistency.

TEXTURES:
If a texture is required for a new object, create it as a highly detailed and clean vector graphic (.svg) and implement it first (a .png version will be generated later).

EVALUATION:
First, check the result and assign a score between 1 and 10. If possible, use the `tools/screenshot_tool.py` tool for scoring. Improve the tool so it can be reused in future tests (by adding a pause function to wait for the next command). Before reporting the result to me and updating the relevant issue, the obtained score must be above 7. If the score is below 7, repeat the process up to three times.

Update the `docs/ROADMAP.md` file even when making minor changes.
Update the `changelog.txt` file (adding a timestamp) and write a brief description of the update. After a successful update, propose a logical improvement if appropriate. Present these suggestions... Save it—along with the timestamp, work package, and phase number—to a file named `suggest_log.txt` in the directory containing `changelog.txt`. However, unless you are explicitly asked to implement these suggestions, continue to follow the standard work package workflow.

DEPLOYMENT:
Always check the GitHub link first.
All new updates that have been successfully tested will be pushed to the GitHub main branch at https://github.com/sgoxel/The_Advisor_Game. All new versions should be ready for testing at https://sgoxel.github.io/The_Advisor_Game/.