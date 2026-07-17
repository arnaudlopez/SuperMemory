#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const smokeCases = [
  {
    id: "capture-retain",
    purpose: "Verify captured source metadata survives retain into real Hindsight.",
    fixture: "identity-vault/90_evals/cases/hindsight-capture-refresh-sync/input/fixture.json",
    mockVerifierCommand: "node scripts/verify-hindsight-capture-refresh-sync.mjs",
    expectedLiveEffect: "retain document with connector/source metadata"
  },
  {
    id: "source-change-upsert",
    purpose: "Verify changed source re-promotion preserves stable document_id and replacement metadata.",
    fixture: "identity-vault/90_evals/cases/hindsight-source-change-sync/input/fixture.json",
    mockVerifierCommand: "node scripts/verify-hindsight-source-change-sync.mjs",
    expectedLiveEffect: "upsert existing document_id with previous_snapshot_id and replaces_memory_id"
  },
  {
    id: "revocation-delete",
    purpose: "Verify do_not_use revocation deletes the Hindsight document.",
    fixture: "identity-vault/90_evals/cases/hindsight-revocation-delete-sync/input/fixture.json",
    mockVerifierCommand: "node scripts/verify-hindsight-revocation-delete-sync.mjs",
    expectedLiveEffect: "delete document_id from Hindsight bank"
  }
];

function parseArgs(argv) {
  return {
    json: argv.includes("--json")
  };
}

function envStatus(env = process.env) {
  return {
    HINDSIGHT_API_KEY: env.HINDSIGHT_API_KEY ? "set" : "not_set",
    HINDSIGHT_BANK_ID: env.HINDSIGHT_BANK_ID ? "set" : "not_set",
    HINDSIGHT_BASE_URL: env.HINDSIGHT_BASE_URL ? "set" : "not_set",
    SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT ? "set" : "not_set"
  };
}

function runCommand(command) {
  const [cmd, ...args] = command.split(" ");
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
    status: result.status === 0 ? "pass" : "fail",
    exit_code: result.status,
    stdout_tail: result.stdout.trim().split(/\r?\n/).slice(-1)[0] ?? "",
    stderr_tail: result.stderr.trim().split(/\r?\n/).slice(-1)[0] ?? ""
  };
}

function manualLiveCommand() {
  return "node scripts/hindsight-live-smoke-runner.mjs --execute-live --json";
}

function runGuardCheck(fixture) {
  const result = spawnSync("node", [
    "scripts/hindsight-promote.mjs",
    "--input",
    fixture,
    "--live",
    "--json"
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      HINDSIGHT_API_KEY: "set-for-guard-only",
      HINDSIGHT_BANK_ID: "bank-test",
      HINDSIGHT_BASE_URL: "https://example.invalid",
      SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: ""
    }
  });
  const expectedError = "live transport requires reviewed --apply-plan and --owner-confirmed";
  return {
    passed: result.status !== 0 && result.stderr.includes(expectedError),
    exit_code: result.status,
    error: expectedError
  };
}

function buildReport() {
  return {
    status: "ready_for_manual_live_smoke",
    generated_at: new Date().toISOString(),
    live_writes_performed: false,
    env: envStatus(),
    required_manual_env: [
      "HINDSIGHT_API_KEY",
      "HINDSIGHT_BANK_ID",
      "HINDSIGHT_BASE_URL",
      "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1"
    ],
    guard_check: runGuardCheck(smokeCases[0].fixture),
    smoke_cases: smokeCases.map((smokeCase) => {
      const mockResult = runCommand(smokeCase.mockVerifierCommand);
      return {
        id: smokeCase.id,
        purpose: smokeCase.purpose,
        fixture: smokeCase.fixture,
        expected_live_effect: smokeCase.expectedLiveEffect,
        mock_verifier_command: smokeCase.mockVerifierCommand,
        mock_status: mockResult.status,
        mock_exit_code: mockResult.exit_code,
        mock_last_line: mockResult.stdout_tail || mockResult.stderr_tail,
        manual_live_command: manualLiveCommand(smokeCase.fixture),
        live_command_executes_in_readiness: false
      };
    })
  };
}

function printText(report) {
  process.stdout.write(`status=${report.status} live_writes_performed=${report.live_writes_performed}\n`);
  for (const smokeCase of report.smoke_cases) {
    process.stdout.write(`${smokeCase.id} mock=${smokeCase.mock_status} live="${smokeCase.manual_live_command}"\n`);
  }
}

const options = parseArgs(process.argv.slice(2));
const report = buildReport();
if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printText(report);
}
