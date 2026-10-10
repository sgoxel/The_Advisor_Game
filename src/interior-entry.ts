import type { Building } from "./settlement-layout.ts";
import { buildingAt, streetDistanceAt } from "./settlement-layout.ts";
import { heightAt } from "./world.ts";

export type InteriorEntryRequest = {
  building: Building;
  fantasySecond: number;
  intent: "enter-building";
};

export type CharacterEntryDecision = {
  accepted: boolean;
  reason: string;
};

export type SimulationEntryValidation = {
  valid: boolean;
  reason: string;
  building: string;
  entranceDry: boolean;
  accessDry: boolean;
  accessConnected: boolean;
  identityMatches: boolean;
};

export type InteriorEntryResolution = {
  request: InteriorEntryRequest;
  character: CharacterEntryDecision;
  simulation: SimulationEntryValidation;
  approved: boolean;
};

/**
 * Minimal Character decision for the S002 building-entry surface. This is intentionally explicit:
 * atlas selection never calls it. The player must request entry, after which the Character accepts
 * the local transition when a canonical building/entrance exists. Rich autonomous preferences are
 * future character-system scope; no camera/device/visit-order fact is used here.
 */
export function characterDecideInteriorEntry(request: InteriorEntryRequest): CharacterEntryDecision {
  const { building } = request;
  if (!building.code || !building.entrance || !building.access)
    return { accepted: false, reason: "Character cannot identify a valid building entrance." };
  return { accepted: true, reason: "Character accepts the requested local building entry." };
}

/**
 * Simulation validation for an accepted Character decision. The same canonical settlement authority
 * must agree on identity, dry ground and street frontage before an interior can materialize.
 */
export function simulationValidateInteriorEntry(
  request: InteriorEntryRequest,
  character: CharacterEntryDecision,
): SimulationEntryValidation {
  const { building } = request,
    entranceDry = heightAt(building.entrance.x, building.entrance.z) > 0.3,
    accessDry = heightAt(building.access.x, building.access.z) > 0.3,
    accessConnected = streetDistanceAt(building.access.x, building.access.z) <= 0.75,
    resolved = buildingAt(building.x, building.z),
    identityMatches = resolved?.code === building.code;
  if (!character.accepted)
    return {
      valid: false,
      reason: character.reason,
      building: building.code,
      entranceDry,
      accessDry,
      accessConnected,
      identityMatches,
    };
  const valid = entranceDry && accessDry && accessConnected && identityMatches;
  return {
    valid,
    reason: valid
      ? "Simulation validated canonical identity, entrance ground and connected street access."
      : `Simulation rejected entry: ${[
          !identityMatches && "identity mismatch",
          !entranceDry && "wet/invalid entrance",
          !accessDry && "wet/invalid access point",
          !accessConnected && "access is not connected to a street",
        ]
          .filter(Boolean)
          .join(", ")}.`,
    building: building.code,
    entranceDry,
    accessDry,
    accessConnected,
    identityMatches,
  };
}

export function resolveInteriorEntry(
  building: Building,
  fantasySecond = 0,
): InteriorEntryResolution {
  if (!Number.isFinite(fantasySecond) || fantasySecond < 0)
    throw new RangeError("fantasySecond must be a finite non-negative value");
  const request: InteriorEntryRequest = { building, fantasySecond, intent: "enter-building" },
    character = characterDecideInteriorEntry(request),
    simulation = simulationValidateInteriorEntry(request, character);
  return { request, character, simulation, approved: character.accepted && simulation.valid };
}
