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

The protagonist uses a **chatbot-assisted response architecture**. A lightweight deterministic chatbot layer handles well-known words, phrases, sentence patterns and common commands first; an external LLM may then be used for richer conversation, ambiguity resolution and reasoning when needed. A deterministic local fallback remains available when an external model is unavailable or disabled. These paths are not separate protagonists or separate game modes: they represent the **same persistent character** in the same world.

The character should:

- act from their own personality, knowledge, memory, relationships, goals and circumstances;
- treat the human as an Advisor, not an unrestricted commander;
- consider advice without being forced to obey it;
- respect what is possible in the world;
- never invent authoritative resources, status, possessions, people, locations, completed actions or world facts.

The **Simulation is the authority** for what is legal, possible, resolved and true.

## Natural Conversation and Persistent Advice

Normal dialogue may include questions, warnings, negotiation, encouragement, criticism, strategy, moral arguments, reminders, requests for information and long-term planning.

Conversation may influence beliefs, intentions, trust, memory, priorities and future choices, but dialogue alone does not rewrite authoritative world state.

The game also supports persistent behavioral advice for longer-term goals, priorities, conditions, exceptions, diplomacy preferences, safety rules or strategic principles.

Persistent advice may influence behavior but may never create resources, manufacture authority, bypass requirements, force impossible actions or alter Simulation truth.

## Chatbot-Assisted LLM Response System

The conversation system is intentionally **hybrid**. The game should not send every player message directly to an LLM. Simple, well-known and high-confidence inputs should be interpreted locally first so common interactions remain fast, predictable, inexpensive and usable without an external AI provider.

The response pipeline is:

**Player message → Normalize input → Known-word/phrase detection → Sentence Library match → Intent/command candidate → LLM only when needed → Character decision → Simulation validation → Response/action**

### Known Words, Phrases and Sentence Library

The chatbot maintains a versioned **Sentence Library** containing common player expressions and their recognized meanings. It may contain:

- exact sentences and normalized sentence forms;
- known keywords and multi-word phrases;
- synonyms and alternative wording;
- controlled patterns for variable parts such as a person, place, object, topic or amount;
- an intent identifier;
- optional response templates;
- optional command candidates;
- priority, confidence and ambiguity rules.

Examples include greetings, status questions, requests for information, travel suggestions, interaction requests, warnings, reminders, schedule questions, inventory-related questions and other common Advisor inputs.

Matching should be deterministic for the same library version and normalized input. Exact and high-confidence matches take priority over broader patterns. Ambiguous or conflicting matches must not silently choose an unsafe interpretation; they may be clarified locally or forwarded to the LLM with the recognized candidates as context.

The Sentence Library is an **interpretation and routing layer**, not gameplay authority. A recognized phrase such as “go to the market” may identify a travel/advice intent, but it does not move a character by itself.

### LLM Command Set Interface

When an LLM is used, it receives a bounded **Command Set Interface** describing only the game-facing commands currently available to the conversation/decision system. The LLM may select or propose commands from this interface; it must never call arbitrary game code or directly mutate authoritative state.

Each exposed command should define:

- a stable command or intent ID;
- a short purpose;
- required and optional parameters;
- valid actor and target types;
- required context or preconditions;
- whether it is a query, advice proposal, interaction proposal or other supported operation;
- validation rules and expected structured result.

The available command set may be filtered by current context. For example, commands involving a nearby person, known location, owned item, valid route or legitimate political authority should only expose identifiers that actually exist in authoritative Simulation state.

The LLM response may contain normal conversational text plus **zero or more structured command proposals**. Free-form text is never treated as an executed action.

### Command Execution Boundary

Every proposed command passes through the character and Simulation layers:

**Chatbot/LLM interprets → Command proposal → Character evaluates → Simulation validates → Command executes or is rejected → Result returns to conversation**

This preserves the central game rule: **the Advisor can influence decisions, but cannot bypass character autonomy or Simulation authority.**

The command interface must therefore never allow an LLM to:

- invent an authoritative character, item, location, resource, relationship, title or event;
- teleport or move an actor without a valid world action;
- grant money, inventory, ownership, rank or political authority;
- mark an action as successful before the Simulation resolves it;
- bypass collision, travel, schedule, permission, resource or other gameplay rules;
- execute arbitrary JavaScript or unrestricted internal functions.

### Response Routing Modes

The same conversation system can use several response paths without changing character identity:

1. **Local library response** — a high-confidence known input is answered or routed without an LLM call.
2. **Library-assisted LLM response** — the chatbot recognizes the likely intent and gives the LLM the relevant context and allowed command subset.
3. **LLM interpretation fallback** — unfamiliar or complex language is sent to the LLM with authoritative context and the bounded Command Set Interface.
4. **Deterministic offline fallback** — when no external LLM is available, local recognition, templates and deterministic character logic continue to provide functional gameplay.

This architecture should reduce unnecessary LLM usage while keeping natural conversation available for inputs that genuinely benefit from language-model reasoning.

### Authority and Persistence Rules

The chatbot and LLM may interpret language, generate dialogue, propose intents and help the character reason. They do **not** own world truth.

Authoritative facts come from Simulation state. Conversation history, recognized intent, LLM output and response templates may be stored as character memory or dialogue history where appropriate, but any resulting world change must be persisted only after successful Simulation validation.

If an LLM response conflicts with authoritative state, the authoritative state wins and the conversation layer should correct, reject or reformulate the response instead of changing the world to fit the generated text.

---

# 🧠 Character Identity, Memory and Emotion

The protagonist and procedurally generated world characters have stable identities. A known character remains the same person across settlements, regions and realms.

Base identity may include name and gender, birth date and birthplace, baseline personality and behavioral tendencies, and original profession or social role where applicable.

**Current age is derived from birth date and authoritative fantasy campaign time.** Life stage may affect physical capability, recovery, risk tolerance, patience, priorities or emotional dynamics, but must not erase established personality or reduce people to age stereotypes.

Birthplace and formative environment may create enduring tendencies based on culture, geography, danger, economy and social conditions. Current location and circumstances create contextual effects, not a replacement personality.

Characters may have dynamic mood and emotional state influenced by events, needs, hunger, injury, safety, work, relationships, memories, conflict, loss, success, age and location. Emotion may affect risk preference, dialogue tone, social behavior, advice interpretation, memory salience and later choices, but **emotion is never an authority layer**: it cannot legalize impossible actions, fabricate facts, bypass resources or override the Simulation.

Characters may remember promises, betrayals, victories, failures, important advice, disagreements, loyalty, generosity, humiliation, debts, fears, unresolved goals and political events. Relationships may include trust, friendship, affection, fear, rivalry, loyalty, resentment, respect, suspicion and obligation. Advisor Trust affects influence but never becomes mind control.

Meaningful personal history should persist, including profession or residence changes, migration, relationships, memories, injuries, status changes and important emotional consequences.

---

# 🌍 Living World

## Current Planet-First Rebuild Baseline

The active game build is intentionally at **world-construction Stage 1**. It shows only the canonical fantasy planet sphere so the world scale and planet-space foundation can be established before local terrain, settlements, characters or simulation detail are reintroduced.

The canonical fantasy planet uses **10% of Earth's linear scale**:
- reference Earth mean radius: **6,371 km**;
- fantasy world radius: **637.1 km**;
- fantasy world diameter: **1,274.2 km**;
- fantasy world circumference: **4,003.01736 km**.

The displayed PlayCanvas sphere is a visualization of that physical world, not a literal meter-per-engine-unit mesh. Physical measurements remain in meters/kilometers independently of renderer scale. The binding numeric, coordinate, handoff, precision, compatibility, performance and telemetry contracts are defined in [Stage S002 canonical planet architecture](PLANET_ARCHITECTURE.md). The legacy S001 `WORLD_SIZE = 262144 m` runtime remains transitional implementation data until the dedicated rescale WP and is not an alternative physical-world authority.

### Pure Zoom Interaction Rule

Zoom input changes **zoom only**. It must not rotate, tilt, orbit, translate, recenter or otherwise move the planet/sphere or change the viewing angle. The current geographic focus and screen-space focus remain fixed unless the player explicitly uses a separate movement/rotation control.

As zoom increases, the already-visible area is progressively refined with more SEED-generated detail. Internal LOD or globe/tangent/local representation changes may occur only when they are visually equivalent to continuing the same pure zoom; they must not introduce a new angle, horizon, focus, location or camera choreography.

Wheel/pinch is therefore strictly separated from pan/drag and rotation/orbit controls. Zoom is magnification/detail refinement, not navigation.

### Canonical Scale and Navigation Rule

The player-facing scale display uses this exact ordered ladder and does not use `x` multipliers:

`1/10 → 1/20 → 1/50 → 1/100 → 1/250 → 1/500 → 1/1000 → 1/2500 → 1/5000 → 1/10000`

For Stage S002 each scale state has a canonical vertical planet-space footprint, defined by `planet diameter × denominator / 10000`: 1/10 = 1.2742 km, 1/20 = 2.5484 km, 1/50 = 6.371 km, 1/100 = 12.742 km, 1/250 = 31.855 km, 1/500 = 63.710 km, 1/1000 = 127.420 km, 1/2500 = 318.550 km, 1/5000 = 637.100 km and 1/10000 = 1,274.200 km. Internal zoom may interpolate continuously between those presentation anchors. Later gameplay may only extend the ladder through an explicit owner-approved design change, never by silently introducing `x` multipliers.

The on-screen distance ruler must be physically truthful to the current footprint: its displayed distance and line length must match measured canonical world-space distance. A convenient rounded label must never be retained when it makes the line physically false. Globe ruler error must be no more than 2% against measured great-circle distance at the view center.

Drag/rotation sensitivity is also scale-aware. The same pointer movement must not produce the same angular/geographic movement at every scale. Wide planet views may traverse large distances; close/local views must move proportionally small distances so a short drag while viewing local terrain cannot jump across a country or continent. Browser acceptance error for a known drag distance is at most 5% at representative globe/local scales.

Scale, ruler calculation and navigation sensitivity are presentation/control behavior only. They must never assign or alter Campaign-SEED world-foundation values.

The atlas footer provides the ten scale anchors. Wheel/pinch and the zoom buttons interpolate between them; an approximate selected anchor is marked `≈`. Drag the surface to move the geographic focus, or focus the map and use WASD/arrow keys. Q/E and the rotation button turn the view; the compass arrow follows north and its button resets north. The centre crosshair and latitude/longitude identify the retained focus. The ruler measures surface distance across a short horizontal segment at that focus, with globe sphere intersections and canonical great-circle distance. Displaced landmark labels retain a leader to their world anchor. Realm view fits the globe into the available space; choosing a scale anchor instead sets its exact vertical footprint.

The world is a **finite continuous sphere**, not an unbounded planar tile grid. No tile is authoritative world state. Future local terrain and LOD systems may use bounded render patches or caches, but those patches must sample planet-space world data and remain disposable presentation/performance structures rather than defining world truth.

### Canonical SEED Coordinate Fabric

At campaign creation/load, Campaign-SEED code establishes one canonical planet coordinate fabric for the fixed world foundation. Every fixed spatial entity and structure—terrain, coasts, rivers, countries, regions, borders, capitals, cities, towns, villages, roads, paths, bridges, buildings, landmarks, POIs and later fixed actor/object spawn positions—must resolve through that same SEED-generated spatial authority.

The coordinate fabric provides stable reversible mapping among spherical latitude/longitude, physical planet-space meters, stable global spatial IDs/cells, local east-north-up tangent coordinates and render projection. Longitude wraps naturally; helper `wrappedX` uses equatorial arc meters and `wrappedX ± circumference` resolves to the same world position. Stable global cell ownership uses the cube-sphere hierarchy defined in `PLANET_ARCHITECTURE.md`, including deterministic face-edge/pole ownership. Lazy streaming may materialize only required detail, but camera position, zoom, viewport, render bucket, loading order, device state and frame timing must never assign or alter foundation coordinates.

The currently active gameplay-area center must be visibly identifiable on the sphere/map by a world-anchored center marker and concise coordinate readout. Pure zoom changes only scale/detail and never changes that center world coordinate.

Important landmark labels must appear at the scale tiers where they are intended to be discoverable. When text is displaced for decluttering, a small visible arrow/leader must point to the exact canonical landmark anchor. Landmark text may disappear only because its scale tier, hemisphere/occlusion, or viewport visibility makes it genuinely ineligible—not because an unrelated label consumed the shared placement budget.

For Stage 1, protagonist, NPC, settlement, building and local-terrain systems are deliberately dormant. Later stages will add planetary geography first, then progressively finer detail while preserving the same canonical planet scale.

## Diversity and a Lively Natural World

Terrain, villages and NPCs must be diverse, coherent and natural. SEED-derived regional terrain/vegetation should vary in shape, density and transitions; villages vary in street/plot geometry, building forms/materials, fields, service placement and economic character while keeping every required facility and owned home. NPCs have individual names, appearance descriptors, roles, birth dates and baseline behavioral tendencies linked to stable NPC/home/work codes. These foundations use SEED alone; current age and purposeful daily activity follow Fantasy Game Time and the established live-action rules.

Residents must visibly use their homes, workplaces, public areas and guard posts through varied work, travel, idle/rest and duty routines on legal connected paths. The scene should feel inhabited without cloned appearances, synchronized perpetual wandering or camera-generated crowds. Reusable optimized assets and focused simulation are permitted, but never alter identities, ownership or same-SEED/time results. See [diversity and living-world acceptance rules](LIVING_WORLD_PLAN.md). These are requirements for the existing Stage S002 packages, not a claim that all activities are implemented.

## Starting Village

Every new campaign begins with the protagonist as an ordinary low-rank character in a **SEED-generated inhabited village**.

The starting village should feel meaningfully inhabited rather than like an empty map or isolated character screen. Homes, workplaces, services, roads, paths, farms, gathering areas, landmarks and NPC activity should form a coherent settlement shaped by terrain and local relationships.

## Enterable Buildings

Accessible local buildings are physical parts of the same authoritative world, not menu shortcuts, exterior-only markers or disconnected duplicate scenes.

Buildings may contain walkable interiors, rooms, entrances, beds, counters, tables, storage, workstations and other function-appropriate spaces. Walls and obstacles constrain movement, entrances connect exterior and interior space, and the scale of characters, rooms, furniture and structures should remain plausible.

Entering or leaving a building preserves the **same building, occupants, location, history and campaign state**. Presentation may reveal or hide roofs, ceilings or upper walls when needed so occupied interiors remain readable.

## Autonomous Local Population

The village and wider world contain numerous autonomous characters who visibly move, work, idle, travel, socialize and interact when relevant.

Local roles may include butcher, produce seller, woodcutter, charcoal burner, tavern keeper, lodging owner, shop or market owner, farmer, craftsperson, guard, traveler, laborer and other settlement-appropriate professions.

These characters are not decorative crowd sprites. They are Simulation-backed participants with identity, location, occupation, relationships, needs and potential interactions.

Every NPC has a registered SEED-defined owned home under the settlement housing rules. Transient visitors such as traveling merchants or caravans may enter, work or trade and later leave while keeping their home elsewhere; visiting a settlement does not invent a new local house or replace their existing identity/home.

Working characters use profession-compatible workplaces or outdoor worksites. Farmers may use fields, hunters wilderness areas, fishers reachable banks or coasts, and similar outdoor professions should use terrain-appropriate locations.

NPC travel should respect terrain, roads, paths, buildings and other characters. Local conversations and activities should appear as world behavior rather than detached menu events.

## Animals, Creatures and Ecology

The world includes domestic animals, wildlife and a broad original medieval-fantasy bestiary.

Presence and behavior should reflect habitat, terrain, biome, settlement type, danger and campaign state. Animals and creatures may idle, forage, flee, travel, gather, guard territory, threaten or interact where appropriate.

---

# 🗺️ World Scale, Settlements and History

The world supports varied settlement archetypes rather than repeating one generic village: rural, farming, forest, mining or production settlements, roadside and trade communities, frontier and border settlements, fortified settlements, abandoned or ruined places, towns, market towns, large cities, castles, capitals and other context-appropriate forms.

Settlement appearance, population, buildings, professions, roads, resources, defenses, prosperity, hazards and surrounding environment should reflect geography, history and campaign state.

The overall world is continuous but finite because it is represented on the canonical spherical planet. Planet-space coordinates must map consistently to the sphere surface; longitude wraps naturally and no planar X/Y edge defines the world. When character simulation is reintroduced, actor positions must resolve to this same planet-space authority rather than an unbounded tile plane.

## World Planning Order

The canonical world-building sequence is:

| Priority | Layer |
| --- | --- |
| 0 | Oceans |
| 1 | Continents |
| 2 | Islands |
| 3 | Forests, deserts, grasslands and mountains |
| 4 | Lakes and rivers |
| 5 | Countries |
| 6 | Capital cities and big cities |
| 7 | Villages |
| 8 | Roads |
| 9 | Ruins and critical quest places |

These are SEED-defined foundation priorities, evaluated from 0 to 9, separate from rendering detail levels and loading order. Later infrastructure and settlement layers may reshape earlier natural terrain locally: roads may cut mountains and clear forest to create a graded near-flat dirt foundation with a road surface above it; houses and their usable perimeter may cut mountainside terrain and clear vegetation for proper living areas. Edits must affect terrain, materials, vegetation and walkability consistently, with bounded transition zones rather than floating meshes or whole-mountain flattening.

Within a village/city subplan, reserve streets, public space, gates and road access before accepting individual building footprints. Road grading follows these legal reservations and joins house entrances without destroying homes, mandatory services or gates. Ruins and quest sites respect existing occupied plots and access. Road crossings of rivers require connected bridges; lake routes turn around the water. Small drainage channels may use explicitly permitted culverts. Terrain cuts preserve drainage and minimum village walking time on the final road network. All detail levels query the same final SEED-defined terrain and modifier plan. See [world-building priority contracts](WORLD_BUILDING_PRIORITY.md). These are Stage S002 planning requirements.

## Connected SEED-Defined Road and Transport Network

Every village, capital/big city, ruin, bridge, critical structure and critical area must connect to one coherent road network on its landmass. Countries connect through their capitals/regional roads and valid border routes. Sites connect through real entrances, gates and streets; bridge decks must join roads on both banks. Connectivity means a traversable path, not a separate direct road between every pair. Between continents and islands, the owner selected road-connected harbors with SEED-defined ferry/ship links, forming one globally connected transport graph without pretending there are roads across oceans.

Route alignment is terrain-aware: a river crossing requires a valid connected bridge; a lake requires a route around it; hills may use modest graded cut/fill; mountain routes prefer the lowest feasible passes around summits. Consider terrain type, elevation, slope, length, earthwork and water locations together. Never automatically cut a straight trench through a high peak merely because road priority is 8. Forest clearing and smaller slope cuts remain permitted along accepted corridors. Preserve water flow, the practical road-bridge limit and minimum village walking time after all grading and access links.

All accepted road settings are definitive Campaign-SEED foundation data: endpoints, centerline, station heights, grades, widths, dirt/surface materials, shoulders, clearance, junctions, crossing anchors, bridge decks and connected access. Intersections join at compatible world coordinates/heights and actual walkable surfaces. Fixed road/bridge/harbor/sea-link settings never depend on camera focus, fantasy time, LOD, device or loading order. Leaving and returning to an unchanged place reproduces identical settings, heights and features; meshes, collisions and route costs all query that same final authority. Legitimate later campaign changes require persisted Simulation events. See [road-network contracts](ROAD_NETWORK_PLAN.md). These are Stage S002 planning requirements.

## World Scale and Travel

The authoritative world scale is physical **planet-space distance in meters**, not tiles. Renderer pixels, mesh density, local LOD resolution and future cache patch sizes must never change physical distance.

The Stage S002 normal walking model uses **3.0 km per fantasy hour** on open ground and **3.6 km per fantasy hour** on a good road/bridge, with difficult terrain slower. Every pair of distinct village centers **must require at least 60 fantasy minutes (3,600 fantasy seconds)** along the shortest legal walking route. This is a minimum; mountains, cliffs, rivers, lakes and other environmental features may make the walk longer. At the existing 24× game clock, the minimum is **2.5 real minutes** at normal speed. A **3.6 km** geodesic separation is a sufficient fastest-walking lower bound; final walking costs must still account for terrain and all legal shortcuts after road/settlement earthworks. Rural bridges remain capped at **120 m** and must satisfy the 10-fantasy-minute bridge-time limit.

Realm geography and environments must drive every closer level from the same SEED data. The sphere must clearly show major mountains, deserts, forests, lakes, seas and frozen north/south polar regions. Continent positions and multiple islands are SEED-generated; natural terrain and placement must look diverse and irregular rather than follow fixed cell positions. Logical addressing may use cells, but geometry must not be a visible lattice. No real randomness or independent globe/local generation is allowed. See [the reaffirmed world requirements](WORLD_REQUIREMENTS.md). These remain Stage S002 planning requirements.

## SEED-Generated Geographic Hierarchy and Scale

The Campaign SEED deterministically defines the fixed geographic foundation from large scale to small scale, including continent, country or realm, region or province, city, district, town where applicable, village, avenue or major road, street or local road, terrain, elevation, rivers, lakes, coastlines, biome, vegetation, climate, local environmental conditions, settlement placement and travel connections.

The same SEED must reproduce the same unchanged geographic foundation. Fantasy time does not participate in this generation.

Generated geography must also obey realism constraints rather than placing settlements arbitrarily. In particular, two distinct villages must not have a valid walking route between their centers that takes less than **1 fantasy game hour**. This constraint uses the shortest valid walkable route, not straight-line distance. Terrain, elevation, water, bridges, roads, paths and other movement conditions may lengthen the route.

If a SEED-generated village candidate would violate this minimum travel-time rule, the generator must deterministically reject that candidate and continue to the next deterministic candidate derived from the same SEED process. Therefore the world remains both realistic and reproducible.

Planetary geography must use the Campaign SEED to reproduce the same large-scale world foundation at the same planet-space positions. Future village placement must use physical distance and route cost on the spherical world; it must not depend on an authoritative tile size. When a geodesic or other valid lower bound already proves that two candidate settlements exceed the minimum travel time, generation should avoid unnecessary detailed pathfinding.

Future main roads remain persistent geographic infrastructure: terrain generation cannot erase or interrupt them. A good road/bridge may use **3.6 km/h** for normal walking calculations. Rural bridges must satisfy both the **10 fantasy-minute** limit and the stricter **120 m practical cap**. Typical widths remain physical measurements: 2 m for rough paths, 4 m for rural roads, 4–6 m for village main roads, up to 8 m for towns, 12 m for cities, and 20 m only for capital-city main roads.


Settlements are historical entities, not frozen templates. Population, prosperity, security, trade, resources, hazards, construction, destruction, war and other pressures may cause them to grow, decline, fortify, change function, lose structures, become abandoned or ruined, recover, rebuild or be repopulated.

Growth from village to town or city is possible but never mandatory. Decline is equally valid.

When the player returns to a known place, it should reflect accumulated campaign history rather than silently reverting to its original state.

As the protagonist rises in authority, play expands naturally from local village life toward towns, cities, regions, kingdoms and multiple realms without replacing the living world with menu-only gameplay.

## Seeded Settlement Design and NPC Homes

Every NPC must have their own distinct, persistent house in a village, city or castle residential area. A settlement name or ID alone is not a home assignment. Each NPC's foundation record must link its NPC SEED code to a specific home-building SEED code, entrance, settlement and owner. Initial ownership comes only from the Campaign SEED; later relocation or ownership changes are persisted Simulation actions using SEED + Fantasy Game Time. Regenerating or unloading an area never changes the assignment or deletes the logical house.

Every inhabited village must start with the following minimum facilities:

- A village center / public square, with a shared water point.
- A market, inn, blacksmith workshop, farmstead with usable fields, butcher and guard office (the medieval equivalent of a police office).
- Enough distinct houses for every generated resident, including service workers and guards.
- A basic enclosing border, such as a seeded timber palisade, hedge or suitable wall.
- Exactly **one or two gates**, decided by the village SEED code; **one or two guards at each gate**, with their own NPC identities, houses and duty assignments.

Within the village phase, design follows logical placement rules: suitable terrain and incoming routes → border and reachable gate openings → connected main streets and public center → service plots and residential plots → entrances and important objects → final priority-composed ground and vegetation. Seeded living-area pads and later road earthworks may prepare mountain/forest terrain. The center and market are accessible from the gates; inn and trade services face usable streets; farms have suitable land and access. Houses, services, fields, roads and the border must not overlap incorrectly or stand in water. The border encloses the inhabited core; connected farmland may sit outside it. Gate openings align with external routes and must not block the existing village travel-time rules.

SEED codes decide the layout, house identities, service identities, gate count, initial guard assignments and initial home/work relationships. Villages must vary in shape, plots and orientation with terrain and routes rather than repeating a rigid grid. Cities scale housing and services to their resident population. Castles require a defined residential area for their inhabitants; a decorative keep without assigned homes does not satisfy the rule. The world retains exactly three continents and at least thirty countries, at least ninety cities and at least two hundred seventy villages; deterministic Campaign-SEED generation may create higher country/city/village counts when later coverage rules require them, and castle residences do not silently replace counted settlements.

Service buildings must have assigned NPC operators, and gate guards must be actual residents rather than anonymous decoration. Daily travel, working, resting and guard shifts use SEED + Fantasy Game Time and follow walkable connections between home entrances, workplaces, public areas and guard posts. One or two guards remain assigned on duty per village gate; shift changes must not discard home ownership or duplicate NPCs. The assignment must remain true when its visual model is outside the rendered area.

These are Stage S002 requirements, not features already implemented in the current atlas. World-level settlement and population summaries stay lightweight; detailed home records, building meshes and NPC schedules are reconstructed lazily for the focused area. Streaming, level of detail, device capabilities and loading order may change presentation cost, never resident identity, ownership or settlement design.

## Economy, Factions, Diplomacy and War

As responsibility expands, the game may include resources, population, prosperity, stability, legitimacy, production, trade, buildings, settlement development and military readiness.

Factions have leaders, needs, memories, relationships, territory, incomplete knowledge and political objectives. Treaties, alliances, trade, dependency, insults, marriages, betrayals, debts, succession disputes, religious disputes and historical conflicts may affect relations.

Military play is strategic rather than direct player unit control. Relevant systems may include recruitment, commanders, supplies, terrain, morale, training, formations, objectives, defense, raids, sieges, retreats, diplomacy and consequences of war. Characters with legitimate authority issue orders; the Simulation resolves outcomes.

Events may include local disputes, crimes, shortages, illness, banditry, family conflict, romance, tournaments, recruitment, intrigue, assassination, invasion, rebellion, succession, diplomacy, economic crises, supernatural discoveries and other opportunities or crises. Events should create situations to understand and influence rather than one obvious correct answer; failure should often create new stories and recovery paths instead of immediate game-over.

---

# 🌱 SEED, Continuity and Persistence

The world is procedurally generated from a player-visible **SEED** and has no gameplay-defined outer boundary.

Compatible seeds should reproduce the same unchanged foundations of the world, while campaign history may transform those foundations over time.

## Deterministic Simulation Randomness

There is **no real randomness** in the Simulation.

Two deterministic modes are used:

**World foundation generation** — terrain, environment, initial NPC generation and other fixed starting-world generation use Campaign-SEED-based deterministic randomness and do **not** use fantasy time. Stable structural locations or slots may be used to address a deterministic SEED-based sample, such as tile coordinates or an NPC generation slot.

### Authoritative SEED-Only Foundation Rule

Every authoritative **initial or fixed world-foundation value** must be assigned by Campaign-SEED code. No other runtime source is allowed to assign or alter those foundation values.

Stable coordinates, hierarchy IDs, generation slots, terrain facts, political borders, settlement affiliations and similar inputs may be consumed by later foundation generators only when they are themselves deterministic outputs/addresses of the same Campaign SEED process. They are not independent authorities and must never introduce camera-, viewport-, timing-, device-, cache-, loading-order- or navigation-dependent values.

In particular, camera position, zoom, viewport size, render bucket, FPS, frame timing, device state, loading/streaming order, wall-clock time and user navigation must never decide terrain, borders, political ownership, settlement positions, building positions, roads, resources, NPC foundation values or any other fixed generated-world value.

The only permitted non-foundation change path is **live Simulation action over fantasy time**. Such changes use the deterministic live-action rule below and may modify campaign state/history, but they do not rewrite the original SEED-generated foundation.

**Live simulation actions** — NPC actions, decisions, dynamic events and other changing behavior use:

**Random(Campaign SEED, Fantasy Game Timestamp)**

Fantasy Game Timestamp contains **date, hour, minute and second only**. Its canonical form is `YYYY-MM-DD HH:MM:SS`. Milliseconds are never included.

If the Campaign SEED and Fantasy Game Timestamp are the same, the live result must be exactly the same.

Neither mode may use `Math.random()`, browser/OS cryptographic randomness, device entropy, uncontrolled real randomness, or real-world time as a random input. The authoritative fantasy timestamp for live actions is supplied by the game-time system.

This split keeps the generated world stable across time while still making later live simulation runs reproducible.


Procedural generation may shape terrain, elevation, biomes, water and vegetation; roads, paths and bridges; settlement archetypes and layouts; buildings, landmarks and important locations; local population and home/work relationships; ecology and habitat foundations; and base political geography.

Neighboring places should feel like parts of one continuous world rather than independent random maps.

## Political Geography

Where applicable, the SEED also defines coherent base political geography such as realms, countries, regions, provinces, territorial relationships, borders, settlement affiliation and major political centers.

Political geography should relate plausibly to terrain, mountains, rivers, coasts, routes, settlements and strategic locations rather than being disconnected random labels.

The SEED defines the **base** political world, not an immutable map. Campaign history may change territorial control, borders, ownership, capitals, relationships or realm composition.

## Persistent Change

The world remembers meaningful change.

Persistent changes may include discoveries, damage, construction, ownership, territorial control, settlement development, resource use, relationships, inventory-affecting interactions, injuries, status changes and other authoritative consequences.

Returning to known places should present the current campaign world shaped by both its original foundations and everything that has happened since.

---

# ⏱️ Time and World Simulation

The campaign is **real-time, not turn-based**.

At normal game speed:

- **60 real-world minutes = one 24-hour in-game day**
- **1 in-game hour = 2.5 real-world minutes**

The game clock is authoritative Simulation state.

Day and night presentation follows game time:

- **05:00 — dawn/daylight begins**
- **22:00 — darkness/night begins**

## Fantasy Calendar and Resume

A new campaign's fantasy date and time derive from the accepted real-world creation time:

- day, month and time-of-day match;
- **fantasy year = real-world year − 1900**.

Example: `07.10.2026 → 07.10.0126`.

The world continues to progress while the player is away. At the default policy:

- **1 real-world hour offline = 1 in-game day**.

Offline progression should preserve believable world continuity without changing the core rule that the Simulation remains authoritative.

---

# 🎨 World Presentation and Rendering Architecture

The world renderer is **PlayCanvas Engine 2**, preferring **WebGPU** with automatic **WebGL2** fallback when the browser cannot initialize WebGPU. Playing with default Chrome settings is mandatory; players must not need experimental flags or GPU blocklist overrides. A usable WebGPU or WebGL2 graphics context is required.
The game will be mainly use 3d simple meshes with Cel-Shading (Toon-Shading) technic for textures, but it will also use 2d character artistic images for dialogues. 

The architecture is intentionally split:

**Simulation authority → chunk/world-data preparation → PlayCanvas presentation**

Simulation remains authoritative for:

- Campaign SEED and canonical spherical world coordinates;
- stable global spatial IDs/cells and local 2 m-or-finer gameplay sampling where required;
- terrain identity and settlement generation;
- walkability, collision legality and routing;
- building footprints, rooms, entrances and interaction points;
- NPC positions, schedules, actions and campaign state;
- save/load truth.

The PlayCanvas scene is presentation only. Renderer state, mesh transforms, depth buffers, physics helpers or visual effects must never silently become Simulation authority.

## PlayCanvas 3D World Standard

Everything in the world is rendered as 3D presentation **except character artwork**.

3D presentation includes:

- terrain and ground surfaces;
- roads, paths, water and bridges;
- buildings, walls, doors and roofs;
- interior architecture and furniture;
- trees, vegetation, rocks and environmental props;
- settlement structures, landmarks and world objects;
- shadows, lighting and other spatial presentation.

Characters remain **2D drawn images rendered inside the 3D world as camera-facing sprites/billboards**. The sprite feet are anchored to the character's authoritative world coordinate. Character presentation may animate through atlas/frame changes, but the image never becomes world authority.

The default gameplay camera is **orthographic top-down / 3/4 view**. Perspective distortion is not required for normal play. Real 3D depth handles building height, roofs, object overlap, terrain elevation where used, and natural occlusion instead of manually faking depth through a 2D layer stack.

## Browser + Mobile Rendering Baseline

The supported production baseline is:

- **PlayCanvas Engine 2**;
- **WebGPU** is preferred on desktop, phone and tablet, with automatic **WebGL2** fallback;
- WebGPU device support must be checked at startup;
- rendering quality changes must preserve identical Simulation behavior;
- adaptive render scale and pixel-ratio limits protect mobile GPU performance;
- phone, tablet and desktop remain first-class targets.

Renderer quality may scale by device capability, but Simulation fidelity must not be reduced to gain graphics performance. Concrete initial frame-time, queue, cache, memory, DPR/render-scale and telemetry budgets are binding in [Stage S002 canonical planet architecture](PLANET_ARCHITECTURE.md); later physical-device measurements may tighten them but must not silently trade away Simulation correctness.

## Chunk-Native 3D Terrain

The finite continuous planet is never instantiated as one giant detailed 3D scene.

Canonical world data is addressed through the deterministic spherical coordinate/ID system, while rendering is chunk-native:

**SEED/world data → complete logical chunk → prepared terrain/building data → PlayCanvas mesh/entities → Active / Prepared / Cached**

Each prepared chunk may contain:

- terrain mesh or a small bounded set of terrain patches;
- material/texture references;
- road/water/bridge geometry;
- static building and prop references;
- cached walkability/world-data results needed by presentation;
- static-batch and instancing groups;
- visibility/culling bounds;
- deterministic presentation signature.

A chunk is prepared as a complete chunk before it is considered ready. Normal camera movement through prepared territory must primarily move the camera and activate/deactivate retained chunk entities instead of regenerating terrain.

Chunk size, preparation radius and cache budget remain adjustable performance controls. No detailed whole-planet array may scale with every 2 m/200 m local sample; detailed data must stay sparse, hierarchical and focus-bounded.

## 3D Asset Standard

Production world geometry should use browser-efficient PlayCanvas-compatible assets, with **GLB/glTF as the standard 3D interchange/runtime model format** where practical.

The renderer should prefer:

- shared materials;
- texture atlases where appropriate;
- compressed/runtime-efficient textures when validated;
- static batching for nearby non-moving geometry;
- hardware instancing for repeated geometry such as trees, rocks, fences and repeated props;
- LOD only where measurable benefit justifies it;
- bounded chunk-local scene entities instead of one Entity per logical tile;
- asset preparation outside the visible render hot path.

Draft SVG artwork may still be useful as a design/source reference, but terrain/buildings/props are no longer defined as flattened 2D world tiles. Final world presentation is 3D geometry with material textures.

## Character 2D Art in 3D

Character art remains 2D by design.

Each visible character uses a PlayCanvas Sprite/billboard presentation that:

- faces the gameplay camera according to the selected billboard rule;
- anchors at the feet to authoritative X/Y position and appropriate visual elevation;
- participates correctly in the 3D depth/occlusion system;
- supports transparent character artwork and animation frames;
- can be hidden/cut away correctly by buildings and roofs;
- does not require a skeletal 3D character model.

Off-screen Simulation characters do not require active render entities.

## Performance Rules

The renderer must be designed for sustained navigation on phones and tablets as well as desktop.

Normal prepared-area navigation should avoid:

- recreating unchanged terrain meshes;
- rebuilding unchanged buildings/roofs/props;
- re-running TerrainFoundation and Walkability for the full viewport every camera step;
- per-frame asset decoding or texture creation;
- large synchronous chunk-generation bursts;
- one draw call or one PlayCanvas Entity per logical terrain tile;
- unnecessary JavaScript allocations in the render/update hot path.

Performance work should prioritize:

- complete background chunk preparation;
- persistent scene-graph reuse;
- frustum/distance culling;
- static batching;
- hardware instancing;
- low material/shader variation;
- bounded Active / Prepared / Cached resource sets;
- dynamic render scale and mobile quality budgets;
- telemetry for CPU frame time, GPU frame time where available, draw calls, triangles, entity counts, chunk activity, cache behavior and navigation spikes.

The design target is **60 FPS on capable hardware** with **30 FPS as the minimum supported gameplay fallback**, without changing Simulation correctness. Software-rendered CI validates functional counters and bounded behavior; it is not evidence of physical-device FPS.

The visual direction remains a readable, grounded **seinen medieval-fantasy / old-school RPG** style. Real 3D is used to improve spatial depth, buildings, settlements and terrain while 2D character artwork preserves the intended illustrated character identity.

---

# 🌐 Public Development Build

The canonical public development build is:

**https://sgoxel.github.io/The_Advisor_Game/**

The game is intended to remain usable across phone, tablet and desktop, in portrait and landscape layouts, and playable without an external AI provider.

---

# ✅ Core Concept Summary

- The player is an **Advisor**, not the protagonist's direct controller.
- The AI Character decides whether and how to act.
- The Simulation is authoritative for legality, state, resources, position, outcomes and world truth.
- The conversation system uses deterministic chatbot/Sentence Library matching first and LLM reasoning only when useful.
- The LLM can only propose actions through a bounded structured Command Set Interface; it cannot directly mutate Simulation state.
- External LLM, chatbot routing and local fallback behavior represent the **same persistent character**.
- The game begins in a SEED-generated inhabited village.
- Buildings are part of the same living world and are physically enterable where relevant.
- NPCs are autonomous, Simulation-backed inhabitants rather than decorative sprites.
- The world evolves through time, persistence, ecology, settlement change, politics and history.
- The campaign is real-time and continues to progress while the player is away.
- The public game should remain responsive across phone, tablet and desktop.
- **Player advises → AI Character decides → Simulation validates → World reacts.**