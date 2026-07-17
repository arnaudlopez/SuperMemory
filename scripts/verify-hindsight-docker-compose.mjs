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
  "ghcr.io/vectorize-io/hindsight@sha256:f0f9e9a73d6aedde9eaf4010ab604c3e015494e494318b26f1011144856b8112",
  "pull_policy: if_not_present",
  "container_name: supermemory-hindsight-local",
  "\"127.0.0.1:8888:8888\"",
  "\"127.0.0.1:9999:9999\"",
  "HINDSIGHT_API_LLM_PROVIDER: llamacpp",
  "HINDSIGHT_API_WORKER_ID: supermemory-local",
  "${HOME}/.hindsight-docker-supermemory:/home/hindsight/.pg0"
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
