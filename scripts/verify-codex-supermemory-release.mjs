#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCodexExecutable } from "./run-codex-integration-canary.mjs";

const definitions = {
  ID: {
    check: "s1_s4_acceptance",
    scenarios: [
      "tests/project-registry.test.mjs :: Git init is idempotent and keeps stable project/workspace/checkout IDs",
      "tests/project-registry.test.mjs :: a moved root preserves IDs and records the old alias as historical",
      "tests/codex-app-server-adapter.test.mjs :: strong rename preserves source identity while ambiguous copies stay distinct and changes invalidate",
      "tests/project-registry.test.mjs :: a Git worktree shares project/workspace identity but has its own checkout",
      "tests/project-registry.test.mjs :: copied markers and explicit multi-root linking fail closed without implicit fusion"
    ]
  },
  CAP: {
    check: "s1_s4_acceptance",
    scenarios: [
      "tests/codex-app-server-adapter.test.mjs :: deltas are ephemeral and item/completed is authoritative exactly once",
      "tests/codex-app-server-adapter.test.mjs :: App Server and hook observations share one logical effect without time heuristics",
      "tests/codex-capture-pipeline.test.mjs :: crash after journal commit but before producer ack replays as one logical effect",
      "tests/codex-capture-pipeline.test.mjs :: journal ordering reports gaps/out-of-order events per session",
      "tests/codex-app-server-adapter.test.mjs :: internal reasoning is ignored while unknown items create explicit gaps",
      "tests/codex-capture-pipeline.test.mjs :: daemon is loopback-only/authenticated and falls back to encrypted spool",
      "tests/codex-capture-pipeline.test.mjs :: spool quota drops in bounded time and writes a payload-free capture gap",
      "tests/codex-capture-pipeline.test.mjs :: journal replay ordering is isolated per session",
      "tests/codex-hook-adapter.test.mjs :: coverage diagnostics never claim rich hook coverage for hosted actions",
      "tests/codex-app-server-adapter.test.mjs :: App Server primary plus hook shadow applies one effect",
      "tests/codex-app-server-adapter.test.mjs :: unknown item creates a partial immutable turn snapshot"
    ]
  },
  VER: {
    check: "s1_s4_acceptance",
    scenarios: [
      "tests/codex-app-server-adapter.test.mjs :: complete turn creates an immutable content-addressed manifest",
      "tests/codex-app-server-adapter.test.mjs :: file change records before/after hashes with path-safe metadata",
      "tests/codex-app-server-adapter.test.mjs :: strong observed rename keeps the same source_id",
      "tests/codex-app-server-adapter.test.mjs :: same-hash ambiguous copy stays distinct and review_required",
      {
        checks: ["s5_s6_acceptance", "oracle_canary"],
        evidence: "tests/codex-memory-governance.test.mjs + isolated oracle :: source replacement makes derived memory stale before projection retry"
      },
      "tests/codex-app-server-adapter.test.mjs :: replay returns the identical turn/file snapshot without divergent artifacts"
    ]
  },
  GOV: {
    check: "s5_s6_acceptance",
    scenarios: [
      "tests/codex-memory-governance.test.mjs :: creating an encrypted archive never activates memory",
      "tests/codex-memory-governance.test.mjs :: candidate creation rejects missing or tampered evidence",
      {
        checks: ["s5_s6_acceptance", "oracle_canary"],
        evidence: "tests/codex-memory-governance.test.mjs + isolated oracle :: independent verifier admission fsyncs canonical memory before projection without reviewCandidate"
      },
      "tests/codex-memory-governance.test.mjs :: rejected candidate never projects",
      "tests/codex-memory-governance.test.mjs :: revocation removes recall authority before physical projection deletion"
    ]
  },
  HIN: {
    check: "s5_s6_acceptance",
    scenarios: [
      "tests/codex-hindsight-recall.test.mjs :: projection uses complete all-strict workspace/consumer/status tags",
      "tests/codex-hindsight-recall.test.mjs :: gateway ignores Hindsight documents absent from active vault memory",
      "tests/codex-hindsight-recall.test.mjs :: Hindsight failure declares cited deterministic local fallback",
      "tests/codex-hindsight-recall.test.mjs :: rebuild deterministically reprojects active canonical memory",
      {
        checks: ["s7_acceptance", "oracle_canary"],
        evidence: "tests/codex-lifecycle.test.mjs + isolated oracle :: delete is verified or remains visibly retryable"
      },
      "tests/codex-hindsight-recall.test.mjs :: each workspace receives a distinct opaque bank"
    ]
  },
  MCP: {
    check: "s5_s6_acceptance",
    scenarios: [
      "tests/codex-hindsight-recall.test.mjs :: project recall returns only active cited memory",
      "tests/codex-hindsight-recall.test.mjs :: cross-workspace memory_id returns scope_mismatch",
      "tests/codex-memory-governance.test.mjs :: stale/revoked memory disappears from recall immediately",
      "tests/codex-hindsight-recall.test.mjs :: restricted or unauthorized memory is filtered by canonical policy",
      "tests/codex-hindsight-recall.test.mjs :: limit is bounded and pagination unavailability is explicit",
      "tests/codex-hindsight-recall.test.mjs :: Hindsight down returns mode=local_fallback",
      "tests/codex-mcp-server.test.mjs :: unresolved launch binding fails closed without auto-creation",
      "tests/codex-mcp-server.test.mjs :: explain citation returns the complete candidate/snapshot chain",
      "tests/codex-hook-adapter.test.mjs :: SessionStart context is active-only, cited and strictly budgeted",
      "tests/codex-mcp-server.test.mjs :: bound tools expose no cwd/workspace override and reject scope arguments"
    ]
  },
  CLI: {
    check: "s1_s4_acceptance",
    scenarios: [
      "tests/codex-app-server-adapter.test.mjs :: Codex 0.125 App Server profile is explicit and incompatible schemas fail closed",
      "tests/codex-hook-adapter.test.mjs :: hook-only Desktop capability is detected as partial, never falsely rich",
      {
        checks: ["oracle_canary", "codex_cli"],
        evidence: "isolated Codex 0.125 canary :: CLI discovers the shared plugin, hooks and MCP package"
      },
      {
        checks: ["client_diagnostics"],
        evidence: "tests/supermemory-doctor.test.mjs :: IDE/App Server availability is separated from configured or observed state"
      },
      {
        checks: ["client_diagnostics"],
        evidence: "tests/supermemory-doctor.test.mjs :: cloud/web coverage is explicitly none"
      },
      "tests/codex-hook-adapter.test.mjs :: non-instrumented and invisible hosted actions never receive a capture claim"
    ]
  },
  SEC: {
    check: "s1_s4_acceptance",
    scenarios: [
      "tests/codex-capture-pipeline.test.mjs :: OpenAI-like key in prompt is redacted before journal and payload persistence",
      "tests/codex-capture-pipeline.test.mjs :: secret fields and private-key-shaped payloads are redacted before persistence",
      "tests/codex-hook-adapter.test.mjs :: hook payloads are bounded/truncated and retain size/hash metadata",
      {
        checks: ["s5_s6_acceptance"],
        evidence: "tests/codex-memory-governance.test.mjs :: archive ciphertext does not expose content without the AEAD key"
      },
      "tests/codex-capture-pipeline.test.mjs :: missing/wrong key has no plaintext fallback",
      "tests/codex-capture-pipeline.test.mjs :: sensitive paths persist only as keyed fingerprints",
      "tests/codex-app-server-adapter.test.mjs :: snapshot storage is path-safe and never follows a source path",
      "tests/codex-capture-pipeline.test.mjs :: daemon and network endpoints reject non-loopback access",
      "tests/codex-app-server-adapter.test.mjs :: hidden reasoning content is ignored and absent from artifacts",
      {
        checks: ["s7_acceptance"],
        evidence: "tests/codex-lifecycle.test.mjs :: expired ciphertext is purged with content-free attestation"
      },
      {
        checks: ["s7_acceptance"],
        evidence: "tests/codex-lifecycle.test.mjs :: key rotation preserves old reads and uses the new key for writes"
      },
      {
        checks: ["secret_hygiene", "oracle_canary"],
        evidence: "secret hygiene gate + isolated oracle :: repository/log evidence contains no secret or user content"
      }
    ]
  },
  DEL: {
    check: "s7_acceptance",
    scenarios: [
      "tests/codex-lifecycle.test.mjs :: deletion persists tombstone before any projection or purge step",
      "tests/codex-lifecycle.test.mjs :: Hindsight-down delete denies recall and exposes retry_required",
      "tests/codex-lifecycle.test.mjs :: session deletion purges scoped candidates, memories and ciphertext",
      "tests/codex-lifecycle.test.mjs :: repeated memory deletion is idempotent",
      "tests/codex-lifecycle.test.mjs :: legal hold explicitly suspends purge",
      "tests/codex-lifecycle.test.mjs :: completed purge writes a content-free attestation"
    ]
  },
  MIG: {
    check: "s7_acceptance",
    scenarios: [
      "tests/codex-migration.test.mjs :: dry-run is read-only",
      "tests/codex-migration.test.mjs :: repeated import returns the same checkpoint without duplicates",
      "tests/codex-migration.test.mjs :: similar legacy slugs require owner review and never merge",
      "tests/codex-migration.test.mjs :: legacy global memory remains scope_review and is not broadcast",
      "tests/codex-installer.test.mjs :: any existing SuperMemory handler blocks plugin apply",
      {
        checks: ["oracle_canary"],
        evidence: "isolated oracle :: one plugin capture produces one event and cited recall"
      },
      "tests/codex-migration.test.mjs :: verified-backup rollback restores legacy and preserves a safety copy",
      "tests/codex-migration.test.mjs :: legacy secret is redacted before canonical import",
      "tests/codex-migration.test.mjs :: workspace:local without owner mapping is legacy_unbound",
      "tests/codex-migration.test.mjs :: opaque source mapping resolves through immutable legacy citation evidence"
    ]
  },
  MEM: {
    check: "s7_acceptance",
    scenarios: [
      "tests/codex-installer.test.mjs :: absent Codex Memories setting remains off and installer does not enable it",
      "tests/codex-installer.test.mjs :: manually enabled native Memories emits a parallel non-governed warning",
      "tests/codex-lifecycle.test.mjs :: deletion attestation explicitly states native Codex Memories are not covered"
    ]
  }
};

export const CODEX_ACCEPTANCE_EVIDENCE = Object.freeze(Object.fromEntries(
  Object.entries(definitions).flatMap(([prefix, definition]) => (
    definition.scenarios.map((scenario, index) => {
      const value = typeof scenario === "string" ? { evidence: scenario } : scenario;
      return [
        `AC-${prefix}-${String(index + 1).padStart(2, "0")}`,
        {
          check_ids: value.checks ?? [definition.check],
          evidence: value.evidence,
          proof_kind: value.proof_kind ?? "automated_contract"
        }
      ];
    })
  ))
));

export const CODEX_ACCEPTANCE_IDS = Object.freeze(
  Object.keys(CODEX_ACCEPTANCE_EVIDENCE)
);

function command(id, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HINDSIGHT_API_KEY: "", SUPERMEMORY_ALLOW_LIVE_HINDSIGHT: "" }
  });
  return {
    id,
    status: result.status === 0 ? "pass" : "fail",
    command: `${executable} ${args.join(" ")}`,
    stdout_tail: result.stdout.trim().split(/\r?\n/).slice(-4),
    stderr_tail: result.stderr.trim().split(/\r?\n/).slice(-4)
  };
}

function artifactCheck() {
  const required = [
    ".agents/plugins/marketplace.json",
    "plugins/supermemory/.codex-plugin/plugin.json",
    "plugins/supermemory/.mcp.json",
    "plugins/supermemory/hooks/hooks.json",
    "plugins/supermemory/skills/supermemory/SKILL.md",
    "scripts/run-codex-integration-canary.mjs",
    "scripts/supermemory-mcp.mjs",
    "scripts/supermemory-hook.mjs",
    "scripts/supermemory-app-server.mjs",
    "scripts/supermemory-codex.mjs",
    "docs/codex-supermemory-technical-design.md"
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  return { id: "release_artifacts", status: missing.length === 0 ? "pass" : "fail", missing };
}

export function buildReleaseReport({
  generatedAt = new Date().toISOString(),
  checks,
  codexVersion = null
}) {
  const checksById = new Map(checks.map((check) => [check.id, check]));
  const matrix = Object.fromEntries(CODEX_ACCEPTANCE_IDS.map((id) => {
    const definition = CODEX_ACCEPTANCE_EVIDENCE[id];
    const covered = definition.check_ids.every((checkId) => (
      checksById.get(checkId)?.status === "pass"
    ));
    return [
      id,
      {
        status: covered ? "covered" : "blocked",
        evidence: definition.evidence,
        proof_kind: definition.proof_kind,
        check_ids: definition.check_ids
      }
    ];
  }));
  const covered = Object.values(matrix).filter((entry) => entry.status === "covered").length;
  const passed = checks.every((check) => check.status === "pass") &&
    covered === CODEX_ACCEPTANCE_IDS.length;
  return {
    schema: "supermemory.codex-release-report.v1",
    generated_at: generatedAt,
    status: passed ? "pass" : "fail",
    readiness_level: passed ? "release-candidate" : "not-ready",
    release_candidate_ready: passed,
    production_ready: false,
    final_audit_required: true,
    sacrificial_local_canary: checksById.get("oracle_canary")?.status === "pass",
    customer_data_used: false,
    live_cloud_writes_performed: false,
    secrets_redacted: true,
    backup_rollback_verified: checksById.get("oracle_canary")?.status === "pass",
    codex_version: codexVersion,
    clients: {
      cli: {
        observed: Boolean(codexVersion),
        status: codexVersion ? "available" : "unavailable"
      },
      desktop: {
        observed: false,
        status: passed ? "app_server_contract_verified" : "blocked",
        claim: "No Desktop UI session was driven by this verifier."
      },
      ide: {
        observed: false,
        status: passed ? "hooks_mcp_contract_verified" : "blocked",
        claim: "No third-party IDE UI session was driven by this verifier."
      },
      cloud_web: {
        observed: false,
        status: "not_covered"
      }
    },
    acceptance: {
      total: CODEX_ACCEPTANCE_IDS.length,
      covered,
      matrix
    },
    limitations: [
      "This verifier is local and sacrificial; it performs no customer-data or cloud write.",
      "Desktop and IDE protocol contracts are verified, but their UIs are not claimed as observed.",
      "A final GoalBuddy audit and explicit post-report production decision remain required."
    ],
    checks
  };
}

export function runCodexReleaseVerification() {
  let resolvedCodex = null;
  try {
    resolvedCodex = resolveCodexExecutable();
  } catch {
    // The explicit codex_cli check below reports the unavailable client.
  }
  const codexVersion = resolvedCodex?.version ?? null;
  const checks = [
    command("s1_s4_acceptance", "node", ["--test",
      "tests/project-registry.test.mjs",
      "tests/codex-capture-pipeline.test.mjs",
      "tests/codex-memory-compiler.test.mjs",
      "tests/codex-hook-adapter.test.mjs",
      "tests/codex-app-server-adapter.test.mjs"
    ]),
    command("s5_s6_acceptance", "node", ["--test",
      "tests/codex-memory-governance.test.mjs",
      "tests/product-store-multi-workspace.test.mjs",
      "tests/codex-hindsight-recall.test.mjs",
      "tests/codex-mcp-server.test.mjs"
    ]),
    command("s7_acceptance", "node", ["--test",
      "tests/codex-lifecycle.test.mjs",
      "tests/codex-migration.test.mjs",
      "tests/codex-installer.test.mjs"
    ]),
    command("oracle_canary", "node", [
      "scripts/run-codex-integration-canary.mjs",
      "--json",
      ...(resolvedCodex ? ["--codex-executable", resolvedCodex.executable] : [])
    ]),
    command("client_diagnostics", "node", [
      "--test",
      "tests/supermemory-doctor.test.mjs"
    ]),
    command("secret_hygiene", "node", ["scripts/verify-secret-hygiene.mjs"]),
    command("diff_check", "git", ["diff", "--check"]),
    artifactCheck(),
    {
      id: "codex_cli",
      status: codexVersion ? "pass" : "fail",
      detail: codexVersion ?? "codex unavailable",
      executable: resolvedCodex?.executable ?? null
    }
  ];
  return buildReleaseReport({ checks, codexVersion });
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const report = runCodexReleaseVerification();
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const check of report.checks) {
      process.stdout.write(`${check.status.toUpperCase()} ${check.id}\n`);
    }
    process.stdout.write(`${report.status.toUpperCase()} Codex SuperMemory release\n`);
  }
  if (report.status !== "pass") process.exitCode = 1;
}
