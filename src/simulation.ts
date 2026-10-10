import { countries, places, type Place } from "./geography.ts";
import { GOOD_ROAD_WALK_SPEED_MPS } from "./travel.ts";
import { digest, heightAt } from "./world.ts";
import {
  lonLatToSource,
  sourceToLonLat,
  type CanonicalPosition,
} from "./planet.ts";
import {
  settlementLayout,
  type Point,
  type Profession,
  type SettlementLayout,
  type Street,
} from "./settlement-layout.ts";

export type Resident = {
  /** Same canonical resident code owned by SettlementLayout; simulation never invents a second roster. */
  code: string;
  /** Canonical home building code from SettlementLayout. */
  home: string;
  /** Owning inhabited place, used only to resolve the settlement on later ticks. */
  settlement: string;
  profession: Profession;
  work?: string;
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
/** Per-street lengths of a layout, cached because residents query it every tick. */
const streetTables = new WeakMap<readonly Street[], { lengths: number[]; total: number }>();
function streetTableFor(streets: readonly Street[]) {
  let table = streetTables.get(streets);
  if (!table) {
    const lengths = streets.map((street) => polylineLength(street.points));
    table = { lengths, total: lengths.reduce((sum, length) => sum + length, 0) };
    streetTables.set(streets, table);
  }
  return table;
}
/** Golden-ratio fraction: consecutive resident indices land far apart on the cumulative length. */
const GOLDEN_FRACTION = 0.6180339887498949;
function streetFor(
  streets: readonly Street[],
  index: number,
): { street: Street; length: number } | undefined {
  const { lengths, total } = streetTableFor(streets);
  if (!(total > 0)) return undefined;
  const target = ((index * GOLDEN_FRACTION) % 1) * total;
  let cumulative = 0,
    last = -1;
  for (let i = 0; i < streets.length; i++) {
    if (!(lengths[i] > 0)) continue;
    last = i;
    cumulative += lengths[i];
    if (target < cumulative) return { street: streets[i], length: lengths[i] };
  }
  return last >= 0 ? { street: streets[last], length: lengths[last] } : undefined;
}

type ResidentRoute = { street?: Street; length: number; phase: number };
const residentRoutes = new Map<string, ResidentRoute>();
/** Route assignment is fixed by the canonical resident code and never depends on visit/update order. */
function routeFor(layout: SettlementLayout, index: number, residentCode: string, variant: number): ResidentRoute {
  let route = residentRoutes.get(residentCode);
  if (!route) {
    const picked = streetFor(layout.streets, index);
    route = {
      street: picked?.street,
      length: picked?.length ?? 0,
      phase: picked ? (variant / 2 ** 32) * picked.length : 0,
    };
    residentRoutes.set(residentCode, route);
  }
  return route;
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
 * A live Resident is the same person owned by SettlementLayout. Only their time-varying position/task
 * is reconstructed here from SEED-derived layout truth plus fantasy tick. No synthetic population,
 * duplicate home, or renderer-driven identity is created.
 */
export function residentAt(
  place: Place,
  index: number,
  tick: number,
): Resident {
  const layout = settlementLayout(place),
    resident = layout.residents[index];
  if (!resident)
    throw new RangeError(`Resident ${index} outside ${place.id} canonical roster (${layout.residents.length})`);
  const code = resident.code,
    variant = digest(code),
    route = routeFor(layout, index, code, variant);
  let point: Point = layout.center;
  if (route.street && route.length > 0) {
    const cycle = 2 * route.length,
      phase = (tick * GOOD_ROAD_WALK_SPEED_MPS + route.phase) % cycle,
      distance = phase <= route.length ? phase : cycle - phase;
    point = pointAlong(route.street.points, distance);
  }
  const canonical = sourceToLonLat(point.x, point.z),
    presentation = lonLatToSource(canonical.lon, canonical.lat),
    legal = heightAt(presentation.x, presentation.z) > 0.1,
    surface = legal ? canonical : place.canonicalPosition,
    source = legal ? presentation : { x: place.x, z: place.z },
    elevation = heightAt(source.x, source.z);
  const nearCentre = Math.hypot(point.x - layout.center.x, point.z - layout.center.z) < 6,
    nearGate = layout.gates.some((gate) => Math.hypot(point.x - gate.x, point.z - gate.z) < 10),
    task = resident.profession === "guard"
      ? "Patrolling"
      : nearCentre
        ? "Trading"
        : nearGate
          ? "Passing gate"
          : resident.work
            ? "Walking to work"
            : "Walking";
  return {
    code,
    home: resident.home,
    settlement: place.id,
    profession: resident.profession,
    ...(resident.work ? { work: resident.work } : {}),
    index,
    variant,
    position: { lon: surface.lon, lat: surface.lat, elevation },
    x: source.x,
    z: source.z,
    task,
  };
}

const placesById = new Map(places.map((place) => [place.id, place]));
const placesByCountry = new Map<string, Place[]>();
for (const country of countries)
  placesByCountry.set(
    country.code,
    places.filter((place) => place.continent === country.continent && place.country === country.id),
  );

export class LazySimulation {
  tick = 0;
  activeCountry = "";
  interested = new Set<string>();
  summaries = new Map<string, CountryState>();
  residents = new Map<string, Resident[]>();
  setFocus(place: Place | undefined) {
    if (place)
      this.activeCountry = countries.find(
        (country) => country.continent === place.continent && country.id === place.country,
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
      if (!previous || live || previous.tier !== tier || tick - previous.lastTick >= interval) {
        const state = summaryAt(country.code, tick);
        state.tier = tier;
        this.summaries.set(country.code, state);
      }
      if (live && !this.residents.has(country.code)) {
        const countryPlaces = placesByCountry.get(country.code) ?? [];
        this.residents.set(
          country.code,
          countryPlaces.flatMap((place) => {
            const count = settlementLayout(place).residents.length;
            return Array.from({ length: count }, (_, index) => residentAt(place, index, tick));
          }),
        );
      } else if (live) {
        const pool = this.residents.get(country.code)!;
        for (let i = 0; i < pool.length; i++) {
          const place = placesById.get(pool[i].settlement);
          if (!place) throw new Error(`Resident ${pool[i].code} references missing settlement ${pool[i].settlement}`);
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
      residents: [...this.residents.values()].reduce((count, roster) => count + roster.length, 0),
      coarseCountries: [...this.summaries.values()].filter((state) => state.tier === "coarse").length,
    };
  }
}
