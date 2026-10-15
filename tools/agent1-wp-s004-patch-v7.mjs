import fs from "node:fs";

const path = "tests/world.test.ts";
let source = fs.readFileSync(path, "utf8");
const before = `    if(f.kind==='field') {
      const geometry=buildTile(tileForPosition(f.x,f.z,13)).structures;
      assert.ok(Array.from({length:geometry.colors.length/4},(_,i)=>i).some(i=>
        geometry.colors[i*4]===158&&geometry.colors[i*4+1]===132&&geometry.colors[i*4+2]===66),
      'field base must survive the worker replacing its nature group');
    }`;
const after = `    if(f.kind==='field') {
      const geometry=buildTile(tileForPosition(f.x,f.z,13)).structures,
        expected = f.fieldForm === 'pasture' ? [125,143,78]
          : f.fieldForm === 'orchard' ? [126,137,70]
          : f.fieldForm === 'vegetable' ? [137,121,65]
          : [158,132,66];
      assert.ok(Array.from({length:geometry.colors.length/4},(_,i)=>i).some(i=>
        geometry.colors[i*4]===expected[0]&&geometry.colors[i*4+1]===expected[1]&&geometry.colors[i*4+2]===expected[2]),
      'field-form base must survive the worker replacing its nature group');
    }`;
if (!source.includes(before)) {
  if (source.includes("field-form base must survive")) {
    console.log("AGENT #1 WP-S004 field-form test patch already applied");
    process.exit(0);
  }
  throw new Error("world field acceptance anchor not found");
}
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("AGENT #1 WP-S004 field-form test patch v7 applied");
