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

## 🏡 Starting Village and Living Local World

Every new campaign begins with the autonomous protagonist as an ordinary low-rank character in a procedurally generated village.

When the player does not explicitly provide a SEED, the game generates one. The starting village is selected or generated deterministically from the campaign SEED, so a compatible SEED and generation rules reproduce the same starting settlement and generator-defined base-world structure.

The player must begin inside a visibly inhabited medieval-fantasy environment rather than on an empty map, abstract dashboard, or isolated character screen.

The starting village must contain a coherent village environment with appropriate homes, roads and paths, gathering areas, farms or fields where suitable, trees and surrounding terrain, shops, workshops, service buildings, food and lodging locations, storage or production locations, and settlement-specific landmarks.

The village must be populated by numerous autonomous world characters that visibly exist, move, perform routines, travel locally, work, idle, socialize, and interact within the same strategic world where appropriate.

Local characters should represent useful occupations and social roles appropriate to the generated settlement, including examples such as butcher, greengrocer or produce seller, woodcutter, charcoal burner, tavern keeper, inn or lodging owner, market or shop owner, farmer, craftsperson, guard, traveler, laborer, and other residents.

These characters are not decorative crowd sprites. They are simulation-backed world characters with locations, activities, roles, relationships, potential needs, and potential interactions that may become relevant to the protagonist.

The protagonist may meet, converse with, trade with, work for, cooperate with, avoid, investigate, or otherwise interact with appropriate world characters according to simulation rules and current circumstances.

## 🏘️ Settlement Diversity and World Scale

The world must support multiple visually and functionally distinct settlement archetypes rather than repeating one generic settlement layout.

Settlement types may include small rural villages, farming villages, forest villages, mining or production villages, roadside and trade settlements, frontier villages, border villages, fortified villages, abandoned or ruined villages, towns, market towns, fortified towns, large cities, castle settlements, capitals, and other regionally appropriate settlement forms.

Settlement appearance, layout, buildings, population, professions, resources, roads, defenses, prosperity, hazards, and surrounding environment should reflect settlement type, geography, region, history, and campaign state.

As the protagonist progresses from Peasant toward noble, royal, and eventually imperial authority, the spatial and political scale of play must expand naturally from local village life toward towns, cities, kingdoms, and multiple realms without replacing the living strategic world with menu-only gameplay.

---

# 🗺️ World and Presentation

## 🗺️ Primary Game Surface — Living Strategic World Map

The primary playable surface of The Advisor Game is a persistent, living strategic world map presented in an isometric or near-isometric style comparable in spatial readability to classic strategy games.

The game must not be presented primarily as a collection of menus, cards, dashboards, text panels, disconnected scenes, or static mockups.

The player must be able to observe the evolving game world itself.

The strategic world map must visually represent, as applicable to the generated world and current campaign state, terrain and elevation; biomes; rivers, lakes, coasts and water; forests and vegetation; roads, paths and bridges; settlements; individual buildings and structures; ruins, caves, dungeons and landmarks; resources and environmental objects; the autonomous main character; other people; animals; fantasy creatures and monsters; armies, groups and caravans; and environmental effects such as weather, lighting, fire, smoke, fog and water.

Characters, creatures, buildings, terrain and objects may use a coherent combination of 2D, 2.5D and 3D techniques, but they must appear to inhabit the same spatial world.

The strategic map is not decorative background art. It is the visual representation of the authoritative simulated world.

Locations, movement, settlements, roads, terrain, discoveries, events, characters and world changes represented on the map must correspond to simulation state.

As the simulation changes the world, the visible strategic map must react accordingly.

The camera and presentation must allow the player to understand where the main character is, what surrounds them, what places exist nearby, and how the local area relates to the wider world.

Early releases may use simplified or placeholder assets, but they must establish and progressively extend this same playable strategic world rather than replacing it with disconnected visual prototypes.

## 🌐 WebGL-Based Mixed 2D / 3D Presentation

The game is a **WebGL-based mixed 2D/3D experience** with an isometric or near-isometric presentation.

The visual world may combine real-time 3D scenes and objects; 2D portraits and character artwork; illustrated or layered backgrounds; sprites and overlays; textures and materials; UI graphics and icons; terrain, buildings, vegetation, props, landmarks, roads, bridges, settlements, and environmental effects.

2D and 3D content must feel like parts of the same coherent game world rather than disconnected visual prototypes.

Readability, atmosphere, character emotion, clear interaction, responsive performance, and broad browser/device usability take priority over unnecessary visual complexity.

## 🌱 Seeded, Reproducible, Extensible World

The world is procedurally generated from a player-visible **SEED**.

A compatible SEED and world-generation rules should reproduce the same base world and regions, including the major environmental and settlement structure that belongs to procedural generation.

For a compatible campaign SEED, procedural generation includes not only terrain but the generator-defined base spatial identity of the playable world: the starting settlement and settlement archetype, settlement layout, roads and paths, major buildings and landmarks, surrounding terrain and biomes, local population generation, important world locations, and other deterministic base-world features defined by the generator.

Procedurally generated scenes and settlement areas must derive their generator-defined base composition from the SEED. Dynamic campaign consequences, character decisions, destruction, construction, ownership, relationships, discoveries, politics, and other simulation changes may subsequently alter that base world.

The world may include biomes and terrain variation; rivers, lakes, coasts, roads and paths; settlements and growth anchors; buildings and landmarks; trees, rocks, vegetation, bridges, signs, props and resources; local populations; creatures; and deterministic visual variation.

Campaign changes such as destruction, upgrades, ownership, relationships, discoveries, politics, or other consequences may alter the world after generation.

Location must remain meaningful to gameplay, including travel, meetings, information access, trade, military movement, employment, politics, events, and hazards.

## 🎨 Visual Direction

The visual direction should support coherent isometric / near-isometric presentation, high-quality 2D and 3D assets, readable silhouettes and scale, character emotion and atmosphere, distinct settlements and environments, environmental effects, and progressive improvement from early placeholders to polished visual assets.

A Worker acting in the **Designer** role chooses the appropriate tools, asset formats, modeling methods, export settings, optimization methods, and production pipeline for each approved task.

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
16. **Development should normally be cumulative:** accepted work extends the current product instead of replacing it with disconnected prototypes.
17. **Verified public releases are preferred by default, but explicit Admin publication instructions override normal verification and release-gate requirements.**
18. **An Admin-directed unverified build may be published when explicitly requested, but it must not be represented as independently verified unless it actually passed independent verification.**
19. **The living strategic world map is the primary game surface.** Terrain, locations, settlements, characters, creatures, objects and relevant world changes must be experienced as parts of one coherent simulated world rather than primarily through disconnected menus, dashboards or static scenes.
20. **A new campaign begins in a SEED-generated inhabited village.** The starting world must already contain a meaningful settlement, buildings, local environment, and autonomous local population rather than an empty or purely abstract starting surface.
21. **World characters are living simulation participants, not decoration.** Local NPCs should visibly move, follow appropriate activities or routines, occupy useful roles and professions, and provide potential interaction within the same world as the protagonist.
22. **Advice must connect to observable world behavior.** When the autonomous protagonist chooses valid advice, the resulting movement, action, interaction, and consequences must be represented through the living strategic world without giving the player direct control.

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

The project normally uses five recurring scheduled Worker identities: **Worker #1, Worker #2, Worker #3, Worker #4, and Worker #5**. It also supports **Worker #6** as a persistent, manually invoked Worker identity that is not part of the recurring schedule.

All Worker identities retain the same role boundaries and independence rules. No Worker has a permanent development role.

Worker roles use this ordered cycle:

**Planner → Coder → Designer → Tester → Reviewer → Planner → ...**

A scheduled Worker invocation receives a **starting role** from the recurring rotation. Worker #6 is manually invoked and does not consume or advance the recurring scheduled rotation merely by being invoked.

Worker runs are **work-conserving**. Starting from the applicable role, a Worker continues through the role cycle and should perform all currently eligible work it can safely complete within each role, in project-priority order, rather than stopping after one task merely because a role already produced useful work.

After a material issue, commit, verification, claim, dependency, or planning-state change, the Worker should re-evaluate current eligibility before selecting further work. Completing one task may unblock or create legitimate work for another role.

After all five roles have been visited, the Worker begins another pass when the preceding pass performed work or materially changed eligibility. The Worker continues until a complete five-role pass produces **no eligible progress**. A blocked or unchanged target must not be retried indefinitely in the same invocation unless relevant external state materially changes.

Blocking corrections, revisions, handoffs, verification obligations, continuations, and release-critical work take priority over ordinary backlog appropriate to their owning role. Workers must not invent work merely to keep themselves busy.

Worker identity and independence restrictions remain in force throughout multi-role and multi-pass runs. A Worker must not independently verify or approve its own earlier implementation, design, revision, bug fix, workflow fix, or process fix. When no independent target exists for Tester or Reviewer, that target remains for another Worker identity while the current Worker continues with other eligible work.

For recurring Workers #1–#5, the next scheduled starting point should follow the **last role in which useful work was actually performed** during the preceding completed run. If the preceding Worker made no eligible progress in any role, the unresolved starting point is preserved rather than falsely consuming empty roles.

Worker #6 uses normal claims and audit records but remains outside the recurring schedule cursor so a manual capacity run cannot silently disturb the scheduled Worker sequence.

Multiple Workers may overlap in time. Claims, dependency rules, committed-state checks, NVIDIA ownership, and independent-verification rules remain responsible for preventing duplicate work, self-approval, and unsafe concurrency.

README defines this high-level role model and its responsibility boundaries. Detailed scheduling, rotation-state storage, task-selection mechanics, claim syntax, branching, file handling, commands, tools, automation implementation, and other execution details belong to Worker instructions and subordinate operational records.

## Planner

Planner converts README goals and principles into practical project planning.

Planner decides phases and sequencing, dependencies, architecture and project organization, technical decomposition, task scope and acceptance criteria, assignment of work to the appropriate role, and normal prerequisites for an independently verified phase release.

Planner keeps planning state consistent with Admin instructions and README, maintains enough focused work for implementation and design, and does not move planning detail into README.

Planner does not normally implement product code or visual production and does not approve releases.

## Coder

Coder implements approved project work.

Coder owns technical implementation decisions inside approved scope, including runtime/application code, configuration, integration, and implementation-focused tests, and coordinates with Designer when code and visual assets must work together.

Coder does not redefine Planner-owned scope, acceptance criteria, dependencies, or phase order and does not independently certify its own implementation as verified.

## Designer

Designer owns creation and refinement of the game's visual presentation, including 2D art, UI visuals, portraits, backgrounds, sprites, textures, icons, 3D scenes and objects, terrain, environments, buildings, vegetation, props, landmarks, isometric/map visuals, WebGL visuals, placeholder-to-final refinement, consistency, scale, perspective, materials, lighting, readability, responsiveness, accessibility, and visual-performance considerations.

Designer chooses suitable tools, formats, workflows, and export methods for approved visual work.

Gameplay and authoritative simulation logic remain Coder responsibility unless an approved task explicitly includes technical visual integration.

Designer does not redefine Planner-owned scope, acceptance criteria, dependencies, or phase order and does not approve releases.

## Tester

Tester independently verifies actual committed project state rather than relying only on implementation or review claims.

Tester verifies relevant functionality, visual work, integration, regression, usability, performance, accessibility, public behavior, revisions, and release candidates against exact committed evidence.

Under normal autonomous development, only an **independent Worker acting in the Tester role** may declare a build, phase, or release independently verified.

A Worker acting as Tester must not independently PASS or approve implementation, design, revision, bug fix, process fix, or other change previously produced by the same Worker identity.

This does not limit Admin authority. Admin may explicitly authorize publication or use of a build without Tester verification; such a build is Admin-authorized but remains **unverified** until independent Tester verification actually occurs.

## Reviewer

Reviewer owns development-process control, defect analysis, bottleneck detection, corrective maintenance, and continuous improvement.

Reviewer examines project execution health across issues, claims, revisions, CI/Actions, automation, auxiliary AI evidence and metrics, recurring failures, stale state, excessive latency, missing checks, fragile workflows, bug patterns, process defects, and avoidable development friction.

When evidence supports a concrete improvement, Reviewer may create a focused bug/infrastructure task and implement a scoped bug fix, workflow/configuration correction, reliability improvement, or process optimization without inventing product scope or overriding Planner-owned phase, dependency, or acceptance-criteria authority.

Reviewer-produced code, configuration, assets, or process fixes remain implementation work and require independent Tester verification by a different Worker identity before being treated as independently verified.

Reviewer may assess quality and process health but is not phase or release approval authority.

## Worker Identity and Independence

Role rotation never removes Worker identity.

A Worker must not independently verify or approve its own prior implementation, design, revision, bug fix, workflow fix, process improvement, or other change when that same Worker later reaches Tester or Reviewer, whether in the same invocation or a later run.

If a Tester or Reviewer stage would require evaluating the same Worker's own prior change, the Worker must select another eligible independent target for that role or leave that target for another Worker identity while continuing other eligible work.

Implementation, design, and Reviewer-produced changes require independent Tester verification by a different Worker identity before they are called independently verified.

These Worker restrictions govern autonomous Worker behavior and do not restrict explicit Admin authority.

---

# 🔁 Revision and Independence Principles

Testing defects should normally return to the responsible implementer for correction.

When implementation or design reveals that approved scope, dependencies, acceptance criteria, or planning must change, the matter normally returns to Planner.

Reviewer may identify and correct development-process defects and bottlenecks, but changes it produces remain subject to independent Tester verification.

Revision decisions and evidence should remain traceable in the project's operational record.

No Worker independently declares its own implementation, visual work, process fix, or requested revision independently verified.

Independent verification is normally required before work is called a **verified release**.

Independent verification is **not mandatory for publication, deployment, import, replacement, rollback, or other repository/public actions when the Admin explicitly instructs otherwise**.

An Admin-authorized exception does not automatically convert unverified work into verified work; it only authorizes the requested action.

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

**Independent Tester verification determines whether a build may be called independently verified; it does not limit Admin's authority to publish an unverified build.**

**Reviewer improves process health and fixes evidenced development defects, but Reviewer is not phase/release approval authority.**

**An explicit Admin instruction may bypass normal Worker, testing, phase, release, or deployment gates.**

**Player advises → AI Character decides → Simulation validates → World reacts.**
