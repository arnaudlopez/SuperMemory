#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const composePath = "compose.hindsight.yml";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const text = fs.readFileSync(composePath, "utf8");

const requiredSnippets = [
  "ghcr.io/vectorize-io/hindsight@sha256:6364c3c5f1e551447976d6c3ab369040d0237c0980f10f911d76d981290913b6",
  "pull_policy: if_not_present",
  "container_name: supermemory-hindsight-local",
  "\"127.0.0.1:8888:8888\"",
  "\"127.0.0.1:9999:9999\"",
  "HINDSIGHT_API_LLM_PROVIDER: ollama",
  "HINDSIGHT_API_LLM_BASE_URL: http://host.docker.internal:11434/v1",
  "HINDSIGHT_API_LLM_MODEL: ${HINDSIGHT_OLLAMA_MODEL:-qwen3.5:9b}",
  "HINDSIGHT_API_LLM_MAX_CONCURRENT: \"1\"",
  "HINDSIGHT_API_ENABLE_OBSERVATIONS: \"true\"",
  "HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION: \"false\"",
  "HINDSIGHT_API_ENABLE_BANK_CONFIG_API: \"true\"",
  "HINDSIGHT_API_AUDIT_LOG_ENABLED: \"true\"",
  "HINDSIGHT_API_WORKER_ID: supermemory-local",
  "\"host.docker.internal:host-gateway\"",
  "${HOME}/.hindsight-docker-supermemory-v090:/home/hindsight/.pg0"
];

for (const snippet of requiredSnippets) {
  if (!text.includes(snippet)) {
    fail(`compose file missing snippet: ${snippet}`);
  }
}

for (const forbidden of ["hindsight:latest", "pull_policy: always", "HINDSIGHT_API_KEY", "api.hindsight.vectorize.io", "0.0.0.0:8888", "0.0.0.0:9999"]) {
  if (text.includes(forbidden)) {
    fail(`compose file contains forbidden snippet: ${forbidden}`);
  }
}

const result = spawnSync("docker", ["compose", "-f", composePath, "config"], {
  encoding: "utf8"
});
if (result.status !== 0) {
  fail(`docker compose config failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

if (!process.exitCode) {
  console.log("PASS hindsight-docker-compose: local Hindsight compose config is valid");
}
