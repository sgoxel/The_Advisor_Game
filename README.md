<div align="center">

# 🏰 The Advisor Game

### 🧠 Advise an autonomous AI character. Shape a life. Change a kingdom. Maybe build an empire.

**The Advisor Game is a medieval-fantasy roleplaying and strategy game where the player advises an autonomous AI-controlled protagonist who can rise from Peasant to Emperor.**

### 🎮 [Play the Current Public Development Build](https://sgoxel.github.io/The_Advisor_Game/)

[🏷️ Latest GitHub Release](https://github.com/sgoxel/The_Advisor_Game/releases/latest) · [🌐 Public Game](https://sgoxel.github.io/The_Advisor_Game/)

</div>

> [!IMPORTANT]
> **Core rule:** the player advises; the autonomous character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

---

# 🎭 Game Concept

You are not directly controlling the hero. **You are the mind advising the hero.**

The protagonist is an autonomous person living in the same world as everyone else. The player is their **Advisor**: observing, investigating, conversing, warning, persuading, explaining, recommending goals and strategies, and helping the character reason. Advice may be accepted, modified, delayed, misunderstood, rejected, remembered, or reconsidered later.

The central challenge is learning how to influence someone who has their own personality, ambitions, fears, knowledge, relationships, memories, authority, needs, and trust in you.

The protagonist may rise through:

<div align="center">

### 🌾 Peasant → 🏡 Villager → 🛡️ Squire → ⚔️ Knight → 🏰 Baron → 👑 Duke → 🦁 Lord → 💎 Prince → 👑 King → 🌍 Emperor

</div>

Rank changes the scale of legitimate action and responsibility. A Peasant deals mainly with survival, work, family, shelter and local relationships. Knights enter military and political life. Nobles gain estates, settlements and broader authority. Kings and Emperors may eventually influence laws, diplomacy, war, succession and multiple realms. **Influence grows, but the AI character remains the actor.**

## Core Gameplay Loop

**Observe → Investigate → Use Advisor tools → Discuss → Advise → Character evaluates → Character decides → Simulation validates → World reacts → Adapt**

The player can:

- converse naturally with the protagonist;
- investigate people, places, rumors, reports, events, objects and opportunities;
- advise, warn, explain, negotiate, challenge assumptions and recommend priorities;
- encourage or discourage goals, relationships, travel, jobs, purchases, investigations and strategies;
- use Advisor tools and mini-games to improve information, persuasion, leverage, discoveries, reputation or opportunities;
- remind the character of promises, previous decisions and relevant history;
- create longer-term behavioral guidance where the game permits it.

The player does **not** directly possess or command the protagonist, arbitrary NPCs, armies, laws, or world truth. Commands such as “go there”, “attack”, “arrest”, “build” or “declare war” are not automatically binding. Legitimate authority belongs to characters who actually possess it.

Mini-games and Advisor tools may affect information, confidence, persuasion, relationships, opportunities or probability modifiers, but must not eliminate character autonomy. Accessible alternatives or auto-resolution should exist where appropriate.

## Advice Must Reach the World

Advice is meaningful only if it can influence observable behavior.

For example, **“Go to the tavern and ask the innkeeper about work.”** does not directly move the protagonist. The protagonist evaluates the suggestion using personality, goals, knowledge, memory, trust, needs, relationships, authority and current circumstances. If they choose the action and the Simulation considers it valid, the living world should show the resulting movement, arrival, interaction and consequences.

**Advice → Character decision → Simulation validation → World movement/action → Interaction → Consequence → Player observes the result**

## Advisor Progression

Advisor capabilities may grow through areas such as **Insight, Rhetoric, Diplomacy, Stewardship, Command, and Intrigue**. Progression may unlock stronger investigation, analysis, reports, memory tools, private conversations, historical context, predictions, mini-games and more sophisticated persistent advice.

These systems improve **influence and understanding**, not direct ownership of the character or world.

---

# 🤖 Character AI and Advisor Relationship

## One Character, Compatible Drivers

The same protagonist may be driven by:

1. **LLM Character Driver** — richer dialogue, interpretation, reasoning, personality expression and memory use.
2. **Deterministic Local BOT Driver** — a complete local fallback when an external model is unavailable, unsuitable, malformed, blocked, over quota or disabled.

These are not separate protagonists or separate game modes. They drive the **same character** and consume the same Simulation-backed identity and state. The game must remain playable without an external AI provider.

Character AI must:

- roleplay the protagonist rather than the player;
- reason from the character's personality, knowledge, memory, relationships, goals and circumstances;
- treat the human as an Advisor, not an unrestricted commander;
- consider advice without being forced to obey it;
- respect Simulation-defined possibilities and limitations;
- never invent authoritative resources, status, possessions, people, locations, completed actions or world facts;
- never directly mutate authoritative world state.

The **Simulation is the authority** for what is legal, possible, resolved and true.

External AI should receive only the context needed for the current task and must never require storing player credentials inside campaign data.

## Natural Conversation and Persistent Advice

Normal dialogue may include questions, warnings, negotiation, encouragement, criticism, strategy, moral arguments, reminders, requests for information and long-term planning.

Conversation may influence beliefs, intentions, trust, memory, priorities and future choices, but dialogue alone does not rewrite authoritative world state.

The game also supports persistent behavioral advice for longer-term goals, priorities, conditions, exceptions, diplomacy preferences, safety rules or strategic principles. The authoritative system boundary for these **Advisor Instructions is structured, human-readable plain text**. A graphical editor may help author them, but the visual representation is not itself authoritative.

Persistent advice may influence behavior but may never create resources, manufacture authority, bypass requirements, force impossible actions or alter Simulation truth.

---

# 🧠 Character Identity, Memory and Emotion

The protagonist and procedurally generated world characters have stable, deterministic base identities. Compatible character-generation inputs—campaign SEED, stable character/world identity inputs and birthplace—must reproduce the same unchanged person when that character is materialized again.

Base identity may include:

- name and gender;
- birth date and birthplace;
- baseline personality and behavioral tendencies;
- original/base profession or social role where applicable.

Travel must not replace identity. A known character remains the same person across settlements, regions and realms.

**Current age is derived from birth date and authoritative fantasy campaign time.** Life stage may affect physical capability, recovery, risk tolerance, patience, priorities or emotional dynamics, but must not erase established personality or reduce people to age stereotypes.

Birthplace and formative environment may create enduring tendencies based on culture, geography, danger, economy and social conditions. Current location and circumstances create **contextual effects**, not a replacement personality.

Characters may have dynamic mood and emotional state influenced by events, needs, hunger, injury, safety, work, relationships, memories, conflict, loss, success, age and location. Emotion may affect risk preference, dialogue tone, social behavior, advice interpretation, memory salience and later choices, but **emotion is never an authority layer**: it cannot legalize impossible actions, fabricate facts, bypass resources or override the Simulation.

Characters may remember promises, betrayals, victories, failures, important advice, disagreements, loyalty, generosity, humiliation, debts, fears, unresolved goals and political events. Relationships may include trust, friendship, affection, fear, rivalry, loyalty, resentment, respect, suspicion and obligation. Advisor Trust affects influence but never becomes mind control.

Unchanged deterministic foundations may be regenerated rather than redundantly saved. Persistence should preserve meaningful departures and history such as profession/residence changes, migration, relationships, memories, injuries/status and important emotional consequences.

Distant or irrelevant characters do not require continuous full-detail emotional or routine simulation. Their compact state and meaningful history may be reconciled lazily when they become relevant.

---

# 🌍 Living World

## Starting Village

Every new campaign begins at world coordinate **(0, 0)** with the protagonist as an ordinary low-rank character in a **SEED-generated inhabited village**.

If the player does not provide a SEED, the game generates one. Compatible SEED + coordinates + compatible generation rules reproduce the same unchanged base settlement and surrounding world.

The starting village occupies the canonical **100 × 100 logical-tile origin region** and should use that area meaningfully rather than compressing everything into a tiny central cluster. Homes, workplaces, services, roads, paths, farms, gathering areas, landmarks and NPC activity should follow terrain, settlement purpose and local relationships.

A representative ordinary starter-village home occupies **at least 10 × 10 logical tiles** and contains **at least two logical rooms**. Other buildings may use larger or otherwise suitable footprints.

The player must begin in a visibly inhabited medieval-fantasy environment, not an empty map, isolated character screen or abstract dashboard.

## Enterable Buildings

Accessible local buildings are physical parts of the same authoritative world, not menu shortcuts, exterior-only markers or disconnected duplicate scenes.

Where relevant, a building may materialize walls and walkable floors; usable entrances and doors; logical rooms; and beds, counters, tables, storage, workstations or other function-appropriate anchors.

Walls and solid obstacles constrain movement. Entrances connect exterior and interior walkable space. Character, room, door, furniture and building scale must remain mutually plausible.

Entering or leaving a building preserves the **same building, occupants, location, history and campaign state**. Interior detail may be streamed, layered, cached or lazily materialized, but it refines the same authoritative place.

Roofs, ceilings or upper walls may hide, cut away, fade or become translucent so occupied interiors remain readable.

## Autonomous Local Population

The village and wider world contain numerous autonomous characters who visibly move, work, idle, travel, socialize and interact when relevant.

Local roles may include butcher, produce seller, woodcutter, charcoal burner, tavern keeper, lodging owner, shop/market owner, farmer, craftsperson, guard, traveler, laborer and other settlement-appropriate professions.

These characters are not decorative crowd sprites. They are Simulation-backed participants with identity, location, occupation, relationships, needs and potential interactions.

Persistent residents normally have a valid home. Explicitly transient visitors such as traveling merchants or caravans may enter, work or trade and later leave without receiving an invented residence.

Working characters use profession-compatible workplaces or outdoor worksites. Multiple compatible NPCs may share a workplace. Farmers may use fields, hunters wilderness areas, fishers reachable banks or coasts, and similar outdoor professions should use terrain-appropriate reachable locations rather than fake buildings.

NPC travel should respect authoritative terrain walkability, road/path preference, building entrances and collision-safe occupancy.

Security may include guards at meaningful entrance/exit routes. Guard duty may rotate through time-aware shifts using valid home, barracks or guard-post relationships without blocking the settlement's only legal route.

Active NPC logical-tile occupancy is exclusive: **two NPCs must not occupy the same authoritative tile at the same movement state**. Conflicts should resolve deterministically through waiting, yielding, neighboring tiles or another valid route.

Two NPCs in direct local dialogue occupy **adjacent tiles**, not the same tile.

During development, visible NPCs may show compact activity bubbles. A directly conversing pair should use one shared conversation/status bubble. These are presentation/debug aids only.

NPCs may exchange simple deterministic or Local-BOT ambient dialogue based on profession, settlement, location, environment, time and local events. Dialogue becomes authoritative only when the Simulation records a resulting fact, relationship or consequence.

## Animals, Creatures and Ecology

The world includes domestic animals, wildlife and a broad original medieval-fantasy bestiary.

Presence and behavior should reflect SEED-defined habitat, terrain, biome, settlement type, danger and campaign state. Animals and creatures may idle, forage, flee, travel, gather, guard territory, threaten or interact where appropriate. Gameplay-relevant identity/state belongs to the Simulation.

---

# 🗺️ World Scale, Settlements and History

The world supports varied settlement archetypes rather than repeating one generic village: rural, farming, forest, mining/production, roadside/trade, frontier, border, fortified, abandoned/ruined, towns, market towns, large cities, castles, capitals and other context-appropriate forms.

Settlement appearance, population, buildings, professions, roads, resources, defenses, prosperity, hazards and surrounding environment should reflect geography, history and campaign state.

One normal local/thematic region is exactly **100 × 100 logical tiles**. The overall world remains continuous and unbounded. Large settlements are not forced into one region; a large city may form one coherent settlement across a **2 × 2 group of four neighboring 100 × 100 regions**.

Settlements are historical entities, not frozen templates. Population, prosperity, security, trade, resources, hazards, construction, destruction, war and other authoritative pressures may cause them to grow, decline, fortify, change function, lose structures, become abandoned or ruined, recover, rebuild or be repopulated.

Growth from village to town or city is possible but never mandatory. Decline is equally valid.

When a settlement becomes relevant, its materialized state must reflect accumulated campaign history rather than silently reverting to its initial SEED template.

As the protagonist rises in authority, play expands naturally from local village life toward towns, cities, regions, kingdoms and multiple realms without replacing the living world with menu-only gameplay.

## Economy, Factions, Diplomacy and War

As responsibility expands, the game may include resources, population, prosperity, stability, legitimacy, production, trade, buildings, settlement development and military readiness.

Factions have leaders, needs, memories, relationships, territory, incomplete knowledge and political objectives. Treaties, alliances, trade, dependency, insults, marriages, betrayals, debts, succession disputes, religious disputes and historical conflicts may affect relations.

Military play is strategic rather than direct player unit control. Relevant systems may include recruitment, commanders, supplies, terrain, morale, training, formations, objectives, defense, raids, sieges, retreats, diplomacy and consequences of war. Characters with legitimate authority issue orders; the Simulation resolves outcomes.

Events may include local disputes, crimes, shortages, illness, banditry, family conflict, romance, tournaments, recruitment, intrigue, assassination, invasion, rebellion, succession, diplomacy, economic crises, supernatural discoveries and other opportunities or crises. Events should create situations to understand and influence rather than one obvious correct answer; failure should often create new stories and recovery paths instead of immediate game-over.

---

# 🌱 SEED, Coordinates and Persistence

The world is procedurally generated from a player-visible **SEED** and has **no gameplay-defined outer boundary**.

The currently displayed map is only a local active part of one continuous world. Reaching a region edge must allow travel into neighboring coordinates rather than ending exploration.

Compatible **SEED + world coordinates + compatible generation rules** reproduce the same unmodified base world at the same location.

Procedural generation may define terrain, elevation, biomes, water and vegetation; roads, paths and bridges; thematic regions; settlement archetypes and layouts; buildings, landmarks and important locations; local population and home/work relationships; ecology/habitat foundations; and base political geography.

Generated regions are parts of one world, not independent random maps. Neighboring terrain, roads, water, settlements and other features must remain spatially coherent.

## Political Geography

Where applicable, the SEED also defines coherent base political geography such as realms/countries, regions/provinces, territorial relationships, borders, settlement affiliation and major political centers.

Political geography should relate plausibly to terrain, mountains, rivers, coasts, routes, settlements and strategic locations rather than being disconnected random labels.

The SEED defines the **base** political world, not an immutable map. Campaign history may change territorial control, borders, ownership, capitals, relationships or realm composition.

Regional, realm and wider-world views must present this same evolving authoritative geography.

## Persistent Change over a Regenerable Base

Deterministic unchanged terrain, buildings, vegetation, political geography and character foundations may be reconstructed when needed. Meaningful campaign changes must persist.

Persistent changes may include discoveries, damage, construction, ownership, territorial control, settlement development, resource use, relationships, inventory-affecting interactions, injuries/status and other authoritative consequences.

Returning to known coordinates reconstructs the current campaign world from deterministic base state plus time, off-screen/hierarchical progression and persistent history:

**SEED-generated base world + authoritative campaign time + accumulated hierarchical/off-screen progression + persistent changes = current campaign world**

Location remains gameplay-relevant to travel, meetings, information, trade, work, politics, war, events, hazards, routines and ecology.

---

# ⏱️ Time and World Simulation

The campaign is **real-time, not turn-based**.

At normal game speed:

- **60 real-world minutes = one 24-hour in-game day**
- **1 in-game hour = 2.5 real-world minutes**

The game clock is authoritative Simulation state.

Day/night presentation follows game time:

- **05:00 — dawn/daylight begins**
- **22:00 — darkness/night begins**

Physically accurate moving shadows are not required; performance-friendly lighting or overlays are acceptable when day/night state remains clear.

## Fantasy Calendar and Resume

A new campaign's fantasy date/time derives from the accepted real-world creation time:

- day, month and time-of-day match;
- **fantasy year = real-world year − 2000**.

Example: `28.08.2026 14:30` → `28.08.0026 14:30`.

After creation, fantasy chronology becomes its own accelerated authoritative timeline. It must not be reset to the current civil calendar on each launch.

Elapsed real-world time while the game is closed advances campaign time at the same normal-speed ratio: **one real-world hour advances one in-game day**. Resume catch-up must update relevant authoritative state efficiently rather than replaying every missed minute, NPC routine or visual day/night cycle.

A backward or otherwise invalid real-world clock change must not silently rewind established campaign chronology.

## Active, Off-Screen and Hierarchical Simulation

The active local world uses detailed real-time simulation appropriate to visible gameplay.

Off-screen regions do not freeze permanently, but they also do not require full-detail entity ticking. They may use lower-cost aggregate progression, elapsed-time advancement or deterministic approximation.

The same authoritative world may be represented at different detail levels:

**global/world → realm/country → region → settlement → local active world**

Higher-level state may track population trends, prosperity, food/resources, security, trade, military pressure, diplomacy, unrest, migration, hazards, settlement development, territorial control and other meaningful balances.

**Simulation fidelity is not Simulation authority.** Compact distant state and detailed local state are representations of the same causal history.

When detail becomes relevant, it is materialized from compatible SEED base data, coordinates, campaign time, higher-level outcomes, persistent changes, neighboring continuity and local rules.

Invisible-world cost must scale primarily with **relevance**, not total world size. Long elapsed periods should normally be reconciled through bounded aggregate/end-state consequences rather than replaying every local micro-action.

Expensive generation, catch-up and materialization should be asynchronous where practical, but scheduling order, device speed, visit order or render order must never change authoritative results. Stale asynchronous results must not overwrite newer state.

---

# 🎨 World Presentation and Art Direction

## Primary Game Surface

The primary playable surface is a persistent **living strategic world map**, not a collection of disconnected menus, cards, dashboards, text screens or static mockups.

Local play uses a readable **WebGL-based, primarily tile-oriented 2D/2.5D RPG presentation** with top-down, shallow-isometric or near-isometric composition. Selective real-time 3D is allowed when coherent, but a fully 3D local world is not required.

The map should visibly represent relevant terrain, elevation, biomes, water, forests, roads, settlements, buildings, interiors, rooms, doors, props, ruins, caves/dungeons, landmarks, resources, people, animals, creatures, groups, caravans, armies and environmental effects such as weather, lighting, fire, smoke, fog and water.

The map is not decorative background art. Visible locations, movement and world changes correspond to Simulation state.

As political scale increases, regional, realm/country and wider-world strategic views summarize the **same authoritative world**, rather than becoming disconnected substitute dashboards.

## Visual Language

Character-focused art follows an **original seinen-anime-inspired** language: mature, grounded, expressive, believable proportions, readable age/status/profession/culture and plausible medieval-fantasy materials.

The local world evokes a **classic old-school tile-based PC RPG** with modern usability: readable floors and terrain, clear rooms/walls/doors, compact sprites, interior props, coherent roads/vegetation, restrained effects and strong atmosphere.

The approved visual reference is a **composition/readability guide only**, never an asset source. Protected artwork, layouts, logos, characters, sprites, textures or identifiable game content must not be copied.

Terrain, buildings, interiors, props, vegetation, creatures and characters should converge toward one original stylization family. Photorealistic terrain with unrelated sprite overlays is not the intended final language.

## Character PNG Identity

At the current development stage, static PNG assets are a valid primary character presentation. Animation is optional and must not block playable progress.

Gameplay-relevant characters should preserve one recognizable visual identity across:

1. **Full-body character PNG** for dialogue, inspection and close presentation.
2. **World-space transparent PNG sprite** positioned at the character's authoritative location/tile.

World sprites are not detached pins, permanent rectangles or unrelated generic avatars. Simplification is allowed for tile readability, but identity should remain recognizable through silhouette, clothing, equipment, palette, hair and role/status cues.

Direct two-character dialogue should show relevant full-body character art where responsive layout permits.

Visual variants may reflect Simulation-backed rank, profession, culture/faction, equipment, region and circumstances, but must not invent authoritative facts.

## Canonical Tile Atlas

Reusable tile-based visual families use a canonical **transparent 1024 × 1024 PNG atlas**, fixed **4 × 4 grid**, with sixteen **256 × 256 cells**.

If fewer variants are needed, unused cells remain fully transparent. Occupied cells must support deterministic export to individual **256 × 256 PNG tiles** with stable semantic family/type identity.

The contract applies to reusable tile families such as roads, paths, terrain/transitions, building parts, walls, floors, interiors, furniture and props; unrelated assets such as full-body character art are not required to use it.

Transparent reusable overlays may reveal underlying authoritative terrain. Larger objects may use multi-tile authoritative footprints, and moving or behavior-rich objects may materialize as world-space entities.

**Pixels never define gameplay truth.** Collision, blocking, walkability, interaction, ownership, movement, inventory/state and damage remain Simulation-backed.

## Responsive and Accessible

Desktop, tablet and phone are first-class gameplay targets in portrait and landscape where applicable.

Core play, navigation, input, save/load, Simulation continuity and required information must remain practical on representative current devices.

Interaction should support touch, mouse and keyboard where applicable. Important information must not depend only on color, hover, tiny targets or precision input.

Visual fidelity may scale by device—detail, render scale, effects or density may change—but this must never change Simulation outcomes, AI knowledge, legal actions, game time, campaign history or deterministic reconstruction.

---

# 🌐 Public Development Build

The evolving game remains publicly accessible at:

### https://sgoxel.github.io/The_Advisor_Game/

The public location represents the **current Admin-authorized public development build**.

Development should normally be cumulative: accepted work extends the current product instead of replacing it with disconnected prototypes.

Under normal autonomous development, public replacement should follow independent testing and the verified release process. The latest GitHub Release should represent the latest verified release.

The Admin may explicitly order a specified repository state, commit, imported template or development build to be published directly. In that case, Admin authorization is sufficient publication authority and no unrequested verification gate may block the publication.

An Admin-directed unverified build must be labeled accurately as an **Admin-directed public development build**, not falsely described as independently verified. Testing, rollback, tagging or promotion to a verified release may occur later.

Build, packaging, deployment and versioning mechanics are development implementation details rather than README product policy.

---

# 🏛️ Project Authority and Development Governance

This section exists for contributors and autonomous Workers. It is intentionally placed after the game concept and product rules because README is first a public description of **what The Advisor Game is**.

## Authority

The **Admin is the highest project authority**.

Authority order:

**Admin explicit instruction → README.md → ROADMAP → TODO → Issues → Code / Assets → Tests**

README defines persistent product scope, principles, invariants and high-level governance: **WHAT the project is and what should normally remain true**.

README does not prescribe implementation architecture, repository/module layout, implementation order, roadmap phases, detailed task decomposition, asset pipeline internals, branching strategy, commands, automation storage or detailed deployment/testing mechanics unless a specific item is itself a product invariant.

If subordinate state conflicts with README and no Admin instruction authorizes the difference, README wins and subordinate state must be corrected. An explicit Admin instruction may override README, authorize an exception or require immediate publication/execution. Persistent policy changes should later be reflected in README where practical.

**README may be modified only with explicit Admin authorization.**

## Worker Model

The project normally has five scheduled persistent Worker identities:

**Worker #1, #2, #3, #4, #5**

**Workers #6 through #20 are manual-only Admin-invoked persistent identities.** They have no schedule, timer, recurrence or recurring cursor slot.

No Worker has a permanent role. Roles rotate through:

**Planner → Coder → Designer → Tester → Reviewer → Planner → ...**

For scheduled Workers, the rotation cursor defines only the **starting role**. It never creates ownership of a run, cycle, backlog, role or future work. Manual Workers do not consume or modify the scheduled cursor.

Worker runs are work-conserving: starting from the applicable role, a Worker should continue through eligible work and roles rather than stopping after one task. **Before unrelated work, a persistent Worker must reconcile its own unfinished claim history and resume any open issue for which that same Worker still has a safe authorized action.** An executable owned issue outranks the rotation cursor, capacity expansion, a new issue, an easier issue, or a preferred role. A Worker may move to unrelated work only when every unfinished owned issue is in a genuine evidenced mandatory wait with no safe owner action remaining.

A mandatory wait must not become an indefinite lock. When the remaining action requires nonterminal external/CI evidence, an independent Worker, an unsatisfied hard prerequisite controlled elsewhere, or unavailable required Admin/external input, the owner records the blocker and resume trigger, clears exclusive ownership, and retains non-exclusive continuity responsibility. If correction work later becomes executable again, the responsible Worker resumes it ahead of unrelated work. Difficulty, size, investigation cost, or context pressure are not mandatory-wait reasons.

Ownership protection is **target-scoped and time-bounded**. A valid exclusive `WORK-CLAIM` protects only the named issue/task. Claiming issue A creates no ownership over issue B, related tasks, dependencies, a phase, a role, the cursor or the project. An exclusive claim becomes **stale and invalid after more than three hours without a qualifying action by that same Worker on that exact issue**. Claim creation starts the three-hour window. A qualifying action must show concrete target progress or a material target-state decision/evidence update; empty heartbeats, repeated status-only comments, unrelated work, or re-fetch-only activity do not refresh the window. Before treating a claim as a collision blocker or taking over a stale claim, Workers must inspect the exact issue history and timestamps. Stale invalidation removes collision protection but does not erase authorship, independence restrictions, audit history, or any non-exclusive responsibility to resume if the issue has not already been validly taken over/completed.

Multiple Workers may overlap in time on non-conflicting eligible targets. A Worker encountering an expired claim records the stale-claim evidence before takeover and then uses the normal exact-target claim/re-fetch safety check.

## Roles

### Planner

Owns project planning below Admin and README: phases/order, dependencies, architecture/organization, decomposition, task scope and acceptance criteria, role routing and normal release prerequisites. Planner owns `ROADMAP.json` and active `TODO.json`, keeps exactly one active phase, reconciles README changes before other planning, and keeps current/earlier work prioritized.

Planner should maintain a deep but legitimate work inventory and a meaningful pool of immediately executable current/earlier work when approved scope permits. Future/dependency-blocked work does not count as immediately executable capacity. Planner should favor genuine independent Coder, Designer, integration, regression, verification and supporting outcomes, avoid unnecessary serialization, and never create filler, duplicates, speculative/invented gameplay, fake dependencies or artificial micro-tasks merely to increase counts.

Planner does not normally implement product code/visual production or approve releases.

### Coder

Implements approved runtime/application code, configuration, integration and implementation-focused tests. Coder may choose technical implementation inside approved scope but does not redefine Planner-owned scope, acceptance criteria, dependencies or phase order, and does not independently verify its own implementation.

### Designer

Owns approved UI/UX and visual production: 2D/2.5D/3D assets, portraits, sprites, textures, environments, buildings, props, maps/world presentation, WebGL visual work, readability, responsiveness, accessibility and visual performance.

Designer chooses appropriate production tools and formats while preserving README-defined visual invariants such as the canonical tile-atlas contract. Gameplay and authoritative Simulation logic remain Coder responsibility unless an approved task explicitly includes technical visual integration.

Designer does not redefine planning or approve releases.

### Tester

Verifies exact committed state, including functionality, visual work, integration, regression, usability, performance, accessibility, public behavior, revisions and release candidates.

Under normal autonomous development, only an **independent Worker acting as Tester** may call implementation/design work independently verified or approve a phase/release. A Worker must not independently PASS its own earlier implementation, design, revision, bug fix, workflow fix or process change.

### Reviewer

Owns development-process health: defect analysis, bottleneck detection, CI/automation/reliability problems, stale state, missing checks, recurring failures and process improvement.

When evidence supports it, Reviewer may create/fix focused workflow, configuration, tooling, process or code defects without inventing product scope or overriding Planner authority. Reviewer-produced changes require a different Worker acting as Tester before being independently verified.

Reviewer is not phase/release approval authority.

## Revisions and Independence

Implementation/design discoveries that require scope, acceptance criteria, dependency, TODO or phase changes return to Planner through the project revision process.

Tester defects return to the responsible role for correction and later independent retest.

All changes and revision decisions remain traceable in GitHub.

### Tester Deadlock Exception

A cumulative phase/release gate may use `DEADLOCK TESTER PASS` only when:

- the gate is otherwise ready;
- required implementation/design/revision work is complete;
- no unresolved valid revision, target claim conflict or higher-authority blocker remains;
- every authorized Tester identity is disqualified solely by accepted authorship inside that cumulative gate.

The first Worker whose authorized execution reaches the gate may then perform the **full exact-state verification**, disclose its own included authorship and issue `DEADLOCK TESTER PASS`.

This PASS may advance the phase/release but **must not be described as independent verification of that Worker's own included work**. If a genuinely independent Tester becomes available before the gate is claimed, normal independent verification takes priority.

Explicit Admin authority may bypass normal Worker/testing/publication gates, but an Admin-authorized unverified state remains unverified unless it later receives valid verification.

---

# ✅ Summary of Non-Negotiable Product Truth

- **Player advises → AI Character decides → Simulation validates → World reacts.**
- The protagonist remains autonomous; influence replaces direct control.
- LLM and Local BOT are compatible drivers for the same character, and the game works without external AI.
- Simulation owns authoritative world state.
- The primary surface is one living, spatially coherent world.
- Campaigns begin in an inhabited SEED-generated village at **(0, 0)**.
- The world is deterministic, continuous and unbounded; one canonical region is **100 × 100 logical tiles**.
- Settlements, characters, politics and ecology evolve through authoritative campaign history.
- Time is real-time and persistent; at normal speed **one real-world hour = one in-game day**.
- Off-screen simulation is hierarchical, relevance-bounded and lazily materialized.
- Local presentation is WebGL-based tile-oriented 2D/2.5D with original seinen-inspired character art and classic RPG world readability.
- Gameplay-relevant characters converge on matching full-body PNG + world-space PNG identity; animation is optional at the current stage.
- Accessible buildings belong to the same authoritative world and support readable interiors.
- Desktop, tablet and phone are first-class gameplay targets.
- The public development build remains available at **https://sgoxel.github.io/The_Advisor_Game/**.
- Admin is the highest project authority; README is the highest persistent authority below Admin.
