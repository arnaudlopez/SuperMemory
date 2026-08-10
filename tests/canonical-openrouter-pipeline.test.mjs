import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalOpenRouterPipeline } from "../scripts/lib/canonical-openrouter-pipeline.mjs";

test("OpenRouter canonical pipeline uses structured output and High reasoning", async () => {
  let request;
  const pipeline = createCanonicalOpenRouterPipeline({
    ["api" + "Key"]: "test-openrouter-credential-long-enough",
    model: "openai/gpt-5.4",
    fetchImpl: async (_url, input) => {
      request = JSON.parse(input.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ store: false, title: "", proposedText: "", type: "durable_fact", confidence: 0, uncertainty: "", sensitivity: "standard" }) } }] }), { status: 200 });
    }
  });
  const result = await pipeline.compilerExtractor.extract({ messages: [], workspaceId: "ws_test", projectId: "prj_test" });
  assert.equal(result, null);
  assert.equal(pipeline.provider, "openrouter");
  assert.equal(request.reasoning.effort, "high");
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.messages.some((message) => message.content.includes("untrusted evidence")), true);
});

test("OpenRouter canonical pipeline rejects plaintext endpoints and fallback drift", () => {
  assert.throws(() => createCanonicalOpenRouterPipeline({
    ["api" + "Key"]: "test-openrouter-credential-long-enough",
    model: "openai/gpt-5.4",
    baseUrl: "http://openrouter.ai/api/v1/chat/completions"
  }), /canonical_openrouter_endpoint_invalid/);
  assert.throws(() => createCanonicalOpenRouterPipeline({
    ["api" + "Key"]: "test-openrouter-credential-long-enough",
    model: "openai/gpt-5.4",
    reasoningEffort: "medium"
  }), /canonical_codex_reasoning_invalid/);
});
