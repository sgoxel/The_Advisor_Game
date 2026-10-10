import { countries, places, type Place } from "./geography.ts";
import {
  settlementBuilding,
  settlementPlan,
  settlementPopulation,
  settlementResident,
  type ResidentProfession,
} from "./settlements.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { digest, heightAt } from "./world.ts";
import {
  canonicalDistanceM,
  lonLatToSource,
  type CanonicalPosition,
} from "./planet.ts";

export type Resident = {
  code: string;
  placeId: string;
  home: string;
  profession: ResidentProfession;
  workplace?: string;
  index: number;
  variant: number;
  /** Canonical spherical simulation position. */
  position: CanonicalPosition;
  /** Transitional renderer/source coordinates; never stable world identity. */
  x: number;
  z: number;
  task: string;
};
export type CountryState = {
  code: string;
  population: number;
  grain: number;
  lastTick: number;
  tier: "live" | "interested" | "coarse";
};
const populationOf = (place: Place) => settlementPopulation(place.id);

export function summaryAt(code: string, tick: number): CountryState {
  const baseline = digest(code) % 5000;
  // Analytical catch-up is independent of update cadence and render interest.
  return {
    code,
    population: 7920,
    grain: baseline + Math.floor(tick / 60) * 12,
    lastTick: tick,
    tier: "coarse",
  };
}

function taskForProfession(profession: ResidentProfession, atWork: boolean) {
  if (!atWork) return "Walking";
  switch (profession) {
    case "innkeeper":
      return "Serving guests";
    case "merchant":
      return "Trading";
    case "blacksmith":
      return "Smithing";
    case "farmer":
      return "Farm work";
    case "butcher":
      return "Preparing goods";
    case "guard":
      return "Guard duty";
    case "carpenter":
      return "Carpentry";
    case "weaver":
      return "Weaving";
    case "miller":
      return "Milling";
    default:
      return "Working";
  }
}

function interpolatePosition(
  from: CanonicalPosition,
  to: CanonicalPosition,
  amount: number,
): CanonicalPosition {
  // Settlement journeys are bounded to a few hundred metres, so shortest-angle
  // longitude interpolation is stable even near the antimeridian.
  let deltaLon = to.lon - from.lon;
  if (deltaLon > Math.PI) deltaLon -= Math.PI * 2;
  else if (deltaLon < -Math.PI) deltaLon += Math.PI * 2;
  return {
    lon: from.lon + deltaLon * amount,
    lat: from.lat + (to.lat - from.lat) * amount,
    elevation: from.elevation + (to.elevation - from.elevation) * amount,
  };
}

/**
 * Resident identity, home and profession come from the settlement registry. This
 * routine only advances the resident along the deterministic home↔work journey;
 * it never invents a second building or settlement authority.
 */
export function residentAt(
  place: Place,
  index: number,
  tick: number,
): Resident {
  const assignment = settlementResident(place.id, index),
    home = settlementBuilding(assignment.homeCode)!;
  if (!home) throw new Error(`${assignment.code} has no canonical home`);
  const workplace = assignment.workplaceCode
      ? settlementBuilding(assignment.workplaceCode)
      : undefined,
    variant = digest(assignment.code),
    destination = workplace?.entrance ?? home.entrance,
    origin = home.entrance,
    distanceM = Math.max(1, canonicalDistanceM(origin, destination)),
    walkingSeconds = distanceM / GOOD_ROAD_WALK_SPEED_MPS,
    // Residents without a dedicated workplace still leave home on a compact
    // settlement walk, using a seeded service building as a stable destination.
    fallback = workplace
      ? undefined
      : settlementPlan(place.id).buildings.filter(
          (building) =>
            building.use !== "home" &&
            building.use !== "guard-post" &&
            building.use !== "well",
        )[variant % 7],
    actualDestination = fallback?.entrance ?? destination,
    actualDistanceM = Math.max(1, canonicalDistanceM(origin, actualDestination)),
    travelSeconds = actualDistanceM / GOOD_ROAD_WALK_SPEED_MPS,
    dwellSeconds = 75 + (variant % 90),
    cycle = travelSeconds * 2 + dwellSeconds * 2,
    phase = tick % cycle;
  let position: CanonicalPosition,
    atWork = false;
  if (phase < travelSeconds) {
    position = interpolatePosition(origin, actualDestination, phase / travelSeconds);
  } else if (phase < travelSeconds + dwellSeconds) {
    position = actualDestination;
    atWork = true;
  } else if (phase < travelSeconds * 2 + dwellSeconds) {
    const t = (phase - travelSeconds - dwellSeconds) / travelSeconds;
    position = interpolatePosition(actualDestination, origin, t);
  } else {
    position = origin;
  }
  const source = lonLatToSource(position.lon, position.lat),
    elevation = heightAt(source.x, source.z);
  return {
    code: assignment.code,
    placeId: place.id,
    home: assignment.homeCode,
    profession: assignment.profession,
    workplace: assignment.workplaceCode,
    index,
    variant,
    position: { lon: position.lon, lat: position.lat, elevation },
    x: source.x,
    z: source.z,
    task: taskForProfession(assignment.profession, atWork),
  };
}

export class LazySimulation {
  tick = 0;
  activeCountry = "";
  interested = new Set<string>();
  summaries = new Map<string, CountryState>();
  residents = new Map<string, Resident[]>();
  setFocus(place: Place | undefined) {
    if (place)
      this.activeCountry = countries.find(
        (country) =>
          country.continent === place.continent && country.id === place.country,
      )!.code;
  }
  setInterest(code: string) {
    this.interested.clear();
    this.interested.add(code);
  }
  advance(tick: number) {
    if (tick < this.tick)
      throw new RangeError("Simulation time must move forward");
    this.tick = tick;
    for (const country of countries) {
      const live = country.code === this.activeCountry,
        interested = this.interested.has(country.code),
        interval = live ? 1 : interested ? 30 : 300,
        previous = this.summaries.get(country.code),
        tier = live ? "live" : interested ? "interested" : "coarse";
      if (
        !previous ||
        live ||
        previous.tier !== tier ||
        tick - previous.lastTick >= interval
      ) {
        const state = summaryAt(country.code, tick);
        state.tier = tier;
        this.summaries.set(country.code, state);
      }
      const countryPlaces = places.filter(
        (place) =>
          place.continent === country.continent && place.country === country.id,
      );
      if (live && !this.residents.has(country.code)) {
        this.residents.set(
          country.code,
          countryPlaces.flatMap((place) =>
            Array.from({ length: populationOf(place) }, (_, index) =>
              residentAt(place, index, tick),
            ),
          ),
        );
      } else if (live) {
        const pool = this.residents.get(country.code)!,
          homes = new Map(countryPlaces.map((place) => [place.id, place]));
        for (let i = 0; i < pool.length; i++) {
          const place = homes.get(pool[i].placeId);
          if (!place) throw new Error(`${pool[i].code} lost settlement ownership`);
          pool[i] = residentAt(place, pool[i].index, tick);
        }
      }
    }
    // Country detail is reconstructible: inactive pools don't remain allocated.
    for (const code of this.residents.keys())
      if (code !== this.activeCountry) this.residents.delete(code);
  }
  /** Renderer-interest query in transitional source coordinates only. */
  focusedResidents(x: number, z: number, radius: number) {
    return [...this.residents.values()]
      .flat()
      .filter((resident) => Math.hypot(resident.x - x, resident.z - z) <= radius);
  }
  get stats() {
    return {
      tick: this.tick,
      countries: this.summaries.size,
      liveCountries: this.residents.size,
      residents: [...this.residents.values()].reduce(
        (count, residents) => count + residents.length,
        0,
      ),
      coarseCountries: [...this.summaries.values()].filter(
        (state) => state.tier === "coarse",
      ).length,
    };
  }
}
