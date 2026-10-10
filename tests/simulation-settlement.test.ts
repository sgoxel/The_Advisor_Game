import test from "node:test";
import assert from "node:assert/strict";
import { cities, villages } from "../src/geography.ts";
import { settlementLayout } from "../src/settlement-layout.ts";
import { residentAt } from "../src/simulation.ts";

for (const place of [villages[0], cities[0]]) {
  test(`${place.kind} live residents reuse canonical housed identities`, () => {
    const layout = settlementLayout(place);
    assert.ok(layout.residents.length > 0, `${place.id}: empty canonical roster`);
    for (const index of [0, Math.floor(layout.residents.length / 2), layout.residents.length - 1]) {
      const canonical = layout.residents[index],
        first = residentAt(place, index, 123456),
        second = residentAt(place, index, 123456),
        later = residentAt(place, index, 123480);
      assert.equal(first.code, canonical.code);
      assert.equal(first.home, canonical.home);
      assert.equal(first.profession, canonical.profession);
      assert.equal(first.work, canonical.work);
      assert.equal(first.settlement, place.id);
      assert.deepEqual(second, first, `${canonical.code}: same fantasy time changed resident state`);
      assert.equal(later.code, canonical.code, `${canonical.code}: identity changed with fantasy time`);
      assert.equal(later.home, canonical.home, `${canonical.code}: home changed with fantasy time`);
    }
    assert.throws(
      () => residentAt(place, layout.residents.length, 123456),
      /outside .* canonical roster/,
      `${place.id}: synthetic resident accepted outside registry`,
    );
  });
}
