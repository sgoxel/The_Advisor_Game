const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'phone_portrait.css'), 'utf8');
const responsiveEntry = fs.readFileSync(path.join(__dirname, '..', 'css', 'tablet_portrait.css'), 'utf8');

function expect(re, text, message) {
  if (!re.test(text)) throw new Error(message);
}

expect(/@import url\(["']phone_portrait\.css["']\);/, responsiveEntry, 'phone portrait stylesheet must be present in the responsive load path');
expect(/@media\s*\(max-width:699px\)\s*and\s*\(orientation:portrait\)/, css, 'phone portrait breakpoint must be isolated from tablet and landscape layouts');
expect(/#app\{[\s\S]*?min-height:200svh;[\s\S]*?grid-template-rows:auto minmax\(0,calc\(100svh - 1px\)\) auto minmax\(0,calc\(100svh - 1px\)\)/, css, 'phone portrait must reserve separate viewport-scale game and control surfaces');
expect(/#center-area\{[\s\S]*?grid-row:2;[\s\S]*?height:100%;/, css, 'game area must own the dedicated first major surface');
expect(/\.mobile-panel-tabs\{[\s\S]*?grid-row:3;/, css, 'control tabs must begin the separate control surface');
expect(/\.bottom-ribbon\{[\s\S]*?grid-row:4;[\s\S]*?height:100%;[\s\S]*?min-height:0;/, css, 'control panel must occupy its own full major surface rather than permanently shrinking the game');
expect(/env\(safe-area-inset-top,0px\)/, css, 'top safe area must be accommodated');
expect(/env\(safe-area-inset-right,0px\)/, css, 'right safe area must be accommodated');
expect(/env\(safe-area-inset-bottom,0px\)/, css, 'bottom safe area must be accommodated');
expect(/env\(safe-area-inset-left,0px\)/, css, 'left safe area must be accommodated');
expect(/\.mobile-tab-btn,[\s\S]*?\.lang-select-wrap\{[\s\S]*?min-height:44px;/, css, 'phone portrait touch controls must retain practical minimum sizing');

if (/display\s*:\s*none/.test(css) && /#center-area|\.bottom-ribbon/.test(css)) {
  throw new Error('base layout must not implement WP-109 surface switching by hiding a major surface');
}
if (/transform\s*:|translate[XY]?\s*\(/.test(css)) {
  throw new Error('base layout must not implement WP-109 off-screen switching transforms');
}

console.log('PASS WP-108/I06 phone portrait base layout');
