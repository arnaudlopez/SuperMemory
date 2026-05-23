#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const fakeEnv = {
  HINDSIGHT_API_KEY: "fake-key-for-contract-check",
  HINDSIGHT_BANK_ID: "fake-bank",
  HINDSIGHT_BASE_URL: "https://api.hindsight.vectorize.io",
  SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "1"
};

const contractSources = [
  {
    id: "retain",
    url: "https://docs.hindsight.vectorize.io/retain/",
    expectation: "POST /v1/default/banks/:bank_id/memories with items[].content, document_id, tags, metadata"
  },
  {
    id: "recall",
    url: "https://docs.hindsight.vectorize.io/api-reference/recall-memories/",
    expectation: "POST /v1/default/banks/:bank_id/memories/recall with query, trace, tags, and tags_match"
  },
  {
    id: "strict_tag_filtering",
    url: "https://hindsight.vectorize.io/developer/api/recall",
    expectation: "tags_match=all_strict is required for scoped fail-closed recall"
  },
  {
    id: "documents",
    url: "https://hindsight.vectorize.io/0.4/developer/api/documents",
    expectation: "DELETE /v1/default/banks/:bank_id/documents/:document_id deletes a retained document"
  }
];

const smokeCases = [
  {
    id: "retain",
    fixture: "identity-vault/90_evals/cases/hindsight-capture-refresh-sync/input/fixture.json",
    expectedOperation: "retain"
  },
  {
    id: "upsert",
    fixture: "identity-vault/90_evals/cases/hindsight-source-change-sync/input/fixture.json",
    expectedOperation: "upsert"
  },
  {
    id: "delete",
    fixture: "identity-vault/90_evals/cases/hindsight-revocation-delete-sync/input/fixture.json",
    expectedOperation: "delete"
  }
];

function parseArgs(argv) {
  return {
    json: argv.includes("--json")
  };
}

function runPromote(fixture) {
  return spawnSync("node", [
    "scripts/hindsight-promote.mjs",
    "--input",
    fixture,
    "--live",
    "--mock-transport",
    "--json"
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...fakeEnv
    }
  });
}

function parseReport(result) {
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    };
  }

  try {
    return {
      ok: true,
      report: JSON.parse(result.stdout)
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid JSON: ${error.message}`
    };
  }
}

function requestMatchesPath(request, suffix) {
  return typeof request?.path === "string" && request.path.endsWith(suffix);
}

function hasObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function checkCase(smokeCase) {
  const parsed = parseReport(runPromote(smokeCase.fixture));
  if (!parsed.ok) {
    return {
      id: smokeCase.id,
      fixture: smokeCase.fixture,
      status: "fail",
      expected_operation: smokeCase.expectedOperation,
      errors: [parsed.error]
    };
  }

  const report = parsed.report;
  const requests = report.transport?.requests ?? [];
  const errors = [];
  const expectedRequest = requests.find((request) => request.operation === smokeCase.expectedOperation);
  const recallRequest = requests.find((request) => request.operation === "recall");

  if (report.network_writes !== false) {
    errors.push("mock transport must not perform network writes");
  }
  if (report.transport?.mode !== "mock") {
    errors.push("transport mode must be mock");
  }
  if (!expectedRequest) {
    errors.push(`missing ${smokeCase.expectedOperation} transport request`);
  }

  if (expectedRequest && (smokeCase.expectedOperation === "retain" || smokeCase.expectedOperation === "upsert")) {
    const item = expectedRequest.body?.items?.[0];
    if (expectedRequest.method !== "POST") errors.push("retain/upsert must use POST");
    if (!requestMatchesPath(expectedRequest, "/memories")) errors.push("retain/upsert must target /memories");
    if (!item?.content) errors.push("retain/upsert item must include content");
    if (!item?.document_id) errors.push("retain/upsert item must include document_id");
    if (!Array.isArray(item?.tags) || item.tags.length === 0) errors.push("retain/upsert item must include tags");
    if (!hasObject(item?.metadata)) errors.push("retain/upsert item must include metadata");
  }

  if (expectedRequest && smokeCase.expectedOperation === "delete") {
    if (expectedRequest.method !== "DELETE") errors.push("delete must use DELETE");
    if (!requestMatchesPath(expectedRequest, `/documents/${expectedRequest.document_id}`)) {
      errors.push("delete must target /documents/:document_id");
    }
  }

  if (recallRequest) {
    if (recallRequest.method !== "POST") errors.push("recall must use POST");
    if (!requestMatchesPath(recallRequest, "/memories/recall")) errors.push("recall must target /memories/recall");
    if (!recallRequest.body?.query) errors.push("recall body must include query");
    if (recallRequest.body?.trace !== true) errors.push("recall body must request trace");
    if (!Array.isArray(recallRequest.body?.tags) || recallRequest.body.tags.length === 0) {
      errors.push("recall body must include scoped tags");
    }
    if (recallRequest.body?.tags_match !== "all_strict") {
      errors.push("recall body must set tags_match=all_strict");
    }
  } else if (smokeCase.expectedOperation !== "delete") {
    errors.push("missing recall transport request");
  }

  return {
    id: smokeCase.id,
    fixture: smokeCase.fixture,
    status: errors.length === 0 ? "pass" : "fail",
    expected_operation: smokeCase.expectedOperation,
    request_count: requests.length,
    requests: requests.map((request) => ({
      operation: request.operation,
      method: request.method,
      path: request.path,
      tags_match: request.body?.tags_match
    })),
    errors
  };
}

function buildReport() {
  const checks = smokeCases.map(checkCase);
  const allPass = checks.every((check) => check.status === "pass");
  return {
    status: allPass ? "ready_for_owner_live_smoke" : "transport_contract_uncertain",
    generated_at: new Date().toISOString(),
    live_writes_performed: false,
    fake_credentials_only: true,
    contract_sources: contractSources,
    checks,
    required_owner_live_env: [
      "HINDSIGHT_API_KEY",
      "HINDSIGHT_BANK_ID",
      "SUPERMEMORY_ALLOW_LIVE_HINDSIGHT=1"
    ],
    next_live_boundary: "owner-provided credentials and a sacrificial Hindsight bank"
  };
}

function printText(report) {
  process.stdout.write(`status=${report.status} live_writes_performed=${report.live_writes_performed}\n`);
  for (const check of report.checks) {
    process.stdout.write(`${check.id} ${check.status} ${check.expected_operation}\n`);
  }
}

const options = parseArgs(process.argv.slice(2));
const report = buildReport();
if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printText(report);
}
