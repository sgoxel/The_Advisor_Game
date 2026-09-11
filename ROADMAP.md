# The Advisor Game — Product Roadmap

Authority: Admin > README.md > this ROADMAP > TODO > issues > code/assets > tests.

This roadmap decomposes README product truth into small vertical work packages. It does not modify or supersede README. Each WP lists ten atomic issue records (`I01`–`I10`) intended to be independently actionable in a single work cycle. Atomic issue creation, readiness, role routing, dependencies, claims, status, and lifecycle are governed by `.github/ISSUE_STANDARD.md`; roadmap entries do not become READY merely by existing here.

## CURRENT DELIVERY PRIORITY — Starting Village visual-first vertical slice

Admin priority: the first product-completion target is a visually complete, stable, responsive **Starting Village** that is comfortable to play on desktop, tablet, and phone before broad feature expansion is preferred.

This is an execution-priority overlay, not a renumbering of existing WPs. Existing issue/WP references remain valid. A valid active claim still completes first, and workers must never block: when no eligible item exists in the highest applicable group, continue through normal role order.

### Priority A — Visible world stability and render continuity
Prefer `WP-091`, `WP-092`, `WP-039`, `WP-040`, and `WP-111` work that keeps the currently visible world responsive and prevents NPCs or other valid scene elements from flickering, disappearing, being recreated with unstable identity, or dropping out during movement, camera pan, zoom, resize, relevance transitions, or frame pressure.

### Priority B — Responsive game area and phone portrait navigation
Prefer `WP-095`, `WP-108`, `WP-109`, and `WP-110` so the game area remains the primary surface on desktop, tablet, and phone. On phone portrait, the currently unused major surface must stay outside the visible viewport: the player switches between the **Game Area** and **Control Panel** with large Up/Down controls rather than shrinking both into one crowded screen. Persistent windows/panels must not consume game-area space unless their information is continuously necessary.

### Priority C — Starting Village visual completion
Prefer `WP-101` through `WP-107` together with existing `WP-021` through `WP-030`, `WP-044`, `WP-045`, and `WP-093`. Complete the visible Starting Village ground/terrain, roads/paths, buildings, protagonist model, required NPC profession visuals, props/vegetation, and movement/animation presentation as one coherent medieval-fantasy scene.

### Priority D — Visual-slice verification and release quality
Use `WP-112` with `WP-099` and the applicable parts of `WP-100` to certify the slice across representative desktop, tablet, phone landscape, and phone portrait layouts. Visual continuity must be checked while the game is actively moving, not only on a static frame.

### Starting Village visual-first exit criteria
The priority remains active until all of the following are independently verifiable:

- The Starting Village reads as an inhabited medieval-fantasy place with coherent terrain, roads, buildings, props, protagonist, and NPC visuals rather than placeholders or debug-only presentation.
- Starting Village building visuals cover the representative home plus the required local service/workplace set and remain scale-consistent with characters, rooms, roads, entrances, and logical tiles.
- Roads and paths form visually coherent connections between homes, workplaces, services, gathering areas, farms, and exits, with stable presentation across zoom levels.
- The protagonist and visible NPCs have stable visual identity, appropriate directional movement presentation, and do not flicker or disappear during normal movement, pan, zoom, resize, or relevance transitions.
- Desktop and tablet layouts keep the game area comfortably playable without unnecessary persistent overlays.
- Phone landscape remains playable with touch-sized controls and no clipped essential content.
- Phone portrait shows either the Game Area or the Control Panel as the primary visible surface; the inactive major surface remains off-screen and Up/Down controls switch between them without losing game/control state.
- Contextual panels, dialogs, labels, and debug/status surfaces do not permanently cover meaningful game space when they are not actively needed.
- Orientation changes and responsive resizing preserve the same authoritative game state and do not create duplicate/missing entities or presentation resets.
- Tester can certify the public build with motion-aware visual evidence and no critical visual continuity defect remaining in this slice.

## Core Advisor → Character → Simulation → World loop

### WP-001 — Tavern travel advice
I01 advice intent; I02 autonomy evaluation; I03 tavern lookup; I04 legality gate; I05 route request; I06 incremental movement; I07 rejection path; I08 unreachable path; I09 persistence; I10 regression evidence.

### WP-002 — Innkeeper work inquiry
I01 inquiry intent; I02 innkeeper identity; I03 adjacency gate; I04 autonomy evaluation; I05 opportunity lookup; I06 no-work result; I07 rejection path; I08 Local BOT parity; I09 persistence; I10 regression evidence.

### WP-003 — Inspect revealed work opportunity
I01 opportunity identity; I02 known-fact filter; I03 unknown-fact display; I04 read-only inspection; I05 time refresh; I06 source NPC/location; I07 reward visibility; I08 Local BOT independence; I09 persistence; I10 responsive test.

### WP-004 — Recommend one known opportunity
I01 recommendation intent; I02 opportunity reference; I03 character weighting; I04 rejection path; I05 expiry validation; I06 requirement validation; I07 no direct acceptance; I08 decision record; I09 save/resume; I10 tests.

### WP-005 — Character accepts one work opportunity
I01 acceptance decision; I02 availability gate; I03 requirement gate; I04 source identity; I05 assignment state; I06 duplicate prevention; I07 rejection/no-op; I08 persistence; I09 world feedback; I10 tests.

### WP-006 — Travel to assigned workplace
I01 target anchor; I02 route legality; I03 entrance use; I04 travel state; I05 arrival state; I06 unreachable fallback; I07 occupancy; I08 save/resume; I09 visible reaction; I10 tests.

### WP-007 — Perform one bounded work action
I01 work precondition; I02 location gate; I03 time cost; I04 action resolution; I05 resource inputs; I06 output record; I07 interruption; I08 persistence; I09 animation/status; I10 tests.

### WP-008 — Receive one lawful work reward
I01 completion proof; I02 employer authority; I03 reward contract; I04 inventory/currency mutation; I05 duplicate guard; I06 refusal/failure; I07 log feedback; I08 persistence; I09 Local BOT parity; I10 tests.

### WP-009 — Advisor warns about one hazard
I01 hazard knowledge; I02 warning intent; I03 trust weighting; I04 autonomy decision; I05 legality unchanged; I06 accepted response; I07 rejected response; I08 memory; I09 world feedback; I10 tests.

### WP-010 — Persistent behavioral advice rule
I01 plain-text schema; I02 parse boundary; I03 character memory; I04 applicability gate; I05 exceptions; I06 autonomy weighting; I07 no authority bypass; I08 edit/remove; I09 persistence; I10 tests.

## Character identity, autonomy, memory and emotion

### WP-011 — Deterministic protagonist identity
I01 seed inputs; I02 stable ID; I03 name; I04 gender; I05 birth date; I06 birthplace; I07 personality base; I08 profession base; I09 regeneration; I10 tests.

### WP-012 — Deterministic NPC identity
I01 stable ID; I02 seed inputs; I03 name; I04 birth data; I05 birthplace; I06 personality; I07 profession; I08 rematerialization; I09 travel continuity; I10 tests.

### WP-013 — Fantasy age derivation
I01 campaign date; I02 birth date; I03 age function; I04 leap/calendar rule; I05 UI exposure; I06 no stored drift; I07 save/resume; I08 boundary ages; I09 localization; I10 tests.

### WP-014 — Character personality evaluation
I01 trait model; I02 deterministic base; I03 context inputs; I04 advice weighting; I05 risk preference; I06 no authority; I07 diagnostics; I08 persistence boundary; I09 Local BOT use; I10 tests.

### WP-015 — Advisor trust
I01 trust state; I02 bounded range; I03 advice influence; I04 gain event; I05 loss event; I06 no mind control; I07 UI readout; I08 persistence; I09 Local BOT parity; I10 tests.

### WP-016 — Character goal memory
I01 goal identity; I02 priority; I03 source; I04 status; I05 reconsideration; I06 advice link; I07 completion evidence; I08 persistence; I09 UI summary; I10 tests.

### WP-017 — Promise memory
I01 promise record; I02 participants; I03 due context; I04 reminder; I05 fulfilled state; I06 broken state; I07 relationship effect; I08 persistence; I09 dialogue context; I10 tests.

### WP-018 — Dynamic mood
I01 mood dimensions; I02 event inputs; I03 need inputs; I04 bounded decay; I05 dialogue effect; I06 risk effect; I07 no authority; I08 persistence; I09 lazy reconciliation; I10 tests.

### WP-019 — Salient event memory
I01 event identity; I02 salience; I03 actor links; I04 location/time; I05 retrieval; I06 decay/retention; I07 advice recall; I08 persistence; I09 LLM context budget; I10 tests.

### WP-020 — Local BOT/LLM driver parity
I01 shared character state; I02 shared opportunities; I03 shared legality; I04 fallback trigger; I05 malformed response; I06 quota fallback; I07 no split identity; I08 diagnostics; I09 persistence; I10 tests.

## Starting village and buildings

### WP-021 — Origin-region generation
I01 coordinate 0,0; I02 100x100 bounds; I03 seed determinism; I04 terrain; I05 roads; I06 settlement footprint; I07 landmarks; I08 population hooks; I09 regeneration; I10 tests.

### WP-022 — Starter home footprint
I01 >=10x10; I02 two rooms; I03 entrance; I04 walls; I05 floor; I06 bed anchor; I07 collision; I08 residence link; I09 rendering; I10 tests.

### WP-023 — Enterable house continuity
I01 exterior ID; I02 interior same ID; I03 door transition; I04 occupant continuity; I05 state continuity; I06 cutaway; I07 collision; I08 save/load; I09 camera; I10 tests.

### WP-024 — Inn/tavern building
I01 footprint; I02 entrance; I03 public room; I04 service anchor; I05 lodging anchor; I06 staff link; I07 visitors; I08 cutaway; I09 persistence; I10 tests.

### WP-025 — Market building
I01 footprint; I02 entrance; I03 stalls; I04 seller anchors; I05 customer space; I06 collision; I07 activity; I08 rendering; I09 persistence; I10 tests.

### WP-026 — Workshop/smithy
I01 footprint; I02 entrance; I03 forge/work anchor; I04 profession capability; I05 safe walk tiles; I06 worker link; I07 activity gate; I08 rendering; I09 persistence; I10 tests.

### WP-027 — Bakery
I01 footprint; I02 entrance; I03 production anchor; I04 profession capability; I05 worker link; I06 customer area; I07 activity gate; I08 rendering; I09 persistence; I10 tests.

### WP-028 — Mill
I01 footprint; I02 entrance; I03 mill anchor; I04 profession capability; I05 worker link; I06 terrain relation; I07 activity gate; I08 rendering; I09 persistence; I10 tests.

### WP-029 — Village hall
I01 footprint; I02 entrance; I03 meeting room; I04 authority anchor; I05 NPC roles; I06 public access; I07 cutaway; I08 rendering; I09 persistence; I10 tests.

### WP-030 — Building top-down presentation
I01 floor tiles; I02 boundary tiles; I03 door tile; I04 roof/cutaway; I05 semantic atlas; I06 cached composition; I07 zoom stability; I08 interior readability; I09 responsive rendering; I10 tests.

## NPC population, routines and movement

### WP-031 — Resident home assignment
I01 resident identity; I02 home capacity; I03 deterministic assignment; I04 valid anchor; I05 no invented home; I06 transient exemption; I07 persistence; I08 regeneration; I09 diagnostics; I10 tests.

### WP-032 — Workplace assignment
I01 profession match; I02 workplace capacity; I03 outdoor exception; I04 deterministic choice; I05 work anchor; I06 no invalid workplace; I07 persistence; I08 regeneration; I09 diagnostics; I10 tests.

### WP-033 — Routine activity legality
I01 sleep gate; I02 work gate; I03 social gate; I04 travel-first; I05 wait fallback; I06 no teleport; I07 presentation sync; I08 save/resume; I09 determinism; I10 tests.

### WP-034 — Terrain-aware routing
I01 walkability; I02 roads preference; I03 entrances; I04 obstacles; I05 path determinism; I06 no straight-line bypass; I07 unreachable result; I08 cache; I09 diagnostics; I10 tests.

### WP-035 — Exclusive NPC occupancy
I01 tile reservation; I02 conflict detect; I03 deterministic yield; I04 wait; I05 neighbor option; I06 route retry; I07 no overlap; I08 save/load; I09 diagnostics; I10 tests.

### WP-036 — Adjacent NPC dialogue
I01 partner ID; I02 adjacency; I03 same-tile reject; I04 approach; I05 shared bubble; I06 partner loss; I07 stale reference cleanup; I08 save/load; I09 determinism; I10 tests.

### WP-037 — Guard shifts
I01 guard role; I02 post anchor; I03 shift time; I04 relief; I05 home/barracks; I06 route legality; I07 entrance not blocked; I08 persistence; I09 presentation; I10 tests.

### WP-038 — Outdoor worksite routing
I01 farmer field; I02 hunter wilderness; I03 fisher bank/coast; I04 woodcutter forest; I05 terrain capability; I06 reachable anchor; I07 travel; I08 activity gate; I09 persistence; I10 tests.

### WP-039 — Smooth NPC movement presentation
I01 authoritative tile state; I02 interpolation; I03 no truth mutation; I04 route turns; I05 collision sync; I06 camera motion; I07 low-FPS behavior; I08 labels; I09 performance; I10 tests.

### WP-040 — Lazy relevance-tier NPC simulation
I01 relevance tiers; I02 stable buckets; I03 visible cadence; I04 nearby cadence; I05 distant compact state; I06 promotion reconcile; I07 demotion snapshot; I08 metrics; I09 render yielding; I10 tests.

## World, terrain, ecology and travel

### WP-041 — Neighbor-region travel
I01 edge detection; I02 coordinate change; I03 terrain continuity; I04 road continuity; I05 protagonist continuity; I06 NPC relevance; I07 camera; I08 persistence; I09 no boundary wall; I10 tests.

### WP-042 — Terrain biome generation
I01 biome inputs; I02 elevation; I03 moisture; I04 terrain types; I05 seed determinism; I06 adjacency coherence; I07 walkability; I08 rendering; I09 persistence delta; I10 tests.

### WP-043 — River continuity
I01 source rule; I02 flow direction; I03 region edge continuity; I04 banks; I05 crossing legality; I06 bridges; I07 rendering; I08 minimap; I09 persistence; I10 tests.

### WP-044 — Road network continuity
I01 settlement links; I02 edge exits; I03 topology; I04 width class; I05 intersections; I06 path preference; I07 semantic rendering; I08 minimap; I09 determinism; I10 tests.

### WP-045 — Two-tile main roads
I01 topology classification; I02 paired semantics; I03 atlas family; I04 transitions; I05 intersections; I06 cached render; I07 no route mutation; I08 zoom stability; I09 performance; I10 tests.

### WP-046 — Domestic animals
I01 species table; I02 habitat; I03 owner/home link; I04 idle; I05 forage; I06 flee; I07 occupancy; I08 relevance; I09 persistence; I10 tests.

### WP-047 — Wildlife
I01 habitat; I02 spawn foundation; I03 deterministic identity; I04 forage; I05 flee; I06 travel; I07 relevance; I08 persistence; I09 presentation; I10 tests.

### WP-048 — Fantasy creatures
I01 original bestiary; I02 habitat; I03 danger tier; I04 territory; I05 behavior; I06 encounter legality; I07 relevance; I08 persistence; I09 presentation; I10 tests.

### WP-049 — Region landmarks
I01 landmark types; I02 deterministic placement; I03 terrain fit; I04 discoverability; I05 identity; I06 interaction anchor; I07 minimap; I08 persistence; I09 presentation; I10 tests.

### WP-050 — World map continuity
I01 region grid; I02 current position; I03 known/unknown; I04 roads; I05 settlements; I06 political overlay; I07 no duplicate truth; I08 responsive UI; I09 performance; I10 tests.

## Time, persistence and campaign state

### WP-051 — Authoritative game clock
I01 60m=24h; I02 2.5m/hour; I03 authoritative tick; I04 pause policy; I05 no FPS coupling; I06 UI clock; I07 persistence; I08 resume; I09 tests; I10 diagnostics.

### WP-052 — Dawn/night presentation
I01 05:00 dawn; I02 22:00 night; I03 overlay; I04 indoor readability; I05 performance; I06 no truth mutation; I07 save/resume; I08 localization; I09 accessibility; I10 tests.

### WP-053 — Fantasy campaign date
I01 creation time; I02 year minus 2000; I03 day/month; I04 time-of-day; I05 timezone acceptance; I06 persistence; I07 display; I08 deterministic resume; I09 migration; I10 tests.

### WP-054 — Save snapshot
I01 schema version; I02 seed; I03 game time; I04 protagonist; I05 world deltas; I06 NPC deltas; I07 advice/memory; I08 checksum; I09 error handling; I10 tests.

### WP-055 — Load/resume
I01 schema validate; I02 base regenerate; I03 apply deltas; I04 time reconcile; I05 identity continuity; I06 location continuity; I07 invalid data fallback; I08 UI restore; I09 diagnostics; I10 tests.

### WP-056 — Off-screen time reconciliation
I01 elapsed time; I02 compact NPC state; I03 settlement state; I04 opportunity expiry; I05 resource effects; I06 deterministic order; I07 bounded work; I08 promotion; I09 persistence; I10 tests.

### WP-057 — Persistent world damage
I01 damage event; I02 target identity; I03 delta schema; I04 rendering; I05 collision effect; I06 repair hook; I07 regeneration base; I08 save/load; I09 minimap; I10 tests.

### WP-058 — Persistent construction
I01 construction identity; I02 location; I03 legality; I04 progress; I05 completed delta; I06 rendering; I07 collision; I08 save/load; I09 history; I10 tests.

### WP-059 — Ownership change persistence
I01 owner identity; I02 target identity; I03 authority gate; I04 event record; I05 current owner; I06 UI; I07 save/load; I08 regeneration; I09 history; I10 tests.

### WP-060 — Campaign history ledger
I01 event IDs; I02 timestamps; I03 actors; I04 locations; I05 consequences; I06 bounded retention; I07 query; I08 save/load; I09 presentation; I10 tests.

## Economy, settlements and progression

### WP-061 — Basic currency inventory
I01 currency state; I02 ownership; I03 earn; I04 spend; I05 insufficient funds; I06 no LLM mutation; I07 UI; I08 persistence; I09 diagnostics; I10 tests.

### WP-062 — Basic item inventory
I01 item IDs; I02 quantities; I03 capacity rule; I04 acquire; I05 consume; I06 transfer; I07 no UI authority; I08 persistence; I09 presentation; I10 tests.

### WP-063 — Local trade transaction
I01 seller; I02 buyer; I03 item; I04 price; I05 stock; I06 funds; I07 atomic resolve; I08 world feedback; I09 persistence; I10 tests.

### WP-064 — Settlement population state
I01 resident count; I02 transient count; I03 births hook; I04 deaths hook; I05 migration hook; I06 housing relation; I07 lazy reconcile; I08 persistence; I09 UI; I10 tests.

### WP-065 — Settlement prosperity
I01 metric; I02 production input; I03 trade input; I04 damage input; I05 bounded change; I06 no presentation authority; I07 history; I08 persistence; I09 UI; I10 tests.

### WP-066 — Settlement security
I01 metric; I02 guards; I03 hazards; I04 incidents; I05 bounded change; I06 consequences; I07 history; I08 persistence; I09 UI; I10 tests.

### WP-067 — Settlement growth
I01 eligibility; I02 space; I03 population; I04 prosperity; I05 construction trigger; I06 no mandatory growth; I07 history; I08 persistence; I09 presentation; I10 tests.

### WP-068 — Settlement decline
I01 pressure inputs; I02 population loss; I03 prosperity loss; I04 abandoned structures; I05 ruined state; I06 recovery hook; I07 history; I08 persistence; I09 presentation; I10 tests.

### WP-069 — Advisor Insight progression
I01 XP source; I02 level; I03 unlock; I04 investigation bonus; I05 no truth fabrication; I06 UI; I07 persistence; I08 Local BOT use; I09 balance bounds; I10 tests.

### WP-070 — Advisor Rhetoric progression
I01 XP source; I02 level; I03 unlock; I04 persuasion modifier; I05 autonomy preserved; I06 UI; I07 persistence; I08 Local BOT use; I09 bounds; I10 tests.

## Politics, factions and authority

### WP-071 — Base realm generation
I01 realm IDs; I02 seed inputs; I03 territory; I04 capital; I05 terrain relation; I06 borders; I07 settlement affiliation; I08 map; I09 regeneration; I10 tests.

### WP-072 — Province generation
I01 province IDs; I02 realm link; I03 boundaries; I04 centers; I05 settlements; I06 terrain relation; I07 map; I08 regeneration; I09 persistence deltas; I10 tests.

### WP-073 — Faction identity
I01 faction ID; I02 leader; I03 objectives; I04 territory; I05 knowledge; I06 relations; I07 memory; I08 persistence; I09 UI; I10 tests.

### WP-074 — Diplomatic relationship
I01 pair identity; I02 attitude; I03 trust; I04 grievances; I05 obligations; I06 events; I07 bounded updates; I08 persistence; I09 UI; I10 tests.

### WP-075 — Treaty
I01 treaty ID; I02 parties; I03 terms; I04 authority; I05 start/end; I06 breach; I07 consequences; I08 persistence; I09 UI; I10 tests.

### WP-076 — Rank progression
I01 rank ladder; I02 eligibility; I03 legitimate grant; I04 authority scope; I05 responsibilities; I06 no player ownership; I07 world reaction; I08 persistence; I09 UI; I10 tests.

### WP-077 — Estate authority
I01 estate ID; I02 holder; I03 territory; I04 permissions; I05 obligations; I06 succession hook; I07 world actions; I08 persistence; I09 UI; I10 tests.

### WP-078 — Law proposal advice
I01 advice; I02 ruler authority; I03 character decision; I04 legal scope; I05 enactment validation; I06 rejection; I07 world effects; I08 history; I09 persistence; I10 tests.

### WP-079 — Succession dispute
I01 claimants; I02 legitimacy; I03 supporters; I04 trigger; I05 character choices; I06 simulation resolution; I07 territory effects; I08 history; I09 persistence; I10 tests.

### WP-080 — Political map evolution
I01 control deltas; I02 border updates; I03 capital changes; I04 affiliation; I05 map rendering; I06 no pixel authority; I07 history; I08 persistence; I09 lazy load; I10 tests.

## Military, conflict and events

### WP-081 — Recruitment advice
I01 advice intent; I02 authority gate; I03 eligible recruits; I04 resources; I05 character decision; I06 simulation resolve; I07 rejection; I08 persistence; I09 world feedback; I10 tests.

### WP-082 — Military unit state
I01 unit ID; I02 commander; I03 members; I04 supplies; I05 morale; I06 training; I07 location; I08 persistence; I09 UI; I10 tests.

### WP-083 — Strategic movement order
I01 legitimate issuer; I02 destination; I03 route; I04 supplies; I05 travel time; I06 interruption; I07 arrival; I08 persistence; I09 map; I10 tests.

### WP-084 — Battle resolution
I01 participants; I02 terrain; I03 morale; I04 training; I05 supplies; I06 deterministic resolution inputs; I07 casualties; I08 retreat; I09 history; I10 tests.

### WP-085 — Siege
I01 target; I02 attacker; I03 authority; I04 supplies; I05 defenses; I06 time; I07 resolution; I08 consequences; I09 persistence; I10 tests.

### WP-086 — Local dispute event
I01 trigger; I02 participants; I03 facts; I04 advisor investigation; I05 character decision; I06 resolution; I07 consequences; I08 memory; I09 persistence; I10 tests.

### WP-087 — Shortage event
I01 trigger; I02 resource; I03 affected settlement; I04 reports; I05 advice; I06 authority; I07 responses; I08 consequences; I09 persistence; I10 tests.

### WP-088 — Banditry event
I01 trigger; I02 location; I03 threat identity; I04 reports; I05 advice; I06 character response; I07 simulation resolution; I08 consequences; I09 persistence; I10 tests.

### WP-089 — Tournament event
I01 host; I02 location; I03 schedule; I04 eligibility; I05 advice; I06 character decision; I07 simulation results; I08 reputation; I09 persistence; I10 tests.

### WP-090 — Supernatural discovery event
I01 location; I02 discovery gate; I03 unknown facts; I04 investigation; I05 advice; I06 character choice; I07 simulation validation; I08 consequences; I09 memory; I10 tests.

## Presentation, accessibility, performance and release quality

### WP-091 — Render-first frame budget
I01 central budget; I02 input priority; I03 camera priority; I04 visible render priority; I05 background yield; I06 chunking; I07 starvation guard; I08 metrics; I09 determinism; I10 performance test.

### WP-092 — Stable NPC presentation
I01 stable ID mapping; I02 relevance retention; I03 cull reason; I04 no flicker; I05 no edge clamp; I06 label anchoring; I07 deferred refresh; I08 diagnostics; I09 mobile bounds; I10 tests.

### WP-093 — Cached static building composition
I01 static/dynamic split; I02 base chunk cache; I03 tile composition; I04 culling; I05 roof overlay; I06 no duplicate layer; I07 zoom stability; I08 performance evidence; I09 authority separation; I10 tests.

### WP-094 — Structured runtime log
I01 event schema; I02 game/system time; I03 categories; I04 severity; I05 bounded retention; I06 dedupe; I07 errors; I08 localization; I09 non-authoritative persistence boundary; I10 tests.

### WP-095 — Responsive desktop/tablet/phone shell
I01 desktop layout; I02 tablet landscape/portrait; I03 phone landscape; I04 phone portrait; I05 touch targets and safe areas; I06 overflow; I07 game/map viewport priority; I08 dialogs/context overlays; I09 orientation-state continuity; I10 tests.

### WP-096 — Keyboard accessibility
I01 tab order; I02 focus visible; I03 dialogs; I04 escape behavior; I05 buttons; I06 inputs; I07 map alternatives; I08 ARIA labels; I09 no traps; I10 tests.

### WP-097 — EN/TR localization integrity
I01 key registry; I02 English coverage; I03 Turkish coverage; I04 fallback; I05 interpolation; I06 date/time; I07 dynamic labels; I08 no hard-coded player strings; I09 responsive text; I10 tests.

### WP-098 — Public-build startup resilience
I01 resource load; I02 missing asset fallback; I03 unhandled error capture; I04 seed startup; I05 save restore; I06 Local BOT fallback; I07 no blank screen; I08 diagnostics; I09 cache/version; I10 smoke tests.

### WP-099 — Performance regression gate
I01 camera fixture; I02 NPC load fixture; I03 world load fixture; I04 frame p95; I05 long tasks; I06 memory; I07 object/draw counts; I08 artifact bounds; I09 baseline comparison; I10 CI gate.

### WP-100 — Core-loop release gate
I01 advice autonomy; I02 Simulation legality; I03 world observability; I04 Local BOT playability; I05 save/resume; I06 seed determinism; I07 performance; I08 accessibility; I09 localization; I10 public-build smoke.

## Starting Village visual-first delivery extension

### WP-101 — Starting Village visual inventory and style lock
I01 asset inventory; I02 placeholder/debug-art inventory; I03 visual palette/material rules; I04 tile/character/building scale rules; I05 isometric silhouette/readability rules; I06 day/night legibility; I07 asset naming/source registry; I08 missing-asset fallback policy; I09 reference scene captures; I10 independent visual-spec verification.

### WP-102 — Starting Village ground, terrain and vegetation visuals
I01 grass ground family; I02 soil/mud family; I03 farm/field ground family; I04 water surface; I05 shoreline/bank transitions; I06 tree family; I07 bush/low vegetation family; I08 rock/ground-prop family; I09 terrain transition atlas integration; I10 in-game zoom/motion visual test.

### WP-103 — Starting Village roads and paths visual set
I01 one-tile path straights; I02 path turns; I03 T/cross intersections; I04 two-tile main-road visuals; I05 building-entrance connectors; I06 bridge/crossing visuals; I07 road-edge/terrain transitions; I08 zoom-stable road composition; I09 semantic atlas integration; I10 full-village route visual test.

### WP-104 — Starting Village building visual set
I01 starter-home visual set; I02 inn/tavern visual set; I03 market/shop visual set; I04 smithy/workshop visual set; I05 bakery visual set; I06 mill visual set; I07 village-hall visual set; I08 farm/outbuilding visual set; I09 interior/cutaway visual set; I10 character/room/road/entrance scale-consistency test.

### WP-105 — Protagonist visual model and movement presentation
I01 base protagonist silhouette/model; I02 directional facing set; I03 idle presentation; I04 directional walk cycle; I05 starter-clothing/profession presentation; I06 selection/focus presentation; I07 shadow/ground-contact presentation; I08 logical-tile scale consistency; I09 low/high-zoom readability; I10 movement/camera regression test.

### WP-106 — Starting Village NPC visual roster
I01 farmer/resident variants; I02 innkeeper/lodging variants; I03 butcher/produce-seller variants; I04 woodcutter/charcoal-burner variants; I05 smith/craftsperson variants; I06 baker/miller variants; I07 guard variants; I08 merchant/traveler variants; I09 generic resident/laborer variants; I10 profession readability and scale test.

### WP-107 — NPC animation and visual continuity
I01 idle-state presentation; I02 directional walk cycles; I03 tile-to-tile interpolation presentation; I04 route-turn continuity; I05 camera/zoom continuity; I06 relevance promotion/demotion continuity; I07 occlusion/roof/cutaway continuity; I08 animation-state carry across render refresh; I09 bounded performance under visible NPC load; I10 motion-sequence regression test.

### WP-108 — Responsive game-area layout matrix
I01 desktop landscape; I02 desktop narrow-window; I03 tablet landscape; I04 tablet portrait; I05 phone landscape; I06 phone portrait; I07 safe-area and browser-chrome handling; I08 resize/orientation state preservation; I09 touch-target/readability baseline; I10 cross-device visual regression.

### WP-109 — Phone portrait Game Area / Control Panel switching
I01 define Game Area primary surface; I02 define Control Panel primary surface; I03 keep inactive major surface fully off-screen; I04 Down control from Game Area to Control Panel; I05 Up control from Control Panel to Game Area; I06 preserve game/control state across switches; I07 prevent accidental dual-surface overlap; I08 touch/keyboard/focus accessibility; I09 preserve selected surface across safe resize/orientation flow; I10 phone-portrait interaction regression.

### WP-110 — Gameplay HUD declutter and viewport budget
I01 inventory persistent overlays; I02 remove/merge redundant persistent content; I03 collapse contextual-only panels when inactive; I04 define maximum non-game viewport occupation; I05 compact essential status presentation; I06 modal/dialog temporary-overlay behavior; I07 prevent debug/development UI from covering normal play; I08 touch-friendly open/close affordances; I09 keyboard/screen-reader accessibility; I10 desktop/tablet/phone viewport-coverage test.

### WP-111 — Render continuity during active motion
I01 stable presentation key per visible entity; I02 retain valid entity presentation during interpolation; I03 culling hysteresis at viewport edges; I04 relevance-transition presentation retention; I05 camera-pan continuity; I06 zoom continuity; I07 responsive resize/orientation continuity; I08 chunk/layer seam continuity; I09 frame-pressure/drop stress behavior; I10 no-flicker/no-disappearance motion regression.

### WP-112 — Starting Village visual-slice release gate
I01 no unresolved placeholder/debug visuals in normal Starting Village play; I02 terrain/roads/buildings visual-completeness check; I03 protagonist/NPC roster and animation completeness; I04 desktop gameplay-area certification; I05 tablet landscape/portrait certification; I06 phone-landscape certification; I07 phone-portrait Game/Control switching certification; I08 active-motion NPC/world continuity certification; I09 accessibility/performance sanity gate; I10 public-build visual certification with recorded evidence.

## Roadmap governance

- README remains product truth and is never changed from roadmap maintenance without explicit Admin authorization.
- `.github/ISSUE_STANDARD.md` controls atomic issue structure, readiness, role routing, dependencies, claims, status, and lifecycle; ROADMAP records do not become READY merely by existing here.
- The Starting Village visual-first section is the current Admin execution priority; it changes task selection order, not authority boundaries or existing issue lifecycle rules.
- Keep the active issue set focused and executable; do not create broad staging queues or a separate Planning buffer.
- Prefer one-cycle atomic records with independently verifiable outcomes; split oversized scope before production claim.
- Simulation owns legality, state, resources, position, outcomes, and world truth. UI, renderer, assets, LLM, Local BOT, and tests never authoritatively mutate world state outside Simulation contracts.
- Every repository change carries actual English audit evidence, and production output receives independent Tester verification where applicable before final release.