/**
 * The generated dialogue map must stay a real, complete graph and keep the
 * follow-up vocabulary varied. These guards fail the release gate if the page
 * stops drawing arrows, drops a topic, or the chips regress to a single "why".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { TOPICS } from "../src/dialogue-topics.ts";
import { SENTENCE_LIBRARY } from "../src/sentence-library.ts";
import { FOLLOWUPS } from "../src/dialogue-followups.ts";

const pageUrl = new URL("../public/dialogue-map.html", import.meta.url);
const generatorUrl = new URL("../tools/dialogue-map.mjs", import.meta.url);

test("the dialogue map page and its generator exist", () => {
  assert.ok(existsSync(pageUrl), "public/dialogue-map.html is missing (run: npm run dialogue-map)");
  assert.ok(existsSync(generatorUrl), "tools/dialogue-map.mjs is missing");
});

const html = readFileSync(pageUrl, "utf8");

test("the page draws a real node-link diagram, not just text", () => {
  assert.match(html, /<svg id="graph"/, "no SVG graph");
  assert.equal((html.match(/class="node[ "]/g) ?? []).length, TOPICS.length, "node box count drifted");
  const edgeCount = (html.match(/class="edge/g) ?? []).length;
  assert.ok(edgeCount > 60, `expected a dense arrow graph, found ${edgeCount} edges`);
  assert.match(html, /<marker id="arrow"/, "arrows have no arrowhead marker");
  assert.match(html, /<rect [^>]*rx="7"/, "nodes are not drawn as boxes");
  // Pan/zoom affordances exist.
  assert.match(html, /zoom-in/, "no zoom control");
  assert.match(html, /pointerdown/, "no pan interaction");
});

test("the page documents every topic, question and answer variant", () => {
  const totalQuestions = TOPICS.reduce((n, t) => n + t.asks.length, 0);
  const totalVariants = TOPICS.reduce((n, t) => n + t.variants.length, 0);
  assert.equal((html.match(/class="topic"/g) ?? []).length, TOPICS.length, "topic card count drifted");
  assert.equal((html.match(/class="question"/g) ?? []).length, totalQuestions, "question count drifted");
  assert.equal((html.match(/class="variant"/g) ?? []).length, totalVariants, "answer count drifted");
});

test("every answer text and cause appears verbatim", () => {
  const esc = (v) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  for (const topic of TOPICS) {
    for (const variant of topic.variants) {
      assert.ok(html.includes(esc(variant.text)), `missing answer from ${topic.id}`);
      if (variant.cause) assert.ok(html.includes(esc(variant.cause)), `missing cause from ${topic.id}`);
    }
  }
});

test("every condition is shown as a badge", () => {
  for (const topic of TOPICS) {
    for (const variant of topic.variants) {
      if (!variant.when) { assert.ok(html.includes("badge-default")); continue; }
      for (const [key, value] of Object.entries(variant.when)) {
        assert.ok(html.includes(`data-cond="${key}"`), `condition "${key}" from ${topic.id} not shown`);
        assert.ok(html.includes(`= ${value}<`), `condition "${key}=${value}" from ${topic.id} not shown`);
      }
    }
  }
});

test("the follow-up graph is drawn in the page's arrow list too", () => {
  for (const topic of TOPICS) {
    for (const next of topic.followUps) {
      assert.ok(html.includes(`href="#topic-${next}"`), `missing follow-up ${topic.id} -> ${next}`);
    }
  }
});

test("follow-up chips are varied, not a single robotic 'why'", () => {
  // At least eight distinct conversational moves.
  assert.ok(FOLLOWUPS.length >= 8, `expected at least 8 follow-up moves, found ${FOLLOWUPS.length}`);

  // Each move offers several natural phrasings.
  for (const move of FOLLOWUPS) {
    assert.ok(move.asks.length >= 5, `move "${move.id}" has only ${move.asks.length} phrasings`);
  }

  // The phrasings are genuinely different words, not "why" ten times.
  const allAsks = FOLLOWUPS.flatMap((move) => move.asks).map((ask) => ask.toLowerCase());
  assert.ok(new Set(allAsks).size >= 60, `only ${new Set(allAsks).size} distinct follow-up phrasings`);

  // The bare one-word question must not dominate the vocabulary.
  const bareWhy = allAsks.filter((ask) => ask === "why").length;
  assert.equal(bareWhy, 1, "exactly one plain 'why' phrasing is allowed");

  // Each move answers differently depending on state.
  for (const move of FOLLOWUPS) {
    assert.ok(move.variants.length >= 4, `move "${move.id}" has too few state variants`);
    assert.ok(move.variants.some((variant) => variant.cause), `move "${move.id}" has no grounded cause`);
    const last = move.variants[move.variants.length - 1];
    assert.equal(last.when, undefined, `move "${move.id}" needs an unconditional fallback`);
  }
});

test("the page documents every follow-up move and its phrasings", () => {
  for (const move of FOLLOWUPS) {
    assert.ok(html.includes(`<code>${move.id}</code>`), `move "${move.id}" is not in the table`);
    for (const ask of move.asks) {
      assert.ok(html.includes(ask.replaceAll("&", "&amp;")), `phrasing "${ask}" is missing from the page`);
    }
  }
});

test("the page documents meta questions and stays self-contained", () => {
  for (const entry of SENTENCE_LIBRARY) {
    if (entry.intent === "query.topic") continue;
    // Follow-up phrasings are documented through the move table rather than as
    // individual library ids, so check the move ids there.
    if (String(entry.intent).startsWith("followup.")) {
      const move = String(entry.intent).replace("followup.", "");
      assert.ok(html.includes(`<code>${move}</code>`), `follow-up move "${move}" is not documented`);
      continue;
    }
    assert.ok(html.includes(entry.id), `entry "${entry.id}" is not documented`);
  }
  assert.doesNotMatch(html, /<script[^>]+src=/i, "no external scripts allowed");
  assert.match(html, /<style>/, "styles must be inline");
  assert.match(html, /Generated by: npm run dialogue-map/);
  assert.ok(html.length > 100_000, `page looks truncated (${html.length} bytes)`);
});
