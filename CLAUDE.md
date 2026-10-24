# CLAUDE.md — agent quick start (read this INSTEAD of re-reading the repo)

The Advisor Game: PlayCanvas + TypeScript + Vite, deterministic seeded round world. Own **one incomplete ACTIVE WP at a time**, continuing that same Issue across runs and independently safe releases until acceptance, exact-main deployment and closure.
Full rules: `docs/AGENTS.md` (short). Product vision: `docs/README.md` (long, do NOT read it whole: `grep -n '^#' docs/README.md`, then read only the section the WP names, with offset/limit).

## Persistent issues become actionable work
- Each run: re-check the ACTIVE WP's unresolved acceptance against **current main and actual evidence**. Mark each finding reproduced, pending proof, superseded or verified; specify the smallest next source-level correction and focused test/visual proof.
- Continue evidence-driven increments as needed. **No arbitrary ceiling on correction attempts, screenshots, iterations or runs.** Each individual job remains finite; do not duplicate proven checks, recursively retry or hold a safe release for optional diagnostics.
- **DEPLOYED is not COMPLETED.** Deploy independently safe, minimally verified slices; keep the same Issue open until its real acceptance gates and exact deployed-main SHA are verified. Do not switch WPs because of age, slow CI or a previous failed attempt.

## Token-lean start of a run
1. `tools/next_wp.sh` prints the next claimable WP, its claim state and the Issue URL. Do not list or read every Issue.
2. Read ONLY that Issue (`gh api repos/sgoxel/The_Advisor_Game/issues/N`) and the files its "Files to touch" line names.
3. `docs/ROADMAP.md` holds open WPs only; finished ones live in `docs/ROADMAP_ARCHIVE.md` (do not read it).
4. Use Grep/Read with offset+limit. Pipe `gh`/test/CI output through `--jq`, `tail`, `grep`. Never print whole logs.
5. Subagent briefs name exact files and line ranges and what is ruled out. Do not make them re-explore.

## Commands (fast loop first)
- `npx tsc --noEmit` · `npm test` (node --test; full suite takes 10+ minutes in this sandbox, run single files with `node --experimental-strip-types --test tests/<file>`; needs `npm ci` first if node_modules is absent) · `npm run build`
- Browser: `npx playwright test --config playwright.fallback.config.js tests/browser/<spec>` (one spec, not the suite)
- Screenshots: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tools/screenshot_tool.py --scenario <name> --profile desktop|phone --renderer webgl2` (120 s timeout, run in background). Steps: click, select, visible, eval (no `;` inside an eval), settle, shot, wait.
- If Playwright cannot find Chromium use `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` in a throwaway config.

## Module map (src/)
- Authority (pure, no RNG/wall clock): `world.ts` coordinates+identity, `planet.ts` scale (radius 637,100 m), `spatial-authority.ts` digests, `macro-geography.ts` continents/mountains, `climate.ts` fields/biomes, `geography.ts` villages/regions, `simulation.ts`, `clock.ts` (only wall-clock boundary, fantasy time x24).
- Travel: `travel.ts` speeds + straight-line 60-minute proof, `routing.ts` bounded A* planner (on demand only), `village-routes.ts` cached village routes, `travel-ui.ts` panel and camera framing (`window.advisorRoutes`), `route-overlay.ts` SVG route + tag. Contract: `docs/ROUTING.md`.
- Rendering: `main.ts` (1.6k lines: app, HUD, labels, loop), `geometry.ts` + `tile-worker.ts` terrain meshes, `streaming.ts` caches/budgets, `render-frame.ts` camera-relative ENU origin, `globe-view.ts`/`globe-surface.ts`/`globe-worker.ts` globe, `handoff.ts` zoom-driven globe<->local blend, `navigation.ts` drag, `renderer.ts`/`renderer-policy.ts` WebGPU->WebGL2, `canonical-inspector.ts` debug inspector.
- Tests: `tests/*.test.ts` unit (listed in package.json `test`), `tests/browser/*.spec.js` Playwright, `tools/screenshot_tool.py` scenarios, `tools/verify-deployment.mjs` live check.
- Docs by topic: `NATURAL_WORLD.md`, `PLANET_ARCHITECTURE.md`, `WORLD_ARCHITECTURE.md`, `ROAD_NETWORK_PLAN.md`, `SETTLEMENT_PLAN.md`, `LIVING_WORLD_PLAN.md`, `WEBGPU.md`, `VERIFICATION.md`, `PRESENTATION_ARCHITECTURE.md` (toon/GLB/billboard/semantic-zoom target, kept in step by `tests/presentation-architecture.test.ts`). Open one only if the WP touches that topic.

## Hard facts
- Everything is decided by the SEED (no other randomness). Canonical positions are lon/lat on the sphere; x/z are derived render coordinates.
- Walking: good road 1 m/s, open ground 5/6 m/s, difficult 0.5 m/s. No walk exceeds 1 m/s, so geodesic >= 3600 m proves the 60-minute village rule. Siting keeps >= 6 km.
- Handoff footprints: local 127,420 m, globe 318,550 m.
- Mobile/tablet performance is a requirement. Prefer the simplest computation (straight-line check over pathfinding).

## Sandbox gotchas (do not rediscover)
- `gh issue ...` (GraphQL) is blocked; use `gh api repos/sgoxel/The_Advisor_Game/...` REST. `git push` works.
- CI logs/artifacts redirect to blob.core.windows.net and are blocked; read failing steps in the built-in browser pane (signed in to GitHub).
- Captures are slow (2-core software GL). Kill stale captures first (`kill -9 <pid>`; `pkill -f` can match your own shell). Some desktop views near the start village stay at "pending=8" in this sandbox even on clean main: pick a view that settles.
- No WebGPU adapter locally; WebGPU evidence comes from CI.
- Pages workflow `pages.yml` is one long serial job; runs queue behind other agents. Check once with a scheduled reminder, never poll in a loop. Never disable CI.
- Commit trailers: see the session attribution reminder. Claim comment format: `CLAIMED by <AGENT #n, model> at <UTC ISO 8601>`.
