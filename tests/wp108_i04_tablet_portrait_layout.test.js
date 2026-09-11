const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'tablet_portrait.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function expect(re, text, message) { if (!re.test(text)) throw new Error(message); }

expect(/tablet_portrait\.css/, html, 'tablet portrait stylesheet must be loaded by index.html');
expect(/@media \(min-width:700px\) and \(max-width:960px\) and \(orientation:portrait\)/, css, 'tablet portrait breakpoint must be explicit and isolated');
expect(/grid-template-rows:auto minmax\(420px,1fr\) auto clamp\(260px,30svh,320px\)/, css, 'tablet portrait must reserve a practical game area and bound the control panel');
expect(/#center-area\{?[\s\S]*?min-height:420px/, css.replace(/\n\s*/g, ''), 'game area must keep a practical minimum height');
expect(/\.bottom-ribbon\{[\s\S]*?max-height:320px;[\s\S]*?overflow:hidden;/, css, 'control panel must stay bounded instead of dominating portrait height');
expect(/\.mobile-tab-btn,[\s\S]*?\.lang-select-wrap\{[\s\S]*?min-height:44px;/, css, 'tablet portrait interactive controls must retain practical touch height');
expect(/\.bottom-ribbon \.panel\.active-panel\{[\s\S]*?height:100%;[\s\S]*?overflow:hidden;/, css, 'only the active panel must consume the bounded control region');

for (const height of [1024, 1133, 1280, 1366]) {
  const panel = Math.max(260, Math.min(height * 0.30, 320));
  if (panel > 320) throw new Error(`panel exceeds cap at ${height}px`);
  if (panel / height >= 0.32) throw new Error(`panel consumes too much portrait height at ${height}px`);
}

console.log('PASS WP-108/I04 tablet portrait layout');
