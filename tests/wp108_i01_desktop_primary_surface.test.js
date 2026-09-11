const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cssPath = path.join(__dirname, '..', 'css', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

assert(css.includes('@media(min-width:961px){'), 'Desktop-only responsive rule must exist.');
assert(
  css.includes('grid-template-rows:48px minmax(0,1fr) clamp(156px,21vh,172px)'),
  'Desktop shell must reserve a bounded control ribbon so the game area remains the dominant surface.'
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
  css.includes('.bottom-ribbon .panel{height:100%}'),
  'Desktop panels must fill only the bounded ribbon instead of overlaying the game area.'
);
assert(
  css.includes('.character-body{grid-template-columns:80px 1fr}') && css.includes('.thumbnail{width:80px;height:80px}'),
  'Character summary must compact with the shorter desktop ribbon without hiding its essential identity text.'
);

const minGameHeights = [600, 720, 768, 900, 1080].map((viewportHeight) => {
  const ribbonHeight = Math.min(172, Math.max(156, viewportHeight * 0.21));
  return {
    viewportHeight,
    gameHeight: viewportHeight - 48 - ribbonHeight,
    ratio: (viewportHeight - 48 - ribbonHeight) / viewportHeight
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
