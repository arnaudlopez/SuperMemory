#!/usr/bin/env node

const phases = [
  {
    id: "release_preflight",
    title: "Release preflight",
    purpose: "Prove the local-first release surface before any operator mutation.",
    commands: [
      "node scripts/verify-supermemory-release-readiness.mjs",
      "node scripts/verify-supermemory-specs.mjs",
      "git diff --check"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "manual_capture",
    title: "Manual source capture",
    purpose: "Capture one owner-selected local source through reviewed plan gates.",
    commands: [
      "node scripts/local-manual-capture.mjs --file /path/to/source.md --scope /path/to/scope --workspace workspace:example --requested-by owner:name --capture-reason \"manual evidence\" --write-plan /path/to/manual-capture-plan.json --json",
      "node scripts/local-manual-capture.mjs --apply-plan /path/to/manual-capture-plan.json --out-dir /path/to/manual-capture-staging --json",
      "node scripts/local-manual-capture.mjs --commit-staging /path/to/manual-capture-staging --vault-root identity-vault --owner-confirmed --json"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "local_file_refresh",
    title: "Local file refresh",
    purpose: "Refresh one registered local_file source through reviewed staging.",
    commands: [
      "node scripts/local-file-source-refresh.mjs --input /path/to/registry.json --source-id source:example --write-plan /path/to/refresh-plan.json --json",
      "node scripts/local-file-source-refresh.mjs --apply-plan /path/to/refresh-plan.json --out-dir /path/to/refresh-staging --json",
      "node scripts/local-file-source-refresh.mjs --commit-staging /path/to/refresh-staging --vault-root identity-vault --owner-confirmed --json"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "local_hindsight_preflight",
    title: "Local Hindsight preflight",
    purpose: "Check Docker/local Hindsight readiness without writes or cloud fallback.",
    commands: [
      "docker compose -f compose.hindsight.yml up -d",
      "node scripts/hindsight-local-live-smoke-preflight.mjs --json"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "reviewed_hindsight_promotion",
    title: "Reviewed Hindsight promotion",
    purpose: "Create and apply a reviewed Hindsight promotion plan.",
    commands: [
      "node scripts/hindsight-promote.mjs --input /path/to/governed-promotion.json --write-plan /path/to/reviewed-promotion-plan.json --json",
      "node scripts/hindsight-promote.mjs --apply-plan /path/to/reviewed-promotion-plan.json --owner-confirmed --mock-transport --json"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "smoke",
    title: "Smoke",
    purpose: "Run mock smoke in CI or explicit local live smoke outside CI.",
    commands: [
      "node scripts/hindsight-live-smoke-runner.mjs --mock-transport --json --evidence-path tmp/hindsight-live-smoke-release-mock.jsonl",
      "HINDSIGHT_API_KEY=<local-key> HINDSIGHT_BANK_ID=<local-bank> HINDSIGHT_BASE_URL=http://127.0.0.1:8888 SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1 node scripts/hindsight-live-smoke-runner.mjs --execute-live --json --evidence-path tmp/hindsight-live-smoke-local.jsonl"
    ],
    network_writes: "explicit-local-live-only",
    credentials_required: "explicit-local-live-only"
  },
  {
    id: "audit",
    title: "Audit",
    purpose: "Verify specs, release readiness, and evidence hygiene after operator work.",
    commands: [
      "node scripts/verify-supermemory-release-readiness.mjs --json",
      "node scripts/verify-supermemory-specs.mjs",
      "git status --short",
      "git diff --check"
    ],
    network_writes: false,
    credentials_required: false
  },
  {
    id: "rollback",
    title: "Rollback",
    purpose: "Return to the last safe code or vault state after a bad release.",
    commands: [
      "git revert <release-commit-sha>",
      "restore the reviewed staging backup or previous registry entries before re-running node scripts/verify-supermemory-release-readiness.mjs"
    ],
    network_writes: false,
    credentials_required: false
  }
];

function parseArgs(argv) {
  return {
    json: argv.includes("--json")
  };
}

function buildReport() {
  return {
    status: "pass",
    mode: "operator-workflow",
    network_writes_performed: false,
    credentials_required: false,
    default_runtime_target: "local_hindsight_docker",
    cloud_hindsight_default: false,
    phases
  };
}

const options = parseArgs(process.argv.slice(2));
const report = buildReport();

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write("SuperMemory operator workflow\n\n");
  for (const phase of phases) {
    process.stdout.write(`${phase.id}: ${phase.title}\n`);
    for (const command of phase.commands) {
      process.stdout.write(`  ${command}\n`);
    }
  }
}
