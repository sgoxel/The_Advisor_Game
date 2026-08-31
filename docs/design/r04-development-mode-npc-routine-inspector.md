# R04 Development Mode — NPC Routine Inspector Design Contract

Issue: #334
Role: Designer
Status: implementation handoff candidate

## Purpose and authority boundary

This surface helps a normal user understand what a Simulation-backed NPC is currently doing and why. It is a Development Mode inspection surface only. It never edits schedules, chooses branches, changes destinations, advances time, moves NPCs, or creates facts. Missing authoritative data is shown as unavailable rather than inferred.

## Entry and modal hierarchy

Development Mode exposes one keyboard-reachable **NPC routines** button with an accessible name equivalent to `Inspect NPC routines`. Activating it opens an **NPC list dialog**. The dialog title is `NPC routines`; helper text states `Read-only Simulation inspection`.

Each active/relevant NPC is one row with stable identity as the primary label. Secondary text may show profession/role and current activity only when supplied by authoritative runtime state. The selected row uses both a visible selection marker and `aria-selected=true`; selection never relies on color alone.

Activating a row opens a **Routine inspector dialog** for that exact identity. The title is `<NPC name> — routine`. A persistent status line reads `Read-only · Development Mode`. A Back action returns to the NPC list without losing list position; Close exits inspection. Escape closes the topmost dialog. Focus enters the dialog title/first useful control and returns to the invoking control on close.

## Inspector information hierarchy

1. **Identity/context header** — name; stable identity token in expandable technical details; profession/role; home/work/worksite/destination when authoritative; authoritative game time.
2. **Current-state strip** — `Current activity`, `Current node`, `Satisfied branch`, path/occupancy/yield state and direct-dialogue context where available. Unavailable fields explicitly read `Unavailable` or `Not applicable`.
3. **Routine flow canvas** — normal-user-readable nodes and directed connectors.
4. **Details panel** — selected-node conditions and authoritative source values. It is descriptive, never editable.

## Flow visual language

Routine nodes are rounded rectangles with a short plain-English action label, optional destination, and optional time window. Examples of labels are `Sleep at home`, `Travel to workplace`, `Work`, `Take a break`, `Socialize`, `Return home`; these labels are shown only when the underlying schedule exposes equivalent semantics.

Directional arrows show allowed sequence/branch direction. A branch label is phrased as a question or condition, for example `Work shift active?`, `Destination available?`, `Need to yield?`, `Social opportunity?`. Internal function/property names are confined to optional technical details.

The currently active node has a persistent `CURRENT` badge plus a thicker outline. The currently satisfied outgoing branch has a `TAKEN` badge and stronger connector treatment. These indicators remain understandable in monochrome/high-contrast rendering. Past/future presentation must not imply historical truth unless runtime state actually exposes it.

A branch whose authoritative input is unavailable is labeled `Condition unavailable`; the UI does not guess an outcome. Unsupported desired behaviors are omitted rather than fabricated.

## Navigation and scale

The flow canvas is bounded inside the viewport. Desktop may use a left-to-right or top-to-bottom graph; narrow tablet/phone layouts default to top-to-bottom. The graph never forces page-level horizontal overflow.

Large routines support internal scrolling plus explicit `Zoom in`, `Zoom out`, `Fit routine`, and `Reset view` controls. Keyboard users can Tab through controls and nodes in logical sequence. Arrow-key graph panning is allowed only while the graph viewport itself has focus. Touch targets are at least 44 CSS px where practical. Zoom/pan/scroll are presentation state only.

Every visible node has equivalent accessible text containing action, destination/time when present, current-state marker, and outgoing condition summaries. Connectors are not the sole carrier of branch meaning; branch text is also associated with source/destination nodes for assistive technology.

## Responsive contract

- Desktop: NPC list can be a medium-width dialog; inspector may use up to the available viewport with header/current-state strip above the graph and details beside or below it.
- Tablet: details move below the graph; controls wrap without clipping.
- Phone: dialogs stay within viewport width/height, graph is vertical by default, controls wrap into multiple rows, and content scrolls inside the dialog. No horizontal page overflow.
- Reduced-motion preference disables nonessential graph transition animation.

## Data projection contract for Coder #335

The design expects a read-only projection of existing authoritative routine state. A minimal view model may contain:

- NPC stable identity and display name;
- authoritative game-time label;
- profession/role and home/work/worksite/destination references when available;
- ordered routine nodes with stable node IDs and plain-English semantic labels;
- directed edges with condition labels and condition status (`true`, `false`, `unavailable`);
- current node ID and currently satisfied edge ID when known;
- current activity, path/occupancy/yield and dialogue context when already authoritative.

The UI must not contain a second routine evaluator. Coder #335 maps existing schedule/routine inputs into this projection; the Simulation remains the only source of truth.

## Empty, unavailable and error states

- No relevant NPCs: `No active NPCs are available for inspection.`
- NPC exists but no inspectable routine data: retain identity and show `Routine data unavailable for this NPC.`
- Individual missing value: `Unavailable` / `Not applicable`; never synthesize a plausible value.
- Projection/render error: show a bounded Development Mode error message and preserve gameplay; inspection failure must not mutate or pause Simulation state.

## Non-command affordance rules

There are no `Run`, `Skip`, `Choose`, `Edit`, `Move`, `Assign`, or branch-forcing controls. Nodes are inspect/select only. Copying technical details is allowed if implemented, but copying has no gameplay effect. The `Read-only · Development Mode` status remains visible in the inspector.

## Prototype example — illustrative semantics only

The following is layout vocabulary, not authoritative NPC truth:

`Sleep at home` → `Travel to workplace` → [Work shift active?] → `Work`

From `Work`, runtime data might expose branches such as `Break window active?` → `Take a break`, or `Shift finished?` → `Return home`. If those conditions do not exist in the selected NPC's authoritative routine, they must not be rendered.

## Tester checklist

Independent Tester should verify: exact-NPC identity continuity from list to inspector; readable node/arrow/condition hierarchy; CURRENT and TAKEN indicators without color dependence; unavailable-data honesty; no edit/command affordance; keyboard focus/escape/return-focus behavior; node accessible text; bounded desktop/tablet/phone layouts; reduced-motion behavior; and zero mutation of routine, NPC position, path, campaign time or other Simulation state while opening/selecting/panning/zooming/closing the inspector.
