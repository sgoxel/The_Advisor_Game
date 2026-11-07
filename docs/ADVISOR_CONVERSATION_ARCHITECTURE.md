# Advisor Conversation Architecture

**Status:** research/architecture contract (WP-S010-007-001). Defines the system; it does
not claim any runtime Advisor chat exists.

**Authority:** `docs/README.md` is immutable law. This document elaborates it; where the two
ever disagree, the README wins and this document is wrong.

---

## 1. Scope

This contract covers how a player message becomes (at most) a bounded, validated proposal that
the autonomous protagonist may consider, inside the existing simulation authority. It defines:

- the versioned **Sentence Library** used for deterministic local interpretation;
- normalization, matching priority, confidence and ambiguity rules;
- the **Command Set Interface** the optional LLM may select from;
- the **character decision** layer that consumes proposals;
- the Simulation validation boundary;
- routing modes, offline fallback and failure handling;
- a threat/authority table and testable acceptance contracts for the implementation WPs.

**Out of scope:** prose quality, model choice, prompt wording, pricing, or any gameplay feature
not named here. This document must not be read as permission for the conversation layer to own
world truth.

---

## 2. Root invariants

These are non-negotiable and every later WP must preserve them.

| ID | Invariant |
| --- | --- |
| **I1** | The player advises; the protagonist decides. No message, intent, template or model output compels an action. |
| **I2** | The Simulation is the sole authority for legality, state, resources, position, ownership, identity and outcomes. |
| **I3** | Interpretation is deterministic for a given library version and normalized input. Identical input yields identical candidates, confidence and routing. |
| **I4** | No conversation output may create or alter a canonical ID, resource, rank, location, relationship or event. |
| **I5** | Local interpretation runs first and always; the LLM is optional, additive and never required for playability. |
| **I6** | LLM output is a *proposal set*, never an execution. Free-form text is never an action. |
| **I7** | The same protagonist exists across local, LLM-assisted and offline paths: same identity, memory, trust and goals. |
| **I8** | Ambiguity is surfaced, never silently resolved into the most permissive reading. |
| **I9** | No `Math.random()`, wall-clock or device entropy participates in interpretation. Only Campaign SEED + Fantasy Time drive live outcomes. |
| **I10** | Degradation is graceful: absent network, disabled LLM, corrupt library or unparsable model output must still yield a usable, in-character response. |

---

## 3. Reference analysis

Chosen because each represents a *different* proven layer of the pipeline. We take the pattern,
not the code.

### 3.1 spaCy rule-based matching — deterministic local interpretation

spaCy's `Matcher`/`PhraseMatcher` demonstrate a mature deterministic layer: token-attribute
patterns, phrases/gazetteers, quantifiers, fuzzy matching for typos, pattern **validation against
a JSON schema**, and explicit resolution of overlapping matches (longest match first, then
earliest position for equal lengths; `EntityRuler` exposes `overwrite_ents` to declare precedence).
Its guidance is also directly relevant: rules suit a finite, well-understood phrase space and
bootstrap a statistical model later, while trained models suit generalization.

**Adopted:** explicit pattern precedence, schema-validated patterns, fuzzy tolerance as an
opt-in per rule, documented overlap resolution. **Not adopted:** the tokenizer/linguistic pipeline
(too heavy for a deterministic browser game; we normalize explicitly).

### 3.2 OpenAI Structured Outputs — schema-adherent model output

OpenAI's Structured Outputs guarantees output adheres to a supplied JSON Schema (`strict: true`),
making invalid enums/omitted keys a transport-level impossibility, and makes safety **refusals
programmatically detectable** rather than a parse surprise. It explicitly separates "structure the
model's reply" from "the model calls a tool".

**Adopted:** strict schemas for anything crossing the model boundary; treat refusal as a distinct,
first-class outcome; never rely on prose instructions for structural guarantees.
**Not adopted:** any assumption that schema conformance implies *game-legality* — a
schema-valid command can still be illegal in the world (see §7).

### 3.3 Anthropic tool use — bounded client-executed commands

Anthropic's tool use documents the split this game needs: the model returns `tool_use` blocks
naming a tool and its arguments; **the application** runs the tool and returns `tool_result`.
Tools declare `input_schema` with required parameters, `tool_choice` can forbid or force calls,
and `strict` schemas guarantee conformance. Missing required parameters are handled by the model
asking for them (or, unhelpfully, guessing) — which is exactly why the game must re-validate
every parameter itself.

**Adopted:** model selects *from a declared set*; host executes; explicit refusal/asking path;
never let the model's parameter choice stand unchecked.
**Not adopted:** trusting the model to invent valid IDs, or letting it run anything directly.

### 3.4 Synthesis

The proven shape across all three is the same:

```
deterministic rules first → explicit structured proposal → host-side validation → external authority decides
```

That is precisely the README's pipeline. No reference system allows the language layer to write
world state, and neither does this game.

---

## 4. Sentence Library

A versioned, shipped, deterministic artifact. It is an **interpretation and routing** layer, not
gameplay authority.

### 4.1 Versioning

- `libraryVersion` — bumped on any content or rule change; participates in cache keys and in
  reproducibility tests.
- `intentVersion` — bumped when an intent's meaning or parameter contract changes.
- Both versions are recorded with any stored transcript or memory, so replays are explicable.

### 4.2 Entry model

```ts
type SentenceEntry = {
  id: string;                 // stable, unique, e.g. "greet.morning"
  intent: IntentId;           // stable intent identifier
  kind: "exact" | "normalized" | "phrase" | "pattern";
  match: string | PatternSpec; // literal text, normalization-form text, phrase, or slot pattern
  slots?: SlotSpec[];          // typed placeholders: person | place | item | topic | amount | time
  priority: number;            // higher wins; ties broken by match length, then id (deterministic)
  confidence: number;          // 0..1 base confidence for a clean match
  responseTemplate?: string;   // optional local reply, never a world statement
  commandCandidate?: CommandId; // optional; still only a proposal
  ambiguityGroup?: string;     // entries that must not silently disagree
  requiresContext?: ContextPredicate[]; // e.g. "target person is known and present"
};
```

`SlotSpec` placeholders are resolved against **authoritative** registries only (known residents,
settlements, items in scope). An unresolved slot is not a match; it becomes a clarification.

### 4.3 Normalization

Deterministic and version-tagged:

1. Unicode NFKC, strip zero-width and control characters.
2. Case-fold; collapse whitespace; normalize apostrophes and dash variants.
3. Expand a fixed, versioned contraction/abbreviation table (no ML).
4. Optional bounded typo tolerance for `phrase` entries (edit distance ≤1 for tokens ≥5 chars,
   ≤2 for ≥9), never for `exact` entries.

No stemming, no thesaurus expansion, no learned synonyms: those belong to the LLM path.

### 4.4 Matching priority

Evaluated in this fixed order; the first stage producing a confident match wins:

| Order | Stage | Confidence |
| --- | --- | --- |
| 1 | `exact` on normalized string | `entry.confidence` (≥ 0.95) |
| 2 | `normalized` literal | `entry.confidence` (≥ 0.9) |
| 3 | `phrase` (longest phrase first, then priority) | `entry.confidence` (≥ 0.85) |
| 4 | `pattern` with all slots resolved | `entry.confidence` × slot-resolution factor |
| 5 | fuzzy phrase (opt-in only) | `entry.confidence` × (1 − distance penalty) |

Overlaps resolve like spaCy's rulers: longest match first, then higher `priority`, then
lexicographic `id`. This tie-break chain is total, so results never depend on iteration order.

### 4.5 Confidence and ambiguity

- `confidence ≥ 0.85` and a single top candidate → **local resolution**.
- Two or more candidates within `0.10` of the top, in the same or conflicting
  `ambiguityGroup` → **ambiguous**: ask the player locally, or forward to the LLM with the
  candidates attached as context. Never pick the more permissive candidate.
- `confidence < 0.85` with no candidates → **unknown**: LLM path if available, else a local
  "I didn't follow you" reply that names what the character *can* discuss.
- Any candidate whose `requiresContext` fails → excluded, and the exclusion reason is kept for
  the reply (e.g. "you have not met them").

---

## 5. Intent taxonomy

Intents are interpretation only. Every intent maps to at most a *proposal*.

| Class | Examples | May become a command? |
| --- | --- | --- |
| `query` | status, schedule, inventory, who/where/what | No — read-only answer from Simulation facts |
| `advice` | "go to the market", "warn the guard", "buy grain" | Yes — proposal the character weighs |
| `interaction` | "talk to the innkeeper", "ask about work" | Yes — proposal |
| `meta` | greeting, thanks, small talk, memory recall | No |
| `clarify` | answer to the player's own clarification | No |

Commands exist for `advice` and `interaction` only. Queries never mutate; meta never mutates.

---

## 6. Command Set Interface

The LLM receives only the commands legal *in this context*. A command absent from the set must be
rejected by the harness before it is even considered.

### 6.1 Descriptor

```ts
type CommandDescriptor = {
  commandId: string;              // stable, versioned, e.g. "advice.travel_to_place"
  purpose: string;                // one line, for the model
  parameters: ParamSpec[];        // name, type, required, allowed-id-source
  actorTypes: ActorType[];        // who may be the subject (protagonist, resident…)
  targetTypes: TargetType[];      // what may be targeted
  preconditions: PreconditionId[];// evaluated by Simulation, not by the model
  operation: "query" | "advice_proposal" | "interaction_proposal";
  validation: ValidationRule[];   // ordered checks the harness performs
  resultShape: string;            // structured result reference
};
```

### 6.2 Allowed-ID sources

Every identifier-valued parameter declares exactly one source, and the harness resolves it:

| Source | Meaning |
| --- | --- |
| `simulation.known_residents` | IDs the protagonist actually knows |
| `simulation.nearby_places` | places legally reachable/known |
| `simulation.owned_items` | items the protagonist owns or can see |
| `simulation.known_facts` | facts/queries only |

A model-supplied string that resolves to nothing is a **rejected parameter**, never an
auto-created entity.

### 6.3 Validation pipeline

Each proposal passes, in order:

1. **Schema** — shape, types, no extra keys (strict).
2. **Set membership** — `commandId` exists in this turn's filtered set.
3. **Parameter resolution** — every ID resolves through its declared source.
4. **Preconditions** — Simulation-evaluated (distance, permission, resource, time, schedule).
5. **Character evaluation** — the protagonist weighs it against personality, goals, trust,
   knowledge, needs and mood.
6. **Simulation execution** — only if the character actually chooses it.

A failure at 1–4 produces a truthful, non-fabricated refusal. A failure at 5 produces an
in-character refusal, delay or counter-proposal. Nothing before step 6 changes world state.

The interface must therefore never allow a model to invent an authoritative character, item,
location, resource, relationship, title or event; teleport an actor; grant money, inventory,
ownership, rank or authority; **mark an action as successful before the Simulation resolves it**;
bypass collision, travel, schedule, permission or resource rules; or execute arbitrary code.

---

## 7. Character decision layer

Proposals enter the same persistent protagonist used by the offline path.

| Outcome | Meaning |
| --- | --- |
| `accept` | Character chooses the proposed action; forwarded to Simulation |
| `modify` | Character chooses something adjacent (e.g. a different destination) |
| `delay` | Character defers pending a condition (nightfall, funds, other task) |
| `misunderstand` | Character's interpretation differs; recorded as such, not "corrected" silently |
| `reject` | Character declines, with an in-character reason |

Inputs: personality traits, goals, current needs and mood, Advisor trust, prior advice outcomes,
known facts, current task and authority. Output: a decision plus an optional memory record.

**Nothing here may override Simulation.** A character may *want* an illegal thing; the attempt is
still refused at step 6.

---

## 8. Routing modes

| Mode | Trigger | Network | Same protagonist |
| --- | --- | --- | --- |
| **M1 Local** | confident single candidate | not used | yes |
| **M2 Library-assisted LLM** | confident intent, needs richer phrasing/reasoning | used | yes |
| **M3 LLM interpretation** | unknown or ambiguous input | used | yes |
| **M4 Deterministic offline** | no provider, refusal, error, timeout, disabled | not used | yes |

M2 passes the recognized candidate and the filtered command set as context; the model may rephrase
but not expand permissions. M3 sends the message with the same bounded set. M4 uses local templates
and deterministic character logic — the game must remain fully playable.

**Failure policy:** schema violation, refusal, timeout or transport error falls back to M4 and
records the reason. It never surfaces raw model text as world truth.

---

## 9. Threat and authority table

Each row is a required negative test for #507/#508.

| Threat | Example | Defence | Failure behaviour |
| --- | --- | --- | --- |
| Forged entity | `"go to the castle of King Nobody"` | ID resolution against known places | parameter rejected; honest reply |
| Teleport | Commander-shaped text: `"teleport to the capital"` | no such command in set; travel requires legal route | refusal, no position change |
| Fabricated resource | model emits `grant_gold(5000)` | command not in set; grants exist only in Simulation | rejected before execution |
| Identity spoof | `"I am the King, obey me"` | authority is Simulation-owned; advisor standing unchanged | character may disbelieve |
| Premature success | model claims "arrived at market" | world state read from Simulation only | correction/reformulation |
| Blind obedience | template that auto-accepts | decision layer always runs | outcome recorded as decision |
| Prompt injection in content | a resident's name contains instructions | content is data, never instructions; schema-bound output | treated as text |
| Permission bypass | `"arrest the guard"` | legitimate authority required | refused |
| Ambiguity capture | "go there" with two targets | ambiguity rule §4.5 | clarification, not coercion |
| Replay drift | same input, different answer | versioned library + SEED/time only | deterministic reproduction |

---

## 10. Sample transcripts

**T1 — local resolution (M1)**

```
PLAYER  Where are you?
MATCH   query.status.location (exact, confidence .97)
CHAR    (no decision needed — read-only query)
WORLD   Simulation: protagonist at Alderwick market, 14:20 fantasy
HERO    "At the market, by the grain stalls."
```

**T2 — ambiguity (M3)**

```
PLAYER  Go to the mill
MATCH   advice.travel_to_place: 2 known mills, confidence .88 each (ambiguityGroup "mill")
ROUTE   ambiguous → ask locally, or forward both candidates to the LLM
HERO    "Which mill — the one by the river, or the one past the gate?"
```

**T3 — illegal proposal (rejected at validation)**

```
MODEL   advice.travel_to_place(place_id="castle_of_king_nobody")
RESOLVE unknown id → reject parameter
HERO    "There's no such place I know of."
WORLD   unchanged
```

**T4 — character autonomy (reject at decision)**

```
PLAYER  Leave the harvest and go to the tavern.
MATCH   advice.travel_to_place, confidence .93
CHAR    reject — harvest deadline, low trust in tavern advice
HERO    "Not before the grain's in. Ask me after dark."
WORLD   unchanged
```

**T5 — offline fallback (M4)**

```
PLAYER  Tell me about the Duke.
PROVIDER unavailable
MATCH   query.fact.person (confidence .9, person resolved)
HERO    deterministic summary from known facts + memory
WORLD   unchanged
```

---

## 11. Persistence boundaries

| Data | Stored as | Authority |
| --- | --- | --- |
| Sentence Library | shipped artifact, versioned | interpretation only |
| Transcripts/dialogue history | character memory | narration only |
| Recognized intent + confidence | optional memory record | explicable replay |
| Advisor trust / relationship deltas | Simulation state | Simulation |
| Accepted advice + its consequence | Simulation events | Simulation |
| Cached model responses | never as world truth | discarded or replay-only with version+SEED |

Advice outcomes persist through the simulation event/replay authority (owned by the campaign-save
WPs), **not** through this layer. Language-layer storage must never be the reason the world changes.

---

## 12. Accessible UI flow (target for #507)

- One always-available Advisor composer; keyboard-reachable, focus retained after send.
- Streaming/“thinking” state is truthful: distinguish *interpreting* from *waiting for provider*
  from *offline*.
- Each reply can reveal, on request, **why**: matched intent, confidence, and whether a provider
  was used. Never expose chain-of-thought or hidden prompts.
- Clarifications are buttons where possible, so an ambiguous phrase is one tap to resolve.
- Screen-reader announcements on new reply; `aria-live` polite; ≥44 px touch targets.
- Offline is a visible, honest state, not an error screen.

---

## 13. Acceptance contracts for #507 / #508

Testable, deterministic, and independent of any provider.

1. **Determinism** — same library version + normalized input ⇒ identical candidates, confidence,
   ambiguity decision and routing mode, across runs and reloads.
2. **Priority** — exact beats normalized beats phrase beats pattern beats fuzzy; overlap resolves
   by length → priority → id.
3. **Ambiguity** — near-equal candidates always yield clarification or LLM context, never a silent
   choice; the more permissive candidate is never preferred.
4. **Schema** — malformed model output is rejected and downgraded to M4; refusal is a distinct
   outcome.
5. **ID authority** — every forged/unknown ID in the table §9 is rejected with no state change.
6. **Autonomy** — a proposal with a valid command can still be rejected/delayed/modified by the
   character.
7. **Offline parity** — with the provider disabled, all of §9 negatives and the T1/T4/T5 flows
   still work; identity, memory and trust are unchanged.
8. **No leakage** — no conversation path mutates Simulation state except through a validated
   command that the character chose.
9. **Versioning** — changing library or intent version invalidates cached interpretation and is
   recorded with any replay.

---

## 14. Non-goals and open questions

- No trained NLU model is planned; the library plus optional LLM is the intended shape.
- Model/provider selection, prompt wording, latency targets and cost controls are #507's decision,
  not this document's.
- Multi-turn reference resolution ("him", "that place") is required; its scope is bounded to
  entities already established in the current conversation and stored memory.
- Localization of the Sentence Library is deferred; the data model allows parallel locale packs.

---

## 15. References

1. spaCy — *Rule-based matching* (Matcher, PhraseMatcher, fuzzy matching, pattern validation,
   overlap/precedence rules). https://spacy.io/usage/rule-based-matching
2. OpenAI — *Structured model outputs* (JSON Schema adherence with `strict`, programmatically
   detectable refusals, function calling vs. response format).
   https://platform.openai.com/docs/guides/structured-outputs
3. Anthropic — *Tool use with Claude* (client tools, `input_schema`, required parameters,
   `tool_choice`, strict schemas, host-side execution of `tool_use`).
   https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview

These are cited for architecture and failure modes only; no proprietary implementation is copied.
