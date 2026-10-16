export * from "./world-runtime.ts";

import {
  featuresFor as runtimeFeaturesFor,
  type Feature as RuntimeFeature,
  type Tile,
} from "./world-runtime.ts";

export type ExteriorFeatureKind = RuntimeFeature["kind"] | "service" | "street" | "border" | "gate" | "guard-post";
export type ExteriorService = "market" | "inn" | "blacksmith" | "butcher" | "guard-office" | "farmstead" | "merchant" | "headman";

/**
 * S004-compatible feature contract layered over the current runtime world.
 * The runtime generator remains unchanged; settlement morphology may add
 * deterministic semantic metadata without weakening the base world API.
 */
export type Feature = Omit<RuntimeFeature, "kind"> & {
  kind: ExteriorFeatureKind;
  service?: ExteriorService;
  ownerId?: string;
  capacity?: number;
  residents?: number;
  label?: string;
  entranceX?: number;
  entranceZ?: number;
  yawRad?: number;
  footprintWidth?: number;
  footprintDepth?: number;
  length?: number;
  fieldForm?: "strip" | "paddock" | "orchard" | "vegetable" | "pasture";
};

export function featuresFor(tile: Tile): Feature[] {
  return runtimeFeaturesFor(tile) as Feature[];
}
