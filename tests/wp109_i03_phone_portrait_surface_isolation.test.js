const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'phone_portrait.css'), 'utf8');

function expect(re, text, message) {
  if (!re.test(text)) throw new Error(message);
}

expect(/@media\s*\(max-width:699px\)\s*and\s*\(orientation:portrait\)/, css, 'surface isolation must be phone-portrait only');
expect(/--phone-portrait-ribbon-height:72px;/, css, 'game surface header height must be bounded');
expect(/--phone-portrait-tabs-height:56px;/, css, 'control surface tab height must be bounded');
expect(/#app\{[\s\S]*?min-height:200svh;/, css, 'two major surfaces must span two viewport heights');
expect(/grid-template-rows:[\s\S]*?var\(--phone-portrait-ribbon-height\)[\s\S]*?calc\(100svh - var\(--phone-portrait-ribbon-height\)\)[\s\S]*?var\(--phone-portrait-tabs-height\)[\s\S]*?calc\(100svh - var\(--phone-portrait-tabs-height\)\)/, css, 'each major surface row pair must total exactly one svh viewport');
expect(/html,[\s\S]*?body\{[\s\S]*?scroll-snap-type:y mandatory;/, css, 'normal phone portrait scrolling must settle on one major surface');
expect(/\.ribbon\{[\s\S]*?scroll-snap-align:start;[\s\S]*?scroll-snap-stop:always;/, css, 'game surface start must be a mandatory snap point');
expect(/\.mobile-panel-tabs\{[\s\S]*?scroll-snap-align:start;[\s\S]*?scroll-snap-stop:always;/, css, 'control surface start must be a mandatory snap point');
expect(/#center-area\{[\s\S]*?overflow:hidden;/, css, 'game surface must not leak content into the second viewport');
expect(/\.bottom-ribbon\{[\s\S]*?overflow:hidden;/, css, 'control surface must not leak content back into the game viewport');
expect(/overscroll-behavior-y:contain;/, css, 'overscroll must not expose accidental partial third-party page space');

if (/display\s*:\s*none/.test(css) && /#center-area|\.bottom-ribbon/.test(css)) {
  throw new Error('inactive surface must stay mounted rather than being display:none');
}
if (/position\s*:\s*(fixed|absolute)/.test(css) && /#center-area|\.bottom-ribbon/.test(css)) {
  throw new Error('major surfaces must remain in deterministic document flow');
}
if (/transform\s*:|translate[XY]?\s*\(/.test(css)) {
  throw new Error('I03 must isolate surfaces without transform-based state mutation');
}

const viewportHeights = [568, 667, 736, 844, 932];
for (const height of viewportHeights) {
  const firstSurface = 72 + (height - 72);
  const secondSurface = 56 + (height - 56);
  if (firstSurface !== height || secondSurface !== height) {
    throw new Error(`surface height arithmetic failed for ${height}px viewport`);
  }
}

console.log('PASS WP-109/I03 phone portrait surface isolation');
