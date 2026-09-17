const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cssPath = path.join(__dirname, '..', 'css', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

assert(css.includes('@media(min-width:961px){'), 'Desktop-only responsive rule must exist.');
assert(
  css.includes('grid-template-rows:48px minmax(0,1fr) 36px clamp(120px,17vh,136px)'),
  'Desktop shell must reserve bounded contextual tabs and one active panel so the game area remains dominant.'
);
assert(
  css.includes('@media(max-width:960px){#app{grid-template-rows:auto minmax(0,1fr) auto auto}'),
  'Tablet/phone responsive shell must retain its independent <=960px layout.'
);
assert(
  css.includes('@media(max-width:960px) and (orientation:landscape)'),
  'Existing compact landscape layout must remain available below the desktop breakpoint.'
);
assert(
  css.includes('.bottom-ribbon .panel{display:none;height:100%}') &&
    css.includes('.bottom-ribbon .panel.active-panel{display:grid}'),
  'Desktop must render only the active contextual panel inside the bounded panel row.'
);
assert(
  css.includes('.character-body{grid-template-columns:80px 1fr}') && css.includes('.thumbnail{width:80px;height:80px}'),
  'Character summary must remain compact without hiding essential identity text.'
);

const minGameHeights = [600, 720, 768, 900, 1080].map((viewportHeight) => {
  const panelHeight = Math.min(136, Math.max(120, viewportHeight * 0.17));
  const persistentChromeHeight = 48 + 36 + panelHeight;
  return {
    viewportHeight,
    gameHeight: viewportHeight - persistentChromeHeight,
    ratio: (viewportHeight - persistentChromeHeight) / viewportHeight
  };
});

for (const sample of minGameHeights) {
  assert(sample.gameHeight > 0, `Desktop ${sample.viewportHeight}px viewport must retain a positive game area.`);
  if (sample.viewportHeight >= 720) {
    assert(
      sample.ratio >= 0.70,
      `Desktop ${sample.viewportHeight}px viewport should devote at least 70% of height to the game area; got ${sample.ratio}`
    );
  }
}

console.log('WP-108/I01 desktop primary-surface regression checks passed.');
