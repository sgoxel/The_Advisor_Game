<div align="center">

# 🏰 The Advisor Game

### 🧠 Advise an autonomous AI character. Shape a life. Change a kingdom. Maybe build an empire.

**A fully client-side medieval fantasy roleplaying and strategy game where the human player advises an autonomous AI-controlled main character as they rise from Peasant to Emperor.**

<p>
  <img alt="Development Status" src="https://img.shields.io/badge/status-early%20development-orange">
  <img alt="Platform" src="https://img.shields.io/badge/platform-HTML5%20%2B%20WebGL2-blue">
  <img alt="AI" src="https://img.shields.io/badge/AI-LLM%20%2B%20Local%20BOT-purple">
  <img alt="Hosting" src="https://img.shields.io/badge/hosting-GitHub%20Pages-black">
  <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-green">
</p>

<p align="center">
  <img src="_githubpage/img/Concept Map Generation.png" width="720" alt="Procedurally generated isometric world map from The Advisor Game">
</p>

### 🎮 [Play the Latest Tested Development Release](https://sgoxel.github.io/The-Advisor-Game/)

[🏷️ Latest GitHub Release](https://github.com/sgoxel/The-Advisor-Game/releases/latest) · [📘 Implementation specification](SPEC.md) · [🌐 GitHub Pages](https://sgoxel.github.io/The-Advisor-Game/)

</div>

> [!IMPORTANT]
> **Core rule:** The human player advises. The autonomous AI character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

> [!NOTE]
> **Development status:** early prototype. The procedural WebGL map, movement, minimap, map import/export, settings, and English/Turkish UI foundation exist. The autonomous main character, LLM/BOT system, advisory interaction system, instruction-flow panel, campaign, economy, diplomacy, military, character relationships, and settlement systems described below are the product direction, not a claim that every feature is already playable.

---

## 🌍 The Fantasy

You are not the hero walking through the world.

**You are the mind advising the hero.**

The game's **main character is an autonomous AI-controlled character** driven by the Character AI system. Depending on configuration and availability, this character may be controlled by an external LLM or by a deterministic local BOT implementation.

The main character begins with little status or power and may rise through the entire social hierarchy:

<div align="center">

### 🌾 Peasant → 🏡 Villager → 🛡️ Squire → ⚔️ Knight → 🏰 Baron → 👑 Duke → 🦁 Lord → 💎 Prince → 👑 King → 🌍 Emperor

</div>

The human player acts as the character's **Advisor**.

You talk to the character, give advice, warn them, persuade them, suggest goals, investigate situations, discuss alternatives, and help shape how they think about the world.

But the character remains autonomous.

The player does not directly walk the character through every decision, issue binding commands to every NPC, move armies as game pieces, or directly control the realm.

The central relationship is therefore:

<div align="center">

## 🧠 Player advises; AI Character decides and acts.

</div>

At the beginning of the campaign, the character may be a powerless peasant trying to survive.

Much later, the same character may become a knight, noble, king, or even emperor.

Their ambitions, personality, relationships, memories, successes, failures, and previous conversations with the player influence how they behave.

The player may become extremely influential, but **influence is not the same as direct control**.

---

## ✨ The Core Promise

The Advisor Game is built around an autonomous character whose life develops over time.

The player tries to influence that life through advice rather than conventional direct-control RPG mechanics.

The player can:

- 💬 talk naturally with the AI character;
- 🧭 give advice and strategic recommendations;
- ⚠️ warn about threats;
- 🎯 encourage or discourage goals;
- 🤝 suggest how people or factions should be treated;
- 🔎 investigate information before giving advice;
- 🧠 challenge the character's assumptions;
- 📜 remind the character about previous promises or events;
- 🧩 use interactive advisory tools;
- 🎮 complete mini-games that provide information, opportunities, leverage, or other advantages;
- 🌐 influence other characters indirectly through the main character and game systems.

The AI character may:

- ✅ accept the advice;
- 🌓 partially accept it;
- 🔄 reinterpret it;
- ❓ misunderstand it;
- ⏳ postpone acting on it;
- ❌ reject it;
- 💭 change their mind later;
- 🧠 remember it;
- 🧭 use it as part of future decisions.

The game is therefore not about selecting the mathematically correct action from a conventional strategy-game menu.

The challenge is influencing an autonomous character who has their own personality, goals, limitations, relationships, and understanding of the world.

---

## 🧍 The Autonomous Main Character

The main character is the central simulated actor of the campaign.

They exist as an ordinary character inside the same game world as other characters.

Their importance comes from their story and progression rather than from an automatic right to rule.

At different points in the campaign they may be:

- a poor peasant;
- a worker or villager;
- a traveler;
- a soldier;
- a squire;
- a knight;
- a landholder;
- a noble;
- a political leader;
- a prince;
- a king;
- an emperor.

Their available actions, responsibilities, relationships, possessions, authority, and strategic influence change according to their current position.

A **Peasant** cannot behave as though they already command a kingdom.

A **Knight** may influence military events but cannot automatically rewrite royal law.

A **Baron** may manage greater responsibilities while remaining subordinate to higher nobility.

A **King** or **Emperor** may eventually possess genuine sovereign authority.

Progression therefore changes both the character's personal capabilities and the scale of decisions they can legally make.

---

## 🤖 Character AI — LLM + BOT Architecture

The Character AI system supports two compatible character drivers:

1. **LLM Character Driver**
2. **Deterministic Local BOT Driver**

Both represent the same game character.

The LLM is not a separate game mode or a supernatural entity inside the fiction.

When an LLM is available, it provides richer interpretation, dialogue, personality, reasoning, memory use, and roleplaying.

When an LLM is unavailable, incompatible, blocked, over quota, malformed, or disabled, the deterministic BOT continues the campaign.

> [!IMPORTANT]
> The game must remain playable without an external AI provider.

### 📜 Standard Character Instructions

Every compatible LLM receives a standard game instruction set.

The instruction set establishes that the model:

- is controlling a character inside **The Advisor Game**;
- must roleplay as that character;
- is not the human player;
- has its own personality, memories, goals, relationships, and current circumstances;
- receives advice from the human Advisor;
- may agree or disagree with the Advisor;
- should interpret Advisor messages according to the character's knowledge and personality;
- must respect the legal possibilities supplied by the deterministic game simulation;
- must not invent game resources, rules, authority, locations, items, characters, or completed actions that do not exist in the authoritative game state;
- may use the Advisor Instruction Flow as behavioral guidance;
- may modify the Advisor Instruction Flow when permitted by the interaction system;
- must treat the instruction flow and player conversation as influence rather than unrestricted external commands;
- must return decisions using the structured formats required by the game;
- must never directly mutate the simulation state.

The standard Character Instructions are game infrastructure.

They are separate from the player's editable advisory instructions.

---

## 🗣️ Advisor Interaction System

The player has two primary methods of interacting with the main character:

1. **💬 Natural conversation**
2. **🧩 Advisor Instruction Flow**

These systems work together.

### 💬 Natural Conversation

The player can talk directly with the AI character through a normal dialogue interface.

The conversation may include:

- advice;
- questions;
- warnings;
- explanations;
- strategic discussion;
- moral arguments;
- reminders;
- negotiation;
- encouragement;
- criticism;
- requests for information;
- discussion about another character;
- long-term plans.

Conversation itself does not directly mutate the simulation.

Instead, the Character AI interprets the conversation and determines how it should influence the character's intentions, attitudes, memories, priorities, and future legal actions.

Important conversations may become summarized memories or Chronicle facts.

Raw LLM conversation does not become authoritative game state merely because the model stated something.

---

## 🧩 Advisor Instruction Flow

In addition to free-form conversation, the player has access to a specially designed interactive advisory interface.

Conceptually, this interface behaves like an **algorithmic flowchart or behavioral instruction editor**.

The player can construct advisory logic such as:

- if a trusted ally is threatened, prioritize helping them;
- avoid unnecessary wars;
- investigate suspicious reports before acting;
- prefer diplomacy when military strength is low;
- never trust a specific character without evidence;
- protect the family before protecting wealth;
- attempt negotiation before using force;
- focus on becoming a knight;
- support poor settlements when resources allow;
- reconsider this rule if specific circumstances change.

The actual stored and transmitted result of this graphical or interactive interface is **plain text**.

The visual flow editor is therefore an authoring tool.

Its authoritative output is a structured, human-readable plain-text instruction document.

### Example conceptual output

```text
GOAL:
Become a respected knight.

PRIORITIES:
1. Protect close allies.
2. Avoid unnecessary conflict.
3. Build reputation through honorable actions.

IF:
A military opportunity is high risk and provides little reputation.

THEN:
Prefer refusing or negotiating.

EXCEPTION:
If refusing would place the home settlement in immediate danger,
military action may become the preferred option.
```

The exact visual UI may evolve, but the output remains plain text so that:

- the player can understand it;
- it can be saved;
- it can be versioned;
- it can be used by either the LLM or BOT interpretation layer;
- it can be included in bounded Character AI context;
- it can be validated and inspected by the game.

---

## 🔄 Conversation-Driven Instruction Updates

The Advisor Instruction Flow is not isolated from normal conversation.

The Character AI may evaluate conversations and determine that the instruction flow should change.

For example, the player might say:

> From now on, don't automatically trust Duke Arven. Investigate his claims first.

The Character AI may interpret this as a persistent advisory principle and update the plain-text Advisor Instruction Flow accordingly.

Likewise, the player may say:

> Forget the plan about joining the eastern army. Focus on protecting the village instead.

The AI may revise the appropriate goal or priority.

This creates a two-way relationship:

```text
Advisor Flow Panel ───────► Character AI
       ▲                         │
       │                         │ evaluates
       │                         ▼
Player Conversation ─────► Updated Advisory Flow
```

The flow is therefore a living representation of the player's persistent advice.

The player does not need to manually translate every conversational instruction into flowchart nodes.

However, the LLM never receives unrestricted authority over game mechanics.

Automatic instruction updates must remain within the supported instruction format and validation rules.

An LLM may change advisory instructions.

It may not use an instruction update to:

- create gold;
- change character level;
- teleport characters;
- declare an NPC dead;
- invent a settlement;
- bypass game requirements;
- create illegal actions;
- directly alter simulation values.

The deterministic simulation remains authoritative.

---

## 🧠 Instructions Are Influence, Not Mind Control

The Advisor Instruction Flow should strongly influence the character without reducing the AI character to a remote-controlled puppet.

Instructions represent:

- advice;
- preferences;
- plans;
- warnings;
- priorities;
- heuristics;
- beliefs encouraged by the Advisor.

They are **not guaranteed commands**.

Character personality and circumstances remain meaningful.

A proud character may resist humiliating advice.

A compassionate character may reject an efficient but cruel strategy.

A frightened character may ignore a dangerous recommendation.

A character who strongly trusts the Advisor may follow advice much more consistently.

A character who has lost trust may deliberately question it.

The player's challenge is therefore not merely writing better instructions.

**It is building a relationship with the character.**

---

## 🔁 Core Gameplay Loop

Gameplay continuously combines world simulation, character autonomy, conversation, investigation, and advisory planning.

A typical cycle may contain:

1. **🌍 Observe the world**  
   Events, rumors, opportunities, threats, faction activity, relationships, and environmental changes appear.

2. **🔎 Gather information**  
   The player examines the map, reports, characters, objects, conversations, clues, and available tools.

3. **🧰 Use advisory tools**  
   Mini-games, investigation systems, reports, comparisons, evidence tools, and other mechanics can reveal information or create opportunities.

4. **💬 Talk to the main character**  
   The player discusses events, asks questions, warns the character, proposes plans, or tries to change their priorities.

5. **🧩 Review or modify the Advisor Instruction Flow**  
   The player may manually adjust longer-term behavioral guidance.

6. **🤖 Character AI evaluates the situation**  
   The LLM or BOT considers game state, character personality, memories, relationships, Advisor conversation, and current instruction flow.

7. **🎯 Character chooses legal actions**  
   The Character AI expresses intentions and selects among actions that are currently legal for that character.

8. **⚙️ Simulation validates the action**  
   Deterministic game systems verify legality, costs, requirements, probabilities, and consequences.

9. **🌐 World advances**  
   The character and other autonomous actors perform their actions.

10. **📜 Consequences become new context**  
    Relationships, resources, opportunities, reputation, political conditions, memories, and future possibilities change.

11. **🧠 Advisor reacts**  
    The player discusses what happened and adapts future advice.

<div align="center">

### Observe → Investigate → Advise → Character decides → World reacts → Discuss → Adapt

</div>

---

## 🎭 Why the Advice Should Be Interesting

- **🧍 The main character is a person, not a menu skin.** Their traits, history, fears, ambitions, relationships, and memories affect interpretation.
- **❌ Good advice can be rejected.** The character remains autonomous.
- **⚡ Bad advice can succeed temporarily.** A short-term victory can create long-term consequences.
- **🔄 Advice can evolve over time.** Conversation may modify persistent instructions.
- **🎭 The same advice can produce different results for different characters.**
- **🔎 Information has provenance.** Scouts, merchants, priests, spies, soldiers, peasants, nobles, and rivals may provide incomplete or biased information.
- **🤐 Silence is a decision.** The player may choose not to interfere.
- **🤝 Relationships matter.** Trust affects how seriously advice is considered.
- **🧠 Consequences have memory.** Characters remember loyalty, betrayal, generosity, humiliation, promises, and previous advice.
- **📈 The character can outgrow earlier advice.** Guidance suitable for a Peasant may become inappropriate for a King.
- **⚖️ No perfect instructions exist.** The game world continually creates exceptions and conflicting priorities.
- **📖 Failure creates stories.** Poverty, imprisonment, dismissal, broken relationships, political defeat, military disaster, exile, lost opportunities, and damaged reputation can create new paths rather than immediate game-over screens.

---

## 🎮 Player Agency

The player has substantial influence but limited direct authority.

The player may:

- converse with the main character;
- create and modify advisory instructions;
- investigate information;
- use advisory tools;
- solve mini-games;
- collect evidence;
- identify opportunities;
- reveal secrets;
- provide warnings;
- recommend actions;
- encourage relationships;
- discourage relationships;
- make arguments;
- influence the character's goals;
- help the character reason about consequences.

### 🚫 The player does not directly command world characters

The player must not directly control ordinary game characters on the scene.

The player cannot simply click an NPC and command:

- go there;
- attack this person;
- give me your inventory;
- join this faction;
- arrest that character;
- build this structure;
- declare war.

Instead, the player influences events indirectly.

For example:

- discovering evidence may change how the main character treats an NPC;
- winning a negotiation mini-game may improve a diplomatic opportunity;
- uncovering a secret may provide leverage;
- analyzing a battlefield may improve the main character's military judgment;
- helping prepare a speech may improve persuasion;
- identifying a safe route may influence travel;
- solving a puzzle may reveal information unavailable through normal conversation.

The world remains populated by autonomous characters rather than player-controlled units.

---

## 🕹️ Mini-Games and Advisor Tools

Mini-games provide the player with direct gameplay without violating character autonomy.

They may include:

- reconstructing an event from evidence;
- comparing conflicting witness statements;
- tracing caravan routes;
- decoding messages;
- analyzing maps;
- preparing diplomatic arguments;
- identifying suspicious behavior;
- organizing information;
- researching historical claims;
- examining military plans;
- evaluating resource proposals;
- helping prepare speeches;
- solving environmental puzzles;
- identifying tactical advantages.

Mini-games can influence:

- information quality;
- character confidence;
- available advice;
- persuasion strength;
- reputation;
- relationships;
- discovered opportunities;
- hidden facts;
- probability modifiers.

They do not directly force autonomous characters to perform actions.

Accessible auto-resolve alternatives should exist where appropriate.

---

## 📈 Character Progression

The primary progression belongs to the autonomous main character.

<div align="center">

### 🌾 Peasant → 🏡 Villager → 🛡️ Squire → ⚔️ Knight → 🏰 Baron → 👑 Duke → 🦁 Lord → 💎 Prince → 👑 King → 🌍 Emperor

</div>

These ranks are not merely cosmetic levels.

Each stage changes the types of problems and opportunities encountered.

### 🌾 Peasant

Gameplay focuses on:

- survival;
- employment;
- family;
- local relationships;
- basic reputation;
- food and shelter;
- village problems.

### 🏡 Villager

The character becomes more established and may gain:

- social relationships;
- local responsibilities;
- modest wealth;
- greater access to information.

### 🛡️ Squire

The world begins expanding toward:

- military culture;
- noble relationships;
- training;
- loyalty;
- patronage.

### ⚔️ Knight

The character may participate in:

- military campaigns;
- political missions;
- protection duties;
- tournaments;
- land or title opportunities.

### 🏰 Baron / Duke / Lord

Gameplay expands toward:

- estates;
- settlements;
- political factions;
- taxation consequences;
- larger military responsibilities;
- diplomacy;
- court intrigue.

### 👑 Prince / King

Gameplay expands toward:

- national diplomacy;
- major wars;
- succession;
- laws;
- realm economy;
- legitimacy;
- large-scale crises.

### 🌍 Emperor

The campaign may involve:

- multiple kingdoms;
- imperial administration;
- large alliances;
- rebellions;
- succession;
- cultural conflict;
- massive wars;
- imperial legitimacy;
- maintaining a realm too large for one person to understand completely.

As the character gains power, the Advisor's influence may become historically significant.

But the player still advises.

The AI character remains the actor.

---

## 🧠 Advisor Progression

The Advisor may also develop capabilities without becoming the directly controlled ruler.

Possible capabilities include:

| Capability | Purpose |
| --- | --- |
| 🔎 **Insight** | Reveal uncertainty, detect bias, and improve forecasts |
| 🗣️ **Rhetoric** | Present advice more effectively |
| 🤝 **Diplomacy** | Understand relationships and faction incentives |
| 💰 **Stewardship** | Analyze economic consequences |
| ⚔️ **Command** | Analyze military situations |
| 🕵️ **Intrigue** | Uncover secrets and recognize manipulation |

Additional advisory progression may unlock:

- more complex Instruction Flow structures;
- better reports;
- additional investigation tools;
- private conversations;
- historical analysis;
- stronger memory tools;
- better prediction interfaces;
- additional mini-games;
- improved access to information.

Advisor progression increases the quality of influence.

It does not transfer direct ownership of autonomous characters or the game world to the player.

---

# 🏗️ Major Systems

## 🤖 Character AI — The Centerpiece

All core gameplay routes through a shared Character AI contract.

1. The deterministic simulation creates the current authoritative game state.
2. The system derives a bounded character context containing only information the character is allowed to know.
3. Relevant character personality, memories, relationships, goals, and current Advisor Instruction Flow are added.
4. Recent player conversation is included when appropriate.
5. A configured LLM may interpret the situation, roleplay the character, update supported advisory instructions, and select preferences or intentions.
6. The deterministic local BOT uses compatible character data and game rules when no suitable LLM is available.
7. Potential actions are checked against the current legal-action allowlist.
8. Invalid output is rejected, repaired, or replaced with a valid BOT-generated action.
9. Only deterministic simulation systems apply costs, checks, movement, resource changes, combat results, progression, and world consequences.

> [!CAUTION]
> The model never receives authority to arbitrarily mutate JavaScript state.

---

## 🧠 Character Memory

The character should remember important experiences.

Memory may include:

- promises;
- betrayals;
- victories;
- failures;
- relationships;
- important advice;
- major disagreements with the player;
- people who helped them;
- people who harmed them;
- unresolved goals;
- major fears;
- political events.

Not every raw chat message must be preserved forever.

Long campaigns should use summarized, structured memories where possible.

Canonical simulation facts remain separate from generated roleplay prose.

---

## 🤝 Relationships

Characters maintain relationships with other characters.

Relationships may include:

- trust;
- friendship;
- affection;
- fear;
- rivalry;
- loyalty;
- resentment;
- respect;
- suspicion;
- obligation.

The main character's relationship with the human Advisor is particularly important.

Repeatedly useful advice may increase trust.

Manipulation, incorrect information, or advice that produces disaster may decrease it.

High trust increases influence but does not eliminate autonomy.

---

## 💰 Economy and Settlements

Gold, Food, Materials, population, prosperity, stability, legitimacy, military readiness, production, trade, buildings, and settlement development may become important as the main character gains responsibility.

The player does not directly manipulate settlement values as though operating a spreadsheet.

Instead, the player:

- gathers reports;
- analyzes situations;
- identifies problems;
- uses tools;
- recommends strategies;
- discusses alternatives.

The autonomous character and other actors determine what actions they legally take.

Settlement visuals may grow from villages into towns, cities, castles, capitals, and eventually imperial centers.

---

## 🤝 Diplomacy and Autonomous Factions

Factions retain:

- leaders;
- traits;
- needs;
- memories;
- relationships;
- territory;
- incomplete knowledge;
- political objectives.

The player may help analyze diplomacy but does not directly control every faction.

Treaties create obligations.

Alliances can deter enemies but create commitments.

Trade may produce prosperity while creating dependency.

Personal insults, marriages, betrayals, debts, religious disputes, succession disputes, and old wars can affect relationships.

The main character participates according to their current authority and status.

---

## ⚔️ Military Strategy

Military gameplay remains strategic rather than unit-by-unit player control.

Relevant mechanics may include:

- recruitment;
- commanders;
- supplies;
- terrain;
- morale;
- training;
- formations;
- objectives;
- defense;
- raids;
- sieges;
- retreats;
- diplomacy.

The Advisor may analyze reports, evaluate plans, identify threats, or recommend strategies.

The player does not directly click battlefield units and command every movement.

Characters with legitimate military authority issue orders.

The simulation resolves their actions deterministically with controlled seeded variance where appropriate.

---

## 📜 Events, Quests, Crises, and Opportunities

Events provide the narrative engine of the campaign.

Examples include:

- local disputes;
- crimes;
- shortages;
- illness;
- bandit attacks;
- family conflicts;
- romance;
- tournaments;
- military recruitment;
- political intrigue;
- assassinations;
- invasions;
- rebellion;
- succession;
- diplomatic crises;
- economic collapse;
- supernatural discoveries.

Events should create situations for the player to understand rather than simply presenting one obvious correct answer.

---

## 👥 Autonomous World Characters

Characters other than the main character should also behave autonomously.

They may use deterministic AI, authored behavior, utility systems, state machines, or bounded LLM support where appropriate.

Each relevant character can possess:

- identity;
- personality;
- occupation;
- social status;
- relationships;
- memories;
- goals;
- possessions;
- location;
- beliefs;
- knowledge;
- current intentions.

The human player does not directly possess these characters.

The Advisor affects them through the world.

---

## 🗺️ Procedural World and Presentation

The world is presented as a lightweight **isometric 2.5D experience rendered through WebGL**, with HTML/CSS/SVG/Canvas interfaces layered around it for conversation, reports, investigation, Advisor tools, mini-games, and the Advisor Instruction Flow.

The presentation should prioritize readability, atmosphere, character emotion, and clear interaction over free-camera 3D complexity.

### 🌱 Seeded, Reproducible, and Extensible World

The world must be reproducible from a player-visible **SEED code**.

The SEED is the deterministic source for the map's generated content, including:

- biome distribution and biome transitions;
- terrain regions and environmental variation;
- rivers, lakes, coastlines, roads, paths, and other geographic structure;
- settlement locations and settlement growth anchors;
- standard villages, farms, houses, workshops, markets, walls, towers, castles, and other basic buildings;
- trees, rocks, vegetation groups, bridges, signs, props, resource objects, and other basic world objects;
- deterministic visual variants, placement, orientation, and supported scale variation;
- region and landmark placement when those elements are defined as seed-generated content.

Required biome, building, and object families may use repository-provided art assets or procedural primitives, but their generated selection and placement must remain deterministic for the same compatible SEED and world-generation rules. Runtime AI image generation is not required for reproducibility.

The world should support **deterministic region/chunk generation** so that map size is not limited by requiring the entire world to exist in memory at once. A region may be generated when needed from the campaign SEED together with stable region or chunk coordinates, then unloaded when it is no longer required for rendering.

The logical world should not require a fixed pre-generated global map boundary. Additional deterministic regions can be generated as the campaign expands, allowing the playable world to grow without regenerating or retaining the entire world in memory. Generation order must not affect results: the same compatible SEED, world-generation version, and region coordinates must reproduce the same base region whether that region is visited first, later, or after returning from another map.

This allows the world to expand to much larger playable areas while preserving browser and mobile performance.

When the player leaves a map region and later returns, the game should be able to reconstruct the same base region from its SEED-derived generation inputs rather than permanently storing every generated terrain tile, building, and decorative object.

Campaign saves should preserve the information required to reproduce a generated world consistently, including the campaign SEED and a compatible world-generation version when generation rules evolve. Persistent simulation changes such as destroyed structures, constructed upgrades, ownership changes, discovered information, or other campaign consequences are stored as state differences layered over the reproducible seed-generated base world.

Location remains mechanically meaningful and determines:

- who can meet whom;
- which information is available;
- travel time;
- trade routes;
- military routes;
- available employment;
- political control;
- local events;
- environmental hazards.

The world should increasingly feel inhabited by autonomous characters rather than functioning only as a strategy-game board.

### 🎨 Visual Direction

The visual direction remains lightweight enough for browser deployment while presenting a distinctive medieval-fantasy identity:

- isometric or near-isometric 2.5D terrain;
- WebGL-rendered world layers with an orthographic-style presentation rather than unrestricted free-camera 3D;
- 2.5D characters and autonomous character movement on the world map;
- high-quality 2D character portraits for dialogue and important events;
- visible character emotional states such as confidence, fear, anger, suspicion, fatigue, injury, pride, and happiness where appropriate;
- layered or illustrated regional and interior backgrounds for important conversations, audiences, crises, and events;
- standardized seed-compatible building and object families;
- unique landmarks where the campaign requires them;
- atmosphere through lightweight lighting, shadows, weather, particles, water movement, smoke, fire, fog, vegetation motion, and similar effects when performance permits;
- optional AI-assisted art production during development;
- repository-shipped fallbacks for all required gameplay visuals.

Visual effects must never reduce the readability of map information, reports, character state, evidence, or Advisor choices.

Required gameplay must always have repository-shipped fallbacks.

### 🖼️ AI-Assisted Vector Asset Fallback

Missing required visual assets must never result in an empty world area, invisible gameplay object, blank placeholder, or generic temporary box when a visual representation is expected.

When a required biome visual, standard building, standard object, prop, environmental element, character-map representation, interface illustration, or other reusable gameplay visual does not yet have an appropriate repository asset, an AI development agent should create a **true vector graphic** for that asset and save it into the appropriate repository content or asset directory so it becomes a normal versioned game asset.

AI-created fallback art must follow the established visual language of **modern high-quality 2.5D games**. It must not be treated as throwaway programmer art. In particular:

- vector assets should use purposeful silhouettes, layered forms, material cues, depth, shading, highlights, and readable detail appropriate to their display scale;
- buildings and world objects should respect the game's isometric or near-isometric viewing direction, proportions, footprint logic, and visual depth;
- biome and environmental assets should visually communicate terrain identity, climate, vegetation, surface character, and regional variation rather than relying on a flat color or simple geometric symbol;
- related asset families should share a coherent palette, lighting direction, outline treatment, perspective, scale, and level of detail;
- assets must remain readable on phone and tablet displays at the smallest supported gameplay scale;
- the same asset should remain visually credible when zoomed on higher-resolution tablet and desktop displays;
- simple rectangles, circles, wireframes, generic icons, single-color silhouettes, debug primitives, or similarly minimal placeholders are not acceptable substitutes for a required final-facing visual;
- an SVG or other vector container must contain genuine vector geometry and styling rather than merely embedding a raster PNG/JPEG image inside the vector file;
- vector complexity should be optimized for browser rendering so visual quality does not create excessive DOM, SVG, memory, or GPU cost on mobile devices.

Generated assets should use stable filenames and predictable directory organization appropriate to their content family so biome, building, object, character, event, and interface visuals can be referenced deterministically by game data and reused across generated regions. Once created and accepted, these files are repository-shipped assets and should not need to be regenerated during normal gameplay.

This fallback policy applies to **asset availability**, not simulation authority. SEED-based world generation determines what biome, building, object, or visual variant belongs at a location; the corresponding repository asset determines how that generated content is presented. Missing art must be completed as an asset rather than changing the deterministic generated world to avoid displaying the missing content.

Runtime image generation is not required. AI-assisted visual creation is a development-time asset-production workflow, and required gameplay visuals must remain available from repository-shipped files during normal play, including when no external AI service is available.

### 📱 Responsive Phone and Tablet Presentation

The complete game interface must be usable on current desktop browsers, tablets, and phones in both **portrait and landscape orientation**.

Responsive behavior must be designed intentionally for each form factor rather than treating mobile as a scaled-down desktop layout.

#### Phone — Portrait

Portrait mode should prioritize one primary task at a time.

- The map remains available as a compact interactive world view.
- Conversation, reports, evidence, character information, Chronicle, and Advisor tools may open as tabs, sheets, drawers, or full-height panels.
- Bottom navigation or similarly reachable controls should expose the most important player surfaces without requiring precise pointer input.
- Large information panels should be dismissible so the player can quickly return to the map.
- Text entry for Advisor conversation must remain usable with the on-screen keyboard visible.
- Opening the keyboard must not permanently hide essential send, close, or navigation controls.

#### Phone — Landscape

Landscape mode should favor a **split-view** presentation when screen width permits.

- The map may occupy the larger portion of the screen.
- Conversation, reports, selected-character information, or Advisor tools may occupy a secondary side panel.
- Secondary panels may collapse when the player wants a larger map.
- Important controls must remain reachable without requiring hover or tiny edge targets.

#### Tablet — Portrait and Landscape

Tablets should use their additional space to show more persistent context.

- Portrait tablets may combine a larger map with a docked or sliding lower information area.
- Landscape tablets may keep the map and one or more contextual Advisor panels visible simultaneously.
- Dialogue, evidence, reports, relationships, Chronicle, and the Advisor Instruction Flow should be able to use expanded layouts without changing their underlying gameplay rules.
- Orientation changes must reflow the interface without losing the current selection, conversation draft, open report, map position, or gameplay state.

### 👆 Touch, Pointer, and Interactive Behavior

All major interactions must support **touch, mouse, and keyboard** where applicable.

For map interaction:

- tap or click selects characters, settlements, objects, or map locations;
- one-pointer drag pans the map;
- pinch gestures zoom on touch devices;
- mouse wheel or equivalent controls zoom on desktop when appropriate;
- camera behavior should remain predictable and should not require free 3D camera manipulation;
- interactive objects require clear selected, focused, available, unavailable, and uncertain states;
- important gameplay information must never be available only through hover.

For interface interaction:

- touch targets should be comfortably finger-sized, with a preferred minimum interactive size around **44 CSS pixels** where practical;
- controls should avoid requiring pixel-precise dragging unless the mechanic specifically benefits from it;
- any drag-based Advisor tool should provide a tap/select alternative where practical;
- hover tooltips should have tap, focus, or explicit-info equivalents;
- panels and dialogs must remain operable within mobile safe areas, including devices with display cutouts and gesture bars;
- interface scaling must respect browser text scaling and should not encode required information only through color;
- the Advisor Instruction Flow must support touch-friendly node or rule editing, scrolling, zooming, selection, connection, reordering, and plain-text inspection without depending on a desktop mouse.

### ⚡ Mobile Rendering and Scalability

The presentation should preserve responsiveness during long campaigns and large generated worlds.

- Only visible or nearby world regions should require full rendering detail.
- Distant or inactive regions may use simplified representation or remain simulation-only until needed visually.
- Decorative density, particles, shadows, animation frequency, and render resolution may scale according to device capability without changing simulation results.
- High-density mobile displays should use sensible render-resolution limits rather than assuming every device must render the world at unrestricted native device-pixel resolution.
- UI responsiveness, readable text, and stable interaction take priority over optional visual effects.
- Visual quality scaling must never change deterministic simulation outcomes, legal actions, AI knowledge, or campaign state.

---

# 🧭 Design Principles

1. **🧠 Player advises; AI Character decides and acts.**  
   This is the central identity of the game.

2. **🧍 The AI character is the protagonist.**  
   The Peasant-to-Emperor journey belongs primarily to the autonomous game character.

3. **🧭 Influence instead of direct control.**  
   The player changes the world by influencing people, information, decisions, and opportunities.

4. **💬 Conversation is gameplay.**  
   Natural dialogue with the character is a primary interaction system.

5. **🧩 Persistent advice is gameplay.**  
   The Advisor Instruction Flow allows long-term behavioral guidance.

6. **🔄 Conversation and instructions are connected.**  
   Chat may cause the Character AI to revise persistent advisory instructions.

7. **📄 Instructions are plain text at the system boundary.**  
   A graphical flow editor may author them, but the stored and transmitted result remains inspectable text.

8. **⚙️ LLM-centered, rules-grounded.**  
   Language models provide interpretation and roleplay. Deterministic systems remain authoritative.

9. **🤖 One character, multiple AI drivers.**  
   LLM and BOT implementations represent the same game character.

10. **🧠 The character has agency.**  
    Advice must never become guaranteed mind control.

11. **👥 Other characters also have agency.**  
    The human player cannot directly command arbitrary NPCs.

12. **🎮 Mini-games provide direct interaction without breaking autonomy.**

13. **📈 Progression changes scale.**  
    Problems evolve naturally from village survival to imperial politics.

14. **🌐 Static-hosting first.**  
    Complete core gameplay works from GitHub Pages without a required application backend.

15. **📜 Readable causality.**  
    The player should understand what they advised, what the character decided, and what happened afterward.

16. **⏱️ Respect the player's time.**  
    Progress should come from decisions, relationships, discoveries, and stories rather than daily-login systems or grind.

17. **♿ Accessible by default.**  
    Keyboard, mouse, and touch should be supported and information should never rely on color alone.

---

# 🌐 Static Hosting and LLM Contract

The production game is static HTML, CSS, JavaScript, localization, image, and audio hosted by GitHub Pages.

GitHub Pages deploys the verified `LatestRelease/` snapshot as the public site root, so the stable player URL never needs a version number.

It requires **no mandatory custom server, serverless function, database, account, or server-side simulation**.

- World generation executes locally.
- Game-state validation executes locally.
- The deterministic Character BOT executes locally.
- Action legality executes locally.
- Progression rules execute locally.
- Economy and world simulation execute locally.
- Seeded random checks execute locally.
- Saves execute locally.
- The Advisor Instruction Flow is stored as plain text and/or validated structured data locally.
- An optional player-configured OpenAI-compatible HTTPS endpoint may be called directly from the browser when it supports the required CORS configuration.
- No API key is bundled with the game.
- Player-entered provider credentials must not be written into campaign saves.
- If the LLM is unavailable, the deterministic BOT continues the campaign.
- The LLM may interpret conversation, roleplay the character, evaluate advice, update supported advisory instructions, and select among currently legal intentions.
- The LLM cannot directly apply game outcomes.
- The deterministic simulation remains authoritative.
- Campaigns can be exported/imported as versioned JSON.
- Runtime assets use repository-relative URLs so the game works below `https://sgoxel.github.io/The-Advisor-Game/` and on compatible static hosts.

Opening `index.html` directly through `file://` is best-effort because browsers restrict some asset and network operations.

GitHub Pages or any ordinary HTTPS static host is sufficient.

---

# 🔐 LLM Trust Boundary

LLM output is always treated as untrusted external input.

The model may generate:

- dialogue;
- reasoning summaries;
- intentions;
- emotional responses;
- interpretation of advice;
- proposed advisory-instruction changes;
- preferences between legal actions.

The model may **not** directly:

- edit authoritative JavaScript state;
- change resources;
- create items;
- create settlements;
- modify character ranks;
- award experience;
- determine random rolls;
- move armies;
- kill characters;
- create legal authority;
- bypass requirements;
- alter game rules.

Structured model output must be parsed and validated.

If model output is invalid:

1. reject or sanitize the invalid fields;
2. optionally request one bounded correction;
3. fall back to the deterministic BOT when necessary.

Gameplay must never depend on trusting arbitrary model-generated prose.

---

# 🧪 Current Prototype

Implemented today:

- ✅ Seeded 12×12 to 80×80 procedural worlds
- ✅ WebGL2 isometric renderer with Canvas2D overlays
- ✅ Terrain, settlements, connected roads, minimap, camera, and path movement
- ✅ Map data/image import and export tools
- ✅ English and Turkish localization foundation
- ✅ Responsive desktop/mobile panels
- ✅ Static deployment at `https://sgoxel.github.io/The-Advisor-Game/`
- ✅ Vitest, Playwright, ESLint, JSDoc type checking, and performance checks

> [!WARNING]
> The current Gold, Health, Stamina, Mana, Character, and Dialogue displays are prototype UI.
>
> They are not evidence that the final autonomous Character AI loop, progression, Advisor Instruction Flow, or long-term campaign systems are already implemented.

Existing prototype behavior is not automatically a product requirement.

---

# 🎮 Play, Deploy, or Run Locally

The production game runs directly from the static GitHub Pages site.

<div align="center">

## ▶️ [PLAY LATEST TESTED DEVELOPMENT RELEASE](https://sgoxel.github.io/The-Advisor-Game/)

[View latest GitHub release](https://github.com/sgoxel/The-Advisor-Game/releases/latest)

</div>

Players do not need Node.js or a local server.

To deploy another copy, publish the repository root through GitHub Pages or another compatible HTTPS static host.

Keep the directory structure intact.

Node.js 18 or newer is required only for local development tools and automated tests:

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:playwright
npm run perf
```

---

# 🗂️ Project Map

| Path | Responsibility |
| --- | --- |
| `index.html` | Application shell and script order |
| `js/config.js` | Constants and adjustable limits |
| `js/state.js` | Shared runtime and campaign state |
| `js/simulation.js` | Deterministic validation, world simulation, progression, and consequences |
| `js/character-ai.js` | Shared Character AI contract, LLM adapter, BOT fallback, and output validation |
| `js/advisor.js` | Player conversation, advisory context, and Advisor-facing interaction systems |
| `js/advisor-flow.js` | Advisor Instruction Flow model, plain-text generation, validation, and updates |
| `js/memory.js` | Structured character memory and conversation summarization |
| `js/rng.js` | Seeded random helpers |
| `js/topology.js` | Map topology helpers |
| `js/terrain.js` | Procedural terrain, settlements, and roads |
| `js/renderer.js` | WebGL/Canvas rendering |
| `js/input.js` | Camera, pointer, touch, and movement input |
| `js/ui.js` | DOM presentation, panels, logs, and import/export |
| `js/app.js` | Startup and orchestration |
| `locales/` | English and Turkish strings |
| `tests/` | Unit, browser, visual, and gameplay checks |
| `LatestRelease/` | Last verified static release snapshot deployed by GitHub Pages |
| `VERSION` | Concrete release version used by tooling, tags, manifests, and GitHub Releases |
| `SPEC.md` | Detailed mechanics, architecture, roadmap, and acceptance criteria subordinate to this README |

Modules listed as product direction need not exist in the current prototype yet.

---

# 🛣️ Roadmap

Development proceeds through playable vertical slices while protecting the central autonomous-character concept.

### 1. ⚙️ Deterministic Simulation Foundation

- campaign state;
- saves;
- seeded checks;
- legal-action validation;
- character state;
- world state.

### 2. 🤖 Autonomous Local BOT Character

- one complete autonomous character;
- character goals;
- legal actions;
- memories;
- basic Advisor influence;
- no external LLM dependency.

### 3. 💬 Conversation System

- player/character dialogue;
- character context;
- structured memories;
- trust;
- personality;
- conversation consequences.

### 4. 🧩 Advisor Instruction Flow

- graphical/interactive instruction editing;
- plain-text instruction output;
- persistent advisory rules;
- BOT interpretation;
- validation.

### 5. 🧠 Optional LLM Character Driver

- standard Character Instructions;
- roleplay;
- structured legal-action selection;
- conversation interpretation;
- instruction-flow evaluation;
- conversation-driven instruction updates;
- safe deterministic fallback.

### 6. 🌾 Peasant-to-Knight Vertical Progression

- local economy;
- employment;
- relationships;
- quests;
- village events;
- reputation;
- military entry;
- early mini-games.

### 7. 🏰 Nobility and Political Progression

- land;
- settlements;
- factions;
- diplomacy;
- trade;
- political relationships;
- court intrigue.

### 8. ⚔️ Kingdom and Military Systems

- strategic armies;
- commanders;
- wars;
- treaties;
- kingdom economy;
- succession;
- major crises.

### 9. 🌍 King-to-Emperor Progression

- multiple kingdoms;
- imperial politics;
- large-scale diplomacy;
- rebellion;
- legitimacy;
- imperial administration;
- end-game crisis structures.

### 10. ✨ Campaign Polish

- advanced mini-games;
- 2.5D characters;
- emotional presentation;
- audio;
- regional backgrounds;
- accessibility;
- campaign balancing;
- replayability.

Detailed implementation milestones belong in `SPEC.md`, but they must always conform to the current README.

---

# 🚀 Development Releases

- `main` contains accepted source history; the deployable tested snapshot is stored in `LatestRelease/`.
- GitHub Pages publishes the contents of `LatestRelease/`.
- The stable player URL is `https://sgoxel.github.io/The-Advisor-Game/` and does not contain a release number.
- The stable GitHub release URL is `https://github.com/sgoxel/The-Advisor-Game/releases/latest`.
- Release versions use `v<major>.<minor>.<patch>-dev.<number>` tags.
- [`VERSION`](VERSION) identifies the current release version for tooling, tags, manifests, and GitHub Releases.
- README must **not** embed the current release number, current tag, or a version query parameter.
- After a release candidate passes the release gate, Release Manager copies the verified static build into `LatestRelease/` before the final main-targeting release PR is completed.
- `LatestRelease/release-manifest.json` records the published version and source commit without requiring a README edit.
- Broken intermediate states must not be copied into `LatestRelease/`.
- `README.md` remains protected; ordinary version increments never require modifying it.

### Latest tested development release

[🎮 Launch the latest tested build](https://sgoxel.github.io/The-Advisor-Game/) · [🏷️ Open the latest GitHub Release](https://github.com/sgoxel/The-Advisor-Game/releases/latest)

The concrete version number is intentionally read from `VERSION`, the Git tag, the GitHub Release, or `LatestRelease/release-manifest.json` rather than duplicated in this protected document.

# 💾 Saves, AI, and Privacy

- Full campaign saves use versioned JSON.
- Map export may remain a separate tool.
- Character identity, rank, personality, important memories, relationships, goals, Advisor Trust, persistent Advisor Instructions, structured AI decisions, and canonical Chronicle facts may be saved.
- Raw model requests and raw model responses should not be required for campaign persistence.
- Provider credentials must never be stored in campaign saves.
- Only the minimum bounded game context should be sent to a configured external model endpoint.
- The game must remain playable through the local BOT without personal information or external accounts.
- Player-entered API credentials should remain temporary and outside exported campaign data.
- Providers that cannot safely communicate from the static GitHub Pages build are not required to be supported.

---

# 🛠️ Guidance for Planner and Coding Agents

Before planning or implementing gameplay, agents **MUST read this README**.

README defines the intended product.

`SPEC.md`, `AGENTS.md`, `TODO.md`, task specifications, implementation, and tests must conform to README.

The synchronization direction is:

<div align="center">

### README → SPEC → AGENTS / instructions → TODO / tasks → implementation → tests

</div>

When README and any subordinate document differ:

<div align="center">

## README wins.

</div>

Existing code is implementation history, not product authority.

Existing tests are requirements only when they remain compatible with README.

---

## 🧠 Fundamental Gameplay Rule

Every gameplay implementation must preserve:

> **Player advises; AI Character decides and acts.**

Agents must not introduce shortcuts that turn the player into the directly controlled protagonist.

Agents must not give the player unrestricted direct control over autonomous world characters.

Agents must not replace unfinished Character AI systems by temporarily making the human player perform the character's binding decisions.

---

## 🤖 AI Implementation Rule

The LLM may help with:

- dialogue;
- roleplay;
- interpretation;
- personality;
- memories;
- advice evaluation;
- Advisor Instruction Flow interpretation;
- supported instruction updates;
- selection among legal actions.

The LLM must not become the authoritative simulation engine.

Deterministic systems remain responsible for:

- validation;
- legal actions;
- costs;
- random checks;
- progression;
- resources;
- movement legality;
- combat outcomes;
- state transitions;
- consequences.

---

## 🧩 Advisor Instruction Flow Rule

The interactive flow interface may visually resemble:

- a flowchart;
- decision tree;
- algorithm editor;
- node graph;
- rule system.

However, its system-level output must remain a **plain-text advisory instruction representation**.

The player may edit it manually.

The Character AI may update it as a result of conversation when allowed by the instruction system.

These updates affect character guidance.

They do not bypass the simulation.

---

# 🔒 README Protection

> [!CAUTION]
> `README.md` is protected.

AI agents **MUST NOT** edit, rewrite, reformat, synchronize, or otherwise modify `README.md` unless the Admin explicitly authorizes that specific README modification.

If an implementation suggests that README should change, the agent must propose the change to the Admin.

It must not silently modify README to match code, tests, SPEC, TODO, or previous assumptions.

---

# 🤝 Contributing

Issues and pull requests are welcome.

A useful gameplay change should:

- identify the relevant README rule;
- remain compatible with the autonomous-character model;
- preserve deterministic validation;
- preserve the local BOT fallback;
- preserve English/Turkish localization where player-facing text is added;
- include appropriate acceptance criteria;
- add or update tests for deterministic game behavior;
- avoid giving direct world authority to the human Advisor.

Features should deepen the relationship between:

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

🎮 [Play Latest Release](https://sgoxel.github.io/The-Advisor-Game/) · 🏷️ [Latest GitHub Release](https://github.com/sgoxel/The-Advisor-Game/releases/latest)

</div>
