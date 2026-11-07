/**
 * Generates docs/dialogue-map.html — a REAL drawn node-link diagram of the
 * Advisor conversation, plus the full condition detail beneath it.
 *
 *   npm run dialogue-map
 *
 * The graph is laid out at generation time with a deterministic force
 * simulation (no runtime physics, no external libraries), then emitted as
 * inline SVG. Nodes are boxes; follow-ups are curved arrows. Clicking a node
 * jumps to that topic's full question/answer/condition card.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOPICS } from "../src/dialogue-topics.ts";
import { SENTENCE_LIBRARY } from "../src/sentence-library.ts";
import { FOLLOWUPS } from "../src/dialogue-followups.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = `${here}/../public/dialogue-map.html`;

const esc = (v) =>
  String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/* ------------------------------------------------------------------ */
/* Deterministic layout                                                */
/* ------------------------------------------------------------------ */

/** Small deterministic PRNG so the picture is identical on every generation. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 1900;
const HEIGHT = 1450;
const NODE_W = 132;
const NODE_H = 46;

const ids = TOPICS.map((t) => t.id);
const indexOf = new Map(ids.map((id, i) => [id, i]));

const edges = [];
for (const topic of TOPICS) {
  for (const next of topic.followUps) {
    const from = indexOf.get(topic.id);
    const to = indexOf.get(next);
    if (from !== undefined && to !== undefined && from !== to) edges.push({ from, to });
  }
}

// Initial placement: circle (stable starting condition), then relax.
const rand = mulberry32(20261107);
const nodes = ids.map((id, i) => {
  const angle = (i / ids.length) * Math.PI * 2;
  const radius = Math.min(WIDTH, HEIGHT) * 0.34;
  return {
    id,
    x: WIDTH / 2 + Math.cos(angle) * radius + (rand() - 0.5) * 40,
    y: HEIGHT / 2 + Math.sin(angle) * radius + (rand() - 0.5) * 40,
    degree: 0,
  };
});
for (const edge of edges) {
  nodes[edge.from].degree += 1;
  nodes[edge.to].degree += 1;
}

const degree = (i) => Math.max(1, nodes[i].degree);
const K = 150;           // ideal edge length
const ITERATIONS = 620;

for (let step = 0; step < ITERATIONS; step++) {
  const cooling = 1 - step / ITERATIONS;

  // Repulsion between all pairs.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      let dx = nodes[i].x - nodes[j].x;
      let dy = nodes[i].y - nodes[j].y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const minDist = 190;
      if (dist < minDist) dist = minDist;
      const force = (K * K) / dist;
      dx /= dist;
      dy /= dist;
      nodes[i].x += dx * force * 0.06 * cooling;
      nodes[i].y += dy * force * 0.06 * cooling;
      nodes[j].x -= dx * force * 0.06 * cooling;
      nodes[j].y -= dy * force * 0.06 * cooling;
    }
  }

  // Attraction along edges.
  for (const edge of edges) {
    const a = nodes[edge.from];
    const b = nodes[edge.to];
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const force = (dist * dist) / K;
    dx /= dist;
    dy /= dist;
    const pull = force * 0.012 * cooling;
    a.x -= dx * pull;
    a.y -= dy * pull;
    b.x += dx * pull;
    b.y += dy * pull;
  }

  // Gentle pull to centre keeps the drawing compact.
  for (const node of nodes) {
    node.x += (WIDTH / 2 - node.x) * 0.002 * cooling;
    node.y += (HEIGHT / 2 - node.y) * 0.002 * cooling;
  }

  // Keep inside the canvas with a margin for the box itself.
  const padX = NODE_W / 2 + 18;
  const padY = NODE_H / 2 + 18;
  for (const node of nodes) {
    node.x = Math.max(padX, Math.min(WIDTH - padX, node.x));
    node.y = Math.max(padY, Math.min(HEIGHT - padY, node.y));
  }
}

// Final overlap separation pass so no two boxes touch.
for (let pass = 0; pass < 90; pass++) {
  let moved = false;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const needX = NODE_W + 22;
      const needY = NODE_H + 16;
      if (Math.abs(dx) < needX && Math.abs(dy) < needY) {
        moved = true;
        const pushX = (needX - Math.abs(dx)) / 2 * (dx < 0 ? -1 : 1);
        const pushY = (needY - Math.abs(dy)) / 2 * (dy < 0 ? -1 : 1);
        if (Math.abs(pushX) < Math.abs(pushY)) {
          nodes[i].x -= pushX; nodes[j].x += pushX;
        } else {
          nodes[i].y -= pushY; nodes[j].y += pushY;
        }
      }
    }
  }
  const padX = NODE_W / 2 + 14;
  const padY = NODE_H / 2 + 14;
  for (const node of nodes) {
    node.x = Math.max(padX, Math.min(WIDTH - padX, node.x));
    node.y = Math.max(padY, Math.min(HEIGHT - padY, node.y));
  }
  if (!moved) break;
}

/**
 * Draws an edge that leaves and enters the box borders, curving so parallel
 * edges stay distinguishable.
 */
function edgePath(from, to, bow) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  // Exit/entry offsets to the box border.
  const exitX = from.x + ux * (NODE_W / 2);
  const exitY = from.y + uy * (NODE_H / 2);
  const entryX = to.x - ux * (NODE_W / 2);
  const entryY = to.y - uy * (NODE_H / 2);

  const midX = (exitX + entryX) / 2 - uy * bow;
  const midY = (exitY + entryY) / 2 + ux * bow;
  return `M ${exitX.toFixed(1)} ${exitY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${entryX.toFixed(1)} ${entryY.toFixed(1)}`;
}

const pairCount = new Map();
for (const edge of edges) {
  const key = `${edge.from}-${edge.to}`;
  pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
}

const edgeMarkup = edges
  .map((edge) => {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const reverse = edges.some((other) => other.from === edge.to && other.to === edge.from);
    const bow = reverse ? 26 : 12;
    const d = edgePath(from, to, bow);
    return `<path class="edge${reverse ? " edge-pair" : ""}" d="${d}" marker-end="url(#arrow)" />`;
  })
  .join("\n      ");

const nodeMarkup = nodes
  .map((node) => {
    const topic = TOPICS[indexOf.get(node.id)];
    const x = node.x - NODE_W / 2;
    const y = node.y - NODE_H / 2;
    const weight = topic.variants.length;
    const hot = topic.asks.length >= 8;
    return `      <a href="#topic-${esc(node.id)}" class="node-link">
        <g class="node${hot ? " node-hub" : ""}" data-topic="${esc(node.id)}">
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="7" />
          <text class="node-name" x="${(node.x).toFixed(1)}" y="${(node.y - 3).toFixed(1)}" text-anchor="middle">${esc(node.id)}</text>
          <text class="node-meta" x="${(node.x).toFixed(1)}" y="${(node.y + 13).toFixed(1)}" text-anchor="middle">${topic.asks.length} q · ${weight} a</text>
        </g>
      </a>`;
  })
  .join("\n");

/* ------------------------------------------------------------------ */
/* Detail markup (all conditions, as before)                           */
/* ------------------------------------------------------------------ */

const CONDITION_FAMILY = {
  mood: "mood", time: "time", role: "role", place: "place",
  indoors: "state", travelling: "state", ageGroup: "state", guardShift: "state",
  sociability: "personality", temper: "personality",
  diligence: "personality", piety: "personality", curiosity: "personality",
};

const TOPIC_QUESTIONS = new Map(TOPICS.map((t) => [t.id, t.asks.length]));
const INBOUND = new Map();
for (const topic of TOPICS) {
  for (const next of topic.followUps) {
    if (!INBOUND.has(next)) INBOUND.set(next, []);
    INBOUND.get(next).push(topic.id);
  }
}

const metaEntries = SENTENCE_LIBRARY.filter((e) => e.intent !== "query.topic" && !String(e.intent).startsWith("followup."));
const followUpEntries = SENTENCE_LIBRARY.filter((e) => String(e.intent).startsWith("followup."));
const totalQuestions = TOPICS.reduce((n, t) => n + t.asks.length, 0);
const totalVariants = TOPICS.reduce((n, t) => n + t.variants.length, 0);
const totalCauses = TOPICS.reduce((n, t) => n + t.variants.filter((v) => v.cause).length, 0);
const totalFollowupAsks = FOLLOWUPS.reduce((n, f) => n + f.asks.length, 0);

function badges(when) {
  if (!when) return `<span class="badge badge-default">fallback</span>`;
  return Object.entries(when)
    .map(([key, value]) => `<span class="badge badge-${CONDITION_FAMILY[key] ?? "other"}" data-cond="${esc(key)}"><b>${esc(key)}</b> = ${esc(String(value))}</span>`)
    .join(" ");
}

function variantCard(variant, index, topicId) {
  const tags = (variant.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join(" ");
  const cause = variant.cause
    ? `<div class="cause"><span class="cause-label">if you ask “why so?”</span><p>${esc(variant.cause)}</p></div>`
    : `<div class="cause cause-none"><span class="cause-label">no specific cause</span><p>“why?” falls back to a general reason for this variant</p></div>`;
  return `
        <article class="variant" data-search="${esc(`${variant.text} ${variant.cause ?? ""} ${(variant.tags ?? []).join(" ")}`).toLowerCase()}">
          <header class="variant-head">
            <span class="variant-index">#${index + 1}</span>
            <span class="conditions">${badges(variant.when)}</span>
            ${tags ? `<span class="tags">${tags}</span>` : ""}
          </header>
          <p class="answer">${esc(variant.text)}</p>
          ${cause}
        </article>`;
}

function topicCard(topic) {
  const questions = topic.asks.map((a) => `<li class="question" data-search="${esc(a).toLowerCase()}">${esc(a)}</li>`).join("");
  const followUps = topic.followUps
    .map((n) => `<a class="arrow-link" href="#topic-${esc(n)}"><span class="arrow">→</span>${esc(n)}<small>${TOPIC_QUESTIONS.get(n) ?? 0} q</small></a>`)
    .join("");
  const inbound = (INBOUND.get(topic.id) ?? [])
    .map((f) => `<a class="arrow-link arrow-in" href="#topic-${esc(f)}"><span class="arrow">←</span>${esc(f)}</a>`)
    .join("");
  return `
    <section class="topic" id="topic-${esc(topic.id)}" data-search="${esc(`${topic.id} ${topic.asks.join(" ")} ${topic.variants.map((v) => v.text).join(" ")}`).toLowerCase()}">
      <header class="topic-head">
        <div>
          <h2>${esc(topic.id)}</h2>
          <div class="topic-meta">
            <span class="pill">${topic.asks.length} questions</span>
            <span class="pill">${topic.variants.length} answers</span>
            <span class="pill">${topic.variants.filter((v) => v.cause).length} with cause</span>
          </div>
        </div>
        <a class="top-link" href="#graph">↑ graph</a>
      </header>
      <div class="topic-body">
        <div class="topic-col"><h3>Questions that reach it</h3><ul class="question-list">${questions}</ul></div>
        <div class="topic-col"><h3>Answers, match order <small>first match wins</small></h3>${topic.variants.map((v, i) => variantCard(v, i, topic.id)).join("")}</div>
        <div class="topic-col"><h3>Continues to</h3><div class="link-list">${followUps || `<span class="muted">—</span>`}</div>
          <h3>Reached from</h3><div class="link-list">${inbound || `<span class="muted">starting question</span>`}</div></div>
      </div>
    </section>`;
}

const followupTable = FOLLOWUPS.map(
  (f) => `
      <tr>
        <td><code>${esc(f.id)}</code></td>
        <td class="asks">${f.asks.map((a) => `<span class="ask">${esc(a)}</span>`).join(" ")}</td>
        <td class="num">${f.variants.length}</td>
        <td class="num">${f.variants.filter((v) => v.cause).length}</td>
      </tr>`,
).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!-- Generated by: npm run dialogue-map  (tools/dialogue-map.mjs) — do not edit by hand -->
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Advisor dialogue graph — ${TOPICS.length} topics, ${totalQuestions} questions</title>
<style>
:root {
  --bg:#0e1612; --panel:#16211b; --panel2:#1b281f; --line:#2b3a30;
  --ink:#e9e5d6; --dim:#a8b8a6; --faint:#7d8f7f; --gold:#d9b874;
  --green:#8fae7f; --rose:#c98a6a; --blue:#8fa6c9; --violet:#a99ac9; --teal:#7fbfb0;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--gold);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono)}

header.page{padding:30px 28px 20px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#16211b,var(--bg))}
header.page h1{margin:0 0 5px;font-size:26px;font-weight:650}
header.page .sub{color:var(--dim);font-size:13px;margin:0}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:8px 13px;min-width:92px}
.stat b{display:block;font-size:19px;color:var(--gold);font-family:var(--mono)}
.stat span{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}

/* ---------- graph ---------- */
section.graph{padding:20px 28px 6px}
.graph-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.graph-bar h2{font-size:17px;margin:0;flex:1 1 auto}
.graph-bar .hint{font-size:11.5px;color:var(--faint);flex:0 0 auto}
.graph-bar button{
  min-height:34px;padding:5px 12px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:6px;cursor:pointer;
}
.graph-bar button:hover{background:var(--panel2)}
.graph-bar button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}

.graph-frame{
  position:relative;border:1px solid var(--line);border-radius:10px;overflow:hidden;
  background:radial-gradient(circle at 50% 45%,#16211b 0%,#0b120e 100%);
  height:min(78vh,900px);
}
.graph-frame.grab{cursor:grabbing}
svg#graph{display:block;width:100%;height:100%;touch-action:none}
svg#graph g.world{transform-origin:0 0}

.edge{fill:none;stroke:#4e6b5a;stroke-width:1.25;opacity:.9}
.edge-pair{stroke:#5f8170;stroke-width:1.6}

g.node rect{
  fill:#1b281f;stroke:#3c5347;stroke-width:1.2;
  transition:fill .12s ease,stroke .12s ease;
}
g.node:hover rect, g.node:focus-within rect{fill:#26382c;stroke:var(--gold)}
g.node-hub rect{stroke:#d9b87477;stroke-width:1.6;fill:#1f2d23}
.node-name{font:600 12.5px var(--mono);fill:#e9e5d6;pointer-events:none}
.node-meta{font:9.5px var(--mono);fill:#8fa394;pointer-events:none}
.node-link{text-decoration:none}
.node-link:focus{outline:none}

.legend{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px;align-items:center}
.legend-title{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-right:3px}

/* ---------- badges ---------- */
.badge{display:inline-block;font-size:10.5px;padding:2px 7px;border-radius:4px;border:1px solid;font-family:var(--mono);white-space:nowrap}
.badge b{font-weight:700}
.badge-mood{color:#e0c08f;border-color:#d9b87455;background:#d9b87414}
.badge-time{color:var(--blue);border-color:#8fa6c955;background:#8fa6c914}
.badge-role{color:var(--green);border-color:#8fae7f55;background:#8fae7f14}
.badge-place{color:var(--teal);border-color:#7fbfb055;background:#7fbfb014}
.badge-state{color:var(--violet);border-color:#a99ac955;background:#a99ac914}
.badge-personality{color:var(--rose);border-color:#c98a6a55;background:#c98a6a14}
.badge-default{color:var(--faint);border-color:var(--line);background:#ffffff08}
.tag{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border:1px dashed var(--line);border-radius:4px;padding:1px 6px}

/* ---------- detail ---------- */
main{padding:22px 28px 90px;max-width:1560px;margin:0 auto}
.toolbar{position:sticky;top:0;z-index:20;display:flex;gap:10px;align-items:center;padding:10px 28px;background:#0e1612f2;backdrop-filter:blur(8px);border-bottom:1px solid var(--line);margin:0 -28px 22px}
.toolbar input{flex:1 1 320px;min-width:180px;padding:9px 12px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;font-size:13px}
.toolbar input:focus{outline:2px solid var(--gold);outline-offset:1px}
.toolbar .count{font-size:11px;color:var(--faint);font-family:var(--mono)}

.chain-note{margin:0 0 22px;padding:13px 16px;border:1px solid var(--line);border-radius:8px;background:var(--panel);font-size:12.5px;color:var(--dim)}
.chain-note b{color:var(--ink)}
.chain-note code{color:var(--gold);background:#0e1612;padding:1px 5px;border-radius:3px}

.topic{margin-bottom:30px;border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden}
.topic:target{border-color:var(--gold);box-shadow:0 0 0 2px #d9b87433}
.topic-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:14px 17px;background:var(--panel2);border-bottom:1px solid var(--line)}
.topic-head h2{margin:0;font-size:16px;font-family:var(--mono);color:var(--gold)}
.topic-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.pill{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);border:1px solid var(--line);border-radius:20px;padding:2px 9px}
.top-link{font-size:11px;color:var(--faint);white-space:nowrap}
.topic-body{display:grid;grid-template-columns:minmax(190px,.9fr) minmax(360px,2.4fr) minmax(170px,.8fr)}
.topic-col{padding:15px 17px;border-right:1px solid var(--line)}
.topic-col:last-child{border-right:0}
.topic-col h3{margin:0 0 9px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.topic-col h3 small{text-transform:none;letter-spacing:0;color:#667a68}
.question-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.question{font-size:12px;color:var(--dim);padding:4px 9px;background:#0e1612;border:1px solid #223028;border-radius:5px}
.question::before{content:"› ";color:var(--gold)}
.variant{border:1px solid #223028;border-radius:7px;padding:10px 12px;margin-bottom:9px;background:var(--panel2)}
.variant:last-child{margin-bottom:0}
.variant-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:7px}
.variant-index{font-family:var(--mono);font-size:10px;color:var(--faint);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.conditions{display:flex;flex-wrap:wrap;gap:5px}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-left:auto}
.answer{margin:0;font-size:13.5px}
.cause{margin-top:8px;padding:7px 10px;border-left:2px solid var(--gold);background:#d9b8740d;border-radius:0 5px 5px 0}
.cause p{margin:2px 0 0;font-size:12.5px;color:#e6dfc8;font-style:italic}
.cause-label{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}
.cause-none{border-left-color:var(--line);background:#ffffff05}
.cause-none .cause-label{color:var(--faint)}
.cause-none p{color:var(--faint);font-style:normal;font-size:11.5px}
.link-list{display:flex;flex-direction:column;gap:4px;margin-bottom:14px}
.arrow-link{display:flex;align-items:baseline;gap:6px;font-size:12px;font-family:var(--mono);padding:3px 8px;border:1px solid #223028;border-radius:5px;background:#0e1612}
.arrow-link .arrow{color:var(--gold);font-size:13px}
.arrow-link small{color:var(--faint);font-size:10px;margin-left:auto}
.arrow-in .arrow{color:var(--blue)}

table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{text-align:left;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:7px 9px;border-bottom:1px solid var(--line)}
tbody td{padding:7px 9px;border-bottom:1px solid #1f2b24;vertical-align:top}
tbody tr:hover{background:var(--panel)}
tbody td.num{text-align:right;font-family:var(--mono);color:var(--dim)}
td.asks .ask{display:inline-block;font-size:11px;color:var(--dim);background:#0e1612;border:1px solid #223028;border-radius:4px;padding:1px 7px;margin:0 4px 4px 0}
.intent{font-family:var(--mono);font-size:11px;color:var(--teal)}
.muted{color:var(--faint)}
section.meta-block{margin-bottom:34px}
section.meta-block h2{font-size:16px;margin:0 0 4px}
section.meta-block .hint{color:var(--faint);font-size:12px;margin:0 0 12px}
.hidden-by-filter{display:none!important}

@media (max-width:1080px){
  .topic-body{grid-template-columns:1fr}
  .topic-col{border-right:0;border-bottom:1px solid var(--line)}
  .topic-col:last-child{border-bottom:0}
  main,section.graph{padding-left:14px;padding-right:14px}
  header.page{padding-left:14px;padding-right:14px}
  .toolbar{margin-left:-14px;margin-right:-14px;padding-left:14px;padding-right:14px}
  .graph-frame{height:62vh}
}
@media print{.toolbar,.graph-bar button{display:none}.graph-frame{height:520px}}
</style>
</head>
<body>

<header class="page">
  <h1>Advisor dialogue graph</h1>
  <p class="sub">Every topic, question, answer and condition, generated from <code>src/dialogue-topics.ts</code>, <code>src/dialogue-followups.ts</code> and <code>src/sentence-library.ts</code>.</p>
  <div class="stats">
    <div class="stat"><b>${TOPICS.length}</b><span>topics</span></div>
    <div class="stat"><b>${totalQuestions}</b><span>questions</span></div>
    <div class="stat"><b>${totalVariants}</b><span>answers</span></div>
    <div class="stat"><b>${totalFollowupAsks}</b><span>follow-up phrasings</span></div>
    <div class="stat"><b>${edges.length}</b><span>arrows</span></div>
    <div class="stat"><b>${totalCauses}</b><span>causes</span></div>
    <div class="stat"><b>${SENTENCE_LIBRARY.length}</b><span>library entries</span></div>
  </div>
</header>

<section class="graph" id="graph">
  <div class="graph-bar">
    <h2>The conversation graph</h2>
    <span class="hint">drag to pan · wheel to zoom · click a box for its answers</span>
    <button id="zoom-in" type="button">+</button>
    <button id="zoom-out" type="button">−</button>
    <button id="zoom-reset" type="button">Reset</button>
  </div>
  <div class="graph-frame" id="graph-frame">
    <svg id="graph" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Dialogue topic graph: ${TOPICS.length} topic boxes connected by follow-up arrows">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#61806d" />
        </marker>
      </defs>
      <g class="world" id="world">
      ${edgeMarkup}
      ${nodeMarkup}
      </g>
    </svg>
  </div>
  <div class="legend">
    <span class="legend-title">Condition types</span>
    <span class="badge badge-mood"><b>mood</b></span>
    <span class="badge badge-time"><b>time</b></span>
    <span class="badge badge-role"><b>role</b></span>
    <span class="badge badge-place"><b>place</b></span>
    <span class="badge badge-state"><b>state</b></span>
    <span class="badge badge-personality"><b>personality</b></span>
    <span class="badge badge-default">fallback</span>
  </div>
</section>

<main>
  <div class="toolbar">
    <input type="search" id="filter" placeholder="Filter topics, questions, answers, causes…" aria-label="Filter dialogue" />
    <span class="count" id="count">${TOPICS.length} topics</span>
  </div>

  <p class="chain-note">
    <b>How a chain continues.</b> After every answer the game offers four varied next questions, drawn from ten
    conversational moves — reason, detail, feelings, help, others, duration, blame, consequence, past, need — and
    never repeats a move you have already used. Asking <code>why so?</code> replies with the cause of the answer you
    <em>just heard</em>; the other moves each have their own state-dependent answers.
  </p>

  <h2 style="font-size:17px;margin:0 0 14px">Every topic, question and answer</h2>
  ${TOPICS.map(topicCard).join("\n")}

  <section class="meta-block">
    <h2>Follow-up moves (${FOLLOWUPS.length} types, ${totalFollowupAsks} phrasings)</h2>
    <p class="hint">Each move answers from the protagonist's current state. The game shows these as the “Ask next” chips.</p>
    <table>
      <thead><tr><th>Move</th><th>How a player can ask</th><th>Answers</th><th>Causes</th></tr></thead>
      <tbody>${followupTable}</tbody>
    </table>
  </section>

  <section class="meta-block">
    <h2>Direct questions and advice (${metaEntries.length})</h2>
    <p class="hint">Answered from live Simulation facts, or declined in character. Advice is never executed by the dialogue layer.</p>
    <table>
      <thead><tr><th>Entry</th><th>Intent</th><th>Matches</th><th>Priority</th></tr></thead>
      <tbody>${metaEntries.map((e) => `<tr><td><code>${esc(e.id)}</code></td><td><span class="intent">${esc(e.intent)}</span></td><td>“${esc(e.match)}”</td><td class="num">${e.priority}</td></tr>`).join("")}</tbody>
    </table>
  </section>
</main>

<script>
(() => {
  const svg = document.getElementById("graph");
  const world = document.getElementById("world");
  const frame = document.getElementById("graph-frame");
  let scale = 1, tx = 0, ty = 0, dragging = false, lastX = 0, lastY = 0;
  const apply = () => { world.setAttribute("transform", \`translate(\${tx} \${ty}) scale(\${scale})\`); };
  const clamp = (v) => Math.max(0.35, Math.min(4, v));

  // Zoom around the pointer so the box under the cursor stays put.
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = frame.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const before = scale;
    scale = clamp(scale * (event.deltaY > 0 ? 0.9 : 1.1));
    const ratio = scale / before;
    tx = px * (1 - ratio) * frame.clientWidth + ratio * tx;
    ty = py * (1 - ratio) * frame.clientHeight + ratio * ty;
    apply();
  }, { passive: false });

  frame.addEventListener("pointerdown", (event) => {
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    frame.classList.add("grab");
    frame.setPointerCapture(event.pointerId);
  });
  frame.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    tx += event.clientX - lastX;
    ty += event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
    apply();
  });
  const endDrag = () => { dragging = false; frame.classList.remove("grab"); };
  frame.addEventListener("pointerup", endDrag);
  frame.addEventListener("pointercancel", endDrag);
  frame.addEventListener("pointerleave", endDrag);

  document.getElementById("zoom-in").onclick = () => { scale = clamp(scale * 1.2); apply(); };
  document.getElementById("zoom-out").onclick = () => { scale = clamp(scale / 1.2); apply(); };
  document.getElementById("zoom-reset").onclick = () => { scale = 1; tx = 0; ty = 0; apply(); };
  apply();

  // Detail filter (degrades gracefully without JS).
  const input = document.getElementById("filter");
  const count = document.getElementById("count");
  const topics = [...document.querySelectorAll(".topic")];
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      for (const topic of topics) {
        const topicHit = !q || (topic.dataset.search || "").includes(q);
        let any = topicHit;
        for (const el of topic.querySelectorAll(".variant, .question")) {
          const hit = topicHit || (el.dataset.search || "").includes(q);
          el.classList.toggle("hidden-by-filter", !hit);
          any = any || hit;
        }
        topic.classList.toggle("hidden-by-filter", !any);
        if (any) visible++;
      }
      count.textContent = q ? visible + " of " + topics.length + " topics" : topics.length + " topics";
    }, 90);
  });
})();
</script>
</body>
</html>
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html, "utf8");
console.log(`wrote ${outFile}`);
console.log(`topics ${TOPICS.length} · questions ${totalQuestions} · answers ${totalVariants} · arrows ${edges.length} · follow-up phrasings ${totalFollowupAsks}`);
