import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalCodexPipeline } from "../scripts/lib/canonical-codex-pipeline.mjs";

test("canonical Codex pipeline enforces the single Luna High provider", async () => {
  const calls = [];
  const runner = async (input) => {
    calls.push(input);
    if (input.schemaPath.endsWith("memory-candidate.schema.json")) {
      return {
        store: true,
        title: "Architecture",
        proposedText: "Z2 héberge le brain canonique.",
        type: "decision",
        confidence: 0.99,
        uncertainty: "",
        sensitivity: "standard"
      };
    }
    if (input.system.startsWith("Extract exactly")) {
      return {
        claim_key: "architecture:z2-canonical",
        text: "Z2 héberge le brain canonique.",
        fact_class: "user_decision",
        explicit: true,
        authenticated: false,
        inferred: false,
        ttl_ms: null,
        temporal_expression: "",
        event_time: null,
        entities: [{ binding_id: "z2", canonical_name: "Z2", entity_type: "server", aliases: [] }],
        relations: [],
        ontology_proposals: []
      };
    }
    return {
      status: "verified",
      signals: {
        evidence_entailment: 1,
        source_trust: 1,
        extraction_agreement: 1,
        temporal_consistency: 1,
        contradiction_risk: 0,
        scope_valid: true,
        ontology_compatible: true,
        alias_binding_verified: true,
        temporary: false,
        duplicate: false,
        fragment: false,
        high_impact: false,
        permission_risk: false,
        destructive_ontology_change: false
      }
    };
  };
  const pipeline = createCanonicalCodexPipeline({ runner });
  assert.equal(pipeline.provider, "openai-codex");
  assert.equal(pipeline.model, "gpt-5.6-luna");
  assert.equal(pipeline.reasoningEffort, "high");
  assert.equal(pipeline.compilerExtractor.provider, "openai-codex");
  assert.equal(pipeline.compilerExtractor.reasoningEffort, "high");
  assert.equal(pipeline.extractor.identity.provider, "openai-codex");
  assert.equal(pipeline.extractor.identity.prompt_version, "canonical-extract-v3");
  assert.equal(pipeline.verifier.identity.independent, true);

  const candidate = await pipeline.compilerExtractor.extract({
    messages: [{ role: "user", content: "Z2 sera le serveur." }],
    workspaceId: "ws_018f7c0e-7b7d-7abc-8def-0123456789ab",
    projectId: "prj_018f7c0e-7b7d-7abc-8def-0123456789ab"
  });
  assert.equal(candidate.proposedText, "Z2 héberge le brain canonique.");
  const verification = await pipeline.compilerVerifier.verify({ candidate, messages: [] });
  assert.equal(verification.verifier.model, "gpt-5.6-luna");
  assert.equal(calls.length, 2);
  await pipeline.verifier.verify({
    episode: { observed_at: "2026-08-08T00:00:00.000Z" },
    evidence: { kind: "prompt.submitted", source_adapter: "hook" },
    payload: { prompt: "Préférence explicite." },
    extraction: { text: "Préférence explicite." }
  });
  assert.match(calls.at(-1).system, /reopened, hash-verified prompt\.submitted/);
  assert.match(calls.at(-1).system, /never as authentication of an external or machine fact/);
});

test("canonical extraction contract requires temporal and Quiet Authority signals", () => {
  const schema = JSON.parse(fs.readFileSync(new URL(
    "../deploy/codex/canonical-extraction.schema.json",
    import.meta.url
  ), "utf8"));
  for (const field of [
    "fact_class", "explicit", "authenticated", "inferred", "ttl_ms",
    "temporal_expression", "event_time"
  ]) {
    assert.ok(schema.required.includes(field));
    assert.ok(schema.properties[field]);
  }
  assert.deepEqual(schema.properties.event_time.type, ["object", "null"]);
  assert.equal("oneOf" in schema.properties.event_time, false);
  assert.deepEqual(schema.properties.relations.items.properties.event_time.type, ["object", "null"]);
  assert.equal("oneOf" in schema.properties.relations.items.properties.event_time, false);
  assert.ok(schema.properties.relations.items.required.includes("event_time"));
  assert.ok(schema.properties.relations.items.required.includes("temporal_expression"));
});

test("canonical Codex pipeline keeps empty turns out of durable memory", async () => {
  const pipeline = createCanonicalCodexPipeline({
    runner: async () => ({
      store: false,
      title: "",
      proposedText: "",
      type: "",
      confidence: 0,
      uncertainty: "no durable fact",
      sensitivity: "standard"
    })
  });
  assert.equal(await pipeline.compilerExtractor.extract({ messages: [] }), null);
});

test("canonical Codex pipeline rejects provider or reasoning drift", () => {
  assert.throws(
    () => createCanonicalCodexPipeline({ model: "gpt-5.6-sol", runner: async () => ({}) }),
    /canonical_codex_model_invalid/
  );
  assert.throws(
    () => createCanonicalCodexPipeline({ reasoningEffort: "medium", runner: async () => ({}) }),
    /canonical_codex_reasoning_invalid/
  );
});

test("canonical Codex runner disables agent tools around untrusted evidence", () => {
  const source = fs.readFileSync(new URL(
    "../scripts/lib/canonical-codex-pipeline.mjs",
    import.meta.url
  ), "utf8");
  for (const contract of [
    'approval_policy="never"',
    "features.shell_tool=false",
    'web_search="disabled"',
    "features.remote_plugin=false",
    "features.skill_mcp_dependency_install=false",
    '"--sandbox", "read-only"',
    '"--ephemeral"',
    '"--ignore-user-config"',
    '"--ignore-rules"'
  ]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("canonical Codex runner resolves the root-owned npm executable symlink", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-codex-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "codex");
  fs.symlinkSync(process.execPath, executable);
  const pipeline = createCanonicalCodexPipeline({ executable });
  assert.equal(pipeline.provider, "openai-codex");
});
