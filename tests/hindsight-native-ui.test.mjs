import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("memory UI distinguishes canonical proofs from Hindsight-derived planes", () => {
  assert.match(html, /data-memory-plane="canonical-proofs" data-state="ready"/);
  assert.match(html, /Preuves canoniques/);
  assert.match(html, /Autorité locale/);
  assert.match(html, /data-memory-plane="raw-facts"/);
  assert.match(html, /data-memory-plane="observations"/);
  assert.match(html, /data-memory-plane="reflect-syntheses"/);
  assert.match(html, /Dérivé Hindsight/);
  assert.match(app, /plane\.dataset\.state = ready \? "ready" : "degraded"/);
});

test("Topic Continuity UI exposes Travail and silent Exceptions without accepting topic selection", () => {
  assert.match(html, /data-tab="work"/);
  assert.match(html, /data-tab="exceptions"/);
  assert.match(html, /Working Set courant/);
  assert.match(html, /Quiet Authority/);
  assert.doesNotMatch(html, /name="topic_id"|id="topic-id-input"/);
  assert.match(app, /\/api\/work\?workingSetId=/);
  assert.match(app, /\/api\/authority-exceptions\?workingSetId=/);
  assert.match(app, /Aucune exception visible/);
});
