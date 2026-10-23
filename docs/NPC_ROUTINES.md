# NPC character sheets and daily routines

Foundation for living NPCs. Everything is a pure function of the SEED-keyed resident code and absolute Fantasy Time: nothing is stored or stepped. The same NPC always has the same traits and is in the same place, doing the same thing, whenever it is generated.

## Scope and cost

- Only residents of the focused area are evaluated (`LazySimulation.focusedResidents`, per-settlement spatial index, bounded caches). Nothing runs for the rest of the world; other countries stay coarse summaries.
- A resident's state at tick `t` is `residentAt(place, index, t)`. It is computed directly, with no day-by-day replay, so jumping in time or revisiting a place gives identical results.

## Who an NPC is (`src/simulation.ts`, `src/characters.ts`, `src/routines.ts`)

| Field | Source |
|---|---|
| role | service staff (innkeeper, merchant, blacksmith, farmer, butcher, guard officer), gate guards, then a weighted townsfolk mix (farmer, artisan, laborer, trader, child, elder, clergy, beggar, noble) |
| character picture, sex, age group | `characterForRole` (`public/characters/<key>.webp`); names follow sex, ages fall inside the age group |
| abilities | strength, dexterity, constitution, knowledge, wisdom, charisma: 3d6 by seed, plus trade and age adjustments, clamped to 3-18 |
| personality | diligence, sociability, piety, temper, curiosity (0-1); temperament = strongest trait |
| home / workplace | the NPC's own frontage lot; the real inn, market, smithy, butcher, guard office, farmstead, field, gate post, well square or keep of its settlement |

## Mood

`moodAt(code, traits, day, weekday, secondOfDay)` returns a value from -1 to 1 and a label (cheerful, content, calm, grumpy, tired, miserable). It combines:

- a seeded daily swing
- personality (sociability up, temper down)
- the rest day (up)
- fatigue early in the morning and late in the evening

## Daily plan

`dailyPlan(subject, traits, day, weekday)` returns sorted activities `{kind, anchor, start, task, indoors}` from 00:00 to 24:00. Every plan starts and ends at the same anchor, so days join without jumps.

- **Workday (most adults):** sleep, then wake (earlier for diligent people and farmers), breakfast at home, and walk to the workplace. Work until evening, with a midday meal on site for field hands or a market errand for townsfolk. Then dinner at home, or at the inn when sociable and in a good mood; after the inn, home. Sleep.
- **Guards:** 12-hour watches (day 06-18 or night 18-06, matching `guardCoverageAt`), sleeping in the other half.
- **Innkeepers:** late start, working until 22:30.
- **Children:** play in the square, lunch at home, play again, early bed.
- **Elders:** morning prayers or a stroll, rest, chatting at the market.
- **Rest day (weekday 6):** shrine or square, market, lunch, rest. Innkeepers, clergy and beggars keep working.

Moving between two anchors follows the settlement's street network (A* over the street polylines, joined at junctions) at the canonical good-road pace (1 m/s, travel.ts). Each resident reports `activityStart`, `activityEnd` and `activityProgress` for its routine step, and `travelProgress` and `travelDistanceM` while walking. The renderer animates walkers every frame between Fantasy Time samples. Activities inside a building set `indoors`, and the renderer does not draw those NPCs on the street.

## Fantasy clock

The HUD clock's tick 0 is not midnight. `clock.ts` provides:

- `fantasySecondOfDay(tick)`
- `fantasyDayIndex(tick)`
- `fantasyWeekday(tick)`
- `tickAtFantasyTime(day, second)`

Routines and guard shifts use these, so NPC behaviour matches the displayed Fantasy Time.

## Extending

- **New behaviour:** add an `ActivityKind` and an anchor to `dailyPlan`, driven only by role, age, weekday, traits and mood.
- **New anchor:** map it to a real plot in `settlementAnchors`.
- **Rules to keep:** no wall clock, no `Math.random`, and no state carried between ticks.
- **Households:** each resident still owns a one-person home (children and elders live alone). Households would let families share a home.
