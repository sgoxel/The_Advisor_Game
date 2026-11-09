import test from "node:test";
import assert from "node:assert/strict";
import { chatterHash, chatterLinesFor, chatterPlanFor } from "../src/ambient-chatter.ts";

const a = { code: "B/RESIDENT/1", name: "Mira", role: "baker" };
const b = { code: "B/RESIDENT/2", name: "Oda", role: "guard" };

test("an exchange is deterministic for the same pair and fantasy window", () => {
  const first = chatterPlanFor(a, b, 1000), second = chatterPlanFor(a, b, 1000);
  assert.deepEqual(first, second);
  assert.equal(first.window, second.window);
  assert.ok(first.line.text.length > 10 && first.reply.text.length > 10);
  assert.notEqual(first.line.speaker, first.reply.speaker);
  assert.ok([a.name, b.name].includes(first.line.speaker));
  // Swapping who is nearer must not change the words (the pair is unordered).
  const swapped = chatterPlanFor(b, a, 1000);
  assert.deepEqual(swapped, first);
});

test("different windows and different pairs yield a varied, bounded rotation", () => {
  const lines = new Set<string>();
  for (let tick = 0; tick < 128 * 40; tick += 128) lines.add(chatterPlanFor(a, b, tick).line.text);
  assert.ok(lines.size >= 8, `only ${lines.size} distinct openers over 40 windows`);
  const other = chatterPlanFor(a, { code: "B/RESIDENT/3", name: "Rulf", role: "farmer" }, 1000);
  assert.notEqual(other.line.text, chatterPlanFor(a, b, 1000).line.text);
});

test("hash and role pools stay stable, and unknown roles fall back safely", () => {
  assert.equal(chatterHash("B/RESIDENT/1"), chatterHash("B/RESIDENT/1"));
  assert.notEqual(chatterHash("a"), chatterHash("b"));
  assert.ok(chatterLinesFor("guard").length > 0);
  assert.deepEqual(chatterLinesFor("wizard"), []);
  // A missing role pool never throws and still returns a usable exchange.
  const plan = chatterPlanFor({ ...a, role: "wizard" }, { ...b, role: "wizard" }, 500);
  assert.ok(plan.line.text.length > 0 && plan.reply.text.length > 0);
});

test("a trade line is only ever spoken by the person who owns that trade", () => {
  const merchant = { code: "B/RESIDENT/1", name: "Mira", role: "merchant" };
  const guard = { code: "B/RESIDENT/2", name: "Oda", role: "guard" };
  for (let tick = 0; tick < 128 * 300; tick += 128) {
    const plan = chatterPlanFor(merchant, guard, tick);
    const speakerRole = plan.line.speaker === merchant.name ? merchant.role : guard.role;
    // Whatever the opener says must come from their own pool (or the shared,
    // role-free openers), never from the other person's trade.
    const otherRole = speakerRole === merchant.role ? guard.role : merchant.role;
    assert.ok(!chatterLinesFor(otherRole).includes(plan.line.text),
      `tick ${tick}: ${plan.line.speaker} said another trade's line`);
  }
});
