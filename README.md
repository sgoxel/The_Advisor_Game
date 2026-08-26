<div align="center">

# 🏰 The Advisor Game

### 🧠 Advise an autonomous AI character. Shape a life. Change a kingdom. Maybe build an empire.

**A fully client-side medieval fantasy roleplaying and strategy game where the human player advises an autonomous AI-controlled main character as they rise from Peasant to Emperor.**

<p>
  <img alt="Development Status" src="https://img.shields.io/badge/status-planning%20%2F%20from%20scratch-orange">
  <img alt="Platform" src="https://img.shields.io/badge/platform-HTML5%20%2B%20WebGL2-blue">
  <img alt="AI" src="https://img.shields.io/badge/AI-LLM%20%2B%20Local%20BOT-purple">
  <img alt="Hosting" src="https://img.shields.io/badge/hosting-GitHub%20Pages-black">
  <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-green">
</p>

[🌐 GitHub Release Page location](https://sgoxel.github.io/The-Advisor-Game/)

</div>

> [!IMPORTANT]
> **Core rule:** The human player advises. The autonomous AI character decides and acts.
>
> **Player advises → AI Character decides → Simulation validates → World reacts.**

> [!NOTE]
> **Development status:** starting from scratch. This README defines the intended product, architecture, constraints, and development direction. Unless explicitly stated otherwise in a future release record, nothing described here should be interpreted as already implemented or playable.

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

---

# 🌐 Runtime Architecture, Trust Boundary, Saves, and Privacy

The production game is static HTML, CSS, JavaScript, localization, images, and audio hosted by GitHub Pages. GitHub Pages deploys the verified `LatestRelease/` snapshot as the public site root, preserving a stable player URL.

No mandatory custom server, serverless function, database, account, or server-side simulation is required. Locally executed systems include world generation, deterministic Character BOT, game-state/action validation, progression, economy/world simulation, seeded checks, saves, and Advisor Instruction Flow storage/validation.

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
- Runtime assets use repository-relative URLs so the game works under `https://sgoxel.github.io/The-Advisor-Game/` and compatible static hosts.

Opening `index.html` through `file://` is best-effort because browsers restrict some asset/network operations. GitHub Pages or another ordinary HTTPS static host is sufficient.

---

# 🧪 Starting State

Development begins from a clean starting point. This README describes the **target product and required behavior**, not completed functionality. Implementation status must be tracked outside this protected product-definition README, such as in the ROADMAP, TODO/task state, tests, and release records.

No feature, module, test, deployment, release, or UI shown or named in this document should be treated as already completed solely because it appears here.

---

# 🧰 Development and Deployment Target

The target production game is a static browser application deployable through GitHub Pages or another compatible HTTPS static host, with no mandatory application backend. Players should not require Node.js or a local server.

For development, the project should provide local tooling and automated checks equivalent to:

```bash
npm install
npm run dev
```

Target verification commands include:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:playwright
npm run perf
```

These commands are **development requirements**, not a statement that the corresponding tooling already exists.

---

# 🚀 Development Release Policy

Once development releases begin:

- `main` contains accepted source history; verified deployable snapshots are stored in `LatestRelease/`.
- GitHub Pages publishes `LatestRelease/` at `https://sgoxel.github.io/The-Advisor-Game/`.
- GitHub Releases use `https://github.com/sgoxel/The-Advisor-Game/releases/`.
- Versions use `v<major>.<minor>.<patch>-dev.<number>` tags; [`VERSION`](VERSION) is the concrete version authority for tooling, tags, manifests, and releases.
- README must **not** embed the current release number, current tag, or a version query parameter.
- A release candidate must pass its release gate before Release Manager copies the verified static build into `LatestRelease/` and completes the final main-targeting release PR.
- `LatestRelease/release-manifest.json` records the published version and source commit without requiring README edits.
- Broken intermediate states must never be copied into `LatestRelease/`.
- Ordinary version increments must not modify this protected README.

Before the first verified release, the public play URL and GitHub Release page must not be treated as evidence of implemented functionality.

---

# 🛠️ Authority for Planning and Coding Agents

Before planning or implementing gameplay, agents **MUST read this README**. It defines product intent and authority.

The synchronization direction is:

<div align="center">


</div>

When README conflicts with task specifications, implementation, tests, or previous assumptions, **README wins**. Implementation artifacts and tests are subordinate to README and remain valid only while compatible with it.

Every gameplay implementation must preserve the rules already defined above, especially:

- **Player advises; AI Character decides and acts.** Never replace an unfinished AI feature by temporarily letting the player make the protagonist's binding decisions.
- Human players never gain unrestricted direct control over autonomous world characters.
- LLMs may handle dialogue, roleplay, interpretation, personality, memories, advice evaluation, supported instruction updates, and selection among legal actions; deterministic systems own validation, legal actions, costs, seeded checks, progression, resources, movement legality, combat, state transitions, and consequences.
- The Advisor Instruction Flow may look like a flowchart, decision tree, algorithm editor, node graph, or rule system, but its system-boundary output remains plain-text advisory instructions that may be edited by the player or updated by Character AI when allowed and may never bypass simulation rules.

## 🔒 README Protection

> [!CAUTION]
> `README.md` is protected. AI agents **MUST NOT** edit, rewrite, reformat, synchronize, or otherwise modify it unless the Admin explicitly authorizes that specific README modification. If implementation suggests a README change, agents must propose it to the Admin rather than silently changing README to match code, tests, SPEC, TODO, or assumptions.

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


</div>
