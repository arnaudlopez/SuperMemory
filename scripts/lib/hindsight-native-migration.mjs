import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, openJsonAead, sealJsonAead } from "./codex-redaction.mjs";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function createHindsightNativeMigrator({
  vaultRoot,
  encryptionKey,
  workspaceId,
  graphAdapter,
  gateway,
  activeMemorySource,
  bankTemplate,
  clock = () => new Date().toISOString()
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) fail("hindsight_migration_key_invalid");
  if (!/^ws_[A-Za-z0-9._:-]{8,}$/.test(String(workspaceId ?? ""))) fail("hindsight_migration_scope_invalid");
  if (!graphAdapter?.projectionHash || !graphAdapter?.rebuildProjectionAsync) fail("hindsight_migration_graph_invalid");
  if (!gateway?.project || !gateway?.consolidate || !gateway?.ensureBankTemplate) fail("hindsight_migration_gateway_invalid");
  if (typeof activeMemorySource !== "function" || !bankTemplate) fail("hindsight_migration_source_invalid");
  const vault = fs.realpathSync(path.resolve(vaultRoot));
  const root = path.join(vault, "20_professional", "memory-fabric", workspaceId, "migrations");
  const receiptPath = path.join(root, "hindsight-native-v090.aead.json");
  const aad = `supermemory.hindsight-native-migration.v1\0${workspaceId}`;

  const active = () => activeMemorySource({ workspaceId })
    .filter((memory) => memory.workspace_id === workspaceId && memory.status === "active")
    .sort((left, right) => left.memory_id.localeCompare(right.memory_id));

  const plan = () => {
    const body = {
      schema: "supermemory.hindsight-native-migration-plan.v1",
      workspace_id: workspaceId,
      source: "hindsight-0.6.2-derived-volume",
      target: "hindsight-0.9.0-fresh-derived-volume",
      graph_projection_hash: graphAdapter.projectionHash({ workspaceId }),
      memory_ids: active().map((item) => item.memory_id),
      bank_template_hash: digest(bankTemplate),
      immutable_vault_rewrite: false
    };
    return Object.freeze({ ...body, plan_hash: digest(body) });
  };

  const readReceipt = () => {
    if (!fs.existsSync(receiptPath)) return null;
    const stat = fs.lstatSync(receiptPath);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("hindsight_migration_receipt_insecure");
    return openJsonAead(JSON.parse(fs.readFileSync(receiptPath, "utf8")), {
      encryptionKey,
      expectedAad: aad
    });
  };

  const execute = async ({ planHash } = {}) => {
    const migrationPlan = plan();
    if (planHash !== migrationPlan.plan_hash) fail("hindsight_migration_plan_mismatch");
    const existing = readReceipt();
    if (existing?.plan_hash === planHash && existing.status === "complete") return existing;
    const template = await gateway.ensureBankTemplate(bankTemplate);
    if (template.status !== "applied") fail("hindsight_migration_template_drift");
    const graph = await graphAdapter.rebuildProjectionAsync({ workspaceId });
    if (graph.projection_hash !== migrationPlan.graph_projection_hash) fail("hindsight_migration_graph_hash_mismatch");
    const operations = [];
    for (const memory of active()) operations.push(await gateway.project(memory));
    const consolidation = await gateway.consolidate([
      ["consumer:codex", "sensitivity:standard", "domain:project"]
    ]);
    const receipt = {
      schema: "supermemory.hindsight-native-migration-receipt.v1",
      workspace_id: workspaceId,
      plan_hash: planHash,
      status: "complete",
      graph_projection_hash: graph.projection_hash,
      memories_projected: operations.length,
      operation_ids: operations.map((item) => item.operation_id).filter(Boolean).sort(),
      consolidation_operation_id: consolidation?.operation_id ?? null,
      completed_at: clock(),
      immutable_vault_rewrite: false
    };
    atomicWrite(receiptPath, `${canonicalJson(sealJsonAead(receipt, { encryptionKey, aad }))}\n`);
    return readReceipt();
  };
  return Object.freeze({ workspaceId, root, plan, execute, readReceipt });
}
