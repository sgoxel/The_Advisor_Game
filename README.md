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

Base identity may include name and gender, birth date and birthplace, baseline personality and behavioral tendencies, and original/base profession or social role where applicable.

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

Entering or leaving a building preserves the **same building, occupants, location, history and campaign state**. Interior detail may be streamed, cached or lazily materialized, but it refines the same authoritative place and must obey the same static 100 × 100 tile-composition presentation rule as other non-NPC world art.

Roofs, ceilings or upper walls may hide, cut away, fade or change their tile-local composite so occupied interiors remain readable; they must not require a separate persistent building/interior image layer.

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

Unless the Admin grants a named presentation exception, non-NPC animals/creatures do not gain permanent independent world-image layers: when their logical tile changes, the affected static tile composites are invalidated and rebuilt from authoritative state.

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

Example: `28.08.2026 → 28.08.0026`.

The campaign stores the last accepted real-world timestamp needed for resume progression. On resume:

- default safe startup order is **load → validate → offline progression → start live clock**;
- negative real-time deltas do not reverse the world;
- corrupt or incompatible timestamps fall back safely;
- **1 real-world hour offline = 1 in-game day** at default policy.

Offline catch-up must remain bounded and suitable for large worlds. Distant regions should use compact or hierarchical progression rather than replaying every NPC minute-by-minute.

---

# 🎨 World Presentation and Art Direction

The project is presented primarily as a **WebGL-rendered 2D/2.5D world**, with selective 3D only where it genuinely improves the experience.

The target is a readable, grounded **seinen medieval-fantasy / old-school RPG** presentation: painterly or hand-crafted-feeling environments, practical rather than exaggerated materials, readable silhouettes, lived-in settlements, and characters that remain identifiable at gameplay scale.

The visual system should prioritize:

- coherent roads, paths, terrain and settlement structure;
- readable building footprints, entrances and interiors;
- clear characters, creatures, objects and interaction points;
- useful day/night atmosphere;
- responsive presentation from mobile portrait through desktop;
- stable world visuals while moving, panning and zooming;
- performance appropriate for a large continuous world.

Direct two-character dialogue should show relevant full-body character art where responsive layout permits.

Visual variants may reflect Simulation-backed rank, profession, culture/faction, equipment, region and circumstances, but must not invent authoritative facts.

## Canonical Tile Atlas

Reusable tile-based visual families use a canonical **transparent 1024 × 1024 PNG atlas**, fixed **4 × 4 grid**, with sixteen **256 × 256 cells**.

If fewer variants are needed, unused cells remain fully transparent. Occupied cells must support deterministic export to individual **256 × 256 PNG tiles** with stable semantic family/type identity.

This convention applies to roads, paths, terrain and transitions, building parts, walls, floors, interiors, furniture, props, vegetation, trees, resources, ruins and other reusable non-NPC world art.

## Static 100 × 100 Tile Composition

**NPC world sprites are the sole normal independently dynamic world-image exception.** Except for NPCs, every visible world graphic is resolved into the logical background tile before presentation.

Each logical world tile has one exact **100 × 100 RGBA static presentation composite**. The authoritative terrain/base is painted first. Transparent atlas-derived roads, paths, terrain transitions, building/interior parts, walls, floors, roofs, trees, vegetation, furniture, props, resources, ruins and other non-NPC world artwork are then alpha-composited into that same tile image in deterministic order.

For example, a tree on grass is presented as **one grass + transparent-tree 100 × 100 tile image**, not as an independent tree sprite. A road over dirt is one dirt + transparent-road tile image.

The canonical **256 × 256 PNG slices are reusable source assets, not separate runtime image objects**. They are scaled and alpha-composited into the destination 100 × 100 logical-tile composite. Source object/structure art remains transparent so the underlying terrain is visible where appropriate.

Multi-tile structures retain their authoritative Simulation footprints, but presentation is decomposed into tile-local semantic parts and composited independently into each covered logical tile. A building must not remain as one persistent giant world-space image layer over the background.

Except for NPCs, production world presentation must not retain persistent road, building, interior, tree, vegetation, prop, generic-object or vector/debug canvases, DOM images, or per-object sprite layers. If a non-NPC Simulation entity changes logical tile, the affected old/new tile composites are invalidated and rebuilt instead of promoting that entity to a permanent independent image layer, unless the Admin explicitly grants a named exception.

The runtime must use sparse/bounded composition and GPU-safe background storage. It must **not** allocate one monolithic 10000 × 10000 texture merely because a 100 × 100 logical region uses 100 × 100-pixel composition units. Static pixels should be recomputed only when their authoritative presentation inputs change; camera movement, zoom and NPC interpolation do not by themselves invalidate static tile pixels.

This is a performance and presentation invariant only. Pixels never become gameplay authority: terrain legality, collision, roads, building footprints, object identity/state, movement and outcomes remain Simulation-owned.

World presentation must not replace unresolved artwork with CSS/vector geometry or invented placeholders when a real asset is required.

---

# 🌐 Public Development Build

The canonical public development build is:

**https://sgoxel.github.io/The_Advisor_Game/**

The public build should expose only meaningful player/runtime surfaces by default. Development/debug controls may exist when deliberately enabled, but should not dominate the normal game experience.

The game should remain:

- responsive across phone, tablet and desktop;
- usable in portrait and landscape layouts;
- keyboard- and pointer-accessible where appropriate;
- localization-capable;
- playable without an external AI provider;
- conservative about network use, credentials and external services.

---

# 📜 Project Authority and Development Governance

Authority order:

**Admin → README.md → ROADMAP → TODO → issues → code/assets → tests**

The Admin may explicitly override any lower authority.

`README.md` is the product truth. It defines game concept, scope, principles, invariants and high-level governance. It is **not** an implementation diary, task backlog, detailed roadmap or technical HOW manual.

The README must not be changed unless the Admin explicitly authorizes the change.

The repository must preserve a inspectable audit trail for meaningful changes. Plans, issues, code, assets and tests must remain subordinate to current README product truth and explicit Admin direction.

Development details may evolve, but they must not weaken the core product:

**Player advises → AI Character decides → Simulation validates → World reacts.**

---

# ✅ Summary of Non-Negotiable Product Truth

- The player is an **Advisor**, not the protagonist's direct controller.
- The AI Character decides whether and how to act.
- The Simulation is authoritative for legality, state, resources, position, outcomes and world truth.
- LLM and Local BOT are alternate drivers of the **same persistent character**.
- The game starts in a SEED-generated inhabited village at **(0, 0)**.
- A normal region is exactly **100 × 100 logical tiles**; the world itself is continuous and unbounded.
- An ordinary starter home is at least **10 × 10 logical tiles** with at least **two rooms**.
- Buildings are part of the same world and are physically enterable where relevant.
- NPCs are autonomous, Simulation-backed inhabitants with exclusive active-tile occupancy.
- NPC world sprites are the sole normal independently dynamic world-image layer.
- All non-NPC world art is flattened into exact **100 × 100 RGBA logical-tile composites**: terrain first, transparent PNG overlays second; separate persistent static object/road/building/vector layers are prohibited.
- Reusable tile art uses a transparent **1024 × 1024 PNG atlas**, fixed **4 × 4**, with **256 × 256 cells** and transparent unused cells.
- The world evolves through time, persistence, ecology, settlement change, politics and history.
- **60 real minutes = 24 in-game hours** at normal speed.
- New-campaign fantasy year = **real-world year − 2000**.
- Default offline progression is **1 real hour = 1 in-game day**.
- The canonical public build is **https://sgoxel.github.io/The_Advisor_Game/**.
