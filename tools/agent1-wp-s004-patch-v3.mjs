import fs from "node:fs";

const path = "src/geography.ts";
let source = fs.readFileSync(path, "utf8");

const startMarker = "function seededSettlementName(";
const endMarker = "function canonicalPosition(";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("seeded settlement name function anchors not found");

const replacement = `function seededSettlementName(
  kind: "city" | "village",
  address: string,
  continent: number,
  used: Set<string>,
) {
  const stems = CULTURE_STEMS[continent % CULTURE_STEMS.length],
    endings = kind === "city" ? CITY_ENDINGS : VILLAGE_ENDINGS,
    reserved = new Set(COUNTRY_NAMES.map((name) => name.toLowerCase())),
    gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a),
    coprimeStep = (addressKey: string, total: number) => {
      let step = 1 + (digest(addressKey) % Math.max(1, total - 1));
      while (gcd(step, total) !== 1) step = (step % (total - 1)) + 1;
      return step;
    },
    accept = (name: string) => {
      const key = name.toLowerCase();
      if (used.has(key) || reserved.has(key)) return undefined;
      used.add(key);
      return name;
    };

  const simpleTotal = stems.length * endings.length,
    simpleStart = digest(\`\${WORLD_SEED}/\${WORLD_FOUNDATION_VERSION}/\${address}/NAME/SIMPLE/START\`) % simpleTotal,
    simpleStep = coprimeStep(
      \`\${WORLD_SEED}/\${WORLD_FOUNDATION_VERSION}/\${address}/NAME/SIMPLE/STEP\`,
      simpleTotal,
    );
  for (let slot = 0; slot < simpleTotal; slot++) {
    const index = (simpleStart + slot * simpleStep) % simpleTotal,
      stem = stems[Math.floor(index / endings.length)],
      ending = endings[index % endings.length],
      name = accept(\`\${stem}\${ending}\`);
    if (name) return name;
  }

  // A dense viable region can legitimately need more names than the simple
  // vocabulary contains. Probe every two-stem cultural compound in a seeded
  // permutation rather than adding numeric suffixes or retrying collisions.
  const compoundTotal = stems.length * (stems.length - 1) * endings.length,
    compoundStart = digest(\`\${WORLD_SEED}/\${WORLD_FOUNDATION_VERSION}/\${address}/NAME/COMPOUND/START\`) % compoundTotal,
    compoundStep = coprimeStep(
      \`\${WORLD_SEED}/\${WORLD_FOUNDATION_VERSION}/\${address}/NAME/COMPOUND/STEP\`,
      compoundTotal,
    );
  for (let slot = 0; slot < compoundTotal; slot++) {
    const index = (compoundStart + slot * compoundStep) % compoundTotal,
      endingIndex = index % endings.length,
      pairIndex = Math.floor(index / endings.length),
      primaryIndex = Math.floor(pairIndex / (stems.length - 1)),
      secondarySlot = pairIndex % (stems.length - 1),
      secondaryIndex = secondarySlot >= primaryIndex ? secondarySlot + 1 : secondarySlot,
      name = accept(
        \`\${stems[primaryIndex]}\${stems[secondaryIndex].toLowerCase()}\${endings[endingIndex]}\`,
      );
    if (name) return name;
  }
  throw new Error(\`Seeded geography exhausted cultural \${kind} names for \${address}\`);
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
console.log("AGENT #1 WP-S004 naming patch v3 applied");
