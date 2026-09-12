const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function expect(re, text, message) {
  if (!re.test(text)) throw new Error(message);
}

function reject(re, text, message) {
  if (re.test(text)) throw new Error(message);
}

const css = read('css/phone_portrait.css');
const html = read('index.html');
const ui = read('js/ui.js');

expect(/@media \(max-width:699px\) and \(orientation:portrait\)/, css,
  'Up control styling must remain isolated to phone portrait.');
expect(/#center-area\.panel-toggle-up \.mobile-panels-toggle\{[\s\S]*?position:fixed;[\s\S]*?top:max\(12px,var\(--phone-portrait-safe-top\)\);[\s\S]*?z-index:30;/, css,
  'Up state must keep the control reachable while the Game Area is off-screen and respect the top safe area.');
expect(/#center-area\.panel-toggle-up \.mobile-panels-toggle::before\{[\s\S]*?content:"↑ Game";/, css,
  'Up state must expose a discoverable Game return label.');
expect(/\.mobile-panels-toggle\{[\s\S]*?width:clamp\(168px,52vw,240px\);[\s\S]*?min-height:52px;/, css,
  'Up control must retain the practical finger target used by the paired Down control.');
expect(/\.mobile-panels-toggle:focus-visible\{[\s\S]*?outline:/, css,
  'Up control must retain visible keyboard focus.');
expect(/id="mobilePanelsToggle"[^>]*class="mobile-panels-toggle"/, html,
  'The two-way control must remain a native button rather than a non-semantic visual element.');
expect(/const shouldScrollUp = isCompactPortraitLayout\(\) && window\.scrollY > 24;/, ui,
  'The existing handler must select upward navigation only after the phone portrait surface has moved down.');
expect(/window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/, ui,
  'Up activation must return predictably to the Game Area start.');
expect(/centerArea\.classList\.toggle\("panel-toggle-up", shouldPointUp\)/, ui,
  'Scroll state must drive the reachable Up presentation.');
expect(/window\.addEventListener\("scroll", updateMobilePanelsToggle, \{ passive: true \}\)/, ui,
  'Up presentation must stay synchronized with phone portrait scrolling.');
reject(/State\.world\s*=|State\.world\.[A-Za-z0-9_$]+\s*=/g, css,
  'Presentation CSS must not mutate authoritative game state.');

console.log('WP-109/I05 phone portrait Up control regression: PASS');
