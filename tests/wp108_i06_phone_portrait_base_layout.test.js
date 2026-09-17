const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'phone_portrait.css'), 'utf8');
const responsiveEntry = fs.readFileSync(path.join(__dirname, '..', 'css', 'tablet_portrait.css'), 'utf8');

function expect(re, text, message) {
  if (!re.test(text)) throw new Error(message);
}

function selectorBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'g');
  return Array.from(css.matchAll(re), match => match[1]);
}

expect(/@import url\(["']phone_portrait\.css["']\);/, responsiveEntry, 'phone portrait stylesheet must be present in the responsive load path');
expect(/@media\s*\(max-width:699px\)\s*and\s*\(orientation:portrait\)/, css, 'phone portrait breakpoint must be isolated from tablet and landscape layouts');
expect(/#app\{[\s\S]*?min-height:200svh;/, css, 'phone portrait must reserve two viewport-scale major surfaces');
expect(/#app\{[\s\S]*?grid-template-rows:[\s\S]*?var\(--phone-portrait-ribbon-height\)[\s\S]*?calc\(100svh - var\(--phone-portrait-ribbon-height\)\)[\s\S]*?var\(--phone-portrait-tabs-height\)[\s\S]*?calc\(100svh - var\(--phone-portrait-tabs-height\)\)/, css, 'phone portrait must keep game and control surfaces as two exact viewport-height row pairs');
expect(/#center-area\{[\s\S]*?grid-row:2;[\s\S]*?height:100%;/, css, 'game area must own the dedicated first major surface');
expect(/\.mobile-panel-tabs\{[\s\S]*?grid-row:3;/, css, 'control tabs must begin the separate control surface');
expect(/\.bottom-ribbon\{[\s\S]*?grid-row:4;/, css, 'control panel must occupy the dedicated second major surface');
expect(/\.bottom-ribbon\{[\s\S]*?min-height:0;/, css, 'control surface must override the legacy phone minimum height');
expect(/\.bottom-ribbon\{[\s\S]*?height:100%;/, css, 'control surface must fill its dedicated major row');
expect(/env\(safe-area-inset-top,0px\)/, css, 'top safe area must be accommodated');
expect(/env\(safe-area-inset-right,0px\)/, css, 'right safe area must be accommodated');
expect(/env\(safe-area-inset-bottom,0px\)/, css, 'bottom safe area must be accommodated');
expect(/env\(safe-area-inset-left,0px\)/, css, 'left safe area must be accommodated');
expect(/\.mobile-tab-btn,[\s\S]*?\.lang-select-wrap\{[\s\S]*?min-height:44px;/, css, 'phone portrait touch controls must retain practical minimum sizing');

for (const selector of ['#center-area', '.bottom-ribbon']) {
  const blocks = selectorBlocks(selector);
  if (!blocks.length) throw new Error(`${selector} major surface must remain defined`);
  for (const block of blocks) {
    if (/display\s*:\s*none/.test(block)) {
      throw new Error(`${selector} must remain mounted instead of being removed from layout`);
    }
    if (/transform\s*:|translate[XY]?\s*\(/.test(block)) {
      throw new Error(`${selector} must remain in document flow instead of transform-based state replacement`);
    }
  }
}

console.log('PASS WP-108/I06 phone portrait base layout');
