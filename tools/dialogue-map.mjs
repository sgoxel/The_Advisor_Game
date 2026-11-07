/**
 * Generates a self-contained HTML map of the Advisor dialogue tree.
 *
 *   node --experimental-strip-types tools/dialogue-map.mjs
 *   -> docs/dialogue-map.html
 *
 * The page is generated from the real source modules, so it cannot drift from
 * the shipped dialogue. Pure HTML + CSS (plus a small optional filter), no
 * external assets, no build step required to read it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOPICS } from "../src/dialogue-topics.ts";
import { SENTENCE_LIBRARY } from "../src/sentence-library.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = `${here}/../docs/dialogue-map.html`;

const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Groups condition keys into families so badges are colour-coded. */
const CONDITION_FAMILY = {
  mood: "mood", time: "time", role: "role", place: "place",
  indoors: "state", travelling: "state", ageGroup: "state", guardShift: "state",
  sociability: "personality", temper: "personality",
  diligence: "personality", piety: "personality", curiosity: "personality",
};

const TOPIC_QUESTIONS = new Map(TOPICS.map((topic) => [topic.id, topic.asks.length]));
const INBOUND = new Map();
for (const topic of TOPICS) {
  for (const next of topic.followUps) {
    if (!INBOUND.has(next)) INBOUND.set(next, []);
    INBOUND.get(next).push(topic.id);
  }
}

const metaEntries = SENTENCE_LIBRARY.filter(
  (entry) => entry.intent !== "query.topic" && !entry.intent.startsWith("followup."),
);
const followUpEntries = SENTENCE_LIBRARY.filter((entry) => entry.intent.startsWith("followup."));
const totalQuestions = TOPICS.reduce((sum, topic) => sum + topic.asks.length, 0);
const totalVariants = TOPICS.reduce((sum, topic) => sum + topic.variants.length, 0);
const totalCauses = TOPICS.reduce((sum, topic) => sum + topic.variants.filter((v) => v.cause).length, 0);

function conditionBadges(when) {
  if (!when) return `<span class="badge badge-default" title="Matches when no earlier variant did">fallback</span>`;
  return Object.entries(when)
    .map(([key, value]) => {
      const family = CONDITION_FAMILY[key] ?? "other";
      return `<span class="badge badge-${family}" data-cond="${esc(key)}"><b>${esc(key)}</b> = ${esc(String(value))}</span>`;
    })
    .join(" ");
}

function variantCard(variant, index, topicId) {
  const tags = (variant.tags ?? []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join(" ");
  const cause = variant.cause
    ? `<div class="cause"><span class="cause-label">if asked “why?”</span><p>${esc(variant.cause)}</p></div>`
    : `<div class="cause cause-none"><span class="cause-label">no cause</span><p>“why?” gets no specific explanation for this variant</p></div>`;
  return `
      <article class="variant" id="${esc(topicId)}-v${index}" data-search="${esc(`${variant.text} ${variant.cause ?? ""} ${(variant.tags ?? []).join(" ")}`).toLowerCase()}">
        <header class="variant-head">
          <span class="variant-index">#${index + 1}</span>
          <span class="conditions">${conditionBadges(variant.when)}</span>
          ${tags ? `<span class="tags">${tags}</span>` : ""}
        </header>
        <p class="answer">${esc(variant.text)}</p>
        ${cause}
      </article>`;
}

function topicCard(topic) {
  const questions = topic.asks
    .map((ask) => `<li class="question" data-search="${esc(ask).toLowerCase()}">${esc(ask)}</li>`)
    .join("");
  const followUps = topic.followUps
    .map((next) => `<a class="arrow-link" href="#topic-${esc(next)}"><span class="arrow">→</span>${esc(next)}<small>${TOPIC_QUESTIONS.get(next) ?? 0} questions</small></a>`)
    .join("");
  const inbound = (INBOUND.get(topic.id) ?? [])
    .map((from) => `<a class="arrow-link arrow-in" href="#topic-${esc(from)}"><span class="arrow">←</span>${esc(from)}</a>`)
    .join("");
  const variants = topic.variants.map((variant, index) => variantCard(variant, index, topic.id)).join("");

  return `
    <section class="topic" id="topic-${esc(topic.id)}" data-search="${esc(`${topic.id} ${topic.asks.join(" ")} ${topic.variants.map((v) => v.text).join(" ")}`).toLowerCase()}">
      <header class="topic-head">
        <div class="topic-title">
          <h2>${esc(topic.id)}</h2>
          <div class="topic-meta">
            <span class="pill">${topic.asks.length} questions</span>
            <span class="pill">${topic.variants.length} answer variants</span>
            <span class="pill">${topic.variants.filter((v) => v.cause).length} with “why”</span>
          </div>
        </div>
        <a class="top-link" href="#index">↑ index</a>
      </header>

      <div class="topic-body">
        <div class="topic-col topic-questions">
          <h3>Questions that reach it</h3>
          <ul class="question-list">${questions}</ul>
        </div>

        <div class="topic-col topic-answers">
          <h3>Answers, in match order <small>first matching condition wins</small></h3>
          ${variants}
        </div>

        <div class="topic-col topic-links">
          <h3>Continues to</h3>
          <div class="link-list">${followUps || `<span class="muted">no follow-ups</span>`}</div>
          <h3>Reached from</h3>
          <div class="link-list">${inbound || `<span class="muted">a starting question</span>`}</div>
        </div>
      </div>
    </section>`;
}

const indexRows = TOPICS.map((topic) => {
  const inbound = (INBOUND.get(topic.id) ?? []).join(", ");
  return `
      <tr>
        <td><a href="#topic-${esc(topic.id)}">${esc(topic.id)}</a></td>
        <td class="num">${topic.asks.length}</td>
        <td class="num">${topic.variants.length}</td>
        <td class="num">${topic.variants.filter((v) => v.cause).length}</td>
        <td class="links">${topic.followUps.map((n) => `<a href="#topic-${esc(n)}">${esc(n)}</a>`).join(" ")}</td>
        <td class="links muted">${esc(inbound)}</td>
      </tr>`;
}).join("");

const metaRows = metaEntries
  .map(
    (entry) => `
      <tr>
        <td><code>${esc(entry.id)}</code></td>
        <td><span class="intent">${esc(entry.intent)}</span></td>
        <td>“${esc(entry.match)}”</td>
        <td class="num">${entry.priority}</td>
      </tr>`,
  )
  .join("");

const followRows = followUpEntries
  .map(
    (entry) => `
      <tr>
        <td><code>${esc(entry.id)}</code></td>
        <td><span class="intent">${esc(entry.intent)}</span></td>
        <td>“${esc(entry.match)}”</td>
      </tr>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<!-- Generated by: npm run dialogue-map  (tools/dialogue-map.mjs) — do not edit by hand -->
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Advisor dialogue map — ${TOPICS.length} topics, ${totalQuestions} questions</title>
<style>
:root {
  --bg: #0f1713;
  --panel: #16211b;
  --panel-2: #1b281f;
  --line: #2b3a30;
  --ink: #e9e5d6;
  --ink-dim: #a8b8a6;
  --ink-faint: #7d8f7f;
  --gold: #d9b874;
  --green: #8fae7f;
  --rose: #c98a6a;
  --blue: #8fa6c9;
  --violet: #a99ac9;
  --teal: #7fbfb0;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--gold); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: var(--mono); }

header.page {
  padding: 34px 30px 26px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #16211b 0%, var(--bg) 100%);
}
header.page h1 { margin: 0 0 6px; font-size: 27px; font-weight: 650; letter-spacing: .01em; }
header.page .sub { color: var(--ink-dim); font-size: 13px; }
.stats { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
.stat {
  background: var(--panel); border: 1px solid var(--line); border-radius: 7px;
  padding: 9px 14px; min-width: 96px;
}
.stat b { display: block; font-size: 20px; color: var(--gold); font-family: var(--mono); }
.stat span { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint); }

.legend {
  display: flex; flex-wrap: wrap; gap: 7px; margin-top: 18px;
  padding-top: 16px; border-top: 1px solid var(--line);
}
.legend-title { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-faint); align-self: center; margin-right: 4px; }

.toolbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  padding: 11px 30px; background: #0f1713f2; backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.toolbar input[type=search] {
  flex: 1 1 320px; min-width: 200px; padding: 9px 12px;
  background: var(--panel); color: var(--ink);
  border: 1px solid var(--line); border-radius: 6px; font-size: 13px;
}
.toolbar input[type=search]:focus { outline: 2px solid var(--gold); outline-offset: 1px; }
.toolbar .count { font-size: 11px; color: var(--ink-faint); font-family: var(--mono); }

main { padding: 26px 30px 90px; max-width: 1500px; margin: 0 auto; }

/* ---------- badges ---------- */
.badge {
  display: inline-block; font-size: 10.5px; letter-spacing: .02em;
  padding: 2px 7px; border-radius: 4px; border: 1px solid; font-family: var(--mono);
  white-space: nowrap;
}
.badge b { font-weight: 700; }
.badge-mood { color: #e0c08f; border-color: #d9b87455; background: #d9b87414; }
.badge-time { color: var(--blue); border-color: #8fa6c955; background: #8fa6c914; }
.badge-role { color: var(--green); border-color: #8fae7f55; background: #8fae7f14; }
.badge-place { color: var(--teal); border-color: #7fbfb055; background: #7fbfb014; }
.badge-state { color: var(--violet); border-color: #a99ac955; background: #a99ac914; }
.badge-personality { color: var(--rose); border-color: #c98a6a55; background: #c98a6a14; }
.badge-default { color: var(--ink-faint); border-color: var(--line); background: #ffffff08; }
.tag {
  font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-faint); border: 1px dashed var(--line); border-radius: 4px; padding: 1px 6px;
}

/* ---------- index ---------- */
section.index { margin-bottom: 46px; }
section.index h2 { font-size: 18px; margin: 0 0 4px; }
section.index .hint { color: var(--ink-faint); font-size: 12px; margin: 0 0 14px; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
thead th {
  text-align: left; font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint); font-weight: 600; padding: 7px 9px; border-bottom: 1px solid var(--line);
  position: sticky; top: 47px; background: var(--bg); z-index: 5;
}
tbody td { padding: 7px 9px; border-bottom: 1px solid #1f2b24; vertical-align: top; }
tbody tr:hover { background: #16211b; }
tbody td.num { text-align: right; font-family: var(--mono); color: var(--ink-dim); }
tbody td.links a { margin-right: 7px; font-size: 11.5px; }
.muted { color: var(--ink-faint); }

/* ---------- topic cards ---------- */
.topic {
  margin-bottom: 34px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--panel); overflow: hidden;
}
.topic:target { border-color: var(--gold); box-shadow: 0 0 0 2px #d9b87433; }
.topic-head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 14px;
  padding: 15px 18px; background: var(--panel-2); border-bottom: 1px solid var(--line);
}
.topic-head h2 { margin: 0; font-size: 17px; font-family: var(--mono); color: var(--gold); }
.topic-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.pill {
  font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-dim); border: 1px solid var(--line); border-radius: 20px; padding: 2px 9px;
}
.top-link { font-size: 11px; color: var(--ink-faint); white-space: nowrap; }

.topic-body {
  display: grid;
  grid-template-columns: minmax(190px, 0.9fr) minmax(360px, 2.4fr) minmax(170px, 0.8fr);
  gap: 0;
}
.topic-col { padding: 16px 18px; border-right: 1px solid var(--line); }
.topic-col:last-child { border-right: 0; }
.topic-col h3 {
  margin: 0 0 10px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-faint); font-weight: 600;
}
.topic-col h3 small { text-transform: none; letter-spacing: 0; color: #667a68; font-weight: 400; }

.question-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.question {
  font-size: 12px; color: var(--ink-dim); padding: 5px 9px;
  background: #0f1713; border: 1px solid #223028; border-radius: 5px;
}
.question::before { content: "› "; color: var(--gold); }

/* ---------- variants ---------- */
.variant {
  border: 1px solid #223028; border-radius: 7px; padding: 11px 13px; margin-bottom: 10px;
  background: var(--panel-2);
}
.variant:last-child { margin-bottom: 0; }
.variant-head { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 8px; }
.variant-index {
  font-family: var(--mono); font-size: 10px; color: var(--ink-faint);
  border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px;
}
.conditions { display: flex; flex-wrap: wrap; gap: 5px; }
.tags { display: flex; flex-wrap: wrap; gap: 5px; margin-left: auto; }
.answer { margin: 0; font-size: 13.5px; color: var(--ink); }
.cause {
  margin-top: 9px; padding: 8px 11px; border-left: 2px solid var(--gold);
  background: #d9b8740d; border-radius: 0 5px 5px 0;
}
.cause p { margin: 2px 0 0; font-size: 12.5px; color: #e6dfc8; font-style: italic; }
.cause-label {
  font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--gold);
}
.cause-none { border-left-color: var(--line); background: #ffffff05; }
.cause-none .cause-label { color: var(--ink-faint); }
.cause-none p { color: var(--ink-faint); font-style: normal; font-size: 11.5px; }

/* ---------- links ---------- */
.link-list { display: flex; flex-direction: column; gap: 5px; margin-bottom: 16px; }
.arrow-link {
  display: flex; align-items: baseline; gap: 6px; font-size: 12px; font-family: var(--mono);
  padding: 4px 8px; border: 1px solid #223028; border-radius: 5px; background: #0f1713;
}
.arrow-link .arrow { color: var(--gold); font-size: 13px; }
.arrow-link small { color: var(--ink-faint); font-size: 10px; margin-left: auto; }
.arrow-in .arrow { color: var(--blue); }

/* ---------- meta tables ---------- */
section.meta-block { margin-bottom: 40px; }
section.meta-block h2 { font-size: 17px; margin: 0 0 4px; }
section.meta-block .hint { color: var(--ink-faint); font-size: 12px; margin: 0 0 14px; }
.intent { font-family: var(--mono); font-size: 11px; color: var(--teal); }

.chain-note {
  margin: 0 0 26px; padding: 14px 17px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--panel); font-size: 12.5px; color: var(--ink-dim);
}
.chain-note b { color: var(--ink); }
.chain-note code { color: var(--gold); background: #0f1713; padding: 1px 5px; border-radius: 3px; }

/* hidden by the filter */
.hidden-by-filter { display: none !important; }

@media (max-width: 1080px) {
  .topic-body { grid-template-columns: 1fr; }
  .topic-col { border-right: 0; border-bottom: 1px solid var(--line); }
  .topic-col:last-child { border-bottom: 0; }
  main { padding: 20px 16px 70px; }
  header.page, .toolbar { padding-left: 16px; padding-right: 16px; }
  thead th { position: static; }
}
@media print {
  .toolbar { display: none; }
  body { background: #fff; color: #111; }
  .topic, .variant, .stat { break-inside: avoid; }
}
</style>
</head>
<body>

<header class="page">
  <h1>Advisor dialogue map</h1>
  <p class="sub">
    Every question, every answer variant and every condition, generated from
    <code>src/dialogue-topics.ts</code> and <code>src/sentence-library.ts</code>.
    Conditions read top-to-bottom: the <b>first matching variant wins</b>.
  </p>
  <div class="stats">
    <div class="stat"><b>${TOPICS.length}</b><span>topics</span></div>
    <div class="stat"><b>${totalQuestions}</b><span>questions</span></div>
    <div class="stat"><b>${totalVariants}</b><span>answer variants</span></div>
    <div class="stat"><b>${totalCauses}</b><span>“why?” causes</span></div>
    <div class="stat"><b>${SENTENCE_LIBRARY.length}</b><span>library entries</span></div>
    <div class="stat"><b>${followUpEntries.length}</b><span>follow-up intents</span></div>
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
</header>

<div class="toolbar">
  <input type="search" id="filter" placeholder="Filter topics, questions, answers and causes…" aria-label="Filter dialogue" />
  <span class="count" id="count">${TOPICS.length} topics</span>
</div>

<main>

  <p class="chain-note">
    <b>How a chain continues.</b> Each answer can carry a cause. Asking <code>why</code> replies with
    the cause of the answer you <em>just heard</em>, and <code>tell me more</code> follows the topic’s
    first “Continues to” link. The <b>Ask next</b> chips in the game are exactly those two routes.
  </p>

  <section class="index" id="index">
    <h2>Topic index</h2>
    <p class="hint">Follow-up arrows form the conversation graph; “reached from” shows which topics can lead here.</p>
    <table>
      <thead>
        <tr>
          <th>Topic</th><th>Questions</th><th>Variants</th><th>“Why”</th>
          <th>Continues to</th><th>Reached from</th>
        </tr>
      </thead>
      <tbody>${indexRows}</tbody>
    </table>
  </section>

  <h2 style="font-size:18px;margin:0 0 16px">Every topic, question and answer</h2>
  ${TOPICS.map(topicCard).join("\n")}

  <section class="meta-block">
    <h2>Direct questions and advice (not part of the topic tree)</h2>
    <p class="hint">These match by intent and are answered from live Simulation facts, or declined in character.</p>
    <table>
      <thead><tr><th>Entry</th><th>Intent</th><th>Matches</th><th>Priority</th></tr></thead>
      <tbody>${metaRows}</tbody>
    </table>
  </section>

  <section class="meta-block">
    <h2>Follow-up intents (what a chain can say)</h2>
    <p class="hint">These only mean something after a previous answer; without one they answer honestly that nothing has been asked.</p>
    <table>
      <thead><tr><th>Entry</th><th>Intent</th><th>Matches</th></tr></thead>
      <tbody>${followRows}</tbody>
    </table>
  </section>

</main>

<script>
// Optional filter: degrades gracefully when JS is unavailable.
(() => {
  const input = document.getElementById("filter");
  const count = document.getElementById("count");
  const topics = [...document.querySelectorAll(".topic")];
  const variants = [...document.querySelectorAll(".variant")];
  const questions = [...document.querySelectorAll(".question")];
  const total = topics.length;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        topics.forEach((t) => t.classList.remove("hidden-by-filter"));
        variants.forEach((v) => v.classList.remove("hidden-by-filter"));
        questions.forEach((e) => e.classList.remove("hidden-by-filter"));
        count.textContent = total + " topics";
        return;
      }
      let visible = 0;
      for (const topic of topics) {
        const topicMatch = (topic.dataset.search || "").includes(q);
        let any = topicMatch;
        for (const variant of topic.querySelectorAll(".variant")) {
          const hit = topicMatch || (variant.dataset.search || "").includes(q);
          variant.classList.toggle("hidden-by-filter", !hit);
          any = any || hit;
        }
        for (const question of topic.querySelectorAll(".question")) {
          const hit = topicMatch || (question.dataset.search || "").includes(q);
          question.classList.toggle("hidden-by-filter", !hit);
          any = any || hit;
        }
        topic.classList.toggle("hidden-by-filter", !any);
        if (any) visible++;
      }
      count.textContent = visible + " of " + total + " topics";
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
console.log(`topics ${TOPICS.length} · questions ${totalQuestions} · variants ${totalVariants} · causes ${totalCauses} · library ${SENTENCE_LIBRARY.length}`);
