#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const smokeCases = [
  {
    id: "capture-retain",
    fixture: "identity-vault/90_evals/cases/hindsight-capture-refresh-sync/input/fixture.json",
    expected_operations: ["retain", "recall"]
  },
  {
    id: "source-change-upsert",
    fixture: "identity-vault/90_evals/cases/hindsight-source-change-sync/input/fixture.json",
    expected_operations: ["upsert", "recall"]
  },
  {
    id: "revocation-delete",
    fixture: "identity-vault/90_evals/cases/hindsight-revocation-delete-sync/input/fixture.json",
    expected_operations: ["delete"],
    setup_document: {
      document_id: "doc-acme-pricing-note",
      memory_id: "mem-acme-pricing-note-live-smoke-seed"
    }
  }
];

function parseArgs(argv) {
  const options = {
    json: false,
    executeLive: false,
    mockTransport: false,
    evidencePath: process.env.SUPERMEMORY_LIVE_SMOKE_EVIDENCE_PATH || "tmp/hindsight-live-smoke-evidence.jsonl"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--execute-live") {
      options.executeLive = true;
    } else if (arg === "--mock-transport") {
      options.mockTransport = true;
    } else if (arg === "--evidence-path") {
      options.evidencePath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.executeLive && options.mockTransport) {
    throw new Error("--execute-live and --mock-transport are mutually exclusive");
  }
  if (!options.executeLive && !options.mockTransport) {
    throw new Error("choose --mock-transport for rehearsal or --execute-live for real Hindsight writes");
  }
  return options;
}

function envStatus(env = process.env) {
  return {
    HINDSIGHT_API_KEY: env.HINDSIGHT_API_KEY ? "set" : "not_set",
    HINDSIGHT_BANK_ID: env.HINDSIGHT_BANK_ID ? "set" : "not_set",
    HINDSIGHT_BASE_URL: env.HINDSIGHT_BASE_URL ? "set" : "not_set",
    SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT ? "set" : "not_set"
  };
}

function missingLiveEnv(env = process.env) {
  const missing = [];
  if (!env.HINDSIGHT_API_KEY) missing.push("HINDSIGHT_API_KEY");
  if (!env.HINDSIGHT_BANK_ID) missing.push("HINDSIGHT_BANK_ID");
  if (!env.HINDSIGHT_BASE_URL) missing.push("HINDSIGHT_BASE_URL");
  if (env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT !== "1") missing.push("SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1");
  return missing;
}

function commandFor(smokeCase, options) {
  return commandForInput(smokeCase.fixture, options);
}

function commandForInput(input, options) {
  const args = [
    "scripts/hindsight-promote.mjs",
    "--input",
    input,
    "--live",
    "--json"
  ];
  if (options.mockTransport) args.push("--mock-transport");
  return ["node", args];
}

function envFor(options) {
  if (!options.mockTransport) return process.env;
  return {
    ...process.env,
    HINDSIGHT_API_KEY: process.env.HINDSIGHT_API_KEY || "fake-live-smoke-key",
    HINDSIGHT_BANK_ID: process.env.HINDSIGHT_BANK_ID || "fake-live-smoke-bank",
    HINDSIGHT_BASE_URL: process.env.HINDSIGHT_BASE_URL || "https://example.invalid",
    SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: process.env.SUPERMEMORY_ALLOW_LIVE_HINDSIGHT || ""
  };
}

function deleteSetupInput(setupDocument) {
  return {
    promotion_payloads: [
      {
        document_id: setupDocument.document_id,
        memory_id: setupDocument.memory_id,
        status: "active",
        text: "Temporary SuperMemory live smoke seed document for revocation delete verification.",
        tags: [
          "visibility:professional",
          "sensitivity:medium",
          "domain:client",
          "workspace:ws-acme",
          "access_policy:professional-default",
          "status:active",
          "entity_type:fact",
          "schema_status:stable",
          "consumer:email_agent",
          "source_kind:live_smoke_seed"
        ],
        metadata: {
          source_id: "src-live-smoke-delete-seed",
          snapshot_id: "snap-live-smoke-delete-seed",
          observation_id: "obs-live-smoke-delete-seed",
          interpretation_id: "interp-live-smoke-delete-seed",
          memory_id: setupDocument.memory_id,
          source_version: "snap-live-smoke-delete-seed",
          freshness: "fresh",
          derived_from: ["snap-live-smoke-delete-seed"],
          workspace_id: "ws-acme",
          access_policy: "professional-default",
          data_owner: "team:acme",
          allowed_consumers: ["email_agent"],
          review_status: "approved"
        }
      }
    ]
  };
}

function runPromote(input, options) {
  if (!options.mockTransport) {
    const planDir = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-live-smoke-plan-"));
    const planPath = path.join(planDir, "reviewed-promotion-plan.json");
    try {
      const writePlan = spawnSync("node", [
        "scripts/hindsight-promote.mjs",
        "--input", input,
        "--write-plan", planPath,
        "--json"
      ], {
        encoding: "utf8",
        env: process.env
      });
      if (writePlan.status !== 0) return writePlan;
      return spawnSync("node", [
        "scripts/hindsight-promote.mjs",
        "--apply-plan", planPath,
        "--owner-confirmed",
        "--live",
        "--json"
      ], {
        encoding: "utf8",
        env: process.env
      });
    } finally {
      fs.rmSync(planDir, { recursive: true, force: true });
    }
  }
  const [cmd, args] = commandForInput(input, options);
  return spawnSync(cmd, args, {
    encoding: "utf8",
    env: envFor(options)
  });
}

function summarizePromoteResult(result) {
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr.trim().split(/\r?\n/).slice(-1)[0] || `exit ${result.status}`
    };
  }

  try {
    const report = JSON.parse(result.stdout);
    return {
      ok: true,
      mode: report.transport?.mode ?? report.mode,
      network_writes: report.network_writes,
      operations: (report.operations ?? []).map((operation) => ({
        operation: operation.operation,
        document_id: operation.document_id,
        memory_id: operation.memory_id,
        trace_id: operation.trace_id,
        reason: operation.reason
      })),
      requests: (report.transport?.requests ?? []).map((request) => ({
        operation: request.operation,
        method: request.method,
        path: request.path,
        document_id: request.document_id,
        policy_id: request.policy_id,
        tags_match: request.body?.tags_match
      })),
      responses: (report.transport?.result?.responses ?? []).map((response) => ({
        operation: response.operation,
        document_id: response.document_id,
        policy_id: response.policy_id,
        status: response.status
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid JSON: ${error.message}`
    };
  }
}

function runSetup(smokeCase, options) {
  if (!smokeCase.setup_document) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-live-smoke-setup-"));
  const inputPath = path.join(tmpDir, `${smokeCase.id}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(deleteSetupInput(smokeCase.setup_document), null, 2));
  const summary = summarizePromoteResult(runPromote(inputPath, options));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return {
    id: `${smokeCase.id}-setup`,
    purpose: "seed document before delete verification",
    target_document_id: smokeCase.setup_document.document_id,
    status: summary.ok ? "pass" : "fail",
    error: summary.error,
    mode: summary.mode,
    network_writes: summary.network_writes,
    operations: summary.operations ?? [],
    requests: summary.requests ?? [],
    responses: summary.responses ?? []
  };
}

function runCase(smokeCase, options) {
  const setup = runSetup(smokeCase, options);
  if (setup?.status === "fail") {
    return {
      id: smokeCase.id,
      fixture: smokeCase.fixture,
      status: "fail",
      expected_operations: smokeCase.expected_operations,
      setup,
      error: setup.error
    };
  }

  const summary = summarizePromoteResult(runPromote(smokeCase.fixture, options));
  if (!summary.ok) {
    return {
      id: smokeCase.id,
      fixture: smokeCase.fixture,
      status: "fail",
      expected_operations: smokeCase.expected_operations,
      setup,
      error: summary.error
    };
  }

  const operations = summary.operations;
  const requests = summary.requests;
  const responses = summary.responses;
  const observedOperations = new Set([
    ...operations.map((operation) => operation.operation),
    ...requests.map((request) => request.operation)
  ]);
  const missingOperations = smokeCase.expected_operations.filter((operation) => !observedOperations.has(operation));

  return {
    id: smokeCase.id,
    fixture: smokeCase.fixture,
    status: missingOperations.length === 0 ? "pass" : "fail",
    expected_operations: smokeCase.expected_operations,
    setup_required: Boolean(smokeCase.setup_document),
    target_document_id: smokeCase.setup_document?.document_id,
    missing_operations: missingOperations,
    setup,
    mode: summary.mode,
    network_writes: summary.network_writes,
    bank_id_status: envFor(options).HINDSIGHT_BANK_ID ? "set" : "not_set",
    operations,
    requests,
    responses
  };
}

function writeEvidence(report, evidencePath) {
  const fullPath = path.resolve(process.cwd(), evidencePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.appendFileSync(fullPath, `${JSON.stringify(report)}${os.EOL}`);
  return fullPath;
}

function assertNoSecrets(report) {
  const serialized = JSON.stringify(report);
  const forbidden = [
    process.env.HINDSIGHT_API_KEY,
    "fake-live-smoke-key",
    "sk-test-secret"
  ].filter(Boolean);
  return forbidden.every((secret) => !serialized.includes(secret));
}

function buildReport(options) {
  if (options.executeLive) {
    const missing = missingLiveEnv();
    if (missing.length > 0) {
      return {
        status: "blocked_missing_live_env",
        generated_at: new Date().toISOString(),
        mode: "live",
        live_writes_performed: false,
        env: envStatus(),
        missing_env: missing,
        cases: []
      };
    }
  }

  const cases = smokeCases.map((smokeCase) => runCase(smokeCase, options));
  const liveWritesPerformed = options.executeLive && cases.some((item) => item.network_writes === true);
  const report = {
    status: cases.every((item) => item.status === "pass") ? "pass" : "fail",
    generated_at: new Date().toISOString(),
    mode: options.mockTransport ? "mock" : "live",
    live_writes_performed: liveWritesPerformed,
    env: envStatus(options.mockTransport ? envFor(options) : process.env),
    evidence_path: options.evidencePath,
    cases
  };
  report.secrets_redacted = assertNoSecrets(report);
  if (!report.secrets_redacted) report.status = "fail";
  return report;
}

function printText(report) {
  process.stdout.write(`status=${report.status} mode=${report.mode} live_writes_performed=${report.live_writes_performed}\n`);
  if (report.missing_env?.length) {
    process.stdout.write(`missing_env=${report.missing_env.join(",")}\n`);
  }
  for (const smokeCase of report.cases ?? []) {
    process.stdout.write(`${smokeCase.id} ${smokeCase.status}\n`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (report.status !== "blocked_missing_live_env") {
    report.evidence_path = writeEvidence(report, options.evidencePath);
  }
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
