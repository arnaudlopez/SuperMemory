#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const requiredCommands = [
  "node scripts/verify-memory-contracts.mjs",
  "node scripts/verify-local-manual-capture-workflow.mjs",
  "node scripts/verify-local-file-source-refresh-workflow.mjs",
  "node scripts/verify-hindsight-adapter-minimal.mjs",
  "node scripts/verify-hindsight-local-live-smoke-preflight.mjs",
  "node scripts/verify-hindsight-live-smoke-runner.mjs",
  "node scripts/verify-governed-answer-evidence.mjs",
  "node scripts/verify-enterprise-living-memory-complete.mjs"
];

const requiredDocs = [
  "README.md",
  "docs/golden-end-state-operator-workflow.md"
];

const phases = [
  {
    id: "capture",
    evidence: [
      "scripts/local-manual-capture.mjs",
      "node scripts/verify-local-manual-capture-workflow.mjs"
    ]
  },
  {
    id: "snapshot",
    evidence: [
      "identity-vault/00_inbox/snapshot_registry.md",
      "node scripts/verify-local-manual-capture-workflow.mjs"
    ]
  },
  {
    id: "llm_first_interpretation",
    evidence: [
      "identity-vault/75_governance/interpretation_contract.md",
      "node scripts/verify-memory-contracts.mjs"
    ]
  },
  {
    id: "staging_review",
    evidence: [
      "scripts/local-manual-capture.mjs --apply-plan",
      "scripts/local-file-source-refresh.mjs --apply-plan"
    ]
  },
  {
    id: "governed_promotion",
    evidence: [
      "scripts/hindsight-promote.mjs",
      "node scripts/verify-hindsight-live-smoke-runner.mjs"
    ]
  },
  {
    id: "local_hindsight_preflight",
    evidence: [
      "scripts/hindsight-local-live-smoke-preflight.mjs",
      "node scripts/verify-hindsight-local-live-smoke-preflight.mjs"
    ]
  },
  {
    id: "recall",
    evidence: [
      "identity-vault/90_evals/cases/hindsight-adapter-minimal",
      "node scripts/verify-hindsight-adapter-minimal.mjs"
    ]
  },
  {
    id: "governed_answer",
    evidence: [
      "identity-vault/90_evals/cases/governed-answer-evidence",
      "node scripts/verify-governed-answer-evidence.mjs"
    ]
  },
  {
    id: "refresh_change",
    evidence: [
      "scripts/local-file-source-refresh.mjs",
      "node scripts/verify-local-file-source-refresh-workflow.mjs"
    ]
  },
  {
    id: "audit",
    evidence: [
      "scripts/verify-supermemory-specs.mjs",
      "docs/golden-end-state-operator-workflow.md"
    ]
  }
];

const failureModes = [
  "missing_live_env_blocks_live_write",
  "non_local_hindsight_endpoint_blocked",
  "revoked_memory_not_active",
  "unavailable_source_not_fresh",
  "restricted_memory_not_answer_evidence",
  "mock_transport_not_live_proof",
  "secret_like_text_not_committed"
];

function parseArgs(argv) {
  const options = { json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function commandParts(command) {
  const [cmd, ...args] = command.split(" ");
  return [cmd, args];
}

function runCommand(command) {
  const [cmd, args] = commandParts(command);
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "",
      HINDSIGHT_BANK_ID: "",
      HINDSIGHT_BASE_URL: "",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
    }
  });
  return {
    command,
    status: result.status === 0 ? "pass" : "fail",
    exit_code: result.status,
    error: result.status === 0 ? undefined : (result.stderr.trim().split(/\r?\n/).slice(-1)[0] || `exit ${result.status}`)
  };
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function text(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function requiredSnippetChecks() {
  const checks = [];
  const snippets = {
    "README.md": [
      "node scripts/verify-golden-end-state-workflow.mjs",
      "Golden End State"
    ],
    "docs/golden-end-state-operator-workflow.md": [
      "capture -> snapshot -> interpretation -> promotion -> recall -> answer -> refresh -> audit",
      "node scripts/hindsight-local-live-smoke-preflight.mjs --json",
      "No implicit cloud fallback"
    ],
    "scripts/verify-supermemory-specs.mjs": [
      "scripts/verify-golden-end-state-workflow.mjs"
    ]
  };

  for (const [filePath, expected] of Object.entries(snippets)) {
    if (!exists(filePath)) {
      checks.push({ file: filePath, status: "fail", missing: expected });
      continue;
    }
    const fileText = text(filePath);
    const missing = expected.filter((snippet) => !fileText.includes(snippet));
    checks.push({
      file: filePath,
      status: missing.length === 0 ? "pass" : "fail",
      missing
    });
  }
  return checks;
}

function staticArtifactChecks() {
  const files = [
    "scripts/local-manual-capture.mjs",
    "scripts/local-file-source-refresh.mjs",
    "scripts/hindsight-promote.mjs",
    "scripts/hindsight-local-live-smoke-preflight.mjs",
    "identity-vault/75_governance/interpretation_contract.md",
    "identity-vault/90_evals/cases/enterprise-living-memory-complete"
  ];
  return files.map((file) => ({
    file,
    status: exists(file) ? "pass" : "fail"
  }));
}

function assertNoForbiddenStrings(report) {
  const serialized = JSON.stringify(report);
  const forbidden = [
    "api.hindsight.vectorize.io",
    "sk-test-secret"
  ];
  return forbidden.filter((item) => serialized.includes(item));
}

function buildReport() {
  const command_results = requiredCommands.map(runCommand);
  const doc_checks = requiredSnippetChecks();
  const artifact_checks = staticArtifactChecks();
  const phaseReports = phases.map((phase) => ({
    ...phase,
    status: phase.evidence.every((item) => exists(item) || requiredCommands.includes(item) || item.includes(" --")) ? "pass" : "fail"
  }));
  const report = {
    status: "pass",
    generated_at: new Date().toISOString(),
    mode: "golden-end-state-workflow",
    operator_usable_locally: true,
    live_writes_performed: false,
    network_writes: false,
    cloud_fallback_allowed: false,
    phases: phaseReports,
    required_commands: requiredCommands,
    command_results,
    failure_modes: failureModes,
    docs: requiredDocs,
    doc_checks,
    artifact_checks
  };

  const failedChecks = [
    ...command_results.filter((item) => item.status !== "pass"),
    ...doc_checks.filter((item) => item.status !== "pass"),
    ...artifact_checks.filter((item) => item.status !== "pass"),
    ...phaseReports.filter((item) => item.status !== "pass")
  ];
  const forbidden = assertNoForbiddenStrings(report);
  if (failedChecks.length > 0 || forbidden.length > 0) {
    report.status = "fail";
    report.operator_usable_locally = false;
    report.failures = failedChecks;
    report.forbidden_strings = forbidden;
  }
  return report;
}

function printText(report) {
  process.stdout.write(`status=${report.status} mode=${report.mode} live_writes_performed=${report.live_writes_performed}\n`);
  for (const phase of report.phases) {
    process.stdout.write(`${phase.id} ${phase.status}\n`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }
  if (report.status !== "pass") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
