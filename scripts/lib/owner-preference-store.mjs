import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openJsonAead, sealJsonAead } from "./codex-redaction.mjs";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const CATEGORIES = new Set(["personal_preference", "cross_project_convention", "infrastructure_choice"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function tokens(value) {
  return new Set(String(value ?? "").toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

export function createOwnerPreferenceStore({
  vaultRoot,
  encryptionKey,
  ownerScope,
  clock = () => new Date().toISOString()
} = {}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32 || !ownerScope?.workspaceId) {
    fail("owner_store_invalid");
  }
  const directory = path.join(
    path.resolve(vaultRoot),
    "20_professional",
    "memory-fabric",
    ownerScope.workspaceId,
    "owner"
  );
  const target = path.join(directory, "preferences.json.aead");
  const aad = `supermemory.owner-preferences.v1.${ownerScope.workspaceId}`;
  const read = () => {
    if (!fs.existsSync(target)) return [];
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("owner_store_corrupt");
    const value = openJsonAead(JSON.parse(fs.readFileSync(target, "utf8")), {
      encryptionKey,
      expectedAad: aad
    });
    if (value?.schema !== "supermemory.owner-preferences.v1" || !Array.isArray(value.memories)) {
      fail("owner_store_corrupt");
    }
    return value.memories;
  };
  const write = (memories) => {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(sealJsonAead({
      schema: "supermemory.owner-preferences.v1",
      workspace_id: ownerScope.workspaceId,
      project_id: ownerScope.projectId,
      memories
    }, { encryptionKey, aad }))}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
    fs.chmodSync(target, 0o600);
  };
  const promote = ({
    title,
    text,
    category,
    sourceProjectId = null,
    evidenceIds = [],
    confirmation
  } = {}) => withVaultMutationLock(path.resolve(vaultRoot), () => {
    if (
      confirmation !== "PROMOTE OWNER" || !CATEGORIES.has(category) ||
      typeof title !== "string" || !title.trim() || typeof text !== "string" || !text.trim() ||
      !Array.isArray(evidenceIds) || evidenceIds.length === 0
    ) fail("owner_promotion_invalid");
    const idMaterial = JSON.stringify({ title: title.trim(), text: text.trim(), category, sourceProjectId, evidenceIds: [...evidenceIds].sort() });
    const memoryId = `owner_${crypto.createHash("sha256").update(idMaterial).digest("hex")}`;
    const memories = read();
    const existing = memories.find((item) => item.memory_id === memoryId);
    if (existing) return { ...existing, status: "duplicate" };
    const memory = {
      memory_id: memoryId,
      title: title.trim().slice(0, 240),
      text: text.trim().slice(0, 16_000),
      category,
      source_project_id: sourceProjectId,
      evidence_ids: [...new Set(evidenceIds)],
      approved_at: clock(),
      status: "active",
      scope_transition: "project_to_owner"
    };
    write([...memories, memory]);
    return memory;
  });
  const search = async ({ query, limit = 5 } = {}) => {
    const requested = tokens(query);
    const results = read().map((memory) => {
      const corpus = tokens(`${memory.title} ${memory.text}`);
      const overlap = [...requested].filter((token) => corpus.has(token)).length;
      return {
        memory_id: memory.memory_id,
        text: memory.text,
        title: memory.title,
        score: requested.size === 0 ? 0 : overlap / requested.size,
        citations: [{
          scope: "owner",
          source_project_id: memory.source_project_id,
          evidence_ids: memory.evidence_ids,
          approved_at: memory.approved_at
        }]
      };
    }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, limit);
    return { results, partial: false };
  };
  return Object.freeze({ promote, search, list: read });
}
