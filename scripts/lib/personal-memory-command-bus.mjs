import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validateScope(scope, requested) {
  if (requested?.kind === "owner" && scope?.ownerId) return { kind: "owner", owner_id: scope.ownerId };
  if (requested?.kind !== "project" || !scope?.allowedProjectIds?.includes(requested.project_id)) fail("personal_memory_scope_forbidden");
  return { kind: "project", project_id: requested.project_id };
}

function memoryId(command) {
  return `mem_${crypto.createHash("sha256").update(String(command.idempotency_key)).digest("base64url").slice(0, 32)}`;
}

function explicitlyRequestsPin(message) {
  return /\b(?:retiens|m[ée]morise|garde\s+(?:ça|cela|ceci)?\s*en\s+m[ée]moire|remember)\b/i.test(String(message ?? ""));
}

export function createPersonalMemoryCommandBus({ revisionStore, intentGate, projectionQueue = { enqueue: async () => {} }, sanitizePatch = (patch) => ({ patch, findings: {} }) } = {}) {
  if (!revisionStore || !intentGate || typeof projectionQueue?.enqueue !== "function" || typeof sanitizePatch !== "function") fail("personal_memory_command_bus_invalid");

  const execute = async ({ scope, token, command } = {}) => {
    if (command?.schema !== "supermemory.personal-memory-command.v1" || !command.command_id || !command.idempotency_key) fail("personal_memory_command_invalid");
    const fingerprint = hash(command);
    const prior = revisionStore.receipt(command.idempotency_key);
    if (prior) {
      if (prior.command_hash !== fingerprint) fail("idempotency_conflict");
      return { ...prior.result, status: "duplicate" };
    }
    const operation = command.operation;
    if (!new Set(["add", "update", "resolve", "supersede"]).has(operation)) fail("personal_memory_operation_invalid");
    const effectiveScope = validateScope(scope, command.scope);
    const intent = intentGate.verify({ token, scope, operation, userInstruction: command.user_instruction });
    if (revisionStore.hasNonce(intent.nonce)) fail("intent_replayed");
    revisionStore.recordNonce(intent.nonce, command.command_id);
    const requestedPatch = operation === "add" && explicitlyRequestsPin(command.user_instruction?.message)
      ? { ...(command.patch ?? {}), pinned: true, recall_priority: 1 }
      : command.patch ?? {};
    const sanitized = sanitizePatch(requestedPatch);
    if (!sanitized?.patch || typeof sanitized.patch !== "object" || Array.isArray(sanitized.patch)) fail("personal_memory_patch_invalid");

    let revision;
    let targetId = command.target?.memory_id;
    let previous = null;
    const provenance = {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      agent_id: scope.agentId,
      owner_id: scope.ownerId,
      turn_id: intent.turn_id,
      message_hash: intent.message_hash,
      redaction: sanitized.findings ?? {}
    };
    if (operation === "add") {
      if (targetId || command.expected_revision !== null) fail("personal_memory_command_invalid");
      targetId = memoryId(command);
      revision = revisionStore.create({ memoryId: targetId, scope: effectiveScope, patch: sanitized.patch, provenance });
    } else {
      if (!targetId || !Number.isInteger(command.expected_revision)) fail("personal_memory_command_invalid");
      previous = revisionStore.current({ memoryId: targetId });
      revision = revisionStore.revise({ memoryId: targetId, expectedRevision: command.expected_revision, patch: sanitized.patch, provenance });
    }
    const operationId = `op_${crypto.createHash("sha256").update(command.command_id).digest("base64url").slice(0, 24)}`;
    const result = {
      schema: "supermemory.personal-memory-command-receipt.v1",
      status: "committed",
      command_id: command.command_id,
      operation_id: operationId,
      memory_id: targetId,
      scope: effectiveScope,
      revision,
      superseded_revision: previous ? { memory_id: targetId, revision: previous.revision, valid_from: previous.valid_from, valid_until: revision.valid_from } : null,
      projections: { hindsight: "queued", graph: "canonical_worker_only" },
      rollback: { operation: "supersede", memory_id: targetId, expected_revision: revision.revision },
      committed_at: revision.valid_from
    };
    result.receipt_hash = hash(result);
    result.signature = `hmac-sha256:${crypto.createHmac("sha256", token).update(result.receipt_hash).digest("hex")}`;
    revisionStore.recordReceipt(command.idempotency_key, { command_hash: fingerprint, result });
    try {
      await projectionQueue.enqueue({
        schema: "supermemory.personal-memory-projection-job.v1",
        operation,
        operation_id: operationId,
        memory_id: targetId,
        revision: revision.revision,
        scope: effectiveScope
      });
    } catch {
      // Canonical authority is already committed; derived projection is repairable.
    }
    return result;
  };

  const verifyForgetIntent = ({ scope, token, userInstruction }) => {
    const intent = intentGate.verify({ token, scope, operation: "forget", userInstruction });
    if (revisionStore.hasNonce(intent.nonce)) fail("intent_replayed");
    revisionStore.recordNonce(intent.nonce, `forget:${intent.turn_id}`);
    return intent;
  };

  const planForget = ({ scope, token, userInstruction, memoryId: targetId } = {}) => {
    verifyForgetIntent({ scope, token, userInstruction });
    const revision = revisionStore.current({ memoryId: targetId });
    const authorized = revision?.scope?.kind === "owner"
      ? revision.scope.owner_id === scope?.ownerId
      : scope?.allowedProjectIds?.includes(revision?.scope?.project_id);
    if (!revision || !authorized) fail("personal_memory_not_found");
    const plan = {
      schema: "supermemory.personal-memory-forget-plan.v1",
      plan_id: `pmfp_${crypto.randomUUID()}`,
      memory_id: targetId,
      expected_revision: revision.revision,
      owner_id: scope.ownerId,
      agent_id: scope.agentId,
      applied: false
    };
    plan.plan_hash = hash(plan);
    return revisionStore.putForgetPlan(plan);
  };

  const applyForget = ({ scope, token, userInstruction, planId, planHash } = {}) => {
    verifyForgetIntent({ scope, token, userInstruction });
    const plan = revisionStore.getForgetPlan(planId);
    if (!plan || plan.applied || plan.owner_id !== scope?.ownerId || plan.agent_id !== scope?.agentId || plan.plan_hash !== planHash) fail("forget_confirmation_invalid");
    const revision = revisionStore.revoke({
      memoryId: plan.memory_id,
      expectedRevision: plan.expected_revision,
      provenance: { plan_id: plan.plan_id, owner_id: scope.ownerId, agent_id: scope.agentId }
    });
    revisionStore.markForgetPlanApplied(plan.plan_id);
    const operationId = `op_${crypto.createHash("sha256").update(plan.plan_id).digest("base64url").slice(0, 24)}`;
    void projectionQueue.enqueue({ schema: "supermemory.personal-memory-projection-job.v1", operation: "forget", operation_id: operationId, memory_id: plan.memory_id, revision: revision.revision, scope: revision.scope }).catch(() => {});
    const receipt = {
      schema: "supermemory.personal-memory-command-receipt.v1",
      status: "committed",
      operation_id: operationId,
      memory_id: plan.memory_id,
      revision,
      projections: { hindsight: "queued", graph: "canonical_worker_only" },
      committed_at: revision.valid_from
    };
    receipt.receipt_hash = hash(receipt);
    receipt.signature = `hmac-sha256:${crypto.createHmac("sha256", token).update(receipt.receipt_hash).digest("hex")}`;
    return receipt;
  };

  return Object.freeze({ execute, planForget, applyForget });
}
