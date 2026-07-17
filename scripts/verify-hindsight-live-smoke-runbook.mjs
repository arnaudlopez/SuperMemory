#!/usr/bin/env node
import fs from "node:fs";

const runbookPath = "docs/hindsight-live-smoke-runbook.md";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const text = fs.readFileSync(runbookPath, "utf8");

const requiredSnippets = [
  "HINDSIGHT_API_KEY",
  "HINDSIGHT_BANK_ID",
  "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1",
  "http://127.0.0.1:8888",
  "self-hosted/local Hindsight",
  "do not silently fall back to cloud",
  "docker run -d --name supermemory-hindsight-local",
  "--pull missing",
  "ghcr.io/vectorize-io/hindsight@sha256:f0f9e9a73d6aedde9eaf4010ab604c3e015494e494318b26f1011144856b8112",
  "docker compose -f compose.hindsight.yml up -d",
  "127.0.0.1:8888 -> Hindsight API",
  "127.0.0.1:9999 -> Hindsight UI",
  "HINDSIGHT_API_LLM_PROVIDER=llamacpp",
  "curl http://127.0.0.1:8888/health",
  "node scripts/verify-hindsight-docker-compose.mjs",
  "seed `doc-acme-pricing-note` via retain, then delete that same document",
  "SUPERMEMORY_LIVE_SMOKE_EVIDENCE_PATH",
  "node scripts/hindsight-live-smoke-runner.mjs --mock-transport --json",
  "node scripts/hindsight-live-smoke-runner.mjs --execute-live --json",
  "node scripts/hindsight-local-live-smoke-preflight.mjs --json --require-ready",
  "SUPERMEMORY_ALLOW_HINDSIGHT_CLOUD=1",
  "node scripts/verify-supermemory-runtime-readiness.mjs",
  "tmp/hindsight-live-smoke-evidence.jsonl",
  "blocked_missing_live_env",
  "tags_match: \"all_strict\"",
  "doc-acme-contract-june-rollout",
  "doc-acme-prd",
  "doc-acme-pricing-note",
  "node scripts/verify-hindsight-live-smoke-runner.mjs",
  "node scripts/verify-supermemory-specs.mjs",
  "git diff --check",
  "The live smoke itself is intentionally not part of CI."
];

for (const snippet of requiredSnippets) {
  if (!text.includes(snippet)) {
    fail(`runbook missing snippet: ${snippet}`);
  }
}

if (/sk-(?:live|test)[-_][A-Za-z0-9_-]{8,}/.test(text)) {
  fail("runbook contains token-like secret");
}

if (!process.exitCode) {
  console.log("PASS hindsight-live-smoke-runbook: operator runbook is complete");
}
