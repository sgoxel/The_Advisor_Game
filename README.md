<div align="center">

# 🏰 The Advisor Game

### 🧠 Advise an autonomous AI character. Shape a life. Change a kingdom. Maybe build an empire.

**A medieval fantasy roleplaying and strategy game where the human player advises an autonomous AI-controlled main character as they rise from Peasant to Emperor.**

### 🎮 [Play the Latest Tested Development Release](https://sgoxel.github.io/The_Advisor_Game/)

[🏷️ Latest GitHub Release](https://github.com/sgoxel/The_Advisor_Game/releases/latest) · [🌐 Public Game](https://sgoxel.github.io/The_Advisor_Game/)

</div>

> [!IMPORTANT]
> **Core rule:** The human player advises. The autonomous AI character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

---

# 📜 README Authority

`README.md` defines the **product scope, fundamental principles, non-negotiable rules, and high-level way of working** for The Advisor Game.

It defines **WHAT the project is and what must remain true**, not HOW individual Workers must technically implement it.

README does **not** prescribe:

- project architecture;
- repository or file structure;
- module names;
- implementation order;
- roadmap phases;
- task decomposition;
- programming libraries or frameworks beyond product-level platform requirements;
- asset formats, modeling tools, export pipelines, filenames, or directories;
- detailed testing, deployment, branching, release, or automation procedures.

Those decisions belong to the appropriate development Workers and subordinate planning/implementation records.

When a subordinate plan, task, implementation, asset, test, or assumption conflicts with README, **README wins** and the subordinate work must be corrected.

README itself is protected and may be changed only with explicit Admin authorization.

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

The player can:

- converse naturally with the main character;
- investigate people, places, events, reports, rumors, objects, and opportunities;
- give advice, warnings, explanations, arguments, and strategic recommendations;
- recommend or discourage goals, actions, relationships, and priorities;
- challenge assumptions and remind the character of promises or earlier events;
- use Advisor tools and mini-games to improve information, leverage, persuasion, or opportunities;
- shape the character's long-term direction without directly possessing the character.

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

Character AI must:

- roleplay the main character rather than the human player;
- act according to the character's personality, memories, goals, relationships, knowledge, and circumstances;
- treat the human as an Advisor rather than an unrestricted commander;
- consider advice without being forced to obey it;
- respect the possibilities and constraints of the authoritative simulation;
- never invent authoritative resources, status, completed actions, locations, people, possessions, or world facts;
- never directly mutate authoritative world state.

The deterministic simulation remains the authority for what is legal, possible, resolved, and true.

## 💬 Natural Conversation

The player talks directly with the character through normal dialogue: questions, warnings, advice, explanations, negotiation, encouragement, criticism, moral arguments, strategy, reminders, requests for information, discussions about people, and long-term plans.

Conversation can affect beliefs, intentions, trust, memories, priorities, and later choices, but conversation alone does not directly rewrite authoritative world state.

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

1. **Observe** events, rumors, opportunities, threats, factions, relationships, and environmental changes.
2. **Investigate** the world and available information.
3. **Use Advisor tools or mini-games** to improve information, leverage, or opportunity.
4. **Discuss** events, risks, goals, and plans with the character.
5. **Advise** through conversation and persistent Advisor Instructions.
6. **Character AI evaluates** state, personality, memories, relationships, knowledge, advice, and circumstances.
7. **Character chooses** among actions legitimately available to them.
8. **Simulation validates and resolves** actions and consequences.
9. **World reacts and advances.**
10. **Consequences become new context** for future advice.

<div align="center">

### Observe → Investigate → Advise → Character decides → World reacts → Discuss → Adapt

</div>

## 🎮 Player Agency

The player may investigate, reason, persuade, warn, recommend, analyze, negotiate, gather information, use Advisor tools, and solve mini-games.

The player does **not** directly command ordinary autonomous world characters with binding control such as "go there", "attack", "join", "arrest", "build", or "declare war".

Indirect influence is the intended route.

Mini-games and Advisor tools may affect information quality, confidence, persuasion, reputation, relationships, opportunities, discoveries, hidden facts, or probability modifiers, but they do not eliminate character autonomy.

Accessible alternatives or auto-resolution should exist where appropriate.

## 📈 Character Progression

| Rank | Typical scale of play |
| --- | --- |
| 🌾 **Peasant** | Survival, work, family, shelter, food, local relationships, reputation |
| 🏡 **Villager** | Local responsibilities, social ties, modest wealth, better information access |
| 🛡️ **Squire** | Training, loyalty, military culture, patronage, noble relationships |
| ⚔️ **Knight** | Campaigns, protection duties, tournaments, missions, reputation, title opportunities |
| 🏰 **Baron / Duke / Lord** | Estates, settlements, factions, economy, diplomacy, court intrigue, broader military responsibility |
| 👑 **Prince / King** | Realm politics, diplomacy, war, succession, laws, legitimacy, major crises |
| 🌍 **Emperor** | Multiple kingdoms, imperial administration, alliances, rebellion, large-scale diplomacy and conflict |

As power grows, the Advisor's influence may become historically significant, but the AI character remains the actor.

## 🧠 Advisor Progression

Advisor capabilities may grow in areas such as:

- Insight
- Rhetoric
- Diplomacy
- Stewardship
- Command
- Intrigue

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

The player analyzes and advises; autonomous characters with legitimate authority make decisions.

Settlement scale may grow from villages to towns, cities, castles, capitals, and imperial centers.

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

---

# 🗺️ World and Presentation

## 🌐 WebGL-Based Mixed 2D / 3D Presentation

The game is a **WebGL-based mixed 2D/3D experience** with an isometric or near-isometric presentation.

The visual world may combine:

- real-time 3D scenes and objects;
- 2D portraits and character artwork;
- illustrated or layered backgrounds;
- sprites and overlays;
- textures and materials;
- UI graphics and icons;
- terrain, buildings, vegetation, props, landmarks, roads, bridges, settlements, and environmental effects.

2D and 3D content must feel like parts of the same coherent game world rather than disconnected visual prototypes.

Readability, atmosphere, character emotion, clear interaction, responsive performance, and broad browser/device usability take priority over unnecessary visual complexity.

## 🌱 Seeded, Reproducible, Extensible World

The world is procedurally generated from a player-visible **SEED**.

A compatible SEED and world-generation rules should reproduce the same base world and regions, including the major environmental and settlement structure that belongs to procedural generation.

The world may include:

- biomes and terrain variation;
- rivers, lakes, coasts, roads, and paths;
- settlements and growth anchors;
- buildings and landmarks;
- trees, rocks, vegetation, bridges, signs, props, and resources;
- deterministic visual variation.

Campaign changes such as destruction, upgrades, ownership, relationships, discoveries, politics, or other consequences may alter the world after generation.

Location must remain meaningful to gameplay, including travel, meetings, information access, trade, military movement, employment, politics, events, and hazards.

## 🎨 Visual Direction

The visual direction should support:

- coherent isometric / near-isometric presentation;
- high-quality 2D and 3D assets;
- readable silhouettes, scale, perspective, and scene composition;
- character emotion and atmosphere;
- visually distinct settlements, environments, objects, and landmarks;
- lighting, weather, particles, water, smoke, fire, fog, and vegetation motion where appropriate;
- progressive improvement from early placeholders to polished visual assets without breaking verified functionality.

The Graphic Designer Worker chooses the appropriate tools, asset formats, modeling methods, export settings, optimization methods, and production pipeline for each approved task.

Visual assets never become simulation authority.

## 📱 Responsive and Accessible Presentation

The complete game must be usable on current desktop browsers, tablets, and phones in portrait and landscape.

Interaction and required information must remain understandable with touch, mouse, and keyboard where applicable.

Important information must not depend only on color, hover, tiny targets, or precision input.

Presentation may adapt to device capability, but visual quality scaling must never change simulation outcomes, AI knowledge, legal actions, or campaign state.

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
16. **Development is cumulative:** accepted work extends the last verified product instead of replacing it with disconnected prototypes.
17. **Broken or unverified work never replaces the latest independently verified public build.**

---

# 🌐 Public Product Principle

The evolving game must remain accessible through one stable public location:

### https://sgoxel.github.io/The_Advisor_Game/

Early development should prioritize a usable public interface where the current verified product can be tried manually.

Each completed development phase should result in an independently tested, manually usable cumulative release.

The specific technical method used to build, package, publish, version, or deploy releases is a development decision and is **not defined by README**.

---

# 🤖 Development Worker Governance

The project uses five recurring development Workers.

README defines their **high-level responsibility and fallback relationship**, while detailed task selection, scheduling, branching, file handling, commands, tools, and execution procedures belong to Worker instructions and planning records.

| Worker | Primary responsibility | Fallback role |
| --- | --- | --- |
| **Planner Worker** | Planning and coordination | Tester |
| **Coder Worker #1** | Implementation | Graphic Designer |
| **Coder Worker #2** | Implementation | Graphic Designer |
| **Graphic Designer Worker** | 2D/3D visual design and asset creation | Coder |
| **Tester Worker** | Independent verification and release approval | Planner |

## Planner

Planner converts README goals and principles into practical project planning.

Planner decides, as needed:

- phases and sequencing;
- dependencies;
- architecture and project organization;
- technical decomposition;
- task scope and acceptance criteria;
- assignment of work to the appropriate role;
- what must be completed before a phase can be independently released.

Planner does not move these decisions into README.

## Coder

Coder implements approved project work.

Coder owns technical implementation decisions inside approved scope and coordinates with Graphic Designer when code and visual assets must work together.

Coder does not redefine product principles or independently approve its own implementation.

## Graphic Designer

Graphic Designer owns the creation and refinement of the game's visual presentation, including:

- 2D art and UI visuals;
- portraits, backgrounds, sprites, textures, icons, and supporting artwork;
- 3D scenes, objects, terrain, environments, buildings, vegetation, props, and landmarks;
- isometric/map visual prototypes;
- WebGL visual prototypes and preview scenes;
- placeholder-to-final visual refinement;
- visual consistency, scale, perspective, materials, lighting, readability, responsiveness, and visual-performance considerations.

Graphic Designer chooses suitable tools, formats, workflows, and export methods for the assigned work.

Gameplay and simulation logic remain Coder responsibility.

## Tester

Tester independently verifies the actual completed project state rather than relying only on implementation claims.

Tester verifies relevant functionality, visual work, integration, regression, usability, performance, and public behavior.

Only the dedicated Tester may approve a phase/release as independently verified.

## Fallback Principle

Primary-role work always has priority.

A Worker may use its defined fallback role only when its primary role has no eligible work requiring attention.

Fallback is limited to **one role transition**; fallback chaining is not allowed.

A Worker acting in fallback follows the responsibility boundaries of that fallback role.

No Worker may independently approve its own implementation or design work.

Planner acting as fallback Tester cannot approve a phase/release.

Tester acting as fallback Planner does not gain additional release authority from planning work.

---

# 🔁 Revision and Independence Principles

Testing defects should return to the responsible implementer for correction.

When implementation or design reveals that approved scope, dependencies, acceptance criteria, or planning must change, the matter returns to Planner.

Revision decisions and evidence should remain traceable in the project's operational record.

No Worker independently approves its own implementation, visual work, or requested revision.

Independent verification is required before work becomes part of a verified release.

---

# 🔒 README Protection

> [!CAUTION]
> `README.md` is protected.
>
> AI Workers must not edit, rewrite, reformat, synchronize, or otherwise modify README unless the Admin explicitly authorizes that specific README change.
>
> If implementation, testing, design, planning, or existing project data conflicts with README, the subordinate project data must be corrected rather than silently rewriting README.

---

# 🤝 Contributing

Useful contributions should preserve:

- the autonomous-character model;
- deterministic simulation authority;
- local BOT fallback;
- player influence rather than direct control;
- responsive and accessible presentation;
- the mixed 2D/3D WebGL visual direction;
- cumulative public usability;
- appropriate independent verification.

Features should deepen:

<div align="center">

## 🧠 Player Advice → 🤖 Autonomous Character Decision → 🌍 World Consequence

</div>

rather than replacing it with conventional direct control.

---

# 📄 License

See [LICENSE](LICENSE).

---

<div align="center">

### 🏰 The Advisor Game

**Advise wisely. The character may listen. The world will remember.**

🎮 [Play Latest Release](https://sgoxel.github.io/The_Advisor_Game/) · 🏷️ [Latest GitHub Release](https://github.com/sgoxel/The_Advisor_Game/releases/latest)

</div>
