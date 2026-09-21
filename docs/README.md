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

The protagonist may use an external LLM for richer conversation and reasoning or a deterministic local fallback when an external model is unavailable or disabled. These are not separate protagonists or separate game modes: they represent the **same persistent character** in the same world.

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

Persistent residents normally have a valid home. Explicitly transient visitors such as traveling merchants or caravans may enter, work or trade and later leave without receiving an invented residence.

Working characters use profession-compatible workplaces or outdoor worksites. Farmers may use fields, hunters wilderness areas, fishers reachable banks or coasts, and similar outdoor professions should use terrain-appropriate locations.

NPC travel should respect terrain, roads, paths, buildings and other characters. Local conversations and activities should appear as world behavior rather than detached menu events.

## Animals, Creatures and Ecology

The world includes domestic animals, wildlife and a broad original medieval-fantasy bestiary.

Presence and behavior should reflect habitat, terrain, biome, settlement type, danger and campaign state. Animals and creatures may idle, forage, flee, travel, gather, guard territory, threaten or interact where appropriate.

---

# 🗺️ World Scale, Settlements and History

The world supports varied settlement archetypes rather than repeating one generic village: rural, farming, forest, mining or production settlements, roadside and trade communities, frontier and border settlements, fortified settlements, abandoned or ruined places, towns, market towns, large cities, castles, capitals and other context-appropriate forms.

Settlement appearance, population, buildings, professions, roads, resources, defenses, prosperity, hazards and surrounding environment should reflect geography, history and campaign state.

The overall world is continuous and unbounded from the player's perspective. The Protagonist begins every new campaign at world coordinate **(0,0)**, and that origin is the initial center of the gameplay view. Both X and Y may extend without a gameplay-defined boundary in negative or positive directions. Large settlements may extend across multiple local areas while remaining one coherent place.

## World Scale and Travel

The authoritative world grid uses **1 tile = 2 meters × 2 meters**. Pixel size is only camera presentation and does not change physical distance.

Normal NPC walking is intentionally conservative for game readability: about **3.0 km/h** on open ground and **3.6 km/h** on a good road/bridge, with slower speeds in forest, mud and mountain terrain. Village spacing and road/bridge realism use these physical measurements.

Distinct village centers must remain at least one fantasy walking hour apart. Using the fastest normal road speed, that lower bound is **3.6 km = 1,800 tiles**. Rural bridges are practically capped at **120 m = 60 tiles** and must also satisfy the existing 10-fantasy-minute bridge-time limit.

## SEED-Generated Geographic Hierarchy and Scale

The Campaign SEED deterministically defines the fixed geographic foundation from large scale to small scale, including continent, country or realm, region or province, city, district, town where applicable, village, avenue or major road, street or local road, terrain, elevation, rivers, lakes, coastlines, biome, vegetation, climate, local environmental conditions, settlement placement and travel connections.

The same SEED must reproduce the same unchanged geographic foundation. Fantasy time does not participate in this generation.

Generated geography must also obey realism constraints rather than placing settlements arbitrarily. In particular, two distinct villages must not have a valid walking route between their centers that takes less than **1 fantasy game hour**. This constraint uses the shortest valid walkable route, not straight-line distance. Terrain, elevation, water, bridges, roads, paths and other movement conditions may lengthen the route.

If a SEED-generated village candidate would violate this minimum travel-time rule, the generator must deterministically reject that candidate and continue to the next deterministic candidate derived from the same SEED process. Therefore the world remains both realistic and reproducible.

The current foundation model treats one logical tile as **2 meters** for world-scale travel calculations. Village placement is structured so neighboring village centers remain far enough apart that even the fastest normal road walking speed used by the model (**3.6 km/h**) cannot produce a sub-one-hour village-to-village walk. A terrain-aware route check then verifies the actual shortest valid route around the starting village.

Main roads are persistent geographic infrastructure: terrain generation cannot simply erase or interrupt them. The starting village currently uses a connected irregular main-road ring with connected central avenues. Future secondary roads must connect to this network. Bridges are allowed only for short crossings: at the current **100 m/tile** scale and **5.5 km/h** main-road walking speed, a bridge may span at most **9 consecutive tiles**, keeping the crossing below **10 fantasy walking minutes**. Road width depends on context: village roads are smaller, rough forest/mountain roads narrow further, and only future capital-city main roads may widen as far as **10 tiles**; this is not the default width for long-distance/wilderness roads.


Settlements are historical entities, not frozen templates. Population, prosperity, security, trade, resources, hazards, construction, destruction, war and other pressures may cause them to grow, decline, fortify, change function, lose structures, become abandoned or ruined, recover, rebuild or be repopulated.

Growth from village to town or city is possible but never mandatory. Decline is equally valid.

When the player returns to a known place, it should reflect accumulated campaign history rather than silently reverting to its original state.

As the protagonist rises in authority, play expands naturally from local village life toward towns, cities, regions, kingdoms and multiple realms without replacing the living world with menu-only gameplay.

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
- **fantasy year = real-world year − 900**.

Example: `21.09.2026 → 21.09.1126`.

The world continues to progress while the player is away. At the default policy:

- **1 real-world hour offline = 1 in-game day**.

Offline progression should preserve believable world continuity without changing the core rule that the Simulation remains authoritative.

---

# 🎨 World Presentation and Art Direction

The game is presented primarily as a **2D/2.5D world**, with selective 3D where it genuinely improves the experience.

The target is a readable, grounded **seinen medieval-fantasy / old-school RPG** presentation: painterly or hand-crafted-feeling environments, practical rather than exaggerated materials, readable silhouettes, lived-in settlements, and characters that remain identifiable at gameplay scale.

The visual direction should prioritize:

- coherent roads, paths, terrain and settlement structure;
- readable building footprints, entrances and interiors;
- clear characters, creatures, objects and interaction points;
- useful day/night atmosphere;
- responsive presentation from mobile portrait through desktop;
- stable world visuals while moving, panning and zooming;
- performance appropriate for a large continuous world.

Direct two-character dialogue should show relevant full-body character art where responsive layout permits.

Visual variants may reflect Simulation-backed rank, profession, culture or faction, equipment, region and circumstances, but must not invent authoritative facts.

World presentation should reinforce the state of the living world without becoming gameplay authority itself.

## Static 100 × 100 Tile Composition

NPC world sprites are the sole normal independently dynamic world-image exception.

All non-NPC world art is flattened into exact **100 × 100 RGBA logical-tile composites** before presentation. Each logical tile is composed deterministically with terrain/base first, followed by applicable roads, paths, transitions, buildings, interiors, vegetation, props, objects and other static visuals. Reusable atlas cells are source assets for this composition and do not remain independent persistent world-image layers.

Static composition uses sparse, bounded caching. Camera movement and zoom do not rebuild unchanged tiles; only tiles whose authoritative static presentation inputs change are invalidated. These pixels remain presentation-only and never become authority for terrain legality, collision, occupancy, identity, movement, resources or Simulation outcomes.

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
- External LLM and local fallback behavior represent the **same persistent character**.
- The game begins in a SEED-generated inhabited village.
- Buildings are part of the same living world and are physically enterable where relevant.
- NPCs are autonomous, Simulation-backed inhabitants rather than decorative sprites.
- The world evolves through time, persistence, ecology, settlement change, politics and history.
- The campaign is real-time and continues to progress while the player is away.
- The public game should remain responsive across phone, tablet and desktop.
- **Player advises → AI Character decides → Simulation validates → World reacts.**
