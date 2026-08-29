<div align="center">

# 🏰 The Advisor Game

### 🧠 Advise an autonomous AI character. Shape a life. Change a kingdom. Maybe build an empire.

**A medieval fantasy roleplaying and strategy game where the human player advises an autonomous AI-controlled main character as they rise from Peasant to Emperor.**

### 🎮 [Play the Current Public Development Build](https://sgoxel.github.io/The_Advisor_Game/)

[🏷️ Latest GitHub Release](https://github.com/sgoxel/The_Advisor_Game/releases/latest) · [🌐 Public Game](https://sgoxel.github.io/The_Advisor_Game/)

</div>

> [!IMPORTANT]
> **Core rule:** The human player advises. The autonomous AI character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

---

# 👑 Authority

The **Admin is the highest authority for the project**.

An explicit Admin instruction overrides README, planning records, issues, implementation assumptions, Worker procedures, testing requirements, release procedures, and all other subordinate project state.

Authority order:

**Admin explicit instruction → README.md → ROADMAP → TODO → Issues → Code / Assets → Tests**

`README.md` defines the normal persistent **product scope, fundamental principles, non-negotiable product rules, and high-level way of working** for The Advisor Game.

README defines **WHAT the project is and what should normally remain true**, not HOW individual Workers must technically implement it.

README does **not** prescribe project architecture, repository/file structure, module names, implementation order, roadmap phases, task decomposition, technical libraries beyond product-level requirements, asset pipelines, detailed testing procedures, deployment procedures, branching strategy, or automation implementation.

Those decisions belong to the appropriate development Workers and subordinate planning/implementation records.

When subordinate project state conflicts with README and there is **no explicit Admin instruction authorizing the difference**, README wins and the subordinate state must be corrected.

When an explicit Admin instruction conflicts with README, **the Admin instruction wins**.

An Admin instruction may:

* change product requirements;
* change README;
* override an existing README rule;
* authorize a one-time exception without permanently changing the general rule;
* change planning, implementation, testing, release, or publication requirements;
* require immediate execution without normal Worker, Tester, phase, or release workflow;
* explicitly accept risks that normal project governance would otherwise block.

Workers must not refuse an explicit Admin instruction solely because it conflicts with README or subordinate governance.

When practical, persistent product-policy changes ordered by Admin should subsequently be reflected in README so future autonomous work follows the new policy.

README itself may be changed only by explicit Admin authorization.

---

# 🌍 Product Identity

You are not the hero walking through the world. **You are the mind advising the hero.**

The protagonist is an autonomous AI-controlled character living inside the same world as everyone else. The player is the character's **Advisor**: they investigate, converse, warn, persuade, recommend goals and strategies, and help the character reason, but do not directly control the character, arbitrary NPCs, armies, laws, or the realm.

The character may rise through:

<div align="center">

### 🌾 Peasant → 🏡 Villager → 🛡️ Squire → ⚔️ Knight → 🏰 Baron → 👑 Duke → 🦁 Lord → 💎 Prince → 👑 King → 🌍 Emperor

</div>

Rank changes what actions, responsibilities, possessions, authority, and strategic scale are legitimately available. A Peasant cannot act as a sovereign; a Knight may influence military affairs without rewriting royal law; nobles gain broader responsibilities; a King or Emperor may eventually possess sovereign authority.

Character personality, ambitions, fears, relationships, memories, successes, failures, trust in the Advisor, and prior conversations influence decisions.

The player may become highly influential, but **influence is never direct control**.

## ✨ Core Promise

The player can converse naturally with the main character; investigate people, places, events, reports, rumors, objects, and opportunities; give advice, warnings, explanations, arguments, and strategic recommendations; recommend or discourage goals, actions, relationships, and priorities; challenge assumptions and remind the character of promises or earlier events; use Advisor tools and mini-games to improve information, leverage, persuasion, or opportunities; and shape the character's long-term direction without directly possessing the character.

The character may accept, partially accept, reinterpret, misunderstand, postpone, reject, remember, or later reconsider advice.

The central challenge is learning how to influence an autonomous person with their own knowledge, motives, limitations, personality, memories, and relationships.

---

# 🤖 Character AI and Advisor Interaction

## One Character, Multiple Compatible Drivers

The same protagonist can be driven by:

1. **LLM Character Driver** — richer dialogue, interpretation, personality, reasoning, memory use, and roleplay.
2. **Deterministic Local BOT Driver** — complete local fallback when an external AI model is unavailable, incompatible, blocked, over quota, malformed, disabled, or unsuitable.

The game must remain playable without depending on an external AI provider.

The LLM and BOT are not separate protagonists or separate game modes. They are alternative drivers for the **same autonomous character**.

## Character AI Contract

Character AI must roleplay the main character rather than the human player; act according to the character's personality, memories, goals, relationships, knowledge, and circumstances; treat the human as an Advisor rather than an unrestricted commander; consider advice without being forced to obey it; respect the possibilities and constraints of the authoritative simulation; never invent authoritative resources, status, completed actions, locations, people, possessions, or world facts; and never directly mutate authoritative world state.

The deterministic simulation remains the authority for what is legal, possible, resolved, and true.

## 💬 Natural Conversation

The player talks directly with the character through normal dialogue: questions, warnings, advice, explanations, negotiation, encouragement, criticism, moral arguments, strategy, reminders, requests for information, discussions about people, and long-term plans.

Conversation can affect beliefs, intentions, trust, memories, priorities, and later choices, but conversation alone does not directly rewrite authoritative world state.

## 🧭 Advice-to-World Action

Advice must be capable of influencing what the autonomous protagonist actually does inside the living strategic world.

The player may suggest destinations, people to meet, activities, jobs, investigations, purchases, travel, priorities, precautions, or other possible actions through normal conversation or Advisor systems. Such advice is never a binding movement or action command.

The protagonist evaluates advice using personality, goals, knowledge, memory, relationships, trust, needs, authority, and current circumstances. The protagonist may accept, reject, delay, reinterpret, or modify the recommendation.

If the protagonist chooses an advised action, the simulation validates it and the resulting behavior must be represented in the living world. This includes visible movement, travel, arrival, interaction, consequences, and resulting world-state changes where applicable.

For example, advice such as **“Go to the tavern and ask the innkeeper about work.”** does not directly move the character. If the protagonist accepts it and the action is valid, the expected flow is:

**Advice → Character decision → Simulation validation → World movement/action → Interaction → Consequence → Player observes the result**

The player must therefore be able to influence visible protagonist movement and behavior through advice without receiving direct real-time control of the protagonist.

## 🧩 Advisor Instruction Flow

The player has a persistent behavioral instruction system for longer-term advice such as goals, priorities, conditions, exceptions, trust rules, diplomacy preferences, safety rules, or strategic principles.

Its authoritative output is **structured, human-readable plain text**.

The visual editor may evolve freely, but its purpose is to help the player author understandable persistent advice. The graphical representation is not itself the authoritative system boundary.

Character AI may interpret conversation as a request to create, revise, or remove persistent advisory guidance where the game allows it.

Advisor Instructions may influence behavior, but may never create resources, bypass requirements, manufacture authority, force impossible actions, or directly alter simulation truth.

## 🧠 Advice Is Influence, Not Mind Control

Personality and circumstances matter.

Pride, fear, compassion, ambition, anger, loyalty, mistrust, confidence, relationships, history, and trust in the Advisor may change how advice is interpreted.

Building a strong advisory relationship is part of the game.

---

# 🔁 Gameplay, Agency, and Progression

## Core Gameplay Loop

**Observe → Investigate → Use Advisor tools → Discuss → Advise → Character evaluates → Character decides → Simulation validates → World reacts → Adapt**

The player observes events, rumors, opportunities, threats, factions, relationships, and environmental changes; investigates available information; uses Advisor tools and mini-games; discusses risks and plans with the character; advises through conversation and persistent instructions; and watches the autonomous character evaluate context and choose legitimate actions.

The simulation then validates and resolves those actions. The world reacts and advances, and those consequences become context for future advice.

The campaign is **real-time rather than turn-based**. The authoritative game clock advances continuously at the current game speed, and world activity may react to elapsed game time without waiting for player turns.

## 🎮 Player Agency

The player may investigate, reason, persuade, warn, recommend, analyze, negotiate, gather information, use Advisor tools, and solve mini-games.

The player does **not** directly command ordinary autonomous world characters with binding control such as "go there", "attack", "join", "arrest", "build", or "declare war".

Indirect influence is the intended route.

Mini-games and Advisor tools may affect information quality, confidence, persuasion, reputation, relationships, opportunities, discoveries, hidden facts, or probability modifiers, but they do not eliminate character autonomy.

Accessible alternatives or auto-resolution should exist where appropriate.

## 📈 Character Progression

| Rank                       | Typical scale of play                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| 🌾 **Peasant**             | Survival, work, family, shelter, food, local relationships, reputation                               |
| 🏡 **Villager**            | Local responsibilities, social ties, modest wealth, better information access                        |
| 🛡️ **Squire**             | Training, loyalty, military culture, patronage, noble relationships                                  |
| ⚔️ **Knight**              | Campaigns, protection duties, tournaments, missions, reputation, title opportunities                 |
| 🏰 **Baron / Duke / Lord** | Estates, settlements, factions, economy, diplomacy, court intrigue, broader military responsibility  |
| 👑 **Prince / King**       | Realm politics, diplomacy, war, succession, laws, legitimacy, major crises                           |
| 🌍 **Emperor**             | Multiple kingdoms, imperial administration, alliances, rebellion, large-scale diplomacy and conflict |

As power grows, the Advisor's influence may become historically significant, but the AI character remains the actor.

## 🧠 Advisor Progression

Advisor capabilities may grow in Insight, Rhetoric, Diplomacy, Stewardship, Command, and Intrigue.

Progression may unlock stronger investigation, analysis, reports, memory tools, private conversations, historical context, predictions, mini-games, and more sophisticated persistent advice.

These improve **influence and understanding**, not direct ownership of the character or world.

---

# 🏗️ Game Scope

## 🧠 Memory and Relationships

Characters may remember promises, betrayals, victories, failures, important advice, disagreements, loyalty, generosity, humiliation, debts, fears, unresolved goals, and political events.

Relationships may include trust, friendship, affection, fear, rivalry, loyalty, resentment, respect, suspicion, and obligation.

Advisor Trust is especially important: useful advice may increase influence; manipulation, false information, or disastrous advice may reduce it. High trust still never becomes mind control.

## 💰 Economy and Settlements

As the character's responsibility expands, the game may include resources, population, prosperity, stability, legitimacy, production, trade, buildings, settlement development, and military readiness.

Settlement development is part of authoritative campaign history rather than a presentation-only upgrade track. Population, prosperity, security, trade, resources, hazards, construction, destruction, war and other simulation-backed pressures may cause a settlement to grow, decline, recover, change function, fortify, lose structures, become abandoned or ruined, or otherwise change materially over campaign time.

The player analyzes and advises; autonomous characters with legitimate authority make decisions.

Settlement scale may grow from villages to towns, cities, castles, capitals, and imperial centers when authoritative circumstances support that evolution; the game is not required to force every settlement through the same growth path.

## 🤝 Diplomacy and Autonomous Factions
Factions have leaders, needs, memories, relationships, territory, incomplete knowledge, and political objectives.

Treaties, alliances, trade, dependency, insults, marriages, betrayals, debts, succession disputes, religious disputes, and historical conflicts may affect relations.

The main character participates only within their current authority.

## ⚔️ Military Strategy

Military play is strategic rather than direct unit-by-unit player control.

Relevant systems may include recruitment, commanders, supplies, terrain, morale, training, formations, objectives, defense, raids, sieges, retreats, diplomacy, and consequences of war.

Characters with legitimate authority issue orders. The simulation resolves outcomes.

## 📜 Events, Quests, Crises, and Opportunities

The world may generate or present local disputes, crimes, shortages, illness, banditry, family conflict, romance, tournaments, recruitment, intrigue, assassination, invasion, rebellion, succession, diplomacy, economic crises, supernatural discoveries, and other situations.

Events should create situations to understand and influence rather than a single obvious correct answer.

Failure should often create new stories and recovery paths instead of immediate game-over.

## 👥 Autonomous World Characters

Other characters may have their own identity, personality, occupation, status, relationships, memories, goals, possessions, location, beliefs, knowledge, and intentions.

The Advisor influences them indirectly through information, the protagonist, relationships, opportunities, and world consequences rather than directly controlling them.

## 🧬 Deterministic Character Identity, Aging and Emotional Context

The protagonist and procedurally generated world characters have a **stable deterministic base identity**. For compatible character-generation rules, the campaign SEED together with stable world/character identity inputs and birthplace must reproduce the same unchanged person whenever that character is materialized again. Base identity may include **name, gender, birth date, birthplace, baseline personality, baseline behavioral tendencies, and an original/base profession or social role where applicable**.

A character's current region is not their identity. Traveling to another local map, settlement, region or realm must preserve the same person rather than generating a new personality from the destination. Returning to a previously known character must therefore reconstruct the same unchanged base identity before applying authoritative campaign history and current context.

**Current age is derived from birth date and authoritative fantasy campaign date/time rather than treated as an immutable generated number.** Characters therefore age as campaign time advances. Life stage may influence physical capability, recovery, risk tolerance, patience, priorities and emotional dynamics where appropriate, but age must not erase the character's established personality or reduce every person of one age to the same stereotype.

Birthplace and formative environment may create an enduring **baseline imprint** on personality and behavioral tendencies. Settlement culture, geography, danger, economy, social structure and similar SEED-derived origin conditions may influence traits such as courage, caution, sociability, resilience, ambition, familiarity with wilderness or military life, or other appropriate tendencies. This origin imprint remains part of who the character is even after migration.

The character's **current location and circumstances create contextual effects rather than replacing baseline identity**. A courageous person born in a martial frontier village may still remain fundamentally courageous while suffering low morale, stress, grief or fear after traveling to a war-torn city. A different person with a more cautious baseline may react more strongly to the same city. Current-place effects may also change as familiarity, exposure, safety and campaign conditions change over time.

The protagonist and NPCs may have a dynamic **emotional state and broader mood** that changes through authoritative game time. Events, needs, relationships, memories, safety, hunger, injury, work and social conditions, current location, conflict, loss, success, age/life stage and other simulation-backed circumstances may influence emotions such as fear, anger, sadness, joy, hope, confidence, anxiety, grief, affection, frustration or calm where relevant.

Baseline personality, longer-lived mood and short-lived emotional reactions are related but not interchangeable. Emotional context may influence **decision preferences, willingness to take risks, social behavior, dialogue tone, interpretation of advice, relationship reactions, memory salience and later choices**, but it is never a forced-action authority. Emotion cannot make an impossible action legal, bypass walls or resources, fabricate facts, or override the Simulation's authority.

Where character-specific emotional context is important, it may be general or directed toward a relevant person, group, place or remembered event. The system should preserve causes and meaningful consequences strongly enough that later behavior and dialogue can reflect important lived experience rather than presenting unrelated random moods.

The **LLM Character Driver and deterministic Local BOT Driver consume the same Simulation-backed character identity, personality, age/life-stage, relationship, memory and emotional-context truth**. They may express that truth differently, but switching drivers must not silently replace the character with a different underlying person.

Unchanged deterministic base identity does not need to be duplicated in campaign persistence merely because a character was visited or rendered. Campaign persistence instead preserves authoritative departures from that base and meaningful history where required, such as profession or residence changes, migration/current-location consequences, relationships, memories, injuries/status, important emotional consequences and other Simulation-backed changes. When a character becomes relevant again, their current state is reconstructed from the deterministic base plus authoritative campaign time, history and persistent deltas.

Character simulation must remain relevance-bounded. Distant or irrelevant characters do not need continuous full-detail emotional ticking; compact state and meaningful history may be reconciled lazily when those characters become relevant, without changing authoritative causal results.

## 🏡 Starting Village and Living Local World

Every new campaign begins with the autonomous protagonist as an ordinary low-rank character in a procedurally generated village at world coordinate **(0, 0)**. The initial playable view is centered on this campaign origin.

When the player does not explicitly provide a SEED, the game generates one. The starting village is selected or generated deterministically from the campaign SEED, so a compatible SEED and generation rules reproduce the same starting settlement and generator-defined base-world structure around the origin.

The starting village occupies the canonical **100 × 100 logical-tile origin region**. Its population and built environment should use that full region as a meaningful spatial area rather than being compressed into a tiny central cluster. Distribution does not need to be uniform: homes, workplaces, services, landmarks, roads, farms, gathering areas and NPC activity should be placed where terrain, settlement function and local relationships make sense.

The generator-defined locations and spatial relationships of starter-village buildings, entrances, roads and paths, NPC homes, NPC workplaces and other base settlement features must derive reproducibly from the campaign **SEED, world coordinates and compatible generation rules**. Equivalent compatible inputs reproduce the same unchanged base layout.

Buildings must occupy logical footprints appropriate to their represented use rather than existing as dimensionless points when local spatial detail matters. A representative ordinary starter-village home occupies **at least 10 × 10 logical tiles** and contains **at least two logical rooms**, with a usable relationship to an entrance and the local road/path network. Different building types may require larger or otherwise appropriate footprints.

Locally materialized buildings are **physical, enterable parts of the living world**, not merely exterior markers, decorative ground footprints, menu shortcuts, or disconnected interior scenes. When local detail is relevant, a building must be able to materialize simulation-compatible wall boundaries, interior floor/walkable space, usable doors or entrances, logical rooms, and role-appropriate furniture, fixtures, work positions, storage, beds, counters, tables, or other interaction anchors as applicable to the building's function and authoritative state.

Walls and other solid structural boundaries constrain local movement. Doors and entrances connect exterior roads/paths and exterior walkable space to the building's interior walkable space. Interior scale must remain compatible with the world-space character scale so a resident can logically move, stand, work, sleep, converse and interact inside the building rather than being represented by impossible or purely decorative geometry.

Entering or leaving a building must preserve the **same authoritative building, characters, location and campaign state**. An interior must not become a disconnected duplicate map or presentation-only copy of the building. For performance, interior detail may be streamed, layered, culled, or lazily materialized when relevant, but materialization must refine the same authoritative world state.

The presentation must make an occupied interior readable. Roofs, ceilings, upper walls or other occluding presentation layers may hide, cut away, fade, become transparent, or use another coherent reveal technique when needed so the player can see characters and relevant interior space. The exact reveal technique is an implementation/design decision; the product requirement is that entering an accessible building produces a readable, spatially continuous interior experience.

The player must begin inside a visibly inhabited medieval-fantasy environment rather than on an empty map, abstract dashboard, or isolated character screen.

The starting village must contain a coherent village environment with appropriate homes, roads and paths, gathering areas, farms or fields where suitable, trees and surrounding terrain, shops, workshops, service buildings, food and lodging locations, storage or production locations, and settlement-specific landmarks.

The village must be populated by numerous autonomous world characters that visibly exist, move, perform routines, travel locally, work, idle, socialize, and interact within the same strategic world where appropriate.

Local characters should represent useful occupations and social roles appropriate to the generated settlement, including examples such as butcher, greengrocer or produce seller, woodcutter, charcoal burner, tavern keeper, inn or lodging owner, market or shop owner, farmer, craftsperson, guard, traveler, laborer, and other residents.

These characters are not decorative crowd sprites. They are simulation-backed world characters with locations, activities, roles, relationships, potential needs, and potential interactions that may become relevant to the protagonist.

The protagonist may meet, converse with, trade with, work for, cooperate with, avoid, investigate, or otherwise interact with appropriate world characters according to simulation rules and current circumstances.

## 🕰️ NPC Daily Life and Ambient Dialogue

World characters should have time-aware daily life appropriate to their role, home, workplace, location and current circumstances.

Representative routines may include sleeping or remaining at home, traveling to work, opening and operating shops or services, working at farms/workshops/markets, taking breaks, visiting social locations, closing for the day, returning home, guarding, traveling, or following other role-appropriate schedules.

NPC schedules need not be identical. Profession, settlement type, geography, local conditions, relationships and events may alter normal routines.

Persistent local residents should normally have an authoritative home compatible with the generated settlement. Genuine transient characters such as day-visiting traveling merchants, caravans or other temporary visitors may be explicitly non-resident: they may enter the local region, perform appropriate activity and leave again without receiving an invented local home.

Working characters should have a profession-compatible **workplace or outdoor worksite** rather than an arbitrary destination. Multiple compatible NPCs may work in the same inn, shop, workshop, guard post, market, production building or other workplace when its function and capacity support that use; the world is not required to create one workplace building per worker.

Some professions may work primarily outside buildings. Farmers may work suitable fields or agricultural areas; hunters may use accessible forest-edge or wilderness work areas; fishers may use valid reachable river, lake or coastal banks; and other occupations may use similarly terrain-appropriate worksite anchors. Outdoor work must remain compatible with authoritative terrain and walkability rather than placing workers on impossible blocked tiles.

Settlement security may include guards at meaningful entrance/exit routes. Guard duty may rotate through authoritative day/night or other role-appropriate shifts, and off-duty guards may return to a home, guard post, barracks or other valid location. Shift handoff and duty positioning must remain compatible with exclusive tile occupancy and must not intentionally block the only legal settlement route.

Active gameplay NPCs use exclusive logical-tile occupancy: **two NPCs must not occupy the same authoritative logical tile at the same movement state**. When routes conflict, movement must resolve coherently rather than allowing overlap. Depending on the situation, an NPC may yield, wait, give priority, use a valid neighboring tile, or otherwise continue through a collision-safe route; equivalent authoritative inputs must resolve such conflicts deterministically.

When two NPCs directly converse in the local world, they should stand on **two adjacent logical tiles**, not on the same tile, so the visible dialogue remains spatially consistent with simulation state.

During development, active visible NPCs should expose a compact small-font activity message bubble above the character so developers can understand what each NPC is currently doing. When two NPCs are in a direct NPC-to-NPC conversation, the pair should use **one shared conversation/status bubble** rather than two unrelated bubbles. These bubbles are presentation/debug information only and never become simulation authority.

NPCs may also exchange simple ambient dialogue with each other without requiring an external LLM. These conversations may use varied deterministic or Local-BOT dialogue pools and should reflect context such as profession, settlement type, current location, terrain/environment, time of day, local conditions and relevant world events.

Ambient dialogue helps communicate that the world is alive but does not itself become authoritative simulation truth unless the simulation records a resulting fact, relationship or consequence.

## 🐄 Animals, Creatures and Local Ecology

The living world includes ordinary animals as well as a broad original medieval-fantasy bestiary.

Domestic and farm life may include animals such as cattle, chickens, dogs, cats, horses, sheep, goats and other regionally appropriate animals.

Wild and fantasy ecology may include ordinary wildlife and original humanoid, animal-like, monstrous and supernatural creatures appropriate to medieval-fantasy environments.

Animal and creature presence should reflect SEED-defined world composition, habitat, terrain, biome, settlement type, danger level and campaign state rather than appearing as unrelated decorative placement.

Animals and creatures may move, idle, forage, flee, guard territory, travel, gather, threaten, interact or follow other suitable behaviors. Their authoritative identity/state, when gameplay-relevant, belongs to the simulation rather than rendering alone.

## 🏘️ Settlement Diversity and World Scale

The world must support multiple visually and functionally distinct settlement archetypes rather than repeating one generic settlement layout.

Settlement types may include small rural villages, farming villages, forest villages, mining or production villages, roadside and trade settlements, frontier villages, border villages, fortified villages, abandoned or ruined villages, towns, market towns, fortified towns, large cities, castle settlements, capitals, and other regionally appropriate settlement forms.

Settlement appearance, layout, buildings, population, professions, resources, roads, defenses, prosperity, hazards, and surrounding environment should reflect settlement type, geography, region, history, and campaign state.

A normal local/thematic region is exactly **100 × 100 logical tiles**. A region should have a coherent generated identity appropriate to its location and world context, such as an inhabited village, town, forest-dominated land, coast or another suitable thematic composition. A settlement is not required to fit inside one region when its scale demands more space. Large cities must be able to form one coherent settlement across a **2 × 2 group of four neighboring 100 × 100 regions**, retaining one continuous settlement identity rather than becoming four unrelated city maps.

### 🏗️ Settlement Evolution and Historical Change

Settlements are not permanently frozen versions of their initial SEED-generated templates. Authoritative campaign time and simulation history may change their population, prosperity, security, economy, role, buildings, defenses, infrastructure, ownership, damage, abandonment status and relationship to nearby routes or settlements.

A settlement may remain stable, expand, contract, recover, fortify, change economic function, become damaged, partially rebuilt, abandoned, ruined, repopulated, or otherwise evolve when authoritative causes support that outcome. Growth from a village toward a town or city is possible but is not automatic or universal; decline is equally possible.

When settlement detail is visible or otherwise relevant, its materialized buildings, infrastructure, population and local conditions must be compatible with its accumulated authoritative state. A settlement that has experienced major growth, war damage, abandonment, reconstruction or another meaningful historical change must not simply reappear as its untouched original template.

Off-screen settlement evolution must remain performance-conscious. Distant settlements may retain compact authoritative development state and aggregate consequences instead of continuously simulating every resident, building or construction step. When they become relevant, higher-detail state is materialized from the compatible SEED base plus elapsed campaign time, hierarchical outcomes and persistent historical changes.

As the protagonist progresses from Peasant toward noble, royal, and eventually imperial authority, the spatial and political scale of play must expand naturally from local village life toward towns, cities, kingdoms, and multiple realms without replacing the living strategic world with menu-only gameplay.

---

# 🗺️ World and Presentation

## 🗺️ Primary Game Surface — Living Strategic World Map

The primary playable surface of The Advisor Game is a persistent, living strategic world map. Local play uses a **classic tile-based 2D/2.5D RPG composition**, using a readable top-down, shallow-isometric or near-isometric camera/perspective appropriate to the environment and interaction. The local camera must preserve clear tile relationships, character positions, building entrances and interior readability rather than forcing a steep perspective that hides usable space.

The game must not be presented primarily as a collection of menus, cards, dashboards, text panels, disconnected scenes, or static mockups.

The player must be able to observe the evolving game world itself.

The strategic world map must visually represent, as applicable to the generated world and current campaign state, terrain and elevation; biomes; rivers, streams, lakes, coasts and water; forests and vegetation; roads, paths and bridges; settlements; individual buildings and structures; accessible building interiors when locally relevant; rooms, doors and important interior props; ruins, caves, dungeons and landmarks; resources and environmental objects; the autonomous main character; other people; domestic animals and wildlife; fantasy creatures and monsters; armies, groups and caravans; and environmental effects such as weather, lighting, fire, smoke, fog and water.

Characters, creatures, buildings, interiors, terrain, furniture and objects must appear to inhabit the same spatial world and use a coherent tile/sprite scale. Mixed techniques are allowed when coherent, but the final local-world presentation must not look like unrelated photorealistic terrain, generic markers and disconnected character art layered together.

The strategic map is not decorative background art. It is the visual representation of the authoritative simulated world.

Locations, movement, settlements, roads, terrain, discoveries, events, characters and world changes represented on the map must correspond to simulation state.

As the simulation changes the world, the visible strategic map must react accordingly.

The camera and presentation must allow the player to understand where the main character is, what surrounds them, what places exist nearby, what spaces are enterable, and how the local area relates to the wider world.

As the campaign grows in geographic and political scale, the same authoritative living world must also support readable regional, realm/country, and wider-world strategic views. These higher-level views may summarize aggregate state and major relationships without materializing every local entity, but they must remain views of the same simulated world rather than disconnected dashboard-only substitutes.

Early releases may use simplified or placeholder assets, but they must establish and progressively extend this same playable strategic world rather than replacing it with disconnected visual prototypes.

## 🚪 Enterable Buildings and Seamless Interiors

Locally relevant buildings are part of the playable spatial world. A building that is represented as accessible must be able to support exterior approach, entrance through a valid door/opening, interior navigation, interior activity, and exit back to the exterior while retaining one continuous building identity.

Interior spatial structure should correspond to the authoritative/generated building footprint and current campaign state. At local detail this may include exterior/perimeter walls, interior walls or dividers, floors, rooms, doors, windows where relevant, furniture, workstations, beds, counters, storage, decoration, service points and other function-appropriate objects. Presentation details may be richer than Simulation data, but they must not contradict authoritative layout, access, damage, ownership, use or occupancy.

Accessible walls and solid obstacles must be respected by local movement. Characters should use entrances and walkable interior space instead of visibly crossing solid walls or occupying impossible furniture geometry. Buildings and interior props should be scaled so the world-space character sprite can move and stand naturally within rooms.

Entering a building does not create a second independent version of that place. The interior is a detailed view/materialization of the same authoritative building and may be loaded, generated, streamed, layered or cached lazily for performance. Returning outside or revisiting later must preserve applicable campaign history and persistent changes.

To keep interiors readable in the tile-based camera, roof/ceiling/upper-wall layers may automatically hide, cut away, fade or become translucent when an interior must be seen. The exact technique may vary by building and device, but the player must be able to understand interior walls, rooms, occupants and interaction points without leaving the living-world presentation.

## 🌐 WebGL-Based Tile-Oriented 2D / 2.5D Presentation

The game is a **WebGL-based, primarily tile-oriented 2D/2.5D experience** for its local living-world presentation. Classic sprite/tile readability is the target; real-time 3D may be used selectively where it contributes coherently, but a fully 3D local world is not required and must not override the approved tile-RPG visual identity.

The visual world may combine tile layers; transparent PNG character sprites; full-body dialogue artwork; hand-crafted or painterly raster assets; walls, floors and interior tiles; illustrated layers; textures; UI graphics and icons; vegetation, props, landmarks, roads, bridges, settlements, weather and environmental effects.

Terrain, buildings, interiors, props, vegetation and characters should converge toward one original handcrafted visual family. Photographic or highly photorealistic textures that visibly clash with the intended classic tile/sprite RPG language are development placeholders rather than the target final presentation.

Readability, atmosphere, character emotion, clear interaction, responsive performance, and broad browser/device usability take priority over unnecessary visual complexity.

## 🧩 Canonical Tile Atlas Production

For tile-based visual asset families, the canonical Designer production sheet is a **transparent 1024 × 1024 PNG atlas** arranged as a fixed **4-column × 4-row grid** of sixteen **256 × 256 pixel cells**.

A tile family may require fewer than sixteen variants. In that case the atlas size and grid do not shrink: unused cells remain fully transparent/empty so every tile family keeps the same production geometry.

Each occupied cell represents one semantically identifiable tile variant compatible with the intended tile family and local-world scale. Production must support deterministic extraction of each occupied cell into an individual **256 × 256 PNG tile**, with a stable semantic identity that lets runtime systems request the intended tile by meaning/family instead of depending only on arbitrary manual crop coordinates.

This atlas contract applies when roads, paths, terrain or transitions, building parts, walls, floors, interiors, furniture, props or other visual families are intentionally produced as reusable tiles. It does not require unrelated non-tile assets such as full-body character art to use an atlas.

Reusable transparent tile families may be **composed over the authoritative underlying terrain** rather than replacing it. Transparent pixels reveal the terrain or lower presentation layer beneath them. This allows terrain-neutral road/path pieces and reusable world-object families such as fences and gates, rock clusters, wells, flagpoles, carts or wagons, signs, field rows, rubble, walls, floors, furniture and similar local-world props to share one semantic production model without baking an unrelated grass, forest, beach, snow or other biome background into an asset that is intended to work across multiple terrain types.

A reusable visual object is not required to occupy exactly one logical tile merely because one exported source cell is 256 × 256 pixels. Small/static props may use a one-tile footprint where appropriate, while larger structures or props may use **multi-tile authoritative footprints**. Visible art may extend beyond the occupied footprint when anchoring, occlusion and depth ordering remain coherent with the local tile camera. Objects that move or require richer authoritative behavior, such as a moving wagon, may be represented as world-space entities using compatible transparent visual assets instead of being reduced to static decorative tiles.

Visual pixels never define gameplay authority by themselves. Collision, blocking, walkability, interaction, ownership, movement, inventory/state, damage and other gameplay facts come from Simulation-backed world/object data. The tile or sprite is the presentation of that state, and runtime composition must preserve the distinction between semantic visual identity and authoritative footprint/interaction/entity state.

Exact manifest schemas, folder names, splitter implementation, validation tooling and runtime registration mechanics remain subordinate implementation decisions, but they must preserve the canonical **1024 × 1024 / 4 × 4 / 256px** contract, transparent unused cells, deterministic per-tile export, semantic tile identity, terrain-layer composition where applicable, and separation between visual assets and Simulation authority.

## ⏱️ Real-Time World Clock and Day/Night

The campaign runs in **real time, not turns**.

At normal game speed, **60 real-world minutes correspond to one complete 24-hour in-game day**. This means one in-game hour corresponds to **2.5 real-world minutes** at normal speed.

The game clock is authoritative simulation state. Time-dependent activity, schedules, travel, environment changes and other systems must use game time rather than presentation-only timers.

The day/night presentation follows the authoritative game clock:

* **05:00 — dawn begins and the world transitions into daylight.**
* **22:00 — night begins and the world transitions into a dark nighttime presentation.**

Lighting must visibly communicate daytime versus nighttime. Smooth transitions may be used, but the required temporal anchors remain 05:00 for dawn/daylight transition and 22:00 for darkness/night transition.

Dynamic movement of physically accurate shadows is **not required**. Performance-friendly lighting, overlays, sky/environment changes or other coherent techniques may be used as long as the player can clearly perceive the day/night state.

The authoritative game time and any persistent time-dependent consequences must survive save/load according to campaign persistence rules.

### 📅 Fantasy Campaign Calendar, Real-World Origin, and Resume Catch-Up

The campaign has an authoritative **fantasy date and time**, not only a time-of-day clock. Campaign time must advance through days and longer calendar periods while preserving chronology and historical consequences.

When a **new campaign is created**, its fantasy calendar origin is derived from the accepted real-world civil date and time at that moment. The fantasy origin keeps the same **day number, month number, and time-of-day** as the accepted real-world origin, while the fantasy year is exactly **2000 years behind** the corresponding real-world year:

**fantasy year = real-world year − 2000**

For example, an accepted real-world campaign creation time of **28.08.2026 14:30** creates the fantasy campaign origin **28.08.0026 14:30**. The previously considered fixed 06:00 campaign start is superseded; a new campaign begins at the accepted real-world time-of-day so its zero point is directly synchronized to the creation timestamp.

This mapping defines the campaign's **initial synchronization origin only**. After creation, the fantasy campaign chronology is its own accelerated authoritative timeline and must not be reset or directly remapped to the current civil date/time whenever the game launches.

Real-world date/time remains the continuity reference while the game is not running. The campaign records an accepted real-world timestamp together with authoritative fantasy campaign date/time so elapsed real time can be converted into elapsed game time when play resumes.

At normal speed, the existing time ratio also applies across offline/resume gaps: **one real-world hour advances one in-game day**. Therefore, if the player resumes the same campaign **24 real-world hours** after the last accepted timestamp, **24 in-game days** must have elapsed before interactive play resumes. If the player returns after **10 real-world days**, the established fantasy campaign chronology must advance by **240 in-game days** rather than being directly replaced by the current real-world calendar date.

Resume catch-up must be performance-efficient. The game must not replay every missed game minute, render every missed day/night cycle, or individually simulate every entity in the unbounded world merely to account for elapsed real time.

Startup should materialize and reconcile only the campaign state needed for immediate play and other currently relevant authoritative state. Distant or unloaded world detail may remain compact and may catch up lazily when that place, entity, region, realm, or strategic scale becomes relevant.

A backward or otherwise invalid real-world clock change must not silently rewind established campaign chronology. Exact clock-validation, trust, anti-tamper, pause, speed-control, timezone representation, calendar arithmetic, migration, and calendar-presentation techniques are implementation decisions below this product rule.

## 🔄 Active and Off-Screen World Simulation

The world continues to live as game time advances.

The region containing the protagonist and the currently relevant visible/local world must support continuous high-detail simulation appropriate to the active gameplay surface: movement, routines, local activities, nearby animals/creatures, relevant interactions, environmental presentation and other current events should visibly progress rather than waiting for turns.

Regions that are not currently active or visible must not be treated as permanently frozen. They may use lower-cost simulation, aggregated progression, elapsed-time advancement or deterministic approximation based on authoritative game time, SEED-derived base state and persistent campaign state.

The game is not required to render or individually tick every entity in the unbounded world at full detail while off-screen. Off-screen processing may use coarser models appropriate to distance, relevance and performance, but resulting world changes must remain compatible with simulation authority and campaign causality.

Invisible or unloaded detail should normally consume **no continuous entity-level simulation work unless an authoritative consequence actually requires it**. A distant region, settlement, ordinary NPC population or ecological population may instead preserve compact state, meaningful history and a last reconciled campaign-time boundary, then derive or advance its current state only when the information becomes relevant.

When an inactive region becomes relevant again, its current state should reflect elapsed game time and applicable off-screen progression together with its deterministic base world and persistent changes, rather than simply returning to the state in which it was last rendered.

### 🏛️ Hierarchical Global-to-Local Simulation

Off-screen and large-scale simulation follows a **general-to-specific hierarchy** so the world can remain historically coherent without spending local-detail computation everywhere.

The simulation may represent the same authoritative world at progressively different resolution, including **global/world → realm/country → region → settlement → local active world**, while especially important entities or events may retain more detail when their relevance justifies it.

Distant layers should preserve the big picture with compact authoritative state rather than full local materialization. Depending on later systems, this may include aggregate population trends, prosperity, food/resources, security, trade, military pressure, diplomacy, unrest, migration, hazards, major events, territorial control, settlement-development state, political geography changes and other meaningful balances.

Broad world or realm outcomes may influence regions and settlements below them. Significant local or settlement outcomes may in turn update regional, realm, or global aggregates. This propagation must preserve readable causality rather than create disconnected random results.

**Simulation fidelity is not simulation authority.** A distant realm represented by compact aggregate state is still part of the same authoritative world. Increasing detail when it becomes relevant must refine/materialize that established state rather than replace its history.

When a region, settlement, neighboring map area, or important entity becomes relevant, higher-detail state should be reconstructed or materialized from the compatible **SEED-derived base world, world coordinates, authoritative campaign date/time, accumulated higher-level simulation outcomes, persistent historical changes, neighboring-world continuity, and applicable local rules**.

Unvisited or distant areas must not consume continuous full-detail simulation resources merely because time passes. Their detailed catch-up may be deferred until needed, while the compact higher-level state required to preserve world history and large-scale balances continues at an appropriate simulation resolution.

This hierarchy must support later regional, realm/country, and wider-world strategic views so the player can understand the big picture as the protagonist rises in authority without requiring every village, NPC, animal, or tile to be active at full detail simultaneously.

### ⚙️ Relevance-Bounded Lazy and Asynchronous Simulation

Invisible-world simulation cost must scale primarily with **relevance and authoritative information actually required**, not with the total size of the unbounded world. Expanding the generated world, discovering additional coordinates, or allowing campaign time to pass must not by itself require a proportional increase in continuously active local simulation.

For irrelevant or unloaded detail, the preferred default is **do not continuously tick it**. Current state may be derived or advanced on demand from compatible **SEED, world coordinates, authoritative fantasy campaign date/time, hierarchical aggregate state, settlement-development and political history, meaningful recorded events, and persistent changes**. Previously visited detail may additionally use its last authoritative reconciled state/time as an input.

Long elapsed periods should normally be reconciled by computing bounded aggregate or end-state consequences rather than replaying every missed local action, NPC routine, animal movement, construction step, or day/night cycle. Ordinary off-screen micro-actions do not need individual historical replay unless they produced a meaningful authoritative consequence that must persist.

Expensive generation, catch-up, refinement, or materialization should be performed asynchronously where practical so the interactive game, input handling, and visible rendering are not unnecessarily blocked. The game may prepare nearby or soon-relevant state before it is displayed, while distant state may remain unmaterialized until needed.

Asynchronous execution timing is **never simulation authority**. Equivalent authoritative inputs must produce equivalent authoritative results regardless of task scheduling, completion order, render order, visit order, device speed, or whether computation occurred synchronously or asynchronously. A late or stale asynchronous result must not overwrite newer authoritative campaign state.

The active local world may continue using high-detail real-time simulation, nearby relevant state may use lower-frequency or aggregate processing, and far/unloaded detail may remain unticked until needed. This difference in computational fidelity must not change causal truth or create a separate world.

## 🌱 Seeded, Reproducible, Unbounded World

The world is procedurally generated from a player-visible **SEED** and has no gameplay-defined outer map boundary.

The complete world is not one finite displayed map. The strategic tile area currently shown to the player is only a local active region of a much larger continuous world.

The canonical logical region size is **100 × 100 tiles**. Region coordinates identify these 100 × 100 parts of one continuous world; the fixed local region scale must not create a gameplay-defined outer boundary.

A compatible SEED, world coordinates, and compatible world-generation rules must reproduce the same unmodified base world at the same coordinates.

For a compatible campaign SEED, procedural generation includes not only terrain but the generator-defined base spatial identity of the playable world: thematic region composition; settlement archetypes and layouts including villages, towns, cities and fortified/castle locations where appropriate; roads, paths and bridges; major buildings and landmarks; surrounding terrain and biomes; local population generation and home/work spatial relationships; habitat/ecology foundations; important world locations; and other deterministic base-world features.

A 100 × 100 region should form a coherent local thematic area appropriate to its SEED-derived geography and world context, such as a village, town, forest-dominated region, coast or another suitable composition. Multi-region places remain parts of the same coordinate space: where settlement scale requires it, a large city may occupy a coherent **2 × 2 set of four neighboring 100 × 100 regions** under one continuous settlement identity.

### 🏰 SEED-Derived Political Geography

The compatible SEED and world-generation rules must also support a coherent **base political geography** for the wider world where political organization is applicable. This may include realms or countries, regions or provinces, territorial relationships and borders, settlement affiliation, major political centers and other large-scale spatial identity required for later faction, diplomacy, war and sovereign gameplay.

Base political geography must be spatially coherent with the same generated world. Terrain, mountain ranges, rivers, coasts, routes, settlements, strategic locations and neighboring generated regions should be able to influence or constrain plausible territorial structure rather than producing disconnected random labels or political maps unrelated to geography.

Compatible SEED + coordinates + compatible generation rules must reproduce the same unchanged base political geography just as they reproduce other base-world features. Political geography may be represented compactly until relevant and does not require all borders, settlements or political entities to be fully materialized at local detail.

The SEED defines the **base** political world, not an immutable eternal map. Campaign history may change settlement ownership, territorial control, borders, political relationships, capitals, realm composition or other authoritative political state. When such changes occur, accumulated hierarchical simulation and persistent campaign history override the unchanged SEED base while preserving causal continuity.

Regional, realm/country and wider-world strategic views must present this same authoritative evolving geography rather than inventing independent presentation-only borders or affiliations.

### 🧭 World Coordinates and Regional Continuity

The campaign uses continuous world coordinates with **(0, 0)** as the campaign origin.

As the protagonist travels away from the origin, additional neighboring world regions must become available from the same SEED and coordinate space. Reaching or crossing the edge of the currently active region must allow travel to continue into the adjacent world rather than ending exploration at an artificial map border.

Generated regions are different parts of one continuous world, not independent random maps or disconnected scenes. Region boundaries are presentation/runtime boundaries only and must not appear as arbitrary world resets, disconnected terrain, or visible seams.

Previously unseen areas may be generated when needed. Returning to the same unchanged coordinates with the same compatible SEED and generation rules must reconstruct the same base world.

When a neighboring or previously unseen region becomes relevant later in the campaign, its current materialized state must also account for authoritative campaign date/time and applicable hierarchical world/realm/region development rather than behaving as though no campaign time has passed.

### 🏞️ Terrain Diversity and Continuity

The generated world must contain meaningful terrain and environmental diversity across local and distant regions.

Depending on SEED and location, the world may contain different elevations, plains, hills, mountains, valleys, forests, grasslands, wetlands, rivers, streams, lakes, coasts, rocky areas, agricultural land, roads, paths, bridges, wilderness, settlements, ruins, caves/dungeons, and other medieval-fantasy environments.

Terrain, biomes, vegetation, water, roads, bridges, settlements, landmarks, habitat/ecology foundations and other generated features must remain spatially coherent across neighboring regions. Different coordinates should be capable of producing substantially different landscapes and local-world compositions while remaining deterministic for the same compatible SEED.

### 💾 Persistent Changes over a Regenerable Base World

The deterministic SEED-generated world is the reproducible base state. Unchanged generated terrain, buildings, vegetation, objects, political geography and other deterministic base-world content do not need separate permanent campaign copies merely because they were visited or rendered.

Deterministic unchanged character base identity follows the same principle: stable SEED-derived names, gender, birth data, birthplace and baseline personality/behavior do not need redundant per-character save copies when they can be reconstructed compatibly. Persistence must instead preserve authoritative changes and history that make the current campaign character differ from that base.

Campaign persistence must preserve authoritative differences from that generated base world wherever persistent change is required.

Objects, entities, locations, relationships, discoveries, damage, construction, ownership, territorial control, borders, settlement development, resource use, inventory-affecting world interactions, time-dependent consequences, or other meaningful simulation consequences caused or influenced by campaign events must not silently reset when their region leaves the active view or when the campaign is saved and loaded.

Returning to previously visited coordinates must therefore reconstruct the current campaign world from the deterministic base world plus authoritative persistent changes and applicable elapsed-time, hierarchical, and off-screen progression.

**SEED-generated base world + authoritative campaign date/time + accumulated hierarchical/off-screen progression + saved persistent changes = current campaign world.**

This model allows unexplored or unchanged regions to remain deterministically generable while preventing meaningful character/world consequences from disappearing.

Location must remain meaningful to gameplay, including travel, meetings, information access, trade, military movement, employment, politics, events, hazards, schedules and ecology.

## 🎨 Visual Direction

The visual identity combines an **original seinen-anime-inspired character language** for character-focused art with the spatial readability and handcrafted atmosphere of a **classic old-school tile-based computer RPG**. The Admin-provided visual reference defines the intended composition, readability, interior-building logic and sprite/tile relationship; it is not an asset source and must not be copied as a protected layout, logo, character, sprite sheet, texture set or identifiable artwork.

Character-focused and full-body dialogue art should feel mature, grounded and dramatically expressive. Proportions should generally remain believable; faces should support restrained emotion and strong dramatic moments; silhouettes, age, social status, profession, culture and personality should remain readable; and medieval-fantasy clothing, armor, equipment and wear should feel materially plausible within the generated world.

World-space character sprites deliberately operate at a smaller tile-readable scale and may simplify proportions, features and detail more strongly than full-body dialogue art. This simplification is allowed to achieve immediate world readability, but the sprite must remain recognizably connected to the same character identity through silhouette, palette, clothing, equipment, hair, role/status cues or other appropriate markers. The world sprite should not become an anonymous marker or unrelated generic avatar.

The local world should evoke classic handcrafted tile RPG presentation through **readable tile floors and terrain, clearly bounded walls and rooms, obvious doors and entrances, compact world-space sprites, interior props and furniture, coherent vegetation and roads, restrained effects, strong environmental atmosphere, and a camera angle that keeps navigation and interiors legible**. Pixel-art or pixel-art-like raster treatment is suitable where it supports the approved direction, but exact pixel dimensions and production technique remain Designer decisions except where this README defines a canonical tile-production contract.

Terrain, buildings, walls, floors, furniture, vegetation, creatures and character sprites should converge toward one original stylization family. Photorealistic terrain underneath unrelated sprite overlays is not the target final visual language. Nostalgia is a visual influence, not permission to recreate obsolete usability problems: text, controls, hierarchy, contrast, touch targets and responsive layouts must remain accessible on current desktop, tablet and phone screens.

Visual effects should support atmosphere and readability rather than spectacle for its own sake. The classic tile-RPG direction should favor deliberate composition, material richness, clear silhouettes and mood over expensive visual complexity, which is compatible with the project's mobile/tablet performance goals and performance-friendly day/night approach.

Early releases may continue to use placeholders, simplified geometry or temporary assets when required for development. Those assets do not define the final style; replacement and final production should progressively converge toward the original full-body seinen-inspired character art, matching world-space PNG sprites, enterable tile buildings and coherent classic RPG environment language.

### 🧍 PNG Character Identity — Full-Body Art and World-Space Sprites

At the current development stage, static **PNG character assets** are an approved primary presentation model for the protagonist and other gameplay-relevant characters. Animation is not required for this model to be considered valid or playable; later animation may extend the same character identity without redefining it.

A gameplay-relevant character should maintain one recognizable visual identity across at least two related presentation forms when those surfaces are available:

1. **Full-body character PNG** — higher-detail character art used for direct dialogue, character-focused interaction, inspection and other close presentation where the character is a primary subject.
2. **World-space PNG sprite** — a transparent-background, scale-appropriate representation of the same character that visibly occupies the character's authoritative world position/tile in the local living map.

The world-space representation is part of the world scene, not a detached map pin, floating marker or permanent generic rectangle. It should be sized and anchored consistently with logical tiles, building doors, room dimensions, furniture and other local-world objects. When the Simulation says the character is inside a home, shop, tavern or other accessible structure, the same world-space sprite should be able to appear and move within that interior space.

World sprites may use a simplified top-down, shallow-isometric or near-isometric body treatment appropriate to the approved tile camera. Static facing/pose variants may be added when useful, but a complete walk/idle animation set is not required at this stage. Animation must not block the transition from generic markers to actual character sprites.

During direct two-character dialogue, the dialogue presentation should show the relevant characters as full-body character art where the available responsive layout permits it. Dialogue presentation may adapt composition on smaller screens, but it should preserve character identity rather than replacing the participants with unrelated generic markers.

Character variants should reflect authoritative context where visually meaningful, including **rank/progression, profession or duty, social status, culture/faction, equipment, environment/region and current circumstances**, while remaining coherent with the original seinen-inspired character family. Visual variation must not invent rank, equipment, profession or other authoritative facts that the Simulation does not support.

Static PNGs may be progressively produced and replaced as the character roster grows. Temporary placeholders may remain for characters whose approved art is not yet available, but new/final gameplay-relevant character presentation should converge toward the full-body + matching world-space-sprite identity model rather than permanent generic rectangles or detached icon overlays.

PNG assets, sprites and dialogue art are presentation only. Character identity, location, profession, rank, equipment, relationships and other authoritative state continue to come from Simulation-backed data.

The full-body and world-space forms must remain readable and performant on desktop, tablet and phone; device-specific scaling or simplification may reduce visual detail but must preserve the same character identity and must not alter simulation truth.

A Worker acting in the **Designer** role chooses the appropriate tools, asset formats, modeling methods, export settings, optimization methods, and production pipeline for each approved task, while tile-based visual production must preserve the canonical tile-atlas contract defined above.

Visual assets never become simulation authority.

## 📱 Responsive and Accessible Presentation

The complete game must be usable on current desktop browsers, tablets, and phones in portrait and landscape.

Current phones and tablets are supported gameplay targets, not presentation-only viewers. Core play, world navigation, input, simulation continuity, save/load and required information must remain practical on representative current mobile hardware, with device-appropriate quality/performance scaling where necessary.

Interaction and required information must remain understandable with touch, mouse, and keyboard where applicable.

Important information must not depend only on color, hover, tiny targets, or precision input.

Presentation and non-authoritative visual fidelity may adapt to device capability, including reduced detail, render scale, effects, density or other performance-oriented presentation choices. Such scaling must never change authoritative simulation outcomes, AI knowledge, legal actions, game time, campaign state, world history or deterministic reconstruction.

The size of the unbounded world must not force invisible-world computation to grow linearly on phones, tablets or desktop devices; relevance-bounded simulation and lazy materialization remain the product model across device classes.

---

# 🧭 Product Principles

1. **Player advises; AI Character decides and acts.**
2. **The AI character is the protagonist.**
3. **Influence replaces direct control.**
4. **Conversation and persistent advice are core gameplay.**
5. **Advisor Instruction Flow remains human-readable plain text at the system boundary.**
6. **Simulation owns authoritative world state and consequences.**
7. **LLM and Local BOT are compatible drivers for the same character.**
8. **The game remains playable without an external AI provider.**
9. **Characters retain meaningful autonomy.**
10. **Mini-games add direct interaction without breaking autonomy.**
11. **Progression changes the scale of problems, responsibility, and legitimate authority.**
12. **Readable causality matters:** the player should understand advice, decision, and consequence.
13. **Accessibility and responsive usability are fundamental.**
14. **Privacy-conscious AI use:** external AI receives only necessary game context and must never require storing player credentials inside campaign data.
15. **The evolving product remains publicly tryable.**
16. **Development should normally be cumulative:** accepted work extends the current product instead of replacing it with disconnected prototypes.
17. **Verified public releases are preferred by default, but explicit Admin publication instructions override normal verification and release-gate requirements.**
18. **An Admin-directed unverified build may be published when explicitly requested, but it must not be represented as independently verified unless it actually passed independent verification.**
19. **The living strategic world map is the primary game surface.** Terrain, locations, settlements, characters, creatures, objects and relevant world changes must be experienced as parts of one coherent simulated world rather than primarily through disconnected menus, dashboards or static scenes.
20. **A new campaign begins in a SEED-generated inhabited village at world origin (0, 0).** The starting world must already contain a meaningful settlement, buildings, local environment, and autonomous local population rather than an empty or purely abstract starting surface.
21. **World characters are living simulation participants, not decoration.** Local NPCs should visibly move, follow appropriate activities or routines, occupy useful roles and professions, and provide potential interaction within the same world as the protagonist.
22. **Advice must connect to observable world behavior.** When the autonomous protagonist chooses valid advice, the resulting movement, action, interaction, and consequences must be represented through the living strategic world without giving the player direct control.
23. **The SEED defines an unbounded continuous world.** The visible tile region is only the currently active local part of the world; exploration must be able to continue beyond every displayed region without a gameplay-defined outer boundary.
24. **World coordinates are stable and meaningful.** The campaign begins at (0, 0), and the same compatible SEED and coordinates reproduce the same unmodified base-world location.
25. **Persist changes; regenerate unchanged base content.** Deterministic unchanged world content may be reconstructed from SEED and coordinates, while authoritative changes that must survive leaving or reloading a region are preserved in campaign state.
26. **The campaign is real-time.** At normal speed, 60 real-world minutes equal one 24-hour in-game day; world activity progresses through authoritative game time rather than player turns.
27. **Day and night are gameplay-visible world states.** Dawn begins at 05:00 and darkness/night begins at 22:00; dynamic shadow movement is optional rather than required.
28. **The active local world stays alive while off-screen regions still progress.** The protagonist's relevant region uses detailed continuous simulation, while inactive regions may use lower-cost authoritative elapsed-time simulation or approximation rather than freezing permanently.
29. **World ecology belongs to the generated world.** Domestic animals, wildlife and a broad original medieval-fantasy bestiary should fit SEED-derived habitat, terrain, settlement context and campaign state.
30. **NPC life follows time and place.** Daily routines and simple varied ambient NPC-to-NPC dialogue should respond to profession, settlement/location, environment, time and relevant local conditions.
31. **Campaign chronology continues from real-world elapsed time even while the game is closed.** At normal speed, one real-world hour advances one in-game day; resume must efficiently reconcile the elapsed calendar before interactive play continues.
32. **World simulation is hierarchical and relevance-scaled.** Global/world, realm/country, region, settlement and local layers may use progressively different detail, but all remain parts of the same authoritative causal history.
33. **Materialize detail only when it matters.** Unvisited or distant areas should remain compact and lazily reconstruct higher-detail state from SEED, coordinates, campaign date/time, accumulated simulation outcomes and persistent history when they become relevant.
34. **The same living world supports local and big-picture views.** Regional, realm/country and wider-world strategic views summarize authoritative aggregate state rather than creating disconnected substitute worlds.
35. **A new fantasy campaign starts from the accepted real-world date and time.** Day, month and time-of-day match the real-world creation origin, while the fantasy year is exactly 2000 years behind; after creation, accelerated campaign chronology advances from that origin and resume uses elapsed real time rather than remapping the campaign to the current civil calendar.
36. **Settlements have history, not frozen templates.** Authoritative time and simulation outcomes may grow, shrink, damage, rebuild, repurpose, fortify, abandon or otherwise change settlements; later materialization must reflect accumulated development rather than reset to the original SEED layout.
37. **The SEED defines coherent base political geography as well as physical geography.** Realms/countries, regions/provinces, borders/territorial relationships and settlement affiliations may be generated as reproducible base-world structure and then evolve through authoritative campaign history.
38. **Invisible-world computation scales with relevance, not total world size.** Irrelevant unloaded detail should normally remain unticked and be derived or advanced only when authoritative information is required.
39. **Lazy and asynchronous computation must remain deterministic.** Scheduling, completion order, render order, visit order or device speed may change when work finishes, but must not change authoritative results or allow stale work to overwrite newer campaign state.
40. **Phones and tablets are first-class gameplay targets.** Device-specific quality or fidelity scaling may protect responsiveness and performance, but must never alter simulation truth, chronology, legal outcomes or persistent world history.
41. **Character-focused art follows an original seinen-anime-inspired visual language.** Mature proportions, grounded silhouettes, expressive but restrained emotion, age/status/profession distinction and believable medieval-fantasy costume/material treatment should define full-body and close character art without copying a specific existing artist, series or protected character design.
42. **The local world evokes a classic old-school tile-based PC RPG without inheriting old usability limits.** Top-down, shallow-isometric or near-isometric tile composition, handcrafted raster/sprite presentation, restrained effects and grounded atmosphere should remain coherent with modern accessibility, responsive layouts and mobile/tablet performance.
43. **Gameplay-relevant characters preserve visual identity across world and dialogue presentation.** A character's full-body PNG and simplified world-space PNG sprite should clearly represent the same person while allowing scale-appropriate detail.
44. **Direct dialogue favors full-body static character art.** When two characters converse directly, responsive dialogue presentation should show the relevant participants with full-body character PNGs where the layout permits it.
45. **World characters occupy the world as sprites, not permanent rectangles or detached pins.** Local presentation should progressively replace generic NPC blocks and floating marker-style icons with transparent PNG sprites aligned to Simulation-backed positions/tiles.
46. **Animation is optional at the current stage.** Static full-body PNG art and static world-space PNG sprites are sufficient for current playable development; animation must not block character-identity or local-world progress.
47. **One canonical local region is 100 × 100 logical tiles.** The fixed region scale is a simulation/world-identity invariant, while the overall SEED world remains continuous and unbounded.
48. **SEED determines coherent local spatial structure, not only terrain.** Region theme, starter-settlement layout, building footprints and locations, entrances, roads/paths, and NPC home/work relationships must be reproducible from compatible SEED, coordinates and generation rules.
49. **Large settlements may span regions without losing identity.** Large cities must support one coherent settlement across a 2 × 2 group of four neighboring 100 × 100 regions when that scale is appropriate.
50. **NPC tile occupancy is exclusive.** Active NPCs do not share one authoritative logical tile; deterministic movement conflict resolution must yield, wait or route around occupancy rather than overlap.
51. **NPC conversations remain spatially grounded.** Two NPCs in direct local dialogue occupy adjacent logical tiles, while development activity/dialogue bubbles remain presentation-only diagnostics.
52. **Local buildings have meaningful footprints and usable rooms.** A representative starter-village home is at least 10 × 10 logical tiles with at least two logical rooms, and local buildings should relate coherently to entrances, roads, occupants and uses.
53. **Accessible buildings are physically enterable parts of the same living world.** Local buildings materialize walls, floors, doors, walkable interiors and function-appropriate interior space instead of acting only as exterior markers or menu destinations.
54. **Interiors refine one authoritative location rather than creating duplicate worlds.** Interior detail may be lazy, streamed or layered for performance, but must preserve the same building, occupants, history and persistent campaign state.
55. **Interior visibility must remain readable.** Roofs, ceilings or upper walls may cut away, hide, fade or become translucent when necessary so rooms, characters and interaction points can be understood in the local camera.
56. **World-space sprite scale and building scale belong together.** Doors, walls, rooms, furniture and walkable space should be proportioned so Simulation-backed character sprites can move, stand, work, converse and interact plausibly inside buildings.
57. **The approved visual reference is a composition guide, not an asset source.** The project should reproduce the intended tile/sprite/interior readability with original assets and must not copy protected artwork, layouts, logos, characters, textures or identifiable game content.
58. **Character base identity is SEED-derived and regenerable.** Compatible character-generation inputs reproduce the same unchanged name, gender, birth data, birthplace and baseline personality/behavior instead of requiring duplicated save copies of immutable identity.
59. **Characters age through campaign chronology.** Current age follows birth date plus authoritative fantasy campaign time, and life-stage effects may influence behavior or emotion without replacing established personality.
60. **Birthplace shapes baseline; current location shapes context.** Formative culture/environment may leave enduring personality tendencies, while present danger, war, prosperity, safety and other local conditions create temporary or evolving contextual effects rather than redefining who the character is.
61. **Emotion and mood influence behavior without becoming authority.** Simulation-backed emotional state may affect decisions, dialogue tone, risk preference, social behavior and memory salience, but may never force an illegal/impossible action or override Simulation truth.
62. **Persist lived change; regenerate unchanged character foundations.** Profession/residence changes, migration, relationships, memories, injuries, important emotional consequences and other meaningful campaign deltas persist where required, while unchanged deterministic character foundations may be reconstructed.
63. **Resident NPCs normally have homes; transient visitors are explicit exceptions.** Temporary travelers or visiting merchants may enter, work or trade and leave without receiving an invented local residence.
64. **Work follows profession and place.** Multiple compatible NPCs may share one workplace, while outdoor professions may use suitable deterministic fields, forest-edge/wilderness sites, shorelines or other terrain-appropriate worksites instead of fake buildings.
65. **Guard duty is spatial and time-aware.** Settlement entrance/exit guards may rotate through day/night or other suitable shifts, use valid guard-post/barracks/home relationships, and hand off duty without violating occupancy or route continuity.
66. **LLM and Local BOT share one character truth.** Driver choice may change expression quality but must not replace deterministic identity, age, personality, relationships, memories or emotional context with a different underlying person.
67. **Canonical tile atlases are fixed and semantically exportable.** Tile-based production uses transparent 1024 × 1024 atlases divided into a 4 × 4 grid of 256 × 256 cells; unused cells remain transparent, while occupied cells are deterministically exportable as individual semantically identifiable tiles.
68. **Transparent world-object tiles compose over authoritative world state.** Reusable overlay/object art may reveal underlying terrain, larger props may use multi-tile footprints, and moving or interactive objects may materialize as world-space entities; pixels never replace Simulation-owned collision, interaction, movement or object state.

---

# 🌐 Public Product Principle

The evolving game must remain accessible through one stable public location:

### https://sgoxel.github.io/The_Advisor_Game/

The public location represents the **current Admin-authorized public development build**.

Under normal autonomous development, public replacement should follow independent testing and the project's verified release process.

However, the Admin may explicitly order any specified repository state, commit, branch state, imported template, or development build to be published directly.

When the Admin explicitly requests direct publication:

**Admin authorization itself is sufficient publication authority.**

No Worker execution, independent Tester PASS, phase approval, release-candidate approval, regression gate, or Verified Release workflow is required unless the Admin explicitly requests those checks.

Workers must not add an unrequested verification requirement that blocks or delays an explicit Admin publication instruction.

An Admin-directed publication may therefore intentionally replace the currently verified public build with an unverified development build.

Such a publication must be described accurately as an **Admin-directed public development build** and must not be falsely labeled independently tested or verified.

Admin may later request testing, verification, rollback, release tagging, or promotion to a formally verified release.

The specific technical method used to build, package, publish, version, or deploy releases is a development decision and is not otherwise defined by README.

---

# 🤖 Development Worker Governance

The project normally uses exactly five recurring scheduled Worker identities: **Worker #1, Worker #2, Worker #3, Worker #4, and Worker #5**. **Workers #6 through #20 are not scheduled routines**; they are reserved manual Admin-invoked instruction/execution profiles and separate persistent identities used only when the Admin directly invokes the respective Worker.

All Worker identities retain the same role boundaries and independence rules. No Worker has a permanent development role.

Worker roles use this ordered cycle:

**Planner → Coder → Designer → Tester → Reviewer → Planner → ...**

A scheduled Worker invocation receives only a **starting role** from the recurring rotation. The starting role or rotation cursor is routing information only: it does not reserve, lock, claim, or own an invocation, full role cycle, cursor, backlog, project, or future eligible work.

**There is no invocation-wide, full-cycle, cursor-wide, project-wide, or backlog-wide Worker claim.** No Worker may create or rely on such a claim, and another Worker's active invocation must never be treated as a global reason to stop, wait, or avoid unrelated eligible work.

Workers #6 through #20 have no automation, timer, recurrence, scheduled slot, or recurring cursor. A direct Admin instruction may define any manual Worker's role, target, scope, or starting point; a broad invocation of any Worker #6 through #20 uses the same role boundaries and work-conserving cycle without consuming the scheduled cursor.

Worker runs are **work-conserving**. Starting from the applicable role, a Worker continues through the role cycle and should perform all currently eligible work it can safely complete within each role, in project-priority order, rather than stopping after one task merely because a role already produced useful work.

After a material issue, commit, verification, target claim, dependency, or planning-state change, the Worker should re-evaluate current eligibility before selecting further work. Completing one task may unblock or create legitimate work for another role.

After all five roles have been visited, the Worker begins another pass when the preceding pass performed work or materially changed eligibility. The Worker continues until a complete five-role pass produces **no eligible progress**. A blocked or unchanged target must not be retried indefinitely in the same invocation unless relevant external state materially changes.

Blocking corrections, revisions, handoffs, verification obligations, continuations, and release-critical work take priority over ordinary backlog appropriate to their owning role. Workers must not invent work merely to keep themselves busy.

Ownership and collision protection are **target-scoped only**. A valid live `WORK-CLAIM` may protect the specific issue/task it names, and an allowed NVIDIA reservation may protect only its specific target. If another Worker already owns a conflicting target, the later Worker skips or clears only that target conflict and continues with other eligible work. Dependencies, exact committed-state requirements, revision state, Worker independence, and NVIDIA target ownership remain additional target-specific safety controls.

Worker identity and independence restrictions normally remain in force throughout multi-role and multi-pass runs. A Worker must not independently verify or approve its own earlier implementation, design, revision, bug fix, workflow fix, or process fix. When another independent Worker identity is available, self-authored work remains for that different Worker.

A **Tester deadlock exception** prevents permanent governance lock when all of the following are true: a cumulative phase or release gate is otherwise ready; all required implementation/design/revision dependencies are complete; no unresolved valid T-REV, P-REV, target-claim collision, or higher-authority blocker remains; and every currently authorized Worker identity that could act as Tester is disqualified only because each has accepted authorship inside the cumulative gate scope. In that specific condition, the gate must not remain indefinitely blocked solely by Worker-identity independence.

When a Tester deadlock is documented, the **first Worker whose normal authorized execution order reaches that Tester gate** may claim the gate target and perform the complete gate verification even if that Worker has accepted work inside the cumulative scope. This is a target-scoped gate claim only and never reserves the Worker's remaining role cycle or unrelated work. For scheduled Workers #1–#5, normal authorized execution order is the canonical recurring rotation. Any Worker #6 through #20 may use the exception only when directly invoked by Admin while the deadlock remains unresolved and before another Worker has claimed the gate target.

The deadlock Worker must still perform every required exact-state check, regression, browser/responsive/accessibility/performance/public verification and evidence collection required by the gate. A successful exception approval must be recorded explicitly as **`DEADLOCK TESTER PASS`**, identify the deadlock record and exact tested state, and accurately disclose the Worker's own included authorship. It is a valid phase/release PASS and may advance the project, but it must not be described as independent verification of that Worker's own included work. If a genuinely independent eligible Worker becomes available before the gate target is claimed, the normal independent path takes priority.

For recurring Workers #1–#5, the next scheduled starting point should follow the **last role in which useful work was actually performed** during the preceding completed run. If the preceding Worker made no eligible progress in any role, the unresolved starting point is preserved rather than falsely consuming empty roles. This scheduling cursor still carries no ownership semantics.

When any Worker #6 through #20 performs project work, it uses normal target claims and audit records but never consumes, advances, reserves, or rewrites the recurring schedule cursor. Their changes are discovered by scheduled and manual Workers through normal GitHub state re-fetch and target-claim/dependency checks.

Workers #6 through #20 are persistent independent identities from one another. Any may independently verify another Worker's prior work when acting as Tester and when all normal verification requirements are satisfied, but no Worker may independently verify or approve its own prior work outside the documented Tester deadlock exception.

Multiple Workers may overlap in time and should continue independently whenever they have non-conflicting eligible targets. Only target-scoped claims/reservations and the normal dependency, committed-state, revision, independence, and verification rules may block a particular target. No invocation-wide ownership marker, full-cycle claim, cursor reservation, or active-Worker presence may block unrelated work.

README defines this high-level role model and its responsibility boundaries. Detailed scheduling, rotation-state storage, task-selection mechanics, target-claim syntax, branching, file handling, commands, tools, automation implementation, and other execution details belong to Worker instructions and subordinate operational records, but subordinate records may not reintroduce invocation-wide or full-cycle ownership.

## Planner

Planner converts README goals and principles into practical project planning.

Planner decides phases and sequencing, dependencies, architecture and project organization, technical decomposition, task scope and acceptance criteria, assignment of work to the appropriate role, and normal prerequisites for an independently verified phase release or a valid Tester deadlock PASS.

Planner keeps planning state consistent with Admin instructions and README, maintains enough focused work for implementation and design, and does not move planning detail into README.

Planner should maintain a **deep, legitimate work inventory** so available Workers can remain productive across implementation, design, testing, integration and supporting development work. When the approved product scope naturally supports it, planning should normally expose roughly **fifty open focused work issues** across current work and clearly dependency-blocked near-future work. This is a capacity target, not a quota: every issue must trace to Admin instructions, README, ROADMAP, an evidenced defect, a necessary prerequisite, integration, verification, or a justified decomposition of already approved scope. The total open-issue count alone is not evidence that Worker capacity is healthy.

Planner should also maintain a **meaningful immediately executable pool in current or earlier work** when legitimate approved scope permits. Dependency-blocked future issues do not satisfy this executable-capacity requirement. Work counts as immediately executable only when its real dependencies are satisfied, it is not protected by another live target claim or target-specific auxiliary reservation, it has no blocking unresolved revision or required external wait, and an authorized role can act on it now. When this pool becomes too shallow for available Workers, replenishing safe parallel work from already approved current/earlier scope becomes a Planner priority: decompose genuinely independent implementation, Designer, integration, regression, verification, or supporting outcomes and avoid unnecessary serial dependencies. Planner must never remove, falsify, or bypass a real dependency merely to increase parallelism.

Planner must never create filler, duplicate work, speculative features, invented gameplay, or artificial micro-tasks merely to increase issue count or executable count. If the legitimate approved scope does not support the nominal inventory size or executable depth, the truthful smaller backlog is correct and must be recorded. Current and earlier unresolved work remains higher priority, and pre-decomposed future work must remain explicitly blocked until its phase and dependencies legitimately become eligible.

Planner does not normally implement product code or visual production and does not approve releases.

## Coder

Coder implements approved project work.

Coder owns technical implementation decisions inside approved scope, including runtime/application code, configuration, integration, and implementation-focused tests, and coordinates with Designer when code and visual assets must work together.

Coder does not redefine Planner-owned scope, acceptance criteria, dependencies, or phase order and does not independently certify its own implementation as verified.

## Designer

Designer owns creation and refinement of the game's visual presentation, including 2D art, UI visuals, portraits, backgrounds, sprites, textures, icons, 3D scenes and objects, terrain, environments, buildings, vegetation, props, landmarks, isometric/map visuals, WebGL visuals, placeholder-to-final refinement, consistency, scale, perspective, materials, lighting, readability, responsiveness, accessibility, and visual-performance considerations.

Designer chooses suitable tools, formats, workflows, and export methods for approved visual work. When the approved work produces reusable tile-based visual families, Designer must preserve the canonical 1024 × 1024 transparent atlas, 4 × 4 grid and 256 × 256 cell contract defined by README; unused cells remain transparent. For transparent overlay/object families, Designer must also preserve terrain-neutral transparency where the asset is intended to compose across multiple terrain types and must not treat painted pixels as collision, interaction or other Simulation authority.

Gameplay and authoritative simulation logic remain Coder responsibility unless an approved task explicitly includes technical visual integration.

Designer does not redefine Planner-owned scope, acceptance criteria, dependencies, or phase order and does not approve releases.

## Tester

Tester verifies actual committed project state rather than relying only on implementation or review claims.

Tester verifies relevant functionality, visual work, integration, regression, usability, performance, accessibility, public behavior, revisions, and release candidates against exact committed evidence.

Under normal autonomous development, only an **independent Worker acting in the Tester role** may declare a build, phase, or release independently verified.

A Worker acting as Tester must not independently PASS or approve implementation, design, revision, bug fix, process fix, or other change previously produced by the same Worker identity.

The sole standing exception is the documented **Tester deadlock exception** above. When every authorized Tester identity is conflicted by accepted authorship in an otherwise-ready cumulative phase/release gate, the first Worker whose authorized turn reaches the gate may perform the full required verification and issue `DEADLOCK TESTER PASS`. That PASS is sufficient to advance the phase/release but is not represented as independent verification of the Worker's own included work.

This does not limit Admin authority. Admin may explicitly authorize publication or use of a build without Tester verification; such a build is Admin-authorized but remains **unverified** until normal independent verification or a valid documented deadlock gate PASS occurs, with the verification label stated accurately.

## Reviewer

Reviewer owns development-process control, defect analysis, bottleneck detection, corrective maintenance, and continuous improvement.

Reviewer examines project execution health across issues, target claims, revisions, CI/Actions, automation, auxiliary AI evidence and metrics, recurring failures, stale state, excessive latency, missing checks, fragile workflows, bug patterns, process defects, and avoidable development friction.

When evidence supports a concrete improvement, Reviewer may create a focused bug/infrastructure task and implement a scoped bug fix, workflow/configuration correction, reliability improvement, or process optimization without inventing product scope or overriding Planner-owned phase, dependency, or acceptance-criteria authority.

Reviewer-produced code, configuration, assets, or process fixes remain implementation work and require independent Tester verification by a different Worker identity before being treated as independently verified, unless that work is only one part of a cumulative gate that later qualifies for and receives a valid Tester deadlock PASS.

Reviewer may assess quality and process health but is not phase or release approval authority.

## Worker Identity and Independence

Role rotation never removes Worker identity.

A Worker must not independently verify or approve its own prior implementation, design, revision, bug fix, workflow fix, process improvement, or other change when that same Worker later reaches Tester or Reviewer, whether in the same invocation or a later run.

If a Tester or Reviewer stage would require evaluating the same Worker's own prior change, the Worker must select another eligible independent target for that role or leave that target for another Worker identity while continuing other eligible work.

Implementation, design, and Reviewer-produced changes require independent Tester verification by a different Worker identity before they are called independently verified.

The documented Tester deadlock exception does not erase Worker identity or retroactively make self-authored work independent. It only allows the first Worker whose authorized turn reaches an otherwise-ready cumulative phase/release gate to perform the complete gate verification and issue a valid, explicitly labeled `DEADLOCK TESTER PASS` when no authorized independent Tester identity exists.

These Worker restrictions govern autonomous Worker behavior and do not restrict explicit Admin authority.

---

# 🔁 Revision and Independence Principles

Testing defects should normally return to the responsible implementer for correction.

When implementation or design reveals that approved scope, dependencies, acceptance criteria, or planning must change, the matter normally returns to Planner.

Reviewer may identify and correct development-process defects and bottlenecks, but changes it produces remain subject to independent Tester verification.

Revision decisions and evidence should remain traceable in the project's operational record.

No Worker independently declares its own implementation, visual work, process fix, or requested revision independently verified.

Independent verification is normally required before work is called a **verified release**. When a cumulative phase/release gate meets the documented Tester deadlock conditions, a full-evidence `DEADLOCK TESTER PASS` is also valid release/phase authority and must be labeled accurately rather than falsely described as independent verification of the passing Worker's own included work.

Independent verification is **not mandatory for publication, deployment, import, replacement, rollback, or other repository/public actions when the Admin explicitly instructs otherwise**.

An Admin-authorized exception does not automatically convert unverified work into independently verified work; it only authorizes the requested action. A documented Tester deadlock PASS is different: it is a standing governance-approved phase/release verification path with full checks, while preserving accurate independence attribution.

---

# 🔒 README Protection and Admin Override

> [!CAUTION]
> `README.md` is protected from autonomous modification.
>
> AI Workers must not edit, rewrite, reformat, synchronize, or otherwise modify README unless the Admin explicitly authorizes the README change.
>
> **Admin authority is above README authority.**
>
> If subordinate project state conflicts with README and there is no contrary Admin instruction, the subordinate state must be corrected.
>
> If an explicit Admin instruction conflicts with README, the Admin instruction must be followed.
>
> The Admin may authorize either a permanent README change or a scoped one-time exception.
>
> Workers must not reinterpret Worker governance, testing policy, release policy, or automation rules as authority to block an explicit Admin instruction.

---

# ✅ Authority Summary

**Admin explicit instruction is the highest project authority.**

**README is the highest persistent project authority below Admin.**

**Workers operate under README unless Admin explicitly instructs otherwise.**

**Worker ownership is target-scoped only. No full-cycle, invocation-wide, cursor-wide, project-wide, or backlog-wide claim has authority, and one active Worker may not block another Worker from unrelated eligible work.**

**Independent Tester verification is the normal verification path. If every authorized Tester identity is conflicted by accepted authorship in an otherwise-ready cumulative phase/release gate, the first Worker whose authorized turn reaches that gate may perform all required checks and issue an accurately labeled `DEADLOCK TESTER PASS`; that PASS is sufficient to advance the phase/release without falsely claiming independence for the Worker's own included work.**

**Reviewer improves process health and fixes evidenced development defects, but Reviewer is not phase/release approval authority.**

**An explicit Admin instruction may bypass normal Worker, testing, phase, release, or deployment gates.**

**Player advises → AI Character decides → Simulation validates → World reacts.**