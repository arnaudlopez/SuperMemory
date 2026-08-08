import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryAuthorityPolicy } from "../scripts/lib/memory-authority-policy.mjs";

const KEY = Buffer.alloc(32, 4);
const WORKSPACE_ID = "ws_018f1234-5678-7abc-8def-0123456789ac";
const PROJECT_ID = "prj_018f1234-5678-7abc-8def-0123456789ab";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "authority-policy-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let tick = Date.parse("2026-08-08T10:00:00Z");
  return createMemoryAuthorityPolicy({
    vaultRoot: vault, encryptionKey: KEY, workspaceId: WORKSPACE_ID, projectId: PROJECT_ID,
    clock: () => new Date(tick++).toISOString()
  });
}

function claim(id, observedAt, overrides = {}) {
  return {
    claim_id: id, claim_key: overrides.claimKey ?? "preference.editor",
    workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, topic_id: "topic-a",
    fact_class: overrides.factClass ?? "user_preference", observed_at: observedAt,
    evidence_ids: [`wev-${id}`], proof_strength: overrides.proofStrength ?? "strong",
    explicit: overrides.explicit ?? true, authenticated: overrides.authenticated ?? false,
    inferred: overrides.inferred ?? false
  };
}

test("QA-AC03: latest explicit owner preference supersedes prior state with audit history", (t) => {
  const policy = fixture(t);
  const first = policy.evaluate({ claim: claim("mem-a", "2026-08-01T10:00:00Z") });
  const second = policy.evaluate({ claim: claim("mem-b", "2026-08-02T10:00:00Z") });
  assert.equal(first.state.state, "current");
  assert.equal(second.state.state, "current");
  assert.deepEqual(second.state.supersedes, ["mem-a"]);
  assert.equal(policy.get({ claimId: "mem-a" }).state, "superseded");
  assert.equal(policy.resolveCurrent({ claimKey: "preference.editor", topicId: "topic-a" }).claim_id, "mem-b");
});

test("QA-AC04/10/13: weak conflicts and inferred permissions never become current", (t) => {
  const policy = fixture(t);
  const weak = policy.evaluate({ claim: claim("mem-weak", "2026-08-01T10:00:00Z", { proofStrength: "weak" }) });
  assert.equal(weak.state.state, "disputed");
  const permission = policy.evaluate({ claim: claim("mem-permission", "2026-08-02T10:00:00Z", {
    claimKey: "permission.delete", factClass: "permission", explicit: false, inferred: true
  }) });
  assert.equal(permission.state.state, "disputed");
  assert.match(permission.state.reason_codes[0], /permission_requires/);
});

test("revocation and TTL take authority away before any projection cleanup", (t) => {
  const policy = fixture(t);
  policy.evaluate({ claim: { ...claim("mem-ttl", "2026-08-08T10:00:00Z"), ttl_ms: 1 } });
  assert.equal(policy.resolveCurrent({ claimKey: "preference.editor", topicId: "topic-a", at: "2026-08-08T10:00:00.002Z" }).state, "expired");
  policy.revoke({ claimId: "mem-ttl" });
  assert.equal(policy.get({ claimId: "mem-ttl" }).state, "revoked");
});

test("QA-AC01/02/05: strong standard facts are current, fresh machine state supersedes, and temporary observations expire", (t) => {
  const policy = fixture(t);
  const standard = policy.evaluate({ claim: claim("mem-standard", "2026-08-01T10:00:00Z", {
    claimKey: "external.standard", factClass: "external_fact"
  }) });
  assert.equal(standard.state.state, "current");
  policy.evaluate({ claim: claim("mem-machine-a", "2026-08-02T10:00:00Z", {
    claimKey: "machine.health", factClass: "machine_state", authenticated: true
  }) });
  const machine = policy.evaluate({ claim: claim("mem-machine-b", "2026-08-03T10:00:00Z", {
    claimKey: "machine.health", factClass: "machine_state", authenticated: true
  }) });
  assert.equal(machine.state.state, "current");
  assert.deepEqual(machine.state.supersedes, ["mem-machine-a"]);
  const temporary = policy.evaluate({ claim: {
    ...claim("mem-temporary", "2026-08-08T10:00:00Z", {
      claimKey: "derived.temporary", factClass: "derived_observation"
    }),
    ttl_ms: 1
  } });
  assert.equal(temporary.state.state, "provisional");
  assert.equal(policy.resolveCurrent({
    claimKey: "derived.temporary", topicId: "topic-a", at: "2026-08-08T10:00:00.002Z"
  }).state, "expired");
});

test("QA-AC14: the standard strong corpus creates no user prompt state", (t) => {
  const policy = fixture(t);
  for (let index = 0; index < 100; index += 1) {
    const result = policy.evaluate({ claim: claim(`mem-corpus-${index}`, "2026-08-01T10:00:00Z", {
      claimKey: `standard.${index}`, factClass: "external_fact"
    }) });
    assert.equal(result.state.state, "current");
  }
  assert.equal(policy.list().filter((item) => ["provisional", "disputed"].includes(item.state)).length, 0);
});
