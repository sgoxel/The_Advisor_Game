# R04 Static Character PNG Identity Foundation

Issue: #227  
Phase: R04 — Autonomous Protagonist and Local BOT Core  
Role: Designer  
Authority: README.md, including **Static Character PNG Identity and Presentation**  
Status: Designer handoff candidate; independent Tester verification required

## 1. Purpose

Define a reusable current-stage visual contract for gameplay-relevant characters so one Simulation-backed character remains recognizably the same person across:

1. a **full-body static transparent PNG** used for character-focused presentation; and
2. a **matching simplified transparent tile/world-icon PNG** used on the living strategic map.

This document defines presentation behavior only. It does not create rank, profession, equipment, location, faction, relationship, activity, legality, or any other authoritative fact.

## 2. Non-negotiable identity contract

A full-body image and its world icon represent the same character only when they share a stable identity signature. The signature should survive scale reduction and limited-detail rendering.

Preserve, in priority order:

- dominant silhouette and body proportion;
- head/hair/headwear shape;
- one or two durable clothing/armor shape cues;
- role/status cue when supported by Simulation state;
- one restrained identity accent such as scarf, apron shape, cloak cut, shield outline, belt kit, basket, hat, or tool silhouette;
- compatible facing/read direction and visual mass distribution.

Do **not** depend on tiny facial details, text labels, color alone, or equipment that the authoritative state does not provide.

The world icon may simplify folds, facial detail, material texture, fingers, minor accessories and secondary decoration. It must not become a generic rectangle, anonymous pawn, abstract status badge, or unrelated portrait.

## 3. Character family direction

All reference treatments follow the established original mature seinen-anime-inspired / old-school PC RPG direction without imitating a specific protected work.

### Full-body language

- believable adult/age-appropriate proportions rather than chibi or super-deformed proportions;
- grounded stance with readable weight and practical medieval-fantasy clothing;
- restrained facial expression by default, with stronger emotion reserved for context;
- readable age, profession, social position and culture through silhouette, garment construction and material wear;
- painterly/illustrated detail may be richer than the world icon, but the silhouette remains the main identity bridge;
- transparent background is preferred for compositing into dialogue/inspection surfaces.

### World-icon language

- derived from the same approved character identity, not generated as an unrelated token;
- simplified full-figure or strong upper/full silhouette depending on tested map scale;
- large readable head/hair/headwear and outer-garment shapes;
- one primary prop/tool only when authoritative and legible;
- strong negative space between limbs/body/held object where practical;
- no baked text, rank number, health value, quest marker or state label inside the art asset;
- transparent background so selection, legality, intent and other UI states remain separate presentation layers.

## 4. Authoritative variant axes

Variants may be selected only from Simulation-backed or otherwise authoritative character state.

| Axis | Allowed visual response | Must not invent |
| --- | --- | --- |
| Rank / progression | garment quality, heraldic access, armor form, posture/status treatment | a title, crown, insignia or authority not actually held |
| Profession / duty | apron, work coat, tool silhouette, guard kit, merchant pouch, field clothing | a job, guild, duty or workplace assignment not in state |
| Culture / faction / status | silhouette grammar, textile construction, approved emblem family, grooming conventions | faction allegiance, ethnicity, office or legal status not in state |
| Equipment | visible currently equipped/approved items and protective gear | weapons, armor, wealth or inventory not owned/equipped |
| Environment / region | weather layer, practical outerwear, mud/dust/snow wear, region-appropriate materials | permanent identity changes caused only by current biome |
| Current circumstance | limited temporary treatment such as injured wrap, travel cloak, work apron, wet outer layer | authoritative injuries, crimes, buffs, debuffs or conditions absent from state |

A variant must remain recognizable as the same base identity. Temporary context should layer onto the base character rather than replace it with a new unrelated design.

## 5. Reference treatment board

The following treatments are implementation/reference targets, not new Simulation facts. Names are neutral art-board identifiers.

### A. Protagonist — low-rank village origin

**Full-body treatment**

- mature young-adult/adult proportion; practical neutral stance;
- simple tunic, worn belt, trousers/leggings and sturdy work shoes/boots;
- asymmetrical outer cloth or patched layer providing a stable silhouette cue;
- hair/head shape remains the strongest identity cue;
- no noble heraldry, plate armor, command symbol or luxury material at Peasant state;
- restrained expression: alert, thoughtful, capable rather than heroic-power pose.

**Matching world icon**

- same hair/head outline and asymmetrical outer-cloth silhouette;
- torso and legs simplified into three to five large readable shape groups;
- no rectangular backing plate inside the character asset;
- identity remains readable without a face at small scale.

### B. Village butcher / food worker

**Full-body treatment**

- grounded adult figure, rolled sleeves, heavy apron silhouette and practical closed footwear;
- one context-appropriate small tool or cloth may appear only when authoritative/contextually relevant;
- clothing wear suggests repeated manual work without turning the character into caricature.

**Matching world icon**

- apron mass and sleeve silhouette are the primary profession cues;
- avoid tiny knife/meat details as the only identifier;
- tool may be omitted at small scale if it harms clarity.

### C. Woodcutter / charcoal-worker family

**Full-body treatment**

- layered rough work clothing, broad shoulder/outer layer and durable boots;
- soot/dust/weathering may differentiate charcoal work when current context supports it;
- an axe/wood tool is visible only when actually equipped/carried.

**Matching world icon**

- retain broad outer silhouette plus distinctive hood/cap/hair shape;
- if a tool is shown, use one clean diagonal/vertical silhouette separated from the body;
- never add a weapon-like prop solely to make the icon more dramatic.

### D. Tavern keeper / innkeeper / merchant-service family

**Full-body treatment**

- stable service/proprietor silhouette using apron/vest/overshirt, keys/pouch/cloth only when state supports them;
- quality and cleanliness may reflect authoritative prosperity/status;
- expression is socially readable but not exaggerated comedy.

**Matching world icon**

- preserve the same head shape, vest/apron mass and one proprietor cue;
- avoid generic shop-sign or rectangular NPC block as the character itself.

### E. Guard / armed duty family

**Full-body treatment**

- duty-appropriate armor/clothing and equipment only when assigned/equipped;
- rank variation comes from approved armor quality, cloak/tabard construction or insignia only when authoritative;
- believable weight and practical medieval-fantasy kit.

**Matching world icon**

- preserve helmet/head shape, shoulder/torso armor mass and one equipped weapon/shield silhouette when present;
- avoid oversized fantasy weapon proportions that change the established grounded family.

These five reference families establish more than one NPC profession while keeping the protagonist visually central and coherent with the same product family.

## 6. Map integration behavior

The tile/world icon is presentation of an authoritative character entity. Runtime/UI code should bind the art selection to a stable Simulation-backed character identifier and authoritative variant inputs.

Recommended presentation layering:

1. character world-icon PNG;
2. selection/inspection ring or focus layer;
3. autonomous intent/activity/legality/reconsideration feedback from existing R04 presentation;
4. accessibility name/state outside the image asset.

The image itself must never be used as proof of legality, location, profession, identity or action resolution. Missing art must not remove the Simulation entity.

## 7. Placeholder fallback

Approved art will arrive progressively. Missing art is therefore a supported temporary state.

Fallback order:

1. approved matching character world icon;
2. role-family silhouette generated/selected from authoritative role + stable character identity seed/key;
3. neutral person silhouette plus accessible text/name from authoritative data.

A generic rectangle may remain only as an explicitly temporary development fallback where no person silhouette is available. It is not the intended character language and should not be promoted into the final R04/R15 presentation model.

Fallback presentation must preserve interaction/inspection behavior and must never fabricate missing visual facts.

## 8. Responsive and performance guidance

### Desktop / large tablet

- allow richer full-body PNG detail and stronger map-icon silhouette separation;
- preserve readable spacing between character art and existing intent/activity feedback;
- avoid stacking multiple badges directly over the face/head identity cue.

### Small tablet / phone landscape

- reduce non-essential detail, not identity cues;
- simplify shadows/ornament first;
- keep the character icon separate from touch hit-target/background UI layers.

### Phone portrait

- prioritize head/hair/headwear + dominant garment silhouette;
- full-body dialogue art may crop or reposition responsively in later R05 work, but the same character asset/identity must be preserved;
- text/accessibility state must not be baked into the PNG.

### Performance

- static PNG is the current-stage default; animation is not required;
- texture dimensions, atlasing, compression, mip strategy and loading policy are implementation choices and should be validated against representative device memory/GPU limits;
- off-screen/unmaterialized characters must not require their full-body dialogue artwork to remain resident solely for identity continuity;
- loading/render timing cannot become Simulation authority.

## 9. Asset naming and relationship guidance

Exact pipeline is not authoritative, but an implementation should preserve an explicit relationship between base identity and derived forms. A simple logical naming example is:

- `character.<stable-id>.full.<variant>.png`
- `character.<stable-id>.world.<variant>.png`

The `<stable-id>` identifies the same Simulation-backed character; `<variant>` describes a presentation variant selected from authoritative context. Implementations may choose different filenames/asset systems as long as this relationship remains testable.

## 10. Independent Tester checklist

A different Worker acting as Tester should verify at minimum:

- full-body and world-icon rules describe the same recognizable identity rather than unrelated assets;
- reference board includes the protagonist plus multiple NPC profession families;
- variation never authorizes/invents Simulation facts;
- world-icon guidance explicitly rejects permanent generic rectangular NPC blocks;
- transparent static PNG is accepted without animation dependency;
- missing-art fallback preserves entity behavior and accessibility;
- desktop/tablet/phone guidance preserves identity and performance boundaries;
- presentation remains non-authoritative and compatible with existing R04 intent/activity feedback;
- repository change is Designer-only and does not modify gameplay/Simulation truth.

## 11. Handoff boundary

This Designer artifact establishes the reusable character-identity/variant foundation. A separate Coder task should integrate approved world icons/fallbacks into the living map. Full-body two-character dialogue integration remains R05 work and must stay phase-blocked until R05 activation.
