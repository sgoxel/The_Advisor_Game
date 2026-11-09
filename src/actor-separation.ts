/**
 * Presentation-only separation of simultaneously rendered residents.
 *
 * Two people can legitimately share the same SEED spot at a doorway or a
 * routine handover. Drawing both cut-outs on one pixel makes the crowd look
 * broken and makes picking ambiguous. This module nudges only the drawn
 * position, deterministically from the resident code, and never changes
 * Simulation coordinates, routes, identities or the clock.
 *
 * The nudge is hard-capped well inside the picker's tolerance
 * (`actor.getPosition().distance(feet) <= modelHeight * 0.5`, about 0.85 m),
 * so a nudged resident stays selectable and clickable.
 */

export type SeparableActor = {
  readonly code: string;
  readonly x: number;
  readonly z: number;
};

export type SeparatedPoint = { x: number; z: number };

const GOLDEN_ANGLE = 2.399963229728653;
/** Never move a drawn resident farther than this from its canonical feet. */
export const MAX_SEPARATION_OFFSET_M = 0.55;

/** Stable 32-bit hash, matching the rest of the presentation helpers. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Return one point per actor, in input order. The first actor at a spot keeps
 * its canonical position; the others are moved along a seeded golden-angle
 * spiral capped at `maxOffsetM`. Because the order is canonical (code sorted)
 * and the angle comes from the code, repeated frames and reloads produce the
 * identical layout.
 */
export function separateVisibleActors(
  actors: readonly SeparableActor[],
  minDistanceM = 0.42,
  maxOffsetM = MAX_SEPARATION_OFFSET_M,
): Map<string, SeparatedPoint> {
  const min = Math.max(0, minDistanceM),
    minSq = min * min,
    cap = Math.max(0, Math.min(maxOffsetM, MAX_SEPARATION_OFFSET_M)),
    placed: { x: number; z: number }[] = [],
    result = new Map<string, SeparatedPoint>(),
    ordered = [...actors].sort((a, b) => a.code.localeCompare(b.code));
  for (const actor of ordered) {
    let x = actor.x, z = actor.z;
    // Only exact/near-exact collisions are touched; an ordinary crowd on
    // distinct standing slots keeps every authoritative centimetre.
    const collides = () => placed.some((p) => {
      const dx = p.x - x, dz = p.z - z;
      return dx * dx + dz * dz < minSq;
    });
    if (collides()) {
      const phase = (hash(`${actor.code}/SEPARATION`) % 3600) * Math.PI / 1800;
      for (let step = 1; step <= 20 && collides(); step++) {
        // Spread around a ring that always stays inside the picker tolerance.
        const radius = cap * (step <= 6 ? 1 : 0.78 + (step % 2) * 0.12),
          angle = phase + step * GOLDEN_ANGLE;
        x = actor.x + Math.cos(angle) * radius;
        z = actor.z + Math.sin(angle) * radius;
      }
    }
    placed.push({ x, z });
    result.set(actor.code, { x, z });
  }
  return result;
}
