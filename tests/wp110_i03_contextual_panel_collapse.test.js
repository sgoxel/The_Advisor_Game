const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const desktop = css.match(/@media\(min-width:961px\)\{([\s\S]*)\}$/);
expect(desktop, 'Desktop contextual-panel rule must exist.');
const rule = desktop[1];
expect(rule.includes('grid-template-rows:48px minmax(0,1fr) 36px clamp(120px,17vh,136px)'), 'Desktop must reserve a compact tab row and bounded active-panel row.');
expect(rule.includes('.mobile-panel-tabs{display:grid'), 'Panel switcher must be available on desktop.');
expect(rule.includes('.bottom-ribbon .panel{display:none'), 'Inactive desktop panels must leave the panel viewport.');
expect(rule.includes('.bottom-ribbon .panel.active-panel{display:grid'), 'Only the selected contextual panel must be rendered in the panel viewport.');
expect(rule.includes('.mobile-tab-btn:focus-visible'), 'Panel switching must expose keyboard focus feedback.');
expect(html.includes('data-panel-target="character-panel"') && html.includes('data-panel-target="dialog-panel"') && html.includes('data-panel-target="minimap-panel"'), 'Existing semantic panel controls must remain available.');
expect(html.includes('data-panel-name="character-panel"') && html.includes('data-panel-name="dialog-panel"') && html.includes('data-panel-name="minimap-panel"'), 'Existing panel DOM/state containers must remain mounted.');

for (const height of [720, 768, 900, 1080]) {
  const activePanel = Math.max(120, Math.min(height * 0.17, 136));
  const game = height - 48 - 36 - activePanel;
  const legacyGame = height - 48 - Math.max(156, Math.min(height * 0.21, 172));
  expect(game > legacyGame, `Desktop ${height}px must gain usable game height after contextual collapse.`);
}

console.log('WP-110/I03 contextual panel collapse contract: PASS');
