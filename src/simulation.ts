import { countries, places, type Place } from "./geography.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { digest, heightAt } from "./world.ts";
import {
  lonLatToSource,
  sourceToLonLat,
  type CanonicalPosition,
} from "./planet.ts";
import { settlementLayout, type Point } from "./settlement-layout.ts";

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
/** Length of a street polyline in source units (about metres near a settlement). */
function polylineLength(points: readonly Point[]) {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++)
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return total;
}
/** Point after walking `distance` along a polyline; clamps at the final point. */
function pointAlong(points: readonly Point[], distance: number): Point {
  let remaining = distance;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1],
      length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length) {
      const t = length > 0 ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

/**
 * Residents walk the settlement's own street network from the seed-addressed
 * layout: each resident is assigned one street (round-robin by index) and walks
 * back and forth along its centreline at the fantasy-time good-road speed. tick is
 * already fantasy seconds, so no presentation clock scale is applied. Trading
 * means near the settlement centre, Patrolling means near a gate, otherwise
 * Walking. Interiors and home/work routing are not simulated yet. Positions that
 * are not on land fall back to the settlement centre.
 */
export function residentAt(
  place: Place,
  index: number,
  tick: number,
): Resident {
  const code = `${place.code}/RESIDENT/${index}`,
    variant = digest(code),
    layout = settlementLayout(place);
  const street = layout.streets.length
    ? layout.streets[index % layout.streets.length]
    : undefined;
  let point: Point = layout.center;
  if (street && street.points.length > 1) {
    const total = polylineLength(street.points);
    if (total > 0) {
      const cycle = 2 * total,
        phase = (tick * GOOD_ROAD_WALK_SPEED_MPS + (variant % total)) % cycle,
        distance = phase <= total ? phase : cycle - phase;
      point = pointAlong(street.points, distance);
    }
  }
  const canonical = sourceToLonLat(point.x, point.z),
    presentation = lonLatToSource(canonical.lon, canonical.lat),
    legal = heightAt(presentation.x, presentation.z) > 0.1,
    surface = legal ? canonical : place.canonicalPosition,
    source = legal ? presentation : { x: place.x, z: place.z },
    elevation = heightAt(source.x, source.z);
  const nearCentre =
      Math.hypot(point.x - layout.center.x, point.z - layout.center.z) < 6,
    nearGate = layout.gates.some(
      (gate) => Math.hypot(point.x - gate.x, point.z - gate.z) < 10,
    );
  return {
    code,
    home: place.id,
    index,
    variant,
    position: { lon: surface.lon, lat: surface.lat, elevation },
    x: source.x,
    z: source.z,
    task: nearCentre ? "Trading" : nearGate ? "Patrolling" : "Walking",
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
