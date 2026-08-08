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
