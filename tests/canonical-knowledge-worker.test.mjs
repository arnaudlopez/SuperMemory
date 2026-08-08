import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalKnowledgeWorker } from "../scripts/lib/canonical-knowledge-worker.mjs";
import { canonicalJson } from "../scripts/lib/codex-redaction.mjs";
import { createKnowledgeGraphAdapter } from "../scripts/lib/knowledge-graph-adapter.mjs";
import { createMemoryAdmissionPolicy } from "../scripts/lib/memory-admission-policy.mjs";

const WORKSPACE = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";

function contentHash(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

test("Lot 4: canonical worker commits authority without depending on Hindsight or derived local enrichments", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-worker-"));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = { text: "Project A depended on Tool B yesterday" };
  const episodeId = "epi_018f7c0e-7b7d-7abc-8def-0123456789ad";
  const evidenceId = "wev_018f7c0e-7b7d-7abc-8def-0123456789ae";
  const source = {
    status: "active",
    reopened: true,
    payload,
    cursor: { owner: "codex:session-1", event_id: "evt_1", sequence: 1 },
    episode: {
      workspace_id: WORKSPACE,
      project_id: "prj_018f7c0e-7b7d-7abc-8def-0123456789ac",
      session_id: "session-1",
      episode_id: episodeId,
      evidence_ids: [evidenceId],
      source_event_ids: ["evt_1"],
      content_hash: contentHash(payload),
      observed_at: "2026-08-08T10:00:00.000Z",
      sensitivity: "standard"
    },
    evidence: {
      workspace_id: WORKSPACE,
      project_id: "prj_018f7c0e-7b7d-7abc-8def-0123456789ac",
      session_id: "session-1",
      episode_id: episodeId,
      evidence_id: evidenceId,
      event_id: "evt_1",
      source_adapter: "codex",
      source_sequence: 1,
      content_hash: contentHash(payload)
    }
  };
  const graphAdapter = createKnowledgeGraphAdapter({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 0x44),
    workspaceId: WORKSPACE,
    provenanceResolver: () => true,
    clock: () => "2026-08-08T12:00:00.000Z"
  });
  const episodeSource = {
    listCanonicalEvidence: () => [source],
    readClosedSession: () => ({
      workspace_id: WORKSPACE,
      session_id: "session-1",
      closed_at: "2026-08-08T11:59:00.000Z"
    }),
    listRevokedAdmissions: () => []
  };
  let projected = 0;
  const worker = createCanonicalKnowledgeWorker({
    vaultRoot: vault,
    encryptionKey: Buffer.alloc(32, 0x44),
    workspaceId: WORKSPACE,
    enabled: true,
    episodeSource,
    graphAdapter,
    admissionPolicy: createMemoryAdmissionPolicy({ clock: () => "2026-08-08T12:00:00.000Z" }),
    extractor: {
      identity: { provider: "fixture", model: "extractor", prompt_version: "v1" },
      extract: async () => ({
        claim_key: "project-a-depends-tool-b",
        text: "Project A depended on Tool B yesterday",
        entities: [
          { binding_id: "project:a", canonical_name: "Project A", entity_type: "Project", aliases: [] },
          { binding_id: "tool:b", canonical_name: "Tool B", entity_type: "Tool", aliases: [] }
        ],
        relations: [{
          relation_key: "project-a-tool-b",
          subject_binding_id: "project:a",
          predicate: "DEPENDS_ON",
          object_binding_id: "tool:b"
        }]
      })
    },
    verifier: {
      identity: { provider: "fixture", model: "verifier", prompt_version: "v2", independent: true },
      verify: async ({ extraction }) => {
        assert.equal("entity_id" in extraction.entities[0], false);
        assert.equal("relation_id" in extraction.relations[0], false);
        return {
          status: "verified",
          signals: {
            evidence_entailment: 0.99,
            source_trust: 0.99,
            extraction_agreement: 0.99,
            temporal_consistency: 0.99,
            contradiction_risk: 0,
            scope_valid: true,
            ontology_compatible: true,
            alias_binding_verified: true
          }
        };
      }
    },
    learnedPlane: {
      async projectCanonicalClaim() {
        projected += 1;
        throw Object.assign(new Error("offline"), { code: "hindsight_unavailable" });
      }
    },
    clock: () => "2026-08-08T12:00:00.000Z"
  });
  const firstRecovery = await worker.recover();
  assert.equal(firstRecovery.status, "complete");
  assert.equal(firstRecovery.sessions, 1);
  const first = firstRecovery.results[0].canonical;
  assert.equal(first.status, "complete");
  assert.equal(first.processed, 1);
  assert.equal(first.results[0].learned.status, "degraded_retryable");
  assert.equal(projected, 1);
  const state = graphAdapter.readCanonicalState({ workspaceId: WORKSPACE });
  assert.equal(state.claims.length, 1);
  assert.equal(state.relations.length, 1);
  assert.equal(state.claims[0].observed_at, "2026-08-08T10:00:00.000Z");
  assert.equal(state.claims[0].event_time.earliest, "2026-08-07T00:00:00.000Z");
  assert.equal(state.relations[0].event_time.earliest, "2026-08-07T00:00:00.000Z");
  assert.equal(await fs.promises.stat(worker.root).then(() => true), true);
  assert.deepEqual(fs.readdirSync(worker.root), ["checkpoint.aead.json"]);
  assert.deepEqual(worker.status(), {
    enabled: true,
    status: "ready",
    checkpoint: 1,
    last_outcome: "auto_activate",
    last_error: null,
    last_verification: null,
    last_extraction_shape: null,
    last_processed: 1
  });
  assert.equal((await worker.process()).processed, 0);
});
