# P02 Public Shell Visual Specification

Issue: #29 / P02-T08  
Owner: Graphic Designer Worker  
Integration owner: Coder Worker via #24

## Purpose

Adapt the approved visual and responsive patterns from the committed previous UI reference into a lightweight, coherent P02 public shell without importing obsolete world-generation, direct-control, fake-authoritative-state, or duplicate runtime assets.

This specification is presentation guidance. It is not simulation authority and does not alter README, ROADMAP, TODO, gameplay, deterministic RNG, seeded-check resolution, campaign state, or release behavior.

## Approved reference basis

Use as visual reference:

- `reference/index.html`: compact top ribbon, menu/dropdown hierarchy, status/loading treatment, bottom/mobile panel navigation.
- `reference/css/styles.css`: responsive ribbon/panel/modal patterns and compact dark interface hierarchy.
- `assets/ui/phase1-actions.svg`: existing export/import/reset/success/error vector language where useful.
- `assets/ui/p02/p02-shell-symbols.svg`: P02 menu/settings/log/language/panel/loading/info symbol set.
- `assets/ui/p02/p02-shell-preview.svg`: non-authoritative desktop/mobile composition reference.

Do not reintroduce old map generation, old RNG/state authority, pathfinding/direct movement, fake Gold/Health/Stamina/Mana values, or obsolete map import/export tools.

## Visual direction

The current shell already establishes a warm medieval dark-brown/gold palette. P02 should retain that identity while borrowing the denser information hierarchy and responsive shell patterns of the reference UI.

### Core palette

| Token | Value | Intended use |
| --- | --- | --- |
| `surface-page` | `#15130f` | Root background |
| `surface-ribbon` | `#211b15` | Header/ribbon and compact mobile navigation |
| `surface-panel` | `#201c17` | Primary panels/dialogs |
| `surface-panel-raised` | `#2a241b` | Buttons, compact cards, dropdowns |
| `surface-hero` | `#5a4229 -> #2a221a` | Core-rule/identity panel gradient |
| `line-subtle` | `#5d513e` | Borders/dividers |
| `accent-gold` | `#d5b782` | Primary action, eyebrow labels, focus family |
| `accent-gold-strong` | `#f1d89e` | High-visibility focus/selected edge |
| `text-primary` | `#f7f4ec` | Primary text |
| `text-muted` | `#b8b2a7` | Help/secondary information |
| `state-success` | `#79c48b` | Success reinforcement only; always pair with text/icon |
| `state-error` | `#e77e7e` | Error reinforcement only; always pair with text/icon |
| `state-info` | `#8eb4cf` | Informational reinforcement only; always pair with text/icon |

Do not use status color alone to communicate meaning.

## Shell hierarchy

### 1. Top ribbon

Keep the top region compact and stable across views.

Recommended content order:

1. Menu control.
2. Product identity / current P02 context.
3. Optional language control when #24 integrates localization.
4. Current non-authoritative UI status/phase indicator.

Do not place fake resource bars or character statistics in the ribbon. Any later resource/status display must come from legitimate current simulation state.

Controls should use text plus icon where practical. Minimum interactive target: 44 CSS px in touch layouts. Desktop compact controls may visually appear smaller only if the actual hit target remains accessible.

### 2. Main content

Use a clear panel hierarchy instead of the old world-map canvas layout because P02 has no approved current map/world rendering requirement.

Preferred order:

- Core rule / product identity panel.
- Current campaign state panel using only actual state.
- Seeded-check interaction panel integrated by Coder #24.
- Save/export/import panel preserving P01 authority and validation behavior.

The seeded-check result area must visually communicate that the simulation produces the outcome. The UI may expose allowed deterministic context inputs, but no control should appear to choose success/failure directly.

### 3. Panels and cards

- Primary radius: 16-18 px.
- Compact card radius: 9-12 px.
- Border: 1-1.5 px subtle warm neutral.
- Shadow: low-opacity broad shadow, used sparingly.
- Headings: strong white/cream.
- Eyebrows: uppercase gold, letter-spaced.
- Secondary values/help: muted cream-gray.
- Avoid decorative density that competes with current testable P02 behavior.

### 4. Buttons

Primary action:

- Gold fill, dark text.
- Clear text label.
- Optional matching vector icon.

Secondary action:

- Raised dark surface, gold/neutral border, cream text.

Destructive/error-recovery actions should remain textually explicit; do not rely on red coloring alone.

Focus-visible treatment: minimum 3 px high-contrast gold edge/outline with offset. Preserve keyboard order and visible focus when Coder integrates.

### 5. Status and loading

Every state should include at least two of the following:

- text label;
- vector icon;
- shape/border treatment;
- color reinforcement.

Recommended status wording examples are semantic, not authoritative values: `Ready`, `Working`, `Validated`, `Import error`.

Loading should use a text label plus the `loading` symbol from `p02-shell-symbols.svg`. Motion is optional and must respect `prefers-reduced-motion`.

### 6. Dialogs / settings / log presentation

Reuse the reference modal hierarchy visually when current functionality needs it:

- centered or edge-safe panel;
- strong heading;
- explicit close button with text/accessible name;
- scrollable body if required;
- no hover-only controls;
- keyboard focus remains visible.

Do not create settings/log content that has no current implementation purpose merely to imitate the old UI.

## Responsive composition

### Desktop: 960 px and above

- Compact top ribbon.
- Main content may use two columns for identity/campaign panels.
- Seeded-check and save/import panels may span full width when their content benefits from space.
- Maintain readable maximum content width rather than stretching text across the entire viewport.

### Tablet: 721-959 px

- Preserve top ribbon but allow compact wrapping/grouping.
- Prefer one or two content columns based on available width.
- Keep primary interaction and status visible without horizontal scrolling.

### Phone portrait: up to 720 px

- Single-column content.
- Collapse secondary ribbon items into menu where needed.
- Use text+icon bottom/mobile panel navigation only if #24 needs persistent section switching.
- Suggested labels: `Campaign`, `Check`, `Save`.
- Do not hide required information exclusively behind hover or precision interaction.

### Phone landscape

- Keep vertical chrome shallow.
- Allow two compact content regions only where text remains legible.
- Ensure primary action and result are simultaneously reachable without horizontal scrolling.
- Respect safe-area insets.

## Vector asset usage

`assets/ui/p02/p02-shell-symbols.svg` contains genuine vector geometry only and no embedded raster payload. IDs:

- `menu`
- `settings`
- `log`
- `language`
- `panel-open`
- `panel-close`
- `loading`
- `info`

Example integration pattern for Coder #24 where browser support allows external SVG fragments:

```html
<svg aria-hidden="true" width="24" height="24">
  <use href="./assets/ui/p02/p02-shell-symbols.svg#menu"></use>
</svg>
```

When an icon communicates meaning, pair it with visible text or an accessible name. Decorative instances should be hidden from assistive technology.

Existing `assets/ui/phase1-actions.svg` remains the preferred source for export/import/reset/success/error visuals unless #24 identifies an integration reason to redraw them.

## Reference texture review

The eight committed `reference/textures/*.png` files total 2,828,581 bytes (about 2.70 MiB). They are world/terrain-oriented presentation sources, while P02-T08 currently targets the public application shell rather than an approved world surface.

Two pairs are exact blob duplicates:

- `lake_tile_texture.png` and `river_tile_texture.png` share blob `6ca695186d90f42a1975016208dff40f5d35e7c7`.
- `road_tile_texture.png` and `settlement_tile_texture.png` share blob `8a52237e7e27e972804fd5d89343d567eb4315eb`.

Decision for P02-T08: **omit all eight raster textures from the current runtime asset set**. Keep them in `reference/` only for future concrete world/presentation tasks. This avoids shipping approximately 2.70 MiB of currently unnecessary raster data and avoids duplicate payloads. No texture is promoted merely to decorate shell panels.

If a future approved task needs one of these textures, Graphic Designer should review actual visual quality and optimize the selected source before runtime use.

## Accessibility and clarity checklist

Coder integration should preserve these visual constraints:

- Minimum 44 px touch targets for primary controls on touch layouts.
- Visible keyboard focus.
- Status meaning is never color-only.
- Text contrast remains strong on dark surfaces.
- No hover-only required information.
- No tiny precision-only controls for required actions.
- Reduced-motion preference respected.
- Portrait and landscape phone layouts remain readable.
- No decorative treatment implies resources, authority, decisions, or world facts that the simulation has not provided.

## Asset-cost target

The new P02 shell treatment intentionally favors CSS surfaces and small vectors. The P02 Designer output should remain orders of magnitude smaller than the 2.70 MiB reference texture set and should not require extra runtime image decoding for the shell.

## Integration handoff to #24

Coder #24 should:

1. Map the palette/component rules into the runtime CSS/DOM without replacing current simulation authority.
2. Integrate the P02 symbol set and existing Phase 1 action icons where useful.
3. Adapt the approved reference ribbon/menu/modal/mobile patterns rather than copy old fake state or world controls.
4. Add the seeded-check interaction using current verified P02 deterministic modules.
5. Preserve P01 save/import/export/reset/error behavior and regression coverage.
6. Verify desktop, tablet, phone portrait, phone landscape, keyboard, touch, and accessibility behavior on committed state.

Graphic Designer #29 does not own those runtime changes.
