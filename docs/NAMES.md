# Seeded names (`src/names.ts`)

Every person, building, street, gate, field and wall has a proper name. Each name is a pure function of its SEED-keyed address and the continent's naming culture, so the same thing always carries the same name. Names are made on demand for what is in the focused area; nothing global is precomputed.

- **Cultures:** one per continent. Eldermere uses English-like names (Corwen Reedhand), Westreach Celtic-like (Gwenith Llanwyth), Dawnlands southern (Dornada Tersol). Settlements keep their existing seeded names (`geography.ts`), continents and countries their fixed lists.
- **People:** `personName(code, sex, continent)`. The given name ends by sex, so it always matches the resident's picture. `familyName(code)` depends only on the code, so a house is named after its owner without loading the resident.
- **Buildings:** `buildingName(kind, plotId, settlement, continent, ownerFamily?, city?)`:
  - inns: "The Gilded Boar"
  - market: "Alderwick Market Square"
  - smithy: "Hollowford's Smithy"
  - butchery: "The Briarwell Shambles"
  - watchhouse
  - farm: "Lakewell Farm"
  - keep: "Castle Wil" in a city, "Alderwick Tower" or "… Hall" in a village
  - well, field, garden and house: "Ashley House"
- **Streets:** `streetNames(settlementCode, count, city)` gives unique names within a settlement; the first is the main street ("High Street").
- **Gates:** `gateName(bearing, …)` names a gate by the direction it faces ("North Gate").
- **Walls:** `wallName(…)`.
- **Where names appear:** the `name` field of every settlement feature from `world.ts` `featuresFor`. Clicking a spot shows the nearest name in the cell panel. The resident inspector shows the resident's name and "<Family> House".
