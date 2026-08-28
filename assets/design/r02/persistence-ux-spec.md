# R02 Persistence and Seed-Status UX Specification

Issue: #85 / R02-T03  
Owner: Graphic Designer Worker  
Integration target: #89 / R02-T07

## Purpose

Define a compact, map-first presentation for seed identity, save/export, import/load, validation, success, and error states. This design is presentation guidance only. It never creates, validates, mutates, or overrides authoritative campaign/world state.

## Core hierarchy

1. **Living strategic map remains primary.** Persistence controls occupy compact map chrome or temporary sheets/dialogs; they never become the main screen.
2. **Seed identity is persistent but quiet.** Show a short visible seed label in the top utility ribbon, e.g. `Seed: A7K9-42QF`, with a text-copy affordance. The complete seed value may be exposed in an accessible details surface when longer than the available width.
3. **Save status is readable at a glance.** Pair an icon/shape with text such as `Saved`, `Unsaved changes`, `Saving…`, `Load failed`, or `Incompatible save`; never rely on hue alone.
4. **Actions are explicit and non-authoritative in wording.** Use `Export save`, `Import save`, and `Load campaign`. Avoid wording that suggests these controls directly determine simulation outcomes.
5. **Errors remain actionable.** Invalid or incompatible data must explain what happened and provide a safe next action without replacing the current campaign state until Coder-side validation succeeds.

## Compact map ribbon

Recommended desktop/tablet placement: a small utility cluster within the existing top or bottom map chrome.

- Seed badge: `Seed: <short-id>` with copy button.
- Save-state indicator: icon + text.
- Primary persistence button: `Save` when local saving is supported by runtime; otherwise `Export save`.
- Overflow or adjacent secondary action: `Import / Load`.
- Controls should be visually quieter than map inspection, protagonist/current-location, and critical world cues.

Minimum touch target: 44 × 44 CSS px. Keyboard focus must have a visible outline at least 2 px thick with offset.

## Seed identity states

### Normal
- Label: `Seed: A7K9-42QF`.
- Copy affordance includes accessible name `Copy world seed`.
- If copied, show short-lived text confirmation `Seed copied`; do not use color alone.

### Long seed / narrow layout
- Display a stable shortened form with ellipsis or grouped prefix/suffix.
- Accessible name/value must expose the full seed.
- Never silently substitute another seed or generate a new seed from presentation state.

### Seed mismatch on import
- Dialog status: `Seed differs from current campaign`.
- Supporting text explains that the imported save belongs to another deterministic world seed.
- Coder/runtime owns whether this is allowed, rejected, or creates a separate campaign; Designer does not prescribe simulation policy.

## Save and export states

### Saved
- Symbol: outlined shield/check or disk/check geometry plus text `Saved`.
- Quiet positive state; no animation required.

### Unsaved changes
- Symbol: small outlined diamond/dot plus text `Unsaved changes`.
- Do not imply danger; this is state awareness.

### Saving
- Text `Saving…` plus optional restrained spinner.
- Respect reduced-motion preference; text alone is sufficient.

### Export success
- Toast/banner: `Save exported` with file/download icon and optional filename.
- Auto-dismiss is allowed only if equivalent status remains available to assistive technology long enough to be announced.

### Export failure
- Persistent inline/banner message: `Couldn’t export save`.
- Secondary text may include safe retry guidance.
- Action: `Try again` where runtime supports retry.

## Import / load flow

Use a temporary modal/sheet over the map with a dim but still recognizable world backdrop.

1. Heading: `Import or load campaign`.
2. File/drop/select region with button `Choose save file`.
3. Optional file summary after selection: filename, save version, seed, saved-at timestamp when supplied by validated metadata.
4. Validation result area.
5. Primary action remains disabled until runtime validation declares the file loadable.
6. Primary action wording: `Load campaign`.
7. Secondary action: `Cancel`.

The UI must never treat filename, displayed metadata, preview art, or client-side visual parsing as authoritative truth. Coder-side validation owns compatibility and accepted state.

## Validation and error presentation

Every blocking state uses three simultaneous cues: status icon/geometry, short heading, and explanatory text.

### Invalid save
- Heading: `Invalid save file`.
- Text: `This file could not be validated as a supported campaign save.`
- Primary recovery: `Choose another file`.
- The current campaign remains visually present behind the sheet and must not be replaced by preview state.

### Incompatible save version
- Heading: `Save version not supported`.
- Text includes supported/received version only when runtime provides verified values.
- Recovery: `Choose another file` and, if available, a non-destructive migration/help action supplied by Coder scope.

### Corrupt/incomplete save
- Heading: `Save data is incomplete`.
- Do not surface raw stack traces in player-facing UI.
- Provide a compact technical-details disclosure only when useful for support/debugging.

### Successful validation
- Heading: `Ready to load`.
- Summary may show verified seed/version metadata.
- Primary action becomes `Load campaign`.

### Load success
- Non-blocking confirmation after authoritative runtime load succeeds: `Campaign loaded`.
- Seed badge and save status then update from authoritative runtime state, not from pre-load preview data.

### Load failure after validation
- Heading: `Campaign could not be loaded`.
- Current authoritative campaign remains active unless runtime explicitly reports a safe replacement state.
- Provide `Close` / `Try again` as runtime permits.

## Responsive layouts

### Desktop
- Keep seed + save-state + persistence actions in a compact ribbon occupying no more vertical space than existing map chrome.
- Import/load dialog target width: 420–520 px, max 80% viewport height.
- Do not cover the entire map; preserve spatial context around the dialog.

### Tablet
- Same hierarchy, with labels allowed to collapse to short forms (`Seed`, `Save`, `Load`) only when accessible names retain full meaning.
- Dialog/sheet width: min(520 px, calc(100vw - 32px)).

### Phone portrait
- Seed + save-state condense into a single compact status row.
- Persistence actions open a bottom sheet rather than a tiny centered dialog.
- Bottom sheet starts at content height and may expand, but map remains visible above it whenever practical.
- Full-width action buttons with at least 44 px height.

### Phone landscape
- Use a side sheet or compact centered dialog to preserve vertical map area.
- Avoid covering current-location/inspection focus when placement can be shifted safely.

## Accessibility

- Status must never rely on red/green, hue, hover, animation, or icon alone.
- Every icon-only control requires an accessible name.
- Modal/sheet focus is trapped while open and returned to the invoking control on close.
- Error/success status uses an appropriate live region; avoid repeatedly announcing non-changing seed text.
- `Escape` closes dismissible dialogs on keyboard-capable devices.
- Touch and pointer actions must not require precision targets.
- Reduced-motion mode removes non-essential spinners/transitions while preserving text status.

## Visual language

Reuse the R01 map hierarchy: translucent dark chrome, compact geometry, strong text contrast, and shape-based status cues. Persistence controls should feel like map instrumentation, not a separate management dashboard.

Recommended icon semantics:
- Seed: hex/asterisk-like deterministic identity mark.
- Save/export: document/tray + outward arrow.
- Import/load: document/tray + inward arrow.
- Success: check inside outlined circle/shield.
- Warning/incompatible: outlined triangle + text.
- Error/invalid: outlined octagon/cross + text.

Use vector/CSS geometry where possible; no raster asset is required for R02-T03.

## Integration boundary for Coder (#89)

Coder owns runtime behavior, validation, authoritative metadata, persistence mechanics, state mutation, compatibility policy, storage APIs, and localization wiring. Designer-owned deliverables define presentation states and responsive/accessibility behavior only.

Required runtime inputs for presentation:
- authoritative current seed display value;
- save dirty/saved/saving/error state;
- validated import metadata when available;
- validation result (`valid`, `invalid`, `incompatible`, `incomplete`, or equivalent approved runtime states);
- authoritative load success/failure result.

Presentation must not infer simulation truth from CSS classes, filenames, SVG state, local preview text, or unvalidated file contents.

## Independent verification checklist

Tester can verify this deliverable without runtime integration by checking that the committed spec and SVG prototype:

- cover normal, success, invalid, incompatible-save, and mobile states;
- keep the strategic map visually primary;
- provide non-color status cues and explicit text;
- define keyboard/touch/focus requirements;
- distinguish preview/presentation from authoritative runtime state;
- include explicit Coder integration boundaries;
- avoid any direct-protagonist-control affordance.
