import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/memory-fabric-v25/acceptance.v1.json", import.meta.url), "utf8"));

test("v2.5 acceptance matrix is exact and wired to a verifier", () => {
  assert.equal(fixture.schema, "supermemory.memory-fabric-v2.5-acceptance.v1");
  assert.equal(fixture.criteria.length, 22);
  assert.deepEqual(fixture.criteria.map((item) => item.id), Array.from({ length: 22 }, (_, index) => `LM-AC${String(index + 1).padStart(2, "0")}`));
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts["verify:memory-fabric-v25"] ?? "", /verify-memory-fabric-v25/);
  assert.ok(fs.existsSync(new URL("../scripts/verify-memory-fabric-v25.mjs", import.meta.url)));
});

test("production topology keeps six Z2 memory services and native Home 101 Hermes", () => {
  const compose = fs.readFileSync(new URL("../deploy/portainer/supermemory-ai-stack.yml", import.meta.url), "utf8");
  const servicesBlock = compose.split(/^secrets:\s*$/m, 1)[0];
  const serviceNames = [...servicesBlock.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(serviceNames.sort(), ["hindsight", "neo4j", "neo4j-migrate", "supermemory-daemon", "supermemory-graphd", "supermemory-web"].sort());
  assert.doesNotMatch(compose, /^  hermes:/m);
  const home101 = fs.readFileSync(new URL("../deploy/home101/README.md", import.meta.url), "utf8");
  assert.match(home101, /native Hermes/i);
  assert.match(home101, /Home 101/);
  assert.match(home101, /Z2/);
});
