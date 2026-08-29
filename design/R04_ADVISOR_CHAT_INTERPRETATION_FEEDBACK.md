# R04 Advisor Chat and Interpretation Feedback Contract

Issue: #182  
Role owner: Designer  
Authority: current README non-binding Advisor interaction rules and independently accepted #180 conversation contract.  
Implementation target: #248.  
Runtime coordination: #181.

## Purpose

Define the minimum usable free-text Advisor conversation experience inside the existing **Dialogue** surface. The player must be able to tell, in chronological order:

1. what the Advisor said;
2. how the autonomous protagonist interpreted/responded;
3. whether the advice was accepted, rejected, delayed, or reinterpreted;
4. where a later autonomous intent or Simulation result may appear without implying that the Advisor directly caused it.

The experience is conversation and influence feedback, **not a command console**. Presentation never creates action legality, location, inventory, resources, identity, hidden facts, movement, or Simulation results.

## Existing surface to preserve

The current application already exposes a bottom-ribbon `Dialogue` panel (`data-panel-name="dialog-panel"`) and a mobile Dialogue tab. #248 should evolve that existing surface rather than introduce a separate chat game mode, modal, or full-screen command terminal.

Desktop/tablet keeps Dialogue in the existing bottom information band. Phone layouts continue using the existing mobile panel selector so the map remains the primary play surface and Dialogue is one selectable panel.

## Information hierarchy

Use one chronological transcript composed of **exchange groups**. Each group visually belongs together but keeps each authority source explicit.

### A. Advisor message

Label: **Advisor**  
Content: normalized free text submitted by the player.  
Visual treatment: quiet parchment/inset message surface; left-aligned; no action iconography.

Never label this row `Command`, `Order`, `Action`, `Move`, `Execute`, or `Target`.

### B. Protagonist interpretation / response

Label: use the current protagonist display name when available; fallback **Protagonist**.  
Content: #180 character interpretation and response.  
Visual treatment: a second, clearly distinct inset row under the Advisor message. A small character marker/portrait slot is permitted, but #182 does not require new character art.

The response is the character's own reading of the advice. It is not a system confirmation that an action will occur.

### C. Influence state

Show a compact text badge directly beneath the protagonist response:

- **Accepted · considered now**
- **Rejected · not being followed**
- **Delayed · reconsider later**
- **Reinterpreted · treated as advice**

The first word is the canonical #180 disposition. The explanatory text prevents a badge from being read as guaranteed obedience.

Color may reinforce state, but text and icon/shape must remain sufficient without color:

- Accepted: check mark + `Accepted`
- Rejected: crossed mark + `Rejected`
- Delayed: clock + `Delayed`
- Reinterpreted: branching arrow + `Reinterpreted`

Do not use success/error styling that implies Simulation validation. These are **character influence states**, not legal/illegal action results.

### D. Autonomous intent and Simulation result, when later available

#182 does not implement these states. It defines their visual separation so #248 can remain compatible with #181 and later runtime work.

If shown in the transcript:

- `Intent` uses a neutral **Character intent** label and must be sourced from autonomous protagonist state.
- `Simulation` uses a separate **World result** / **Simulation result** label and must only appear after authoritative validation/resolution.

Never merge `Accepted` with `Action succeeded`; they are different facts from different authorities.

## Input composer

Place the composer at the bottom of the Dialogue panel and keep it visible while the transcript scrolls above it.

Recommended structure:

- visible label: **Advise the character**;
- multiline text area;
- helper text: **Advice is non-binding. The character decides what to do.**;
- explicit button: **Send advice**.

Do not use `Execute`, `Go`, `Move`, `Confirm action`, `Issue order`, `Apply`, or controller-like arrow/button wording.

### Submission behavior guidance for #248

- The visible **Send advice** button is always available to keyboard and touch users.
- `Enter` may send when the composer is in chat mode; `Shift+Enter` inserts a newline. If #248 chooses not to implement Enter-to-send, the button remains the canonical submit affordance.
- Empty/whitespace-only input does not create a transcript entry.
- A failed normalization/runtime handoff preserves the user's draft where feasible and exposes a concise inline status; it never invents a protagonist reply.
- After successful send, keep keyboard focus in the composer unless the user explicitly navigates away.
- Do not auto-focus the composer on page load because the map and existing UI remain primary.

## Transcript behavior

- New exchanges append chronologically.
- The transcript scroll region may follow the newest message only when the user is already near the bottom. Do not pull a reader away from older content they are reviewing.
- Keep a short R04 transcript; exact persistence/retention policy is outside this Designer task.
- Each exchange should remain visually readable as one group at 200% browser zoom.
- Do not use dense chat bubbles that overlap the living map; content remains inside the Dialogue panel.

### Empty state

Use a short instructional empty state rather than fake conversation:

**No advice yet. Ask a question, share a warning, or suggest what the character might consider.**

Secondary line:

**The character remains autonomous; the Simulation decides what is possible and what happens.**

## Accessibility contract

### Semantics

Recommended #248 mapping:

- transcript container: `role="log"`, `aria-live="polite"`, `aria-relevant="additions text"`, with a visible heading or `aria-labelledby`;
- composer textarea: explicit `<label>` or equivalent visible label association;
- helper text connected with `aria-describedby`;
- send button: native `<button type="button">` or form submit button;
- inline send/error status: `role="status"` / `aria-live="polite"` for non-destructive feedback;
- influence state text is part of the exchange's accessible name/content, not color-only decoration.

Do not announce the entire transcript on every update. Only the newly appended exchange/status should be announced.

### Keyboard and focus order

Within the active Dialogue surface the practical order is:

`transcript region (optional focus target) -> composer -> Send advice`.

Do not make every transcript row a tab stop by default. Links or controls inside a future message may be focusable only if they perform a genuine UI function.

Provide a visible focus ring with strong contrast against the dark/old-school panel surface.

### Touch

Interactive targets should be at least approximately **44 x 44 CSS px**. The composer and Send advice control must remain reachable above the mobile software keyboard; use dynamic viewport units / safe-area padding as needed during #248 implementation.

### Text and contrast

- Body transcript text: target at least 14–16 CSS px equivalent at normal scale.
- Helper/meta text must not drop below an equivalent readable small-text size.
- Do not encode accepted/rejected/delayed/reinterpreted solely by hue.
- Preserve readable contrast under the current dark old-school PC RPG visual family.

## Responsive layouts

### Desktop

- Keep the Dialogue panel in the existing bottom ribbon.
- Transcript occupies the flexible upper portion of the panel; composer remains pinned to the panel bottom.
- Composer may use `textarea + Send advice` in one row when width permits.
- Suggested comfortable panel content width: use the current panel width rather than introducing a separate centered chat modal.
- Limit transcript height so a substantial map area remains visible.

### Tablet portrait / landscape

- Prefer the same hierarchy with a slightly taller transcript region.
- Stack the Send advice button below or beside the text area based on available width, without horizontal overflow.
- Long Advisor/protagonist text wraps; never create a horizontal transcript scroller.

### Phone portrait

- Use the existing mobile `Dialogue` tab/active-panel model.
- Keep the active panel to approximately the lower **42–48dvh** maximum during ordinary viewing so the living map remains visibly present.
- Composer stacks vertically: label/helper -> textarea -> full-width Send advice button.
- Respect bottom safe-area insets and software-keyboard resize.

### Phone landscape

- Use a compact transcript height and one/two-row composer depending on available vertical space.
- Keep the map visible; avoid a full-screen composer unless the browser/OS itself temporarily expands the textarea for accessibility.
- No horizontal overflow at 320 CSS px effective content width or greater.

## Old-school PC RPG visual language

The Dialogue panel should feel like an information/dialogue surface already belonging to the game's interface, not a modern messaging application pasted on top.

Use:

- dark framed panel/inset surfaces;
- restrained parchment/bronze-neutral accents already compatible with the current UI;
- compact section labels;
- modest 1px/2px rules and inset borders;
- readable square/softly rounded controls rather than oversized pill-shaped social-chat bubbles.

Avoid:

- smartphone messenger bubbles floating over the map;
- bright green `success` treatment for accepted advice;
- red destructive error styling for a protagonist choosing to reject advice;
- gamepad/D-pad/movement-arrow affordances in the chat surface;
- visual lines/arrows that imply the Advisor message directly triggers a Simulation action.

## Concrete #180 data-to-presentation mapping

| #180 field | Presentation responsibility |
| --- | --- |
| `advisorMessage` / `record.advisor.message` | Advisor message row |
| `messageKind` | optional quiet metadata; never an authority badge |
| `record.character.actorId` | resolve the same protagonist identity/display name |
| `record.character.interpretation` | protagonist interpretation line |
| `record.character.response` | protagonist response line |
| `disposition` | accepted/rejected/delayed/reinterpreted influence badge |
| `record.influence.effect` | optional explanatory influence detail |
| `canValidateAction`, `canExecuteAction`, `canResolveAction`, `canMutateWorld` | never rendered as player controls; must remain false for #180 advice records |
| `knownFactRefs` | not rendered raw; presentation must not infer extra facts from identifiers |

If the contract rejects invalid/empty input, #248 should show a local composer/status message and must not fabricate a character exchange.

## Recommended DOM contract for #248

Names are implementation guidance, not authoritative data fields:

```text
#dialogText / existing Dialogue content host
  .advisor-chat
    .advisor-chat__transcript[role=log]
      .advisor-exchange
        .advisor-exchange__message
        .advisor-exchange__character
        .advisor-exchange__disposition
    .advisor-chat__composer
      label[for=advisorInput]
      textarea#advisorInput
      .advisor-chat__hint
      button#advisorSendBtn
      .advisor-chat__status[role=status]
```

#248 may adapt class names to existing conventions, but must preserve the semantic relationships and source separation.

## Representative prototype content

The companion SVG demonstrates three states in the existing Dialogue surface:

1. an Advisor warning;
2. the protagonist's interpretation/response;
3. a clearly separate `Reinterpreted · treated as advice` state;

and shows the responsive phone arrangement with the map still visible above the active Dialogue panel.

Prototype copy is illustrative only and creates no canonical character/world facts.

## Independent verification checklist

A Worker other than the authoring Designer should verify:

- free-text input and explicit Send advice affordance are specified;
- transcript chronology separates Advisor, protagonist interpretation/response, influence state, and future Simulation result;
- all four #180 disposition states have readable text labels and non-color-only cues;
- wording and visual language do not imply direct movement/action authority;
- empty/failure behavior does not fabricate protagonist or Simulation output;
- keyboard, focus, live-region and touch guidance is explicit;
- desktop/tablet/phone portrait/landscape guidance preserves map visibility and avoids horizontal overflow;
- the same protagonist identity is retained and no chat-only mode is created;
- no hidden facts, legality, movement, resource/state, or results are invented by presentation;
- concrete #248 implementation mapping is present;
- companion prototype is original project work and remains presentation evidence only.
