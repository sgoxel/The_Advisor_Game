const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
function expect(re, message) { if (!re.test(css)) throw new Error(message); }

expect(/@media\(min-width:700px\) and \(max-width:960px\) and \(orientation:landscape\)/, 'tablet-landscape breakpoint must be explicit');
expect(/grid-template-columns:minmax\(0,1fr\) clamp\(280px,31vw,320px\)/, 'tablet landscape must bound the control rail and leave remaining width to game area');
expect(/\.mobile-tab-btn\{min-height:44px\}/, 'tablet landscape tabs must retain practical touch height');
expect(/\.choice-btn\{min-height:44px\}/, 'tablet landscape choices must retain practical touch height');
expect(/#center-area\{grid-column:1\/2;grid-row:2;min-width:0;min-height:0\}/, 'game area must own the primary tablet-landscape grid cell');
expect(/\.bottom-ribbon\{grid-column:2\/3;grid-row:2;padding:56px 6px 6px;min-height:0;overflow:hidden\}/, 'controls must stay in bounded side rail without covering game area');
expect(/@media\(max-width:699px\) and \(orientation:landscape\)/, 'phone-landscape behavior must remain separately scoped');
expect(/@media\(min-width:961px\)/, 'desktop behavior must remain separately scoped');

for (const width of [700, 768, 800, 900, 960]) {
  const rail = Math.max(280, Math.min(width * 0.31, 320));
  const game = width - rail;
  if (game <= rail) throw new Error(`game area must remain wider than control rail at ${width}px; game=${game}, rail=${rail}`);
}

console.log('PASS WP-108/I03 tablet landscape layout');
