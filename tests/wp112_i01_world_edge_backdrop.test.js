const fs = require('fs');
const assert = require('assert');

const state = fs.readFileSync('js/state.js', 'utf8');
const renderer = fs.readFileSync('js/renderer.js', 'utf8');

assert.match(state, /clearColor:\s*\[90\s*\/\s*255,\s*155\s*\/\s*255,\s*95\s*\/\s*255,\s*1\]/,
  'finite-world viewport backdrop must use the terrain-compatible grass color');
assert.doesNotMatch(state, /clearColor:\s*\[18\s*\/\s*255,\s*25\s*\/\s*255,\s*32\s*\/\s*255,\s*1\]/,
  'opaque dark world-edge clear color must not return');
assert.match(renderer, /gl\.clearColor\(render\.clearColor\[0\],\s*render\.clearColor\[1\],\s*render\.clearColor\[2\],\s*render\.clearColor\[3\]\)/,
  'renderer must clear exposed viewport pixels through the presentation-only backdrop');
assert.match(state, /Deliberately derived\/presentation-only R01 values are excluded:[\s\S]*camera, DOM\/render\/input caches/,
  'render backdrop must remain outside authoritative Simulation state');

console.log('WP-112/I01 world-edge backdrop regression: PASS');
