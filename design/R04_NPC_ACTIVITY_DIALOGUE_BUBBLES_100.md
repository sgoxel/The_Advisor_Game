# R04 — NPC Activity and Shared-Dialogue Bubble Specification

Authority: Admin #233
Phase: R04
Role: Designer
Status: development presentation specification

## Purpose

During development, the living 100 × 100 tile region must make active NPC behavior observable without turning debug presentation into simulation authority or a player-command surface.

## Activity bubble

Each active visible NPC may show one compact bubble immediately above the character-derived world icon.

The default development treatment is:

- small readable system UI text, approximately 10 px at 1× CSS scale;
- dark translucent background with a light neutral border;
- high-contrast light text;
- short content in the form `Name: current activity`;
- a brief movement-resolution suffix may appear when useful, such as `yield wait` or `side step`;
- rounded compact shape with minimal padding;
- no button, pointer, command affordance or hover-only information requirement;
- `pointer-events: none` behavior so the bubble cannot become a control surface.

The bubble follows the NPC's current rendered position. It is presentation-only: removing, hiding or simplifying it must not alter NPC activity, occupancy, movement, dialogue or world truth.

## Two-NPC dialogue

When exactly two NPCs are participating in one local NPC-to-NPC dialogue:

- the authoritative movement layer places them on two adjacent logical tiles;
- they never share one logical tile;
- their individual activity bubbles are suppressed for the duration of that shared conversation;
- one combined bubble is positioned visually between/above the pair;
- the combined format identifies both participants and the current dialogue/status, for example `Alda ↔ Borin: ...`;
- the bubble is presentation of conversation context only and does not itself create a fact, relationship or Simulation result.

## Dense-area layout

The 100 × 100 starter village can contain many active residents. Bubble presentation should therefore remain deliberately lightweight.

- Use short activity labels rather than paragraph text for ordinary activity.
- Offset neighboring bubbles vertically in a small repeating lane pattern when needed.
- Shared dialogue bubbles may be wider than ordinary activity bubbles, but must remain bounded.
- Character-derived PNG world icons stay visually readable beneath the bubbles.
- Do not reserve logical world tiles for bubble placement; bubble collision handling is a rendering concern only.
- If a future density-control mode hides some debug bubbles at low zoom, hiding must be deterministic presentation policy and must not hide authoritative NPCs themselves.

## Responsive behavior

### Desktop

- Ordinary activity bubble maximum visual width: approximately 220 CSS px.
- Shared dialogue bubble maximum visual width: approximately 320 CSS px.
- Keep the NPC/icon center as the visual anchor.

### Tablet

- Preserve the same semantic content.
- Scale or truncate long text before allowing bubbles to cover large portions of the living map.
- Keep touch interaction on the world surface available; bubbles remain non-interactive.

### Phone

- Prioritize character/icon visibility and map readability over long debug prose.
- Shorten/truncate development labels where necessary.
- Never increase the bubble into a modal/card that obscures the spatial relationship between adjacent NPCs.

## Accessibility and readability

- Text/background contrast must remain readable over bright and dark terrain.
- Activity meaning must not depend on color alone.
- Bubble state must not be required to operate the game; it is development observability.
- Critical gameplay truth must remain available from authoritative game systems rather than only from transient debug bubbles.

## Character identity compatibility

This presentation sits above the static PNG identity model from Admin #225 / #227 / #228.

- The world icon remains the character representation.
- The bubble describes current activity/context; it does not replace the icon.
- Rank, profession, equipment, location or other facts shown in bubble text must originate from Simulation-backed state.

## Tester checklist

An independent Tester should verify on an exact committed state that:

1. active visible NPCs receive compact activity bubbles;
2. bubbles do not accept pointer interaction or issue commands;
3. a two-NPC dialogue uses one combined bubble, not two competing dialogue bubbles;
4. the corresponding NPCs occupy adjacent logical tiles during that dialogue;
5. hiding/removing presentation does not mutate authoritative NPC state;
6. representative desktop, tablet and phone layouts keep world icons and map context readable;
7. unexpected console/page errors are absent.
