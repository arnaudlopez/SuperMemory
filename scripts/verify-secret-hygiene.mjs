#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const strongPatterns = [
  ["openai_key", /\bsk-(?:proj|live)-[A-Za-z0-9_-]{20,}\b/g],
  ["github_token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ["github_fine_grained_token", /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];

const assignmentPattern = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*["']?([^\s"'#;,}]+)/gi;
const allowedAssignmentValue = /^(?:<[^>]+>|\$\{|process\.env|options\.|env\.|mock|fake|test|sk-test|sk-local|fixture|should_not|none|null|undefined|not_set|set-for-guard-only)/i;

function parseArgs(argv) {
  const options = { json: false, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--path") options.paths.push(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("git ls-files failed");
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function scanFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return [];
  const bytes = fs.readFileSync(resolved);
  if (bytes.includes(0)) return [];
  const text = bytes.toString("utf8");
  const findings = [];
  for (const [id, pattern] of strongPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ file: filePath, rule: id });
  }
  for (const line of text.split(/\r?\n/)) {
    assignmentPattern.lastIndex = 0;
    for (const match of line.matchAll(assignmentPattern)) {
      const value = match[1] ?? "";
      if (value.length >= 12 && !allowedAssignmentValue.test(value)) {
        findings.push({ file: filePath, rule: "credential_assignment" });
        break;
      }
    }
  }
  return findings;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const files = options.paths.length > 0 ? options.paths : trackedFiles();
  const findings = files.flatMap((filePath) => scanFile(filePath));
  const trackedTmp = options.paths.length > 0 ? [] : files.filter((filePath) => filePath.startsWith("tmp/"));
  const report = {
    status: findings.length === 0 && trackedTmp.length === 0 ? "pass" : "fail",
    mode: "secret-hygiene",
    files_scanned: files.length,
    findings,
    tracked_tmp: trackedTmp
  };
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${report.status.toUpperCase()} secret hygiene files=${report.files_scanned} findings=${findings.length}\n`);
  if (report.status !== "pass") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
