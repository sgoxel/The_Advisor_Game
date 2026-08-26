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

[🏷️ Latest GitHub Release](https://github.com/sgoxel/The-Advisor-Game/releases/latest) · [🌐 GitHub Pages](https://sgoxel.github.io/The-Advisor-Game/)

</div>

> [!IMPORTANT]
> **Core rule:** The human player advises. The autonomous AI character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

---

# 🌍 Product Identity

You are not the hero walking through the world. **You are the mind advising the hero.**

The protagonist is an autonomous AI-controlled character living inside the same world as everyone else. The player is the character's **Advisor**: they investigate, converse, warn, persuade, recommend goals and strategies, and help the character reason, but do not directly control the character, arbitrary NPCs, armies, laws, or the realm.

The character may rise through:

<div align="center">

### 🌾 Peasant → 🏡 Villager → 🛡️ Squire → ⚔️ Knight → 🏰 Baron → 👑 Duke → 🦁 Lord → 💎 Prince → 👑 King → 🌍 Emperor

</div>

Rank changes what actions, responsibilities, possessions, authority, and strategic scale are legally available. A Peasant cannot act as a sovereign; a Knight may influence military affairs without rewriting royal law; nobles gain broader responsibilities; a King or Emperor may eventually possess sovereign authority.

Character personality, ambitions, fears, relationships, memories, successes, failures, trust in the Advisor, and prior conversations influence decisions. The player may become highly influential, but **influence is never direct control**.

## ✨ Core Promise

The player can converse naturally, investigate information, give advice, warn about threats, recommend or discourage goals and relationships, challenge assumptions, remind the character of promises or events, use Advisor tools, and complete mini-games that improve information, leverage, persuasion, or opportunities.

The character may accept, partially accept, reinterpret, misunderstand, postpone, reject, remember, or later reconsider advice. The challenge is therefore not choosing a mathematically correct strategy-menu action; it is learning how to influence an autonomous person with their own knowledge, motives, limitations, and relationships.

---

# 🤖 Character AI and Advisor Interaction

## Character AI — One Character, Two Drivers

The same character can be driven by:

1. **LLM Character Driver** — richer dialogue, interpretation, personality, reasoning, memory use, and roleplay.
2. **Deterministic Local BOT Driver** — complete local fallback when an LLM is unavailable, incompatible, blocked, over quota, malformed, disabled, or unsafe.

The game **must remain playable without an external AI provider**. The LLM is not a separate game mode and never becomes the simulation authority.

### Standard Character Contract

Every compatible LLM is instructed that it:

- controls a character inside **The Advisor Game**, not the human player;
- must roleplay according to that character's personality, memories, goals, relationships, knowledge, and circumstances;
- receives advice from the human Advisor and may agree, disagree, reinterpret, or defer;
- must respect the legal possibilities supplied by the deterministic simulation;
- must not invent authoritative resources, rules, authority, locations, items, characters, completed actions, or world facts;
- may use the Advisor Instruction Flow as behavioral guidance and update it only when the interaction system permits;
- must treat conversation and Advisor Instructions as influence, not unrestricted commands;
- must return decisions in the structured formats required by the game;
- must never directly mutate simulation state.

These standard Character Instructions are game infrastructure and are separate from the player's editable advisory instructions.

## 💬 Natural Conversation

The player talks directly with the character through normal dialogue: advice, questions, warnings, explanations, strategy, moral arguments, reminders, negotiation, encouragement, criticism, requests for information, discussions about people, and long-term plans.

Conversation does **not** directly change authoritative simulation state. Character AI interprets it into intentions, attitudes, memories, priorities, or future legal actions. Important conversations may become summarized memories or Chronicle facts; raw model prose is never authoritative merely because the model said it.

## 🧩 Advisor Instruction Flow

The player also has an interactive, flowchart-like behavioral instruction editor for persistent advice such as goals, priorities, conditions, exceptions, trust rules, diplomacy preferences, safety rules, or long-term plans.

Its **authoritative stored and transmitted output is structured, human-readable plain text**. The graphical editor is an authoring interface, not the system boundary. This keeps instructions understandable, saveable, versionable, bounded for Character AI context, usable by LLM or BOT interpretation, and inspectable/validatable by the game.

Example:

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

### Conversation-Driven Instruction Updates

Conversation and Instruction Flow are linked. Character AI may interpret a conversational statement as a persistent advisory rule and update the supported plain-text flow accordingly, or revise/remove an earlier goal when the player changes direction.

Such updates may change advice, priorities, heuristics, warnings, plans, or encouraged beliefs. They may **not** create gold, change rank, teleport characters, declare deaths, invent settlements, bypass requirements, create illegal actions, or otherwise alter authoritative simulation values.

## 🧠 Advice Is Influence, Not Mind Control

Advisor Instructions are strong behavioral guidance, not guaranteed commands. Personality and circumstances remain meaningful: pride, compassion, fear, ambition, mistrust, or strong trust in the Advisor may change how advice is interpreted or followed. Building the relationship is part of the game.

---

# 🔁 Gameplay, Agency, and Progression

## Core Gameplay Loop

1. **Observe** events, rumors, opportunities, threats, factions, relationships, and environmental changes.
2. **Investigate** the map, reports, characters, objects, clues, conversations, and tools.
3. **Use Advisor tools / mini-games** to improve information, leverage, or opportunities.
4. **Talk to the character** about events, risks, plans, and priorities.
5. **Review or modify Advisor Instruction Flow** for persistent guidance.
6. **Character AI evaluates** authoritative state, personality, memories, relationships, conversation, and instructions.
7. **Character chooses legal actions** available at their current status and circumstances.
8. **Simulation validates and resolves** legality, costs, checks, probabilities, and consequences.
9. **World advances** as the character and other autonomous actors act.
10. **Consequences become context** through changed resources, relationships, reputation, politics, memories, opportunities, and Chronicle facts.
11. **Advisor reacts and adapts** future advice.

<div align="center">

### Observe → Investigate → Advise → Character decides → World reacts → Discuss → Adapt

</div>

## Why Advice Is Interesting

- Character traits, history, fears, ambitions, relationships, and memories affect interpretation.
- Good advice can be rejected; bad advice can succeed temporarily and create long-term costs.
- The same advice can produce different results for different characters.
- Information has provenance and may be incomplete or biased.
- Silence is a valid decision.
- Trust changes how seriously advice is considered without eliminating autonomy.
- Characters remember loyalty, betrayal, generosity, humiliation, promises, and prior advice.
- Advice appropriate for one social rank may become wrong at another.
- No perfect instruction set exists; changing circumstances create conflicts and exceptions.
- Failure may create recovery stories—poverty, imprisonment, dismissal, broken relationships, political defeat, military disaster, exile, lost opportunities, or damaged reputation—rather than immediate game-over.

## 🎮 Player Agency and Mini-Games

The player may converse, investigate, collect evidence, reveal secrets, identify opportunities, reason about consequences, recommend actions or relationships, use Advisor tools, and solve mini-games. The player **does not directly command ordinary world characters** with binding orders such as “go there,” “attack,” “join,” “arrest,” “build,” or “declare war.”

Indirect influence is the intended route: evidence may change how the main character treats someone; a negotiation tool may improve an opportunity; battlefield analysis may improve judgment; a safe-route discovery may influence travel.

Mini-games may include reconstructing events, comparing witness accounts, tracing routes, decoding messages, analyzing maps, preparing diplomatic arguments or speeches, detecting suspicious behavior, organizing information, researching claims, evaluating resource proposals, examining military plans, or solving environmental puzzles. They may affect information quality, confidence, available advice, persuasion, reputation, relationships, discovered opportunities, hidden facts, or probability modifiers, but never force autonomous actors to take actions. Accessible auto-resolve should exist where appropriate.

## 📈 Character Progression

| Rank | Typical scale of play |
| --- | --- |
| 🌾 **Peasant** | Survival, work, family, shelter, food, local relationships and reputation |
| 🏡 **Villager** | Local responsibilities, social ties, modest wealth, better information access |
| 🛡️ **Squire** | Training, military culture, loyalty, patronage, noble relationships |
| ⚔️ **Knight** | Campaigns, protection duties, tournaments, political missions, land/title opportunities |
| 🏰 **Baron / Duke / Lord** | Estates, settlements, taxation consequences, factions, diplomacy, court intrigue, larger military responsibility |
| 👑 **Prince / King** | National diplomacy, major wars, succession, laws, realm economy, legitimacy, large crises |
| 🌍 **Emperor** | Multiple kingdoms, imperial administration, alliances, rebellions, cultural conflict, succession, massive wars, imperial legitimacy |

As power grows, the Advisor's influence can become historically significant, but the AI character remains the actor.

## 🧠 Advisor Progression

Advisor capability can grow without granting direct rule:

| Capability | Purpose |
| --- | --- |
| 🔎 **Insight** | Reveal uncertainty, detect bias, improve forecasts |
| 🗣️ **Rhetoric** | Present advice more effectively |
| 🤝 **Diplomacy** | Understand relationships and faction incentives |
| 💰 **Stewardship** | Analyze economic consequences |
| ⚔️ **Command** | Analyze military situations |
| 🕵️ **Intrigue** | Uncover secrets and recognize manipulation |

Progression may unlock more complex Instruction Flow structures, better reports, investigation and memory tools, private conversations, historical analysis, predictions, additional mini-games, and improved information access. These improve **influence**, not ownership of characters or the world.

---

# 🏗️ Major Systems

## Character AI Pipeline

All core gameplay uses one shared contract:

1. Deterministic simulation owns authoritative game state.
2. The game derives bounded character context containing only information the character may know.
3. Personality, memories, relationships, goals, Advisor Instructions, and relevant recent conversation are added.
4. A configured LLM may roleplay, interpret advice, update supported advisory instructions, and propose preferences or intentions; the BOT uses compatible character data and rules when no suitable LLM is available.
5. Proposed actions are checked against the current legal-action allowlist; invalid output is rejected, repaired, or replaced by BOT output.
6. Only deterministic simulation applies costs, random checks, movement, resources, combat, progression, state transitions, and consequences.

## 🧠 Memory and Relationships

Important memories may include promises, betrayals, victories, failures, important advice, disagreements, people who helped or harmed the character, unresolved goals, fears, and political events. Long campaigns should prefer summarized structured memories over preserving every raw chat message; canonical simulation facts remain separate from generated roleplay prose.

Relationships may track trust, friendship, affection, fear, rivalry, loyalty, resentment, respect, suspicion, and obligation. Advisor trust is especially important: repeatedly useful advice may increase it; manipulation, false information, or disastrous advice may reduce it. High trust increases influence, never mind control.

## 💰 Economy and Settlements

As responsibility expands, systems may include Gold, Food, Materials, population, prosperity, stability, legitimacy, military readiness, production, trade, buildings, and settlement development. The player analyzes reports and recommends strategies; autonomous actors make legal decisions. Settlement presentation may grow from villages to towns, cities, castles, capitals, and imperial centers.

## 🤝 Diplomacy and Autonomous Factions

Factions have leaders, traits, needs, memories, relationships, territory, incomplete knowledge, and political objectives. Treaties create obligations; alliances can create commitments; trade can create dependency; personal insults, marriages, betrayals, debts, religious disputes, succession disputes, and old wars may affect relations. The main character participates only within their current authority.

## ⚔️ Military Strategy

Military play remains strategic rather than unit-by-unit player control. Relevant mechanics may include recruitment, commanders, supplies, terrain, morale, training, formations, objectives, defense, raids, sieges, retreats, and diplomacy. Characters with legitimate authority issue orders; the deterministic simulation resolves outcomes with controlled seeded variance where appropriate.

## 📜 Events, Quests, Crises, and Opportunities

Events drive narrative and may include local disputes, crimes, shortages, illness, banditry, family conflict, romance, tournaments, recruitment, intrigue, assassinations, invasions, rebellion, succession, diplomacy, economic collapse, and supernatural discoveries. Events should create situations to understand rather than a single obvious correct answer.

## 👥 Autonomous World Characters

Other characters may use deterministic AI, authored behavior, utility systems, state machines, or bounded LLM support. Relevant characters may have identity, personality, occupation, status, relationships, memories, goals, possessions, location, beliefs, knowledge, and intentions. The Advisor influences them through the world rather than directly possessing or commanding them.

---

# 🗺️ Procedural World and Presentation

The game is a lightweight **isometric / near-isometric 2.5D experience rendered through WebGL**, with HTML/CSS/SVG/Canvas interfaces for conversation, reports, investigation, mini-games, Advisor tools, and Instruction Flow. Readability, atmosphere, character emotion, and clear interaction take priority over unrestricted free-camera 3D complexity.

## 🌱 Seeded, Reproducible, Extensible World

A player-visible **SEED code** deterministically defines generated content, including biome distribution/transitions; terrain and environmental variation; rivers, lakes, coastlines, roads and paths; settlement/growth anchors; standard buildings; trees, rocks, vegetation, bridges, signs, props and resources; deterministic visual variants/orientation/scale; and defined seed-generated regions or landmarks.

Required families may use repository-shipped art or procedural primitives, but selection and placement for a compatible SEED and generation rules must remain deterministic. Runtime AI image generation is not required for reproducibility.

World generation must support stable region/chunk generation:

- regions can be generated from campaign SEED + stable coordinates when needed and unloaded when no longer rendered;
- the logical world need not have a fixed pre-generated global boundary;
- generation order must not affect results;
- the same SEED, world-generation version, and region coordinates must reproduce the same base region whenever revisited;
- saves preserve SEED and a compatible generation version, plus **state differences** such as destroyed structures, upgrades, ownership changes, discovered information, or other campaign consequences rather than duplicating every base tile/object.

Location remains mechanically meaningful for meetings, information access, travel time, trade/military routes, employment, political control, local events, and hazards.

## 🎨 Visual Direction and Asset Fallback

Visual direction includes isometric 2.5D terrain and movement, high-quality 2D portraits, visible emotional states where appropriate, layered/illustrated backgrounds for important scenes, seed-compatible building/object families, unique landmarks, and lightweight atmosphere such as lighting, shadows, weather, particles, water, smoke, fire, fog, and vegetation motion when performance permits. Visual effects must never reduce readability of map information, evidence, reports, character state, or Advisor choices.

**Required gameplay visuals always need repository-shipped fallbacks.** If a required reusable visual is missing during development, an AI development agent should create a **true vector asset** and save it into the appropriate versioned asset directory. Such assets must:

- use genuine vector geometry/styling, never a raster PNG/JPEG merely embedded in SVG;
- meet the established modern high-quality 2.5D visual language with purposeful silhouette, depth, material cues, shading/highlights, and readable detail;
- respect isometric direction, scale, proportions, footprint logic, climate/terrain identity, and family consistency in palette, lighting, outline, perspective, and detail;
- remain readable on supported phones/tablets and credible when enlarged on higher-resolution displays;
- avoid final-facing debug boxes, simple primitives, generic icons, single-color silhouettes, or similarly minimal placeholders;
- use stable filenames and predictable family-based directories for deterministic data references and reuse;
- be optimized so vector complexity does not impose excessive DOM/SVG/memory/GPU cost.

This policy fills missing **presentation assets**; it never changes seed-generated simulation content. Accepted generated assets become normal repository assets and are not regenerated during normal gameplay.

## 📱 Responsive, Touch, Pointer, and Keyboard Requirements

The complete game must work on current desktop browsers, tablets, and phones in **portrait and landscape**, with mobile layouts designed intentionally rather than as scaled-down desktop UI.

- **Phone portrait:** prioritize one primary task; compact map plus tabs/sheets/drawers/full-height panels; important navigation within reach; panels dismissible; on-screen keyboard must not hide essential send/close/navigation controls.
- **Phone landscape:** prefer split view when width allows; map usually larger, contextual panel secondary and collapsible; no reliance on hover or tiny edge targets.
- **Tablet portrait/landscape:** use larger persistent context; map and Advisor panels may coexist; orientation changes must reflow without losing selection, conversation draft, open report, map position, or gameplay state.
- **Map:** tap/click selects; one-pointer drag pans; pinch zooms; desktop wheel/equivalent may zoom; interaction must not require free 3D camera manipulation; selected/focused/available/unavailable/uncertain states must be clear; important information cannot be hover-only.
- **UI:** support touch, mouse, and keyboard where applicable; prefer interactive targets around **44 CSS px** where practical; avoid precision dragging unless needed and offer tap/select alternatives where practical; provide tap/focus/info equivalents to hover; respect safe areas and browser text scaling; do not encode required information only by color.
- **Instruction Flow:** must support touch-friendly rule/node editing, scrolling, zooming, selection, connections, reordering, and plain-text inspection without requiring a desktop mouse.

## ⚡ Rendering Scalability

Only visible/nearby regions need full detail. Distant/inactive regions may be simplified or simulation-only. Decorative density, particles, shadows, animation frequency, and render resolution may scale by device capability, including sensible limits for high-density displays. UI responsiveness and readable text take priority over optional effects. Visual quality scaling must **never** change deterministic simulation outcomes, legal actions, AI knowledge, or campaign state.

---

# 🧭 Design Principles

1. **Player advises; AI Character decides and acts.** This is the product identity.
2. **The AI character is the protagonist.** The Peasant-to-Emperor journey belongs to the autonomous character.
3. **Influence instead of direct control.** The player changes outcomes through people, information, advice, tools, and opportunities.
4. **Conversation and persistent advice are gameplay.** Natural dialogue and Advisor Instruction Flow are linked.
5. **Instruction Flow is plain text at the system boundary.** Its graphical editor is an authoring interface.
6. **LLM-centered, rules-grounded.** Models interpret and roleplay; deterministic systems define truth, legality, and consequences.
7. **One character, multiple compatible AI drivers.** LLM and BOT represent the same protagonist.
8. **Characters retain agency.** Neither the protagonist nor ordinary NPCs become player-controlled puppets.
9. **Mini-games add direct interaction without breaking autonomy.**
10. **Progression changes the scale of problems and authority.**
11. **Static-hosting first.** Core gameplay works from GitHub Pages without a mandatory application backend.
12. **Readable causality.** The player should understand their advice, the character's decision, and the resulting consequence.
13. **Respect the player's time.** Progress comes from decisions, relationships, discoveries, and stories rather than daily-login systems or grind.
14. **Accessible by default.** Keyboard, mouse, and touch are supported; required information never relies on color alone.
15. **Testable from the beginning.** The earliest development priority is to establish a usable environment, platform, and interface through which anyone can try the evolving application at the stable public URL. README does not prescribe how Workers technically achieve this.
16. **Grow one working product step by step.** The capabilities and experiences defined in this README are introduced gradually in small, independently verifiable increments. Each accepted increment builds on the previously verified product so the application continuously becomes broader, better, and more complete rather than being rebuilt as disconnected feature branches or throwaway prototypes.

---

# 🌐 Runtime Architecture, Trust Boundary, Saves, and Privacy

The game must remain a client-side web experience that can be published through GitHub Pages at the stable public URL. A mandatory custom application backend, account system, or server-side simulation must not be required for core gameplay. Exact repository layout, file layout, module boundaries, build organization, and deployment implementation are Worker decisions.

An optional player-configured **OpenAI-compatible HTTPS endpoint** may be called directly from the browser only when it supports the required CORS configuration. No API key is bundled with the game. Player-entered credentials remain outside campaign saves and exported campaign data.

## 🔐 LLM Trust Boundary

LLM output is **untrusted external input**. It may generate dialogue, reasoning summaries, intentions, emotional responses, advice interpretation, proposed supported Advisor Instruction changes, or preferences among currently legal actions. It may **not** directly edit authoritative JavaScript state; create resources/items/settlements; change ranks or experience; determine random rolls; move armies; kill characters; create legal authority; bypass requirements; or alter rules.

Structured model output must be parsed and validated against supported schemas and the legal-action allowlist. Invalid output is rejected or sanitized; one bounded correction may be requested; deterministic BOT fallback is used when needed. Gameplay must never rely on trusting arbitrary model prose.

## 💾 Saves and Privacy

- Full campaign saves use **versioned JSON**; map export may remain a separate tool.
- Saved campaign data may include character identity, rank, personality, important memories, relationships, goals, Advisor Trust, persistent Advisor Instructions, structured AI decisions, and canonical Chronicle facts.
- Raw model requests/responses are not required for persistence.
- Provider credentials must never be stored in campaign saves.
- Only minimum bounded game context should be sent to a configured external model.
- The game remains playable through the local BOT without personal information or external accounts.
- Campaigns can be exported/imported as versioned JSON.
- The verified game must remain deployable at `https://sgoxel.github.io/The-Advisor-Game/` and compatible static hosting environments.

---

# 🚀 Development and Release Principles

Development must remain **continuously and manually testable**.

The earliest development priority is not a predefined feature phase. It is establishing a usable public environment, platform, and interface so anyone can try the evolving application at `https://sgoxel.github.io/The-Advisor-Game/`. This is a permanent development principle, not a fixed roadmap item or prescribed technical design.

Every capability, system, interaction, and experience described or required by this README must be introduced **gradually and step by step**. Development should behave like a rolling snowball: each independently verified improvement builds on the last known-good product, preserves previously accepted functionality, and makes the same application progressively broader, better, and more complete.

- README does **not** define phases, task order, project structure, file structure, module names, implementation sequence, or technical decomposition. Those remain Worker decisions made from the current project state while obeying these principles.
- New work should be divided into small, meaningful, testable increments whenever practical.
- Each independently verified increment must extend, improve, or safely refine the same working product rather than create a disconnected throwaway build.
- The latest verified public build must preserve previously accepted work while incorporating newly accepted work.
- Failed, incomplete, or unverified work must never replace the last known-good public build.
- Phase boundaries, when Planner chooses to use them, are planning constructs rather than README-defined product structure. Every completed phase still requires appropriate independent verification and a manually testable public release.
- Users must be able to manually test the latest verified product at `https://sgoxel.github.io/The-Advisor-Game/` throughout development.

The exact technical means used to provide, organize, build, deploy, version, and promote the application are subordinate Worker decisions unless another fundamental rule in this README explicitly constrains them.

---

# 🛠️ AI Development Workflow

Before planning, coding, testing, or releasing, Workers **MUST read this README**. It defines product intent and authority.

The authority order is:

<div align="center">

### README → Planner-owned planning → active tasks/issues → implementation → tests → verified release

</div>

README wins every conflict. Existing planning, issues, code, tests, release artifacts, and prior assumptions are subordinate and must be corrected when incompatible with README.

## Planning Freedom

README intentionally does **not** prescribe a roadmap, phase list, project map, file layout, module layout, task breakdown, implementation order, or detailed technical architecture unless a rule is explicitly stated as a product constraint elsewhere in this README.

Planner decides these details from the current project state and may revise subordinate planning as development evolves. Coder may choose implementation details inside approved task scope. Tester verifies outcomes against README and current approved planning rather than enforcing an obsolete structure merely because it existed earlier.

## Worker Model

Development uses three primary Workers: **Planner Worker**, **Coder Worker**, and **Tester Worker**. Each Worker uses the minimum required context, records meaningful work on GitHub, and stays inside its assigned role except for the explicit fallback modes below.

Planner-owned JSON planning data must parse and contain the required fields before dependent work continues. Invalid planning JSON must be repaired or regenerated first.

### Planner Worker

Planner:

- derives and maintains the project roadmap from README and current verified project state;
- chooses phases, task order, dependencies, acceptance criteria, project organization, and implementation sequence;
- keeps only one active phase at a time unless README explicitly requires otherwise;
- prioritizes unresolved work affecting the current or earlier phase before activating later work;
- reconciles subordinate planning when README changes;
- reviews `PLANNER REVISION REQUEST` from Coder and replies `ACCEPTED` or `REJECTED` on GitHub;
- applies only README-compatible planning changes;
- records decisions, reasons, and resulting planning changes on GitHub.

A rejection requires a clear reason.

#### Planner Fallback Coder Mode

Planner work always has priority. Only when no Planner work, README reconciliation, or unresolved `PLANNER REVISION REQUEST` exists may Planner temporarily work as Coder on one eligible current-phase or required earlier-fix issue.

Fallback coding activity must be identified on GitHub as **`Coder Worker (Planner)`**.

While in fallback mode Planner follows Coder rules but must not silently change planning scope, dependencies, or acceptance criteria. If coding reveals that planning must change, fallback coding stops and the Worker returns to Planner role. A Worker may never create and approve its own revision request.

### Coder Worker

Coder:

- works only eligible current-phase issues or required earlier fixes;
- prefers small visible testable changes;
- splits large implementation work into ordered verifiable steps when useful;
- tests and verifies each step before continuing;
- fixes failures before proceeding;
- records meaningful progress and evidence on GitHub;
- reviews `TESTER REVISION REQUEST` and replies `ACCEPTED` or `REJECTED` on the same GitHub issue;
- implements and tests accepted Tester revisions;
- provides a technical reason and evidence when rejecting a Tester revision;
- creates `PLANNER REVISION REQUEST` when approved planning must change instead of modifying planning directly;
- runs appropriate regression before considering implementation work complete.

### Tester Worker

Tester work always has priority. Tester independently verifies completed work against README, current approved planning, issue requirements, relevant regressions, and the continuously testable release rule.

If issue work is defective, Tester reopens it and creates a `TESTER REVISION REQUEST` on the same issue containing evidence, expected result, and required correction.

Coder may `ACCEPT` or `REJECT`. Tester independently rechecks after the response. Work cannot pass while a valid revision request remains unresolved.

When the active phase is complete, Tester performs the required independent phase verification and release gate. Broken or intermediate work must not replace the last known-good public release.

#### Tester Fallback Coder Mode

Only when no Tester work, unresolved Tester revision request, or release gate exists may Tester temporarily work as Coder on one eligible current-phase or required earlier-fix issue.

Fallback coding activity must be identified on GitHub as **`Coder Worker (Tester)`**.

Tester follows Coder rules in fallback mode and may create `PLANNER REVISION REQUEST` when planning must change, but must not modify planning directly. Tester must not independently approve, test-pass, or release-gate its own fallback coding work. That work requires independent verification by another eligible Worker before it can count as tested or enter a verified release.

## Revision Flow

- Tester → Coder through `TESTER REVISION REQUEST`.
- Coder → Planner through `PLANNER REVISION REQUEST`.
- The target Worker replies `ACCEPTED` or `REJECTED` on GitHub.
- Every rejection requires a reason; technical rejection requires evidence when applicable.
- Requests, responses, evidence, decisions, changes, and outcomes remain recorded on GitHub.
- No Worker may approve its own revision request.

## Independence

- A Worker must not independently approve its own coding work.
- Fallback coding requires independent verification by another eligible Worker.
- Release approval requires independent Tester verification.

## GitHub Worker Identity

The connected GitHub account may remain the actual account identity. Logical Worker identity must be recorded in commits, comments, progress, and status records:

- Normal coding: `Coder Worker`
- Tester fallback coding: `Coder Worker (Tester)`
- Planner fallback coding: `Coder Worker (Planner)`

Every implementation must preserve the core product rule:

**Player advises → AI Character decides → Simulation validates → World reacts.**

## 🔒 README Protection

> [!CAUTION]
> `README.md` is protected. AI Workers **MUST NOT** edit, rewrite, reformat, synchronize, request changes to, or otherwise modify it unless the Admin explicitly authorizes that exact README modification. When subordinate project data conflicts with README, change the subordinate data instead.

---

# 🤝 Contributing

Issues and pull requests are welcome. A useful gameplay change should identify the relevant README rule, preserve the autonomous-character model and deterministic validation, preserve local BOT fallback, maintain English/Turkish localization for player-facing text, include appropriate acceptance criteria and deterministic tests, and avoid giving direct world authority to the human Advisor.

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

🎮 [Play Latest Release](https://sgoxel.github.io/The-Advisor-Game/) · 🏷️ [Latest GitHub Release](https://github.com/sgoxel/The-Advisor-Game/releases/latest)

</div>
