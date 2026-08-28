# R02 Art Direction Foundation

Issue: #152  
Authority: README.md at `8e2e3810f03798ae28e0a3c263c1f05ce5b6893d`, Admin #150, Planner #151  
Role: Designer  
Status: design candidate; requires independent Tester verification

## Intent

The Advisor Game should read as one coherent, original adult medieval-fantasy product family. Character art uses broad seinen-anime conventions—grounded anatomy, restrained expression, readable silhouettes and emotional seriousness—while the world and interface evoke classic PC role-playing games through isometric/near-isometric composition, tactile materials, painterly or pre-rendered-feeling depth, compact information framing and restrained effects.

This is an art-direction contract, not Simulation authority. It does not decide character state, legality, resources, chronology, movement, politics or outcomes. Presentation consumes authoritative state and may simplify fidelity for device capability without changing simulation truth.

## Originality boundary

The direction must remain original. Do not copy or closely imitate a specific manga/anime artist, series, protected character, costume, composition, logo, signature rendering treatment or existing game's exact visual identity. References should be expressed as broad characteristics such as mature proportions, restrained line economy, grounded medieval materials, painterly depth, classic isometric readability and dense-but-legible RPG framing.

Avoid prompts, briefs or asset notes that ask for "in the style of" a living artist or a named protected work. Any external mood-board material is reference-only and must be transformed into project-specific forms, silhouettes, heraldry, costume logic, palettes and compositions.

## 1. Character language

### Proportions and silhouette

- Default adult figures use grounded human proportions rather than chibi, super-deformed, toy-like or oversized-head treatment.
- Silhouettes communicate age, profession, status, culture and current condition before facial detail is available.
- Clothing mass follows believable construction: layered tunics, wool, linen, leather, mail, plate, belts, pouches, cloaks and weather protection appropriate to role and means.
- Rank is communicated through cut, material quality, maintenance, heraldry and accessories—not through implausible scale or constant visual effects.
- Wear matters. Farmers, charcoal burners, guards, travelers, merchants and nobles should differ in fabric condition, posture, equipment and grooming.

### Faces and expression

- Faces are expressive but restrained. Eyebrows, eye direction, mouth tension, cheek/forehead planes and posture carry emotion before exaggerated symbols do.
- Maintain adult facial structure, varied noses/jaws/eye shapes and visible age progression.
- Avoid a single "pretty anime face" template. A village should visibly contain different ages, occupations and social positions.
- Emotional seriousness does not mean constant grimness: warmth, humor, uncertainty, fatigue and relief are valid, but reactions should fit the character and situation.

### Portrait-to-world continuity

Portrait/dialogue art and in-world figures represent the same character family at different information scales.

Portrait layer:
- emphasizes face, hair, status details and emotional state;
- uses controlled painterly shading with selective line accents;
- keeps a simple value grouping so the face remains readable beside text.

In-world layer:
- preserves the portrait's dominant silhouette, hair/head shape, outer garment, primary value grouping and one or two identifying accents;
- simplifies facial detail aggressively at strategic-map scale;
- uses stance, route, role prop and motion to carry identity when the face is too small to read.

A portrait and its map figure should match through silhouette and material cues even if they use different levels of detail.

## 2. Environment and world language

### Composition

- Preserve the living strategic map as the primary playable surface.
- Favor isometric/near-isometric compositions with readable roads, building entrances, terrain edges, gathering areas and travel paths.
- Shape clusters should create navigable visual hierarchy: landmark -> street/path -> service/work zone -> homes/fields -> surrounding terrain.
- Avoid decorative clutter that obscures authoritative movement, interactable locations or important state.

### Materials

Materials should feel tactile and regionally plausible: rough timber, lime/plaster, fieldstone, slate/thatch, packed earth, mud, worn iron, oxidized bronze, wool, linen and leather. Surface variation should be broad and readable rather than noisy at map scale.

Use edge wear, patching, soot, moisture, wheel ruts, moss and weathering selectively to imply history. Effects remain restrained; avoid glossy plastic surfaces, excessive bloom or constant magical particles unless the simulation/context calls for them.

### Palette and atmosphere

Base palette family for R02 reference prototypes:
- charcoal ink / deep structure: `#17191B`
- warm parchment / readable light: `#E5D8BE`
- weathered stone: `#7B756C`
- timber brown: `#6E4F38`
- muted moss: `#687258`
- field ochre: `#A88A54`
- muted iron blue: `#52616B`
- restrained blood/warning red: `#8D4942`
- candle/gold accent: `#C89A4B`

These are directional anchors, not mandatory runtime constants. Regions, seasons, time of day and device quality may vary them while preserving grounded values and legibility.

### Creatures and animals

Creatures belong to the same material world as people. Ordinary animals prioritize recognizable anatomy and behavior. Fantasy creatures should feel adapted to habitat and ecology rather than like unrelated collectible mascots. Exaggeration is acceptable when it supports function, danger or supernatural origin, but materials, lighting and silhouette treatment should remain coherent with the environment.

## 3. Classic PC RPG UI framing

The UI should evoke classic computer RPG information framing without reproducing a specific legacy interface.

- Use strong panel boundaries, readable headers, compact contextual metadata and clear separation between world, character/advice and status information.
- Ornament is structural: thin metal/wood/stone-like dividers, corner details and restrained heraldic motifs may frame information, but should not compete with text.
- Text hierarchy remains modern and accessible. Do not use faux-medieval display type for long body text.
- Primary actions use obvious shape/contrast and minimum touch-friendly targets on tablet/phone.
- Dense information is progressively disclosed on smaller screens rather than merely scaled down.
- Critical simulation state should never be communicated by color alone.

## 4. Responsive composition contract

### Desktop

Use a world-first composition with the strategic map occupying the dominant area. Secondary character/advice/status panels may sit beside or below it. Portraits can use the richest detail level. Information density may be high if hierarchy is clear.

### Tablet

Retain the world as the largest region. Collapse secondary data into two-level tabs/drawers or stacked cards. Keep portrait identity but reduce ornament density and decorative borders.

### Phone portrait

Use a single primary world viewport with compact status overlay and bottom/slide-up Advisor or character panels. Avoid side-by-side narrow columns. Portraits become small identity anchors; text and controls take priority.

### Phone landscape

Use the wider axis for world view and one compact contextual rail. Never shrink desktop three-column UI into unreadable miniature panels.

Across all sizes, touch target spacing, focus visibility, contrast, label clarity and scroll containment take priority over nostalgic density.

## 5. Device-quality scaling

Permitted presentation scaling:
- portrait resolution/detail;
- shadow quality;
- texture resolution;
- foliage density;
- particle count;
- post-processing intensity;
- ambient animation density;
- decorative UI ornament.

Not permitted to scale away:
- authoritative simulation state;
- character/world identity required for decisions;
- route/interactable readability;
- accessibility-critical text or controls;
- persistent consequences or campaign continuity.

## 6. Prototype interpretation

`art-direction-foundation-prototype.svg` is a lightweight vector reference sheet, not final production art. It demonstrates:

1. a protagonist portrait with grounded proportions and restrained expression;
2. matching in-world silhouette/value grouping;
3. profession/status differentiation across three NPC silhouettes;
4. a near-isometric village/material/palette vignette;
5. classic-PC-RPG-inspired frame language;
6. desktop, tablet and phone composition reductions that preserve world-first hierarchy.

The vector format is intentionally light, diffable and repository-native. Later Designer work may replace it with higher-fidelity assets while retaining this contract.

## 7. Acceptance checklist for independent Tester

- README/Admin originality and visual-direction requirements are represented without named-style imitation.
- Character language is mature/grounded and differentiates age/status/profession rather than defaulting to chibi/toy-like forms.
- Portrait and map-figure identity cues visibly correspond.
- Environment reference uses near-isometric spatial hierarchy and grounded medieval materials.
- UI reference evokes classic PC RPG framing while preserving legibility/accessibility.
- Desktop/tablet/phone examples preserve the same product family and world-first hierarchy.
- The spec explicitly allows fidelity scaling while prohibiting simulation-authority changes.
- Deliverables are lightweight and do not replace or invalidate compatible verified R02 runtime assets.

## 8. Handoff

This foundation is presentation-only. Runtime/gameplay integration remains a Coder responsibility when a later issue explicitly requires it. Future Designer production should use this document as the visual convergence baseline until superseded by higher authority.
