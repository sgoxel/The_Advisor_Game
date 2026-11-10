/**
 * Idle DOM-write guard (WP-S009-002-001).
 *
 * Assigning `textContent` to the same string still makes the browser invalidate
 * the node and re-run style/layout work. Measured on a settled, unchanged camera
 * this page performed ~97 text writes in 15 s of idle, 40% of them no-ops.
 *
 * `setText` writes only when the composed value actually differs. Content and
 * behaviour are identical; the DOM simply stops being told to do nothing.
 */

/** Writes text only when it differs from what is already rendered. */
export function setText(node: { textContent: string | null } | null | undefined, value: string): boolean {
  if (!node) return false;
  if (node.textContent === value) return false;
  node.textContent = value;
  return true;
}

/**
 * Guarded `textContent` wrapper for hot per-frame paths. It owns the last value
 * it wrote, so callers may compose freely without tracking state themselves.
 */
export class TextSlot {
  private readonly node: { textContent: string | null } | null;
  private last: string | null;

  constructor(node: { textContent: string | null } | null | undefined) {
    this.node = node ?? null;
    this.last = this.node ? this.node.textContent : null;
  }

  /** Returns true when the DOM was actually written. */
  set(value: string): boolean {
    if (!this.node) return false;
    if (this.last === value) return false;
    this.node.textContent = value;
    this.last = value;
    return true;
  }

  get current(): string | null {
    return this.last;
  }

  /**
   * Adopts a value written by other code, so the guard stays in step and does
   * not suppress a legitimate future change.
   */
  sync(value: string | null): void {
    this.last = value;
  }
}

/**
 * Counts DOM writes versus suppressed no-ops, so the guarantee is testable and
 * observable in-game rather than asserted.
 */
export class WriteTelemetry {
  private writes = 0;
  private suppressed = 0;

  recordWrote(): void { this.writes++; }
  recordSuppressed(): void { this.suppressed++; }

  get stats(): { writes: number; suppressed: number } {
    return { writes: this.writes, suppressed: this.suppressed };
  }

  reset(): void { this.writes = 0; this.suppressed = 0; }
}

/** True when two composed status strings would produce identical DOM output. */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "") === (b ?? "");
}
