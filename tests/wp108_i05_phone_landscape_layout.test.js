const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'phone_landscape.css'), 'utf8');
const responsiveEntry = fs.readFileSync(path.join(__dirname, '..', 'css', 'tablet_portrait.css'), 'utf8');

function expect(re, text, message) {
  if (!re.test(text)) throw new Error(message);
}

expect(/@import url\(["']phone_landscape\.css["']\);/, responsiveEntry, 'phone landscape stylesheet must be retained in the responsive stylesheet load path');
expect(/@media \(max-width: 699px\) and \(orientation: landscape\)/, css, 'phone landscape breakpoint must be explicit and isolated from tablet landscape');
expect(/grid-template-columns: minmax\(0, 1fr\) clamp\(220px, 36vw, 260px\)/, css, 'phone landscape must use a bounded control rail instead of a fixed 340px rail');
expect(/\.mobile-panel-tabs[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, css, 'phone landscape panel tabs must use one compact horizontal row');
expect(/\.mobile-tab-btn[\s\S]*?min-height: 44px/, css, 'panel tabs must retain practical touch height');
expect(/\.advisor-send-btn,[\s\S]*?\.choice-btn[\s\S]*?min-height: 44px/, css, 'primary interactive controls must retain practical touch height');
expect(/env\(safe-area-inset-top\)/, css, 'top safe area must be respected');
expect(/env\(safe-area-inset-right\)/, css, 'right safe area must be respected');
expect(/env\(safe-area-inset-bottom\)/, css, 'bottom safe area must be respected');
expect(/env\(safe-area-inset-left\)/, css, 'left safe area must be respected');
expect(/#center-area[\s\S]*?grid-column: 1 \/ 2;[\s\S]*?grid-row: 2;/, css, 'game area must own the primary phone-landscape grid cell');
expect(/\.bottom-ribbon[\s\S]*?grid-column: 2 \/ 3;[\s\S]*?overflow: hidden;/, css, 'control content must stay inside the bounded side rail');

for (const width of [568, 640, 667, 699]) {
  const rail = Math.max(220, Math.min(width * 0.36, 260));
  const game = width - rail;
  if (game <= rail) throw new Error(`game area is not wider than the control rail at ${width}px`);
  if (game / width < 0.60) throw new Error(`game area receives less than 60% of width at ${width}px`);
}

console.log('PASS WP-108/I05 phone landscape layout');
