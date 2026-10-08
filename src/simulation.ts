import { countries, places, type Place } from "./geography.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { digest, heightAt } from "./world.ts";
import {
  CANONICAL_PLANET_RADIUS,
  clampLatitude,
  lonLatToSource,
  normalizeLongitude,
  type CanonicalPosition,
} from "./planet.ts";

export type Resident = {
  code: string;
  home: string;
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
const populationOf = (place: Place) => (place.kind === "city" ? 2400 : 80);

/**
 * Cached tangent coefficients are presentation-independent acceleration data.
 * Current resident lanes are at most 261 m from their settlement centre, keeping
 * the local spherical tangent approximation well below one metre of position error
 * while avoiding full ECEF/ENU trigonometry for thousands of residents.
 */
const tangentMetrics = new Map<
  string,
  { radiansPerEastM: number; radiansPerNorthM: number }
>();
function metricsFor(place: Place) {
  let result = tangentMetrics.get(place.code);
  if (!result) {
    const cosLat = Math.max(1e-9, Math.abs(Math.cos(place.canonicalPosition.lat)));
    result = {
      radiansPerEastM: 1 / (CANONICAL_PLANET_RADIUS * cosLat),
      radiansPerNorthM: 1 / CANONICAL_PLANET_RADIUS,
    };
    tangentMetrics.set(place.code, result);
  }
  return result;
}
function canonicalOffset(place: Place, eastM: number, northM: number): CanonicalPosition {
  const metrics = metricsFor(place);
  return {
    lon: normalizeLongitude(
      place.canonicalPosition.lon + eastM * metrics.radiansPerEastM,
    ),
    lat: clampLatitude(
      place.canonicalPosition.lat + northM * metrics.radiansPerNorthM,
    ),
    elevation: place.canonicalPosition.elevation,
  };
}

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
export function residentAt(
  place: Place,
  index: number,
  tick: number,
): Resident {
  const code = `${place.code}/RESIDENT/${index}`,
    variant = digest(code),
    span = place.kind === "city" ? 250 : 28;
  // Four deterministic lanes in canonical physical metres. tick is already fantasy
  // seconds, so movement consumes the fantasy-time road speed directly rather than
  // dividing by the 24× presentation clock scale.
  const radius = 12 + (variant % span),
    speed = GOOD_ROAD_WALK_SPEED_MPS,
    perimeter = radius * 8;
  const distance =
    (tick * speed + (variant % Math.ceil(perimeter))) % perimeter;
  const side = Math.floor(distance / (radius * 2)),
    along = distance % (radius * 2);
  let east = 0,
    north = 0;
  if (side === 0) {
    east = -radius + along;
    north = radius;
  } else if (side === 1) {
    east = radius;
    north = radius - along;
  } else if (side === 2) {
    east = radius - along;
    north = -radius;
  } else {
    east = -radius;
    north = -radius + along;
  }
  // Keep/house interiors are not implemented yet: use the two central street axes.
  const horizontal = index % 2 === 0,
    offset = Math.abs(horizontal ? east : north),
    candidate = canonicalOffset(
      place,
      horizontal ? east : 0,
      horizontal ? 0 : north,
    ),
    presentation = lonLatToSource(candidate.lon, candidate.lat),
    legal = heightAt(presentation.x, presentation.z) > 0.1,
    surface = legal ? candidate : place.canonicalPosition,
    source = legal ? presentation : { x: place.x, z: place.z },
    elevation = heightAt(source.x, source.z);
  return {
    code,
    home: place.id,
    index,
    variant,
    position: { lon: surface.lon, lat: surface.lat, elevation },
    x: source.x,
    z: source.z,
    task: offset < 4 ? "Trading" : index % 3 === 0 ? "Patrolling" : "Walking",
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
        (c) => c.continent === place.continent && c.id === place.country,
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
        interval = live ? 1 : interested ? 30 : 300;
      const previous = this.summaries.get(country.code);
      const tier = live ? "live" : interested ? "interested" : "coarse";
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
      if (live && !this.residents.has(country.code)) {
        this.residents.set(
          country.code,
          places
            .filter(
              (p) =>
                p.continent === country.continent && p.country === country.id,
            )
            .flatMap((p) =>
              Array.from({ length: populationOf(p) }, (_, i) =>
                residentAt(p, i, tick),
              ),
            ),
        );
      } else if (live) {
        const pool = this.residents.get(country.code)!;
        const homes = new Map(
          places
            .filter(
              (p) =>
                p.continent === country.continent && p.country === country.id,
            )
            .map((p) => [p.id, p]),
        );
        for (let i = 0; i < pool.length; i++)
          pool[i] = residentAt(homes.get(pool[i].home)!, pool[i].index, tick);
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
      .filter((r) => Math.hypot(r.x - x, r.z - z) <= radius);
  }
  get stats() {
    return {
      tick: this.tick,
      countries: this.summaries.size,
      liveCountries: this.residents.size,
      residents: [...this.residents.values()].reduce((n, r) => n + r.length, 0),
      coarseCountries: [...this.summaries.values()].filter(
        (s) => s.tier === "coarse",
      ).length,
    };
  }
}
