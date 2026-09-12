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
  'Down control styling must remain isolated to phone portrait.');
expect(/\.mobile-panels-toggle\{[\s\S]*?width:clamp\(168px,52vw,240px\);[\s\S]*?min-height:52px;/, css,
  'Down control must have a large practical finger target.');
expect(/\.mobile-panels-toggle::before\{[\s\S]*?content:"↓ Controls";/, css,
  'Down control must have a discoverable visual label.');
expect(/\.mobile-panels-toggle:focus-visible\{[\s\S]*?outline:/, css,
  'Down control must expose visible keyboard focus.');
expect(/id="mobilePanelsToggle"[^>]*class="mobile-panels-toggle"/, html,
  'Existing semantic button must remain mounted in the Game Area.');
expect(/mobilePanelsToggle\.addEventListener\("click", handleMobilePanelsToggle\)/, ui,
  'Down control must retain native button click activation.');
expect(/tabs\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/, ui,
  'Down activation must scroll predictably to the Control Panel start.');
expect(/window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/, ui,
  'Existing reverse behavior must remain intact for the separate I05 follow-up without state recreation.');
reject(/State\.world\s*=|State\.world\.[A-Za-z0-9_$]+\s*=/g, css,
  'CSS must not mutate game state.');

console.log('WP-109/I04 phone portrait Down control regression: PASS');
