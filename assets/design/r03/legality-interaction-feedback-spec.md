# R03 Legality and Interaction Feedback Design

Issue: #158  
Authority: current `README.md` including the R02 art-direction foundation and Simulation-authority rules  
Role: Designer  
Status: design candidate; requires independent Tester verification

## Intent

Legality and interaction feedback must help the Advisor understand what the autonomous protagonist is considering, what the Simulation permits, what is pending, and what actually happened without turning the interface into a command console. The living strategic map remains the primary surface. Feedback inherits the established original mature medieval-fantasy / old-school PC RPG family through restrained parchment, iron, timber and candle accents, compact framing and world-first hierarchy.

This design is presentation-only. It consumes Simulation-owned legality/result state. Color, icon, animation, button appearance, hover state, selected state, tooltip text or any other presentation signal must never manufacture an allowed action, target, movement or consequence.

## State language

Every feedback state uses three redundant channels: a short text label, a distinct icon/shape treatment, and color/value contrast. Required meaning is never color-only or hover-only.

### Candidate

Meaning: the character or Advisor context is highlighting a possible action/interaction that has not yet received authoritative legality.

Presentation:
- label: `Considering`;
- hollow diamond marker or dashed route treatment;
- muted iron-blue frame;
- supporting line explains the contemplated action, for example `Considering travel to Mill Yard`;
- never use imperative wording such as `Move`, `Go`, `Attack`, or `Command` as the primary state label.

### Allowed

Meaning: Simulation validation says the candidate is currently legal/possible. It does **not** mean the protagonist has chosen or completed it.

Presentation:
- label: `Possible`;
- open check-ring marker rather than a completed checkmark;
- muted moss/candle accent with readable text contrast;
- supporting copy: `Simulation permits this action now`;
- primary Advisor affordance, where relevant, is phrased as influence: `Suggest this`, `Discuss`, or `Advise`, never `Execute`.

### Rejected / impossible

Meaning: Simulation rejected the candidate or found it currently impossible/not applicable.

Presentation:
- label: `Not possible` or `Not applicable` based on authoritative result;
- barred-circle / blocked-route shape;
- restrained warning red plus explicit reason text;
- machine reason codes may appear in diagnostics, while player-facing copy translates them to concise language such as `Path blocked by river` or `Target is no longer here`;
- no disabled-looking control may hide the reason from keyboard/touch users.

### Pending

Meaning: an authoritative request/result is still being resolved; no final state may be inferred.

Presentation:
- label: `Checking…` or `Resolving…`;
- small rotating/notched ring or three-step pulse with reduced-motion static fallback;
- neutral parchment/iron treatment;
- prior allowed/rejected styling is visually cleared so stale state is not presented as current truth.

### Resolved

Meaning: the Simulation has committed a consequence and the world has reacted.

Presentation:
- label: `Result` plus concise consequence summary;
- solid result seal/marker that differs from the open `Possible` ring;
- map/world change remains primary evidence: movement, arrival, changed availability, state update or other authoritative consequence;
- history detail may retain the originating advice and validation reason, but presentation does not become an alternative truth source.

## Interaction target feedback

Target affordances apply equally to NPCs, locations, animals and creatures using the same visual grammar.

- Candidate target: thin focus bracket plus category label.
- Available target: `Can interact` text with open-ring marker.
- Unavailable/stale target: crossed bracket plus reason (`No longer here`, `Too far away`, `Context changed`).
- Selected target is not equivalent to an action command. Selection opens information/advice affordances only.
- Multiple nearby targets use a compact list or cycle control with explicit names/categories; target discovery must not depend on pixel-perfect pointer hover.

## Map-first composition

Feedback attaches to the living world before secondary panels:

1. local map marker/route/target treatment;
2. compact contextual state chip near the inspected item;
3. optional detail card with reason, context and Advisor affordances;
4. history/result panel after resolution.

Avoid modal interruption for routine legality checks. Blocking dialogs are reserved for actual user-facing decisions that cannot be expressed safely inline.

## Classic PC RPG framing

Use the established R02 material family:
- deep structure / charcoal: `#17191B`;
- parchment light: `#E5D8BE`;
- muted iron blue: `#52616B`;
- muted moss: `#687258`;
- warning red: `#8D4942`;
- candle/gold accent: `#C89A4B`.

These are directional anchors, not runtime authority or mandatory constants. Frames may use thin iron/timber borders, restrained corner details and compact serif-like display accents for short headings while body text remains highly readable.

## Responsive behavior

### Desktop — 1280×720 reference

- Living map occupies roughly 70–78% of primary canvas.
- Context card may sit at the right edge, 280–340 px wide.
- Map state chip stays close to the relevant target/route while the detail card exposes full reason and Advisor wording.
- Keyboard focus order follows map inspection -> state card -> Advisor affordance -> detail/history.

### Tablet — 1024×768 reference

- Map remains dominant.
- Detail becomes a bottom sheet or compact right drawer depending on orientation.
- Sheet defaults to a one-line state/reason summary and expands on demand.
- Controls retain at least 44×44 CSS-pixel touch target geometry.

### Phone portrait — 390×844 reference

- No desktop side rail.
- Map uses the upper/main viewport; legality/interaction feedback becomes a bottom card with state label, one-line reason and at most two immediate Advisor affordances.
- Expanded detail scrolls inside the sheet without shrinking map labels into unreadable text.
- Critical result/reason remains visible without hover.

### Phone landscape — 844×390 reference

- Map occupies the wider left/main region.
- A compact contextual rail or anchored card may use the right 34–40% when space permits.
- Rail content prioritizes state -> reason -> one Advisor affordance; secondary metadata collapses.
- Avoid desktop three-column miniaturization.

## Accessibility contract

- Minimum target size: 44×44 CSS px for touch-relevant controls.
- All meaningful icons have adjacent visible text or accessible labels.
- Focus indicator uses a clear outline/value contrast independent of state color.
- Allowed/rejected/pending/resolved are never distinguished only by green/red hue.
- State changes use an ARIA-live polite summary where runtime integration later provides dynamic announcements; repeated animation is not the only cue.
- Reduced-motion users receive static pending/result transitions.
- Reasons remain reachable by keyboard and touch, not hover-only tooltips.
- Text/background pairings must meet normal WCAG contrast expectations; ornamental borders may be lower contrast because they carry no required information.

## Autonomy and wording boundary

The UI must continuously reinforce the product rule: player advice influences; the character decides; Simulation validates.

Preferred verbs:
- `Suggest`, `Discuss`, `Advise`, `Ask about`, `Consider`.

Avoid for ordinary Advisor interaction:
- `Execute`, `Force`, `Command`, `Move now`, `Make character`, `Control NPC`.

An `Allowed/Possible` badge means only that the Simulation currently permits the candidate. It never means that advice is binding or that the protagonist has accepted it.

## Prototype evidence

`legality-interaction-feedback-prototype.svg` is a repository-native vector reference sheet showing:
- the five state treatments;
- an in-world route/target example;
- Advisor-safe wording and explicit Simulation source label;
- desktop, tablet, phone portrait and phone landscape compositions;
- non-color-only icon/label differentiation and touch/focus annotations.

It is not final runtime UI and introduces no gameplay authority. Runtime integration belongs to a Coder task.

## Independent Tester checklist

- Candidate / Possible / Not possible / Checking / Result are visibly and semantically distinct.
- Allowed is not presented as completed or as a binding player command.
- Every rejection/unavailable state exposes a textual reason.
- Presentation explicitly identifies Simulation as legality/result authority.
- Desktop/tablet/phone portrait/phone landscape examples retain a dominant living-map surface.
- Required state is not color-only or hover-only.
- Touch target, focus, reduced-motion and announcement guidance is present.
- Visual family remains compatible with the independently verified R02 art-direction foundation.
- No design asset creates authoritative state, target identity, legality or resolution.