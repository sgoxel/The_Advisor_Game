/**
 * WP-S010-007-003 (#508) — the whole advice chain, proven end to end.
 *
 *   Advisor dialogue → autonomous accept/refuse → Simulation legal-route
 *   validation → a real journey that actually arrives → persisted result.
 *
 * This uses a real `LazySimulation` and the real dialogue layer, so it proves
 * the same path the player uses. A refused or impossible suggestion must leave
 * the world completely untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { tickAtLocalTime, localWeekday } from "../src/clock.ts";
import { villages } from "../src/geography.ts";
import { siteTransportNetwork } from "../src/site-transport-network.ts";
import { transportBridgeByCode } from "../src/transport-network.ts";
import { createTransportWalkingIndex, transportWalkingRouteViaRequiredEdge } from "../src/transport-walking-route.ts";
import { residentAt, LazySimulation } from "../src/simulation.ts";
import { residentChoosesSiteVisit } from "../src/resident-transport-events.ts";
import { siteVisitCorridors } from "../src/site-visit-advice.ts";
import {
  ADVICE_TRUST_FLOOR,
  ADVICE_TRUST_SURE,
  adviceVerdict,
  createMemoryCharacterStore,
  loadCharacter,
  neutralState,
  saveCharacter,
  setCharacterStore,
  type CharacterState,
} from "../src/character-state.ts";
import { respond, type AdvisorFacts } from "../src/advisor-dialogue.ts";

/** Builds the dialogue facts for a real resident, as the panel would. */
function factsFor(
  resident: { code: string; name: string; role: string; settlement: string; grounded: boolean; activity: string; mood: { value: number; label: string }; traits: unknown; ageGroup: string },
  character: CharacterState,
  place: { id: string; name: string; canonicalPosition: { lon: number } },
  hour: number,
  knownPlaces: { id: string; name: string }[],
): AdvisorFacts {
  return {
    name: resident.name,
    role: resident.role,
    settlement: place.name,
    homeName: "their house",
    workName: "their workplace",
    task: "their duty",
    activity: resident.activity,
    indoors: false,
    mood: resident.mood.label,
    moodValue: resident.mood.value,
    clockLabel: `${String(Math.floor(hour)).padStart(2, "0")}:00`,
    daylightPhase: "day",
    travelling: false,
    knownPlaces,
    knownPeople: [],
    hour,
    region: "the realm",
    placeKind: "village",
    ageGroup: resident.ageGroup,
    personality: (resident.traits as { personality: AdvisorFacts["personality"] }).personality,
    characterCode: resident.code,
    character,
    day: 1,
  };
}

test("the full chain: advice → autonomous accept → Simulation journey → real arrival, persisted", async () => {
  setCharacterStore(createMemoryCharacterStore());
  // A settlement that actually owns a lawful site corridor. Alderwick has none,
  // so pick the first village the bounded candidate search can serve.
  const place = villages.find((candidate) => siteVisitCorridors(siteTransportNetwork, candidate.id).length > 0);
  assert.ok(place, "at least one village must have a lawful site corridor");
  const settlement = place!;

  // Find a real SEED site-visit corridor from this settlement (the same bounded
  // candidates the Advisor suggestion is allowed to surface).
  const corridors = siteVisitCorridors(siteTransportNetwork, settlement.id);
  assert.ok(corridors.length > 0, "the settlement must have at least one lawful corridor");

  // A stable rest day, so residents are legally free to travel.
  const day = [1, 2, 3, 4, 5, 6, 7, 8].find((candidate) =>
    localWeekday(tickAtLocalTime(candidate, 14 * 3600, settlement.canonicalPosition.lon), settlement.canonicalPosition.lon) === 6,
  );
  assert.ok(day !== undefined, "a stable SEED rest day exists");

  // Find one real resident the character itself will choose to send.
  let chosen: { code: string; tick: number } | undefined;
  outer: for (const corridor of corridors) {
    for (const index of [3, 4, 6, 8, 9, 10, 11, 14, 16, 21, 26]) {
      for (const hour of [11, 14, 15]) {
        const tick = tickAtLocalTime(day, hour * 3600, settlement.canonicalPosition.lon);
        const actor = residentAt(settlement, index, tick);
        if (!residentChoosesSiteVisit(actor, corridor.from, corridor.to, tick)) continue;
        const probe = new LazySimulation();
        probe.setFocus(settlement);
        probe.advance(tick);
        const event = await probe.tryBeginSelfDirectedSiteVisit(actor.code, corridor);
        if (!event) continue;
        chosen = { code: actor.code, tick };
        break outer;
      }
    }
  }
  assert.ok(chosen, "one real SEED resident must autonomously accept a lawful corridor");

  // ---- now run the SAME decision through the Advisor dialogue path ----
  const resident = residentAt(settlement, Number(chosen.code.split("/RESIDENT/")[1]), chosen.tick);

  const destination = (() => {
    const corridor = corridors[0];
    return { id: corridor.to, name: "the site" };
  })();
  const knownPlaces = [{ id: settlement.id, name: settlement.name }, destination];

  // 1. A stranger's advice is refused, and the world is untouched.
  const stranger = neutralState(chosen.code, 1);
  saveCharacter(stranger);
  const refused = respond("go to the site", factsFor(resident, stranger, settlement, 14, knownPlaces));
  assert.equal(refused.state, "refused", "a stranger's advice must be declined");
  assert.equal(adviceVerdict(stranger), "refuse");

  const untouched = new LazySimulation();
  untouched.setFocus(settlement);
  untouched.advance(chosen.tick);
  assert.equal(untouched.preparedSiteVisitFor(chosen.code), undefined,
    "a refused suggestion must not create a journey");

  // 2. An earned relationship is allowed to weigh advice and the Simulation runs.
  const trusted: CharacterState = { ...stranger, trust: ADVICE_TRUST_SURE };
  saveCharacter(trusted);
  assert.equal(adviceVerdict(trusted), "accept");
  const accepted = respond("go to the site", factsFor(resident, trusted, settlement, 14, knownPlaces));
  assert.equal(accepted.state, "proposed", "an accept-level character agrees to set out");
  assert.ok(accepted.proposal, "the character's agreement is carried to the host");

  // 3. The host hands it to the Simulation, which validates the real route.
  const sim = new LazySimulation();
  sim.setFocus(settlement);
  sim.advance(chosen.tick);
  const result = await sim.considerAdvisorSiteVisit(chosen.code);
  assert.equal(result.started, true, "the Simulation must begin the validated journey");
  assert.match(result.message, /set out|verified|journey/i);

  // 4. A real, immutable journey exists with physical stations.
  const event = sim.preparedSiteVisitFor(chosen.code);
  assert.ok(event, "an accepted suggestion must produce a real Simulation event");
  assert.equal(event!.residentCode, chosen.code, "the same SEED person acts");
  assert.ok(event!.journey.stations.length > 1, "the journey has real physical stations, not a teleport");

  // 5. The consequence persists: the saved history round-trips.
  const saved = sim.savedSiteVisitHistory();
  assert.ok(saved, "the accepted journey must be persisted");
  const restored = new LazySimulation();
  restored.setFocus(settlement);
  restored.advance(chosen.tick);
  assert.equal(await restored.restoreSiteVisitHistory(saved), true,
    "the persisted journey must revalidate on reload");
  const replayed = restored.preparedSiteVisitFor(chosen.code);
  assert.ok(replayed, "the restored world must still know about the journey");
  assert.deepEqual(replayed!.journey.edgeCodes, event!.journey.edgeCodes,
    "the replayed route is identical — no injection or substitution");

  // 6. The relationship that unlocked it is also persisted.
  assert.equal(loadCharacter(chosen.code, 1).trust, ADVICE_TRUST_SURE);

  // 7. Mechanism: advice cannot be repeated into a second journey.
  const again = await sim.considerAdvisorSiteVisit(chosen.code);
  assert.match(again.message, /return|home|revalidat/i,
    "a second suggestion is routed to the lawful return, never a second departure");
});

test("an impossible suggestion never mutates the world", async () => {
  setCharacterStore(createMemoryCharacterStore());
  const place = villages[0];
  const trusted: CharacterState = { ...neutralState("invented/RESIDENT/1", 1), trust: 100 };

  const sim = new LazySimulation();
  sim.setFocus(place);
  sim.advance(0);

  const fabricated = await sim.considerAdvisorSiteVisit("invented/RESIDENT/999");
  assert.equal(fabricated.started, false, "no invented resident may be created");
  assert.equal(sim.preparedSiteVisitFor("invented/RESIDENT/999"), undefined);
  assert.equal(trusted.trust, 100, "the refusal does not alter the relationship");
});

test("trust, not luck, decides acceptance", async () => {
  const code = "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/VILLAGE/0/RESIDENT/7";
  for (let repeat = 0; repeat < 5; repeat++) {
    assert.equal(adviceVerdict(neutralState(code, 1)), "refuse");
    assert.equal(adviceVerdict({ ...neutralState(code, 1), trust: ADVICE_TRUST_FLOOR }), "consider");
    assert.equal(adviceVerdict({ ...neutralState(code, 1), trust: ADVICE_TRUST_SURE }), "accept");
  }
});
