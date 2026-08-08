import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DocumentExtractionError, extractBinaryDocument } from "./document-extractors.mjs";
import {
  createMemoryAdmissionPolicy,
  verifyAdmissionDecision
} from "./memory-admission-policy.mjs";

const STORE_VERSION = 1;
const MAX_FILES = 250;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_CANDIDATES_PER_FILE = 120;
const MAX_CANDIDATE_CHARS = 1_600;
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const BINARY_EXTENSIONS = new Set([".pdf", ".docx"]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);

export class ProductError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "ProductError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function contentHash(bytes) {
  return `sha256:${sha256(bytes)}`;
}

function stableId(prefix, ...parts) {
  return `${prefix}:${sha256(parts.join("\u0000")).slice(0, 24)}`;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureSafeDirectory(rootReal, relativeDirectory) {
  let current = rootReal;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new ProductError("vault_path_invalid", `Vault path is not a safe directory: ${relativeDirectory}`, 500);
      }
    } else {
      fs.mkdirSync(next, { mode: 0o700 });
    }
    current = fs.realpathSync(next);
    if (!isInside(rootReal, current)) {
      throw new ProductError("vault_scope_escape", "A vault path escaped the configured root.", 500);
    }
  }
  return current;
}

function atomicWrite(filePath, bytes, mode = 0o600) {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", mode);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, mode);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProductError("relative_path_required", "Each document needs a relative path.");
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\u0000") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ProductError("relative_path_invalid", `Unsafe document path: ${value}`);
  }
  return normalized;
}

function cleanFolderName(value) {
  const folder = String(value ?? "Dossier local").trim();
  return folder.slice(0, 160) || "Dossier local";
}

function extensionOf(relativePath) {
  return path.posix.extname(relativePath).toLowerCase();
}

function isDefaultExcluded(relativePath) {
  const segments = relativePath.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.some((segment) => [".git", "node_modules", "tmp", "dist", "build"].includes(segment)) ||
    basename === ".env" ||
    basename.startsWith(".env.")
  );
}

function isSecretLike(text) {
  return /(sk-[A-Za-z0-9_-]+|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|TOKEN\s*=)/i.test(text);
}

function sourceTitle(relativePath) {
  const basename = path.posix.basename(relativePath, extensionOf(relativePath));
  return basename.replace(/[-_]+/g, " ").trim() || relativePath;
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n");
}

function splitLongBlock(block) {
  if (block.text.length <= MAX_CANDIDATE_CHARS) return [block];
  const chunks = [];
  for (let offset = 0; offset < block.text.length; offset += MAX_CANDIDATE_CHARS) {
    chunks.push({
      ...block,
      text: block.text.slice(offset, offset + MAX_CANDIDATE_CHARS).trim()
    });
  }
  return chunks.filter((chunk) => chunk.text);
}

function candidateBlocks(text, relativePath) {
  const lines = normalizeText(text).split("\n");
  const blocks = [];
  let heading = sourceTitle(relativePath);
  let buffer = [];
  let startLine = 1;

  const flush = (endLine) => {
    const value = buffer.join("\n").trim();
    if (value) {
      blocks.push(...splitLongBlock({
        title: heading,
        text: value,
        lineStart: startLine,
        lineEnd: Math.max(startLine, endLine)
      }));
    }
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const markdownHeading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (markdownHeading) {
      flush(index);
      heading = markdownHeading[1].trim() || heading;
      startLine = index + 2;
      continue;
    }
    if (line.trim() === "") {
      flush(index);
      startLine = index + 2;
      continue;
    }
    if (buffer.length === 0) startLine = index + 1;
    buffer.push(line);
  }
  flush(lines.length);

  if (blocks.length === 0 && text.trim()) {
    blocks.push({
      title: sourceTitle(relativePath),
      text: text.trim().slice(0, MAX_CANDIDATE_CHARS),
      lineStart: 1,
      lineEnd: Math.max(1, lines.length)
    });
  }
  return blocks.slice(0, MAX_CANDIDATES_PER_FILE);
}

function binaryCandidateBlocks(segments) {
  const blocks = [];
  for (const segment of segments) {
    const chunks = splitLongBlock({
      title: segment.title,
      text: segment.text,
      locator: segment.locator,
      lineStart: null,
      lineEnd: null
    });
    blocks.push(...chunks);
  }
  return blocks.slice(0, MAX_CANDIDATES_PER_FILE);
}

function locatorLabel(relativePath, locator, lineStart, lineEnd) {
  if (locator?.kind === "pdf_page") return `${relativePath}, page ${locator.page}`;
  if (locator?.kind === "docx_section") {
    return `${relativePath}, section ${locator.section} — ${locator.heading}`;
  }
  return `${relativePath}, lignes ${lineStart}-${lineEnd}`;
}

function initialState(workspaceId, createdAt) {
  return {
    version: STORE_VERSION,
    workspace: {
      workspaceId,
      folderName: null,
      createdAt,
      updatedAt: createdAt
    },
    sources: [],
    snapshots: [],
    candidates: [],
    memories: [],
    deletions: []
  };
}

function assertState(value) {
  if (
    !value ||
    value.version !== STORE_VERSION ||
    !value.workspace ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.snapshots) ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.memories)
  ) {
    throw new ProductError("product_state_invalid", "The local product state is invalid or unsupported.", 500);
  }
  return value;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function memoryMarkdown(memory) {
  const locator = memory.locator ?? {
    kind: "text_lines",
    lineStart: memory.lineStart,
    lineEnd: memory.lineEnd
  };
  return [
    "---",
    `memory_id: ${yamlString(memory.memoryId)}`,
    `candidate_id: ${yamlString(memory.candidateId)}`,
    `source_id: ${yamlString(memory.sourceId)}`,
    `snapshot_id: ${yamlString(memory.snapshotId)}`,
    `source_path: ${yamlString(memory.relativePath)}`,
    `locator_kind: ${yamlString(locator.kind)}`,
    `locator: ${yamlString(JSON.stringify(locator))}`,
    `status: ${memory.status}`,
    `approved_at: ${yamlString(memory.approvedAt)}`,
    `admission_id: ${yamlString(memory.admissionId ?? "legacy_manual")}`,
    `admission_decision: ${yamlString(memory.admissionDecision ?? "legacy_manual")}`,
    `valid_until: ${yamlString(memory.validUntil ?? "")}`,
    `hindsight_document_id: ${yamlString(memory.projection?.documentId ?? "")}`,
    `hindsight_projection_status: ${yamlString(memory.projection?.status ?? "queued")}`,
    "---",
    "",
    `# ${memory.title}`,
    "",
    memory.text,
    "",
    `> Source: ${locatorLabel(memory.relativePath, locator, memory.lineStart, memory.lineEnd)}`,
    ""
  ].join("\n");
}

function tokenize(value) {
  return [...new Set(
    String(value ?? "")
      .toLocaleLowerCase("fr")
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  )];
}

function occurrences(haystack, needle) {
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

export function createProductStore({
  vaultRoot,
  workspaceId = "workspace:local",
  clock = () => new Date().toISOString(),
  hindsight = null,
  admissionMode = "legacy_manual",
  admissionPolicy = null,
  verifier = null
}) {
  if (!vaultRoot) throw new ProductError("vault_root_required", "A local vault root is required.", 500);
  const requestedRoot = path.resolve(vaultRoot);
  fs.mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(requestedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ProductError("vault_root_invalid", "The configured vault root is not a safe directory.", 500);
  }
  const vaultReal = fs.realpathSync(requestedRoot);
  const stateDirectory = ensureSafeDirectory(vaultReal, "00_inbox/supermemory-product");
  const memoryDirectory = ensureSafeDirectory(vaultReal, "20_professional/product-memories");
  const admissionDirectory = ensureSafeDirectory(vaultReal, "20_professional/admissions/product");
  const logDirectory = ensureSafeDirectory(vaultReal, "80_logs");
  const statePath = path.join(stateDirectory, "state.json");
  const eventLogPath = path.join(logDirectory, "product-events.jsonl");
  if (!["legacy_manual", "automatic"].includes(admissionMode)) {
    throw new ProductError("admission_mode_invalid", "Le mode d’admission est invalide.", 500);
  }
  if (verifier !== null && typeof verifier.verify !== "function") {
    throw new ProductError("admission_verifier_invalid", "Le vérificateur d’admission est invalide.", 500);
  }
  const policy = admissionPolicy ?? createMemoryAdmissionPolicy({ clock });

  const readState = () => {
    if (!fs.existsSync(statePath)) return initialState(workspaceId, clock());
    const stat = fs.lstatSync(statePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ProductError("product_state_invalid", "The local product state path is unsafe.", 500);
    }
    try {
      const state = assertState(JSON.parse(fs.readFileSync(statePath, "utf8")));
      state.deletions ??= [];
      if (!Array.isArray(state.deletions)) {
        throw new ProductError("product_state_invalid", "The local deletion queue is invalid.", 500);
      }
      return state;
    } catch (error) {
      if (error instanceof ProductError) throw error;
      throw new ProductError("product_state_unreadable", "The local product state cannot be read.", 500);
    }
  };

  const writeState = (state) => {
    assertState(state);
    atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };

  const appendEvent = (event) => {
    fs.appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    fs.chmodSync(eventLogPath, 0o600);
  };

  const snapshotArtifact = (bytes, hash) => {
    const hex = hash.replace(/^sha256:/, "");
    const directory = ensureSafeDirectory(vaultReal, `00_inbox/snapshots/sha256/${hex.slice(0, 2)}`);
    const artifactPath = path.join(directory, `${hex}.snapshot`);
    if (fs.existsSync(artifactPath)) {
      const stat = fs.lstatSync(artifactPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new ProductError("snapshot_artifact_invalid", "An existing snapshot artifact is unsafe.", 500);
      }
      const existing = fs.readFileSync(artifactPath);
      if (contentHash(existing) !== hash) {
        throw new ProductError("snapshot_artifact_conflict", "An existing snapshot does not match its hash.", 500);
      }
      fs.chmodSync(artifactPath, 0o600);
    } else {
      const descriptor = fs.openSync(artifactPath, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    return path.relative(vaultReal, artifactPath).split(path.sep).join("/");
  };

  const writeMemory = (memory) => {
    const memoryPath = path.join(memoryDirectory, `${memory.memoryId.replaceAll(":", "-")}.md`);
    atomicWrite(memoryPath, memoryMarkdown(memory));
    return path.relative(vaultReal, memoryPath).split(path.sep).join("/");
  };

  const writeAdmission = (admission) => {
    if (!verifyAdmissionDecision(admission)) {
      throw new ProductError("admission_artifact_invalid", "La décision d’admission est invalide.", 500);
    }
    const target = path.join(admissionDirectory, `${admission.admission_id}.json`);
    const content = `${JSON.stringify(admission, null, 2)}\n`;
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, "utf8") !== content) {
        throw new ProductError("admission_artifact_conflict", "La décision d’admission est immuable.", 409);
      }
      return target;
    }
    atomicWrite(target, content);
    return target;
  };

  const removeVaultFile = (relativePath) => {
    if (!relativePath) return false;
    const filePath = path.resolve(vaultReal, relativePath);
    if (!isInside(vaultReal, filePath) || !fs.existsSync(filePath)) return false;
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new ProductError("vault_file_invalid", "Un fichier canonique à supprimer est invalide.", 500);
    }
    fs.rmSync(filePath);
    return true;
  };

  const queueDerivedDeletion = (state, memory, reason, queuedAt) => {
    const documentId = memory.projection?.documentId ?? memory.memoryId;
    const deletionId = stableId("deletion", documentId);
    const existing = state.deletions.find((item) => item.deletionId === deletionId);
    if (existing) {
      if (existing.status !== "deleted") return false;
      existing.reason = reason;
      existing.status = "pending";
      existing.queuedAt = queuedAt;
      existing.lastAttemptAt = null;
      existing.completedAt = null;
      existing.errorCode = null;
      return true;
    }
    state.deletions.push({
      deletionId,
      sourceId: memory.sourceId,
      memoryId: memory.memoryId,
      documentId,
      reason,
      status: "pending",
      queuedAt,
      attempts: 0,
      lastAttemptAt: null,
      completedAt: null,
      errorCode: null
    });
    return true;
  };

  const markSourceDerivedState = (state, sourceId, reviewedAt) => {
    let staleMemories = 0;
    for (const candidate of state.candidates) {
      if (candidate.sourceId === sourceId && ["pending", "approved"].includes(candidate.status)) {
        candidate.status = "superseded";
        candidate.reviewedAt = reviewedAt;
      }
    }
    for (const memory of state.memories) {
      if (memory.sourceId === sourceId && memory.status === "active") {
        memory.status = "stale";
        memory.staleAt = reviewedAt;
        if (memory.projection) memory.projection.status = "revocation_pending";
        queueDerivedDeletion(state, memory, "source_changed", reviewedAt);
        memory.memoryPath = writeMemory(memory);
        staleMemories += 1;
      }
    }
    return staleMemories;
  };

  const markSourcePendingRemoval = (state, source, reason, detectedAt) => {
    if (source.status === "pending_removal") return false;
    source.status = "pending_removal";
    source.removalReason = reason;
    source.removalDetectedAt = detectedAt;
    for (const candidate of state.candidates) {
      if (candidate.sourceId === source.sourceId && candidate.status === "pending") {
        candidate.status = "source_missing";
      }
    }
    for (const memory of state.memories) {
      if (memory.sourceId !== source.sourceId || memory.status !== "active") continue;
      memory.previousStatus = "active";
      memory.status = "deletion_pending";
      memory.memoryPath = writeMemory(memory);
    }
    return true;
  };

  const restorePendingSource = (state, source) => {
    if (source.status !== "pending_removal") return false;
    source.status = "active";
    source.removalReason = null;
    source.removalDetectedAt = null;
    for (const candidate of state.candidates) {
      if (candidate.sourceId === source.sourceId && candidate.status === "source_missing") {
        candidate.status = "pending";
      }
    }
    for (const memory of state.memories) {
      if (
        memory.sourceId === source.sourceId &&
        memory.status === "deletion_pending" &&
        memory.previousStatus === "active"
      ) {
        memory.status = "active";
        delete memory.previousStatus;
        memory.memoryPath = writeMemory(memory);
      }
    }
    return true;
  };

  const attemptProjection = async (memoryId) => {
    const state = readState();
    const memory = state.memories.find((item) => item.memoryId === memoryId);
    if (!memory || memory.status !== "active") {
      throw new ProductError("memory_not_active", "Cette mémoire ne peut pas être projetée.", 409);
    }
    memory.projection ??= {
      documentId: memory.memoryId,
      status: "queued",
      attempts: 0,
      lastAttemptAt: null,
      syncedAt: null,
      errorCode: null
    };
    memory.projection.attempts += 1;
    memory.projection.lastAttemptAt = clock();
    memory.projection.status = "syncing";
    memory.projection.errorCode = null;
    memory.memoryPath = writeMemory(memory);
    writeState(state);

    if (!hindsight?.enabled) {
      memory.projection.status = "queued";
      memory.projection.errorCode = "hindsight_disabled";
      memory.memoryPath = writeMemory(memory);
      writeState(state);
      return memory.projection;
    }

    try {
      const result = await hindsight.project(memory);
      memory.projection.documentId = result.documentId;
      memory.projection.status = "synced";
      memory.projection.syncedAt = clock();
      memory.projection.errorCode = null;
      memory.memoryPath = writeMemory(memory);
      writeState(state);
      appendEvent({
        event: "hindsight_projection_synced",
        at: memory.projection.syncedAt,
        memoryId,
        documentId: result.documentId,
        attempts: memory.projection.attempts
      });
    } catch (error) {
      memory.projection.status = "queued";
      memory.projection.errorCode = String(error?.code || "hindsight_unavailable").slice(0, 120);
      memory.memoryPath = writeMemory(memory);
      writeState(state);
      appendEvent({
        event: "hindsight_projection_queued",
        at: clock(),
        memoryId,
        documentId: memory.projection.documentId,
        errorCode: memory.projection.errorCode
      });
    }
    return memory.projection;
  };

  const attemptDeletion = async (deletionId) => {
    const state = readState();
    const deletion = state.deletions.find((item) => item.deletionId === deletionId);
    if (!deletion || deletion.status === "deleted") return deletion ?? null;
    deletion.attempts += 1;
    deletion.lastAttemptAt = clock();
    deletion.status = "deleting";
    deletion.errorCode = null;
    writeState(state);

    if (!hindsight?.enabled) {
      deletion.status = "pending";
      deletion.errorCode = "hindsight_disabled";
      writeState(state);
      return deletion;
    }

    try {
      await hindsight.deleteDocument(deletion.documentId);
      deletion.status = "deleted";
      deletion.completedAt = clock();
      deletion.errorCode = null;
      writeState(state);
      appendEvent({
        event: "hindsight_document_deleted",
        at: deletion.completedAt,
        deletionId,
        sourceId: deletion.sourceId,
        memoryId: deletion.memoryId,
        documentId: deletion.documentId,
        reason: deletion.reason
      });
    } catch (error) {
      deletion.status = "pending";
      deletion.errorCode = String(error?.code || "hindsight_unavailable").slice(0, 120);
      writeState(state);
      appendEvent({
        event: "hindsight_deletion_queued",
        at: clock(),
        deletionId,
        sourceId: deletion.sourceId,
        documentId: deletion.documentId,
        errorCode: deletion.errorCode
      });
    }
    return deletion;
  };

  const expireTtlMemories = () => {
    const state = readState();
    const now = Date.parse(clock());
    let changed = false;
    for (const memory of state.memories) {
      if (
        memory.status !== "active" ||
        !memory.validUntil ||
        Date.parse(memory.validUntil) > now
      ) continue;
      memory.status = "expired";
      memory.expiredAt = clock();
      queueDerivedDeletion(state, memory, "ttl_expired", memory.expiredAt);
      memory.memoryPath = writeMemory(memory);
      changed = true;
    }
    if (changed) writeState(state);
    return state;
  };

  const localSearch = (state, normalizedQuery, limit) => {
    const tokens = tokenize(normalizedQuery);
    const phrase = normalizedQuery.toLocaleLowerCase("fr");
    const results = [];
    const now = Date.parse(clock());
    for (const memory of state.memories.filter((item) => (
      item.status === "active" && (!item.validUntil || Date.parse(item.validUntil) > now)
    ))) {
      const title = memory.title.toLocaleLowerCase("fr");
      const text = memory.text.toLocaleLowerCase("fr");
      let score = text.includes(phrase) || title.includes(phrase) ? 8 : 0;
      for (const token of tokens) {
        score += occurrences(title, token) * 4;
        score += occurrences(text, token);
      }
      if (score === 0) continue;
      results.push({
        memoryId: memory.memoryId,
        title: memory.title,
        text: memory.text,
        score,
        citation: {
          sourceId: memory.sourceId,
          snapshotId: memory.snapshotId,
          relativePath: memory.relativePath,
          lineStart: memory.lineStart,
          lineEnd: memory.lineEnd,
          locator: memory.locator,
          label: locatorLabel(memory.relativePath, memory.locator, memory.lineStart, memory.lineEnd)
        }
      });
    }
    return results
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, Math.max(1, Math.min(Number(limit) || 10, 25)));
  };

  const citedMemory = (memory, score) => ({
    memoryId: memory.memoryId,
    title: memory.title,
    text: memory.text,
    score,
    citation: {
      sourceId: memory.sourceId,
      snapshotId: memory.snapshotId,
      relativePath: memory.relativePath,
      lineStart: memory.lineStart,
      lineEnd: memory.lineEnd,
      locator: memory.locator,
      label: locatorLabel(memory.relativePath, memory.locator, memory.lineStart, memory.lineEnd)
    }
  });

  const trustedVerification = async (candidate, source, reason = "ingest") => {
    if (!verifier) return { status: "unavailable" };
    try {
      const result = await verifier.verify({ candidate, source, workspaceId, reason });
      return result?.status === "verified" ? result : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  };

  const admitCandidate = async (candidateId, { verification = null } = {}) => {
    if (admissionMode !== "automatic") {
      throw new ProductError("automatic_admission_disabled", "L’admission automatique est désactivée.", 409);
    }
    let state = readState();
    let candidate = state.candidates.find((item) => item.candidateId === candidateId);
    if (!candidate) throw new ProductError("candidate_not_found", "Cette candidate n’existe pas.", 404);
    if (candidate.admissionId && candidate.status !== "quarantined") {
      const target = path.join(admissionDirectory, `${candidate.admissionId}.json`);
      const admission = JSON.parse(fs.readFileSync(target, "utf8"));
      if (!verifyAdmissionDecision(admission, {
        candidateId: candidate.candidateId,
        workspaceId,
        policyVersion: policy.policyVersion,
        evidenceIds: [candidate.snapshotId]
      })) {
        throw new ProductError("admission_artifact_invalid", "La décision d’admission est invalide.", 500);
      }
      return {
        status: admission.decision,
        candidate,
        admission,
        memory: state.memories.find((item) => item.memoryId === candidate.memoryId) ?? null
      };
    }
    if (!["pending", "pending_verification", "quarantined"].includes(candidate.status)) {
      throw new ProductError("candidate_already_admitted", "Cette candidate a déjà été admise.", 409);
    }
    const policyCandidate = {
      candidate_id: candidate.candidateId,
      workspace_id: workspaceId,
      sensitivity: candidate.sensitivity,
      evidence_ids: [candidate.snapshotId],
      extractor: candidate.extractor ?? {
        provider: "deterministic",
        model: "product-source-blocks",
        prompt_version: "source-blocks-v1"
      }
    };
    const result = policy.evaluate({ candidate: policyCandidate, verification });
    if (result.status === "pending_verification") {
      candidate.status = "pending_verification";
      writeState(state);
      return { ...result, candidate, memory: null };
    }
    if (!verifyAdmissionDecision(result.admission, {
      candidateId: candidate.candidateId,
      workspaceId,
      policyVersion: policy.policyVersion,
      evidenceIds: [candidate.snapshotId]
    })) {
      throw new ProductError("admission_artifact_invalid", "La décision d’admission est invalide.", 500);
    }
    writeAdmission(result.admission);
    candidate.admissionId = result.admission.admission_id;
    candidate.admissionDecision = result.decision;
    candidate.admissionHistory = [...new Set([...(candidate.admissionHistory ?? []), candidate.admissionId])];
    candidate.status = result.decision === "quarantine" ? "quarantined" : result.decision;
    if (!result.recall_allowed) {
      writeState(state);
      appendEvent({
        event: "candidate_admitted",
        at: result.admission.decided_at,
        candidateId,
        decision: result.decision,
        admissionId: result.admission.admission_id
      });
      return { ...result, candidate, memory: null };
    }
    const memoryId = candidate.memoryId ?? stableId("memory", candidate.candidateId);
    const source = state.sources.find((item) => item.sourceId === candidate.sourceId);
    let memory = state.memories.find((item) => item.memoryId === memoryId);
    if (!memory) {
      memory = {
        memoryId,
        candidateId: candidate.candidateId,
        sourceId: candidate.sourceId,
        snapshotId: candidate.snapshotId,
        relativePath: candidate.relativePath,
        title: candidate.title,
        text: candidate.text,
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd,
        locator: candidate.locator,
        workspaceId,
        sourceKind: source?.sourceKind ?? "document",
        sensitivity: candidate.sensitivity,
        status: "active",
        approvedAt: result.admission.decided_at,
        admissionId: result.admission.admission_id,
        admissionDecision: result.decision,
        admissionPolicyVersion: result.admission.policy_version,
        validUntil: result.admission.expires_at,
        staleAt: null,
        memoryPath: null,
        projection: {
          documentId: memoryId,
          status: "queued",
          attempts: 0,
          lastAttemptAt: null,
          syncedAt: null,
          errorCode: null
        }
      };
      memory.memoryPath = writeMemory(memory);
      state.memories.push(memory);
    }
    candidate.memoryId = memoryId;
    writeState(state);
    appendEvent({
      event: "candidate_admitted",
      at: result.admission.decided_at,
      candidateId,
      memoryId,
      decision: result.decision,
      admissionId: result.admission.admission_id
    });
    memory.projection = await attemptProjection(memoryId);
    state = readState();
    candidate = state.candidates.find((item) => item.candidateId === candidateId);
    memory = state.memories.find((item) => item.memoryId === memoryId);
    return { ...result, candidate, memory };
  };

  return {
    vaultRoot: vaultReal,
    admissionMode,
    admitCandidate,

    async getStatus() {
      const state = expireTtlMemories();
      const count = (items, status) => items.filter((item) => item.status === status).length;
      const now = Date.parse(clock());
      const activeMemories = state.memories.filter((memory) => (
        memory.status === "active" && (!memory.validUntil || Date.parse(memory.validUntil) > now)
      ));
      const projection = await (hindsight?.status?.() ?? Promise.resolve({
        status: "disabled",
        available: false
      }));
      return {
        status: "ready",
        mode: "local-first",
        workspace: state.workspace,
        counts: {
          sources: count(state.sources, "active"),
          pendingCandidates: count(state.candidates, "pending"),
          pendingVerification: count(state.candidates, "pending_verification"),
          exceptions: count(state.candidates, "quarantined"),
          approvedMemories: count(state.memories, "active"),
          staleMemories: count(state.memories, "stale"),
          syncedMemories: activeMemories.filter((memory) => memory.projection?.status === "synced").length,
          pendingProjections: activeMemories.filter((memory) => memory.projection?.status !== "synced").length,
          pendingRemovals: count(state.sources, "pending_removal"),
          pendingHindsightDeletions: state.deletions.filter((item) => item.status !== "deleted").length
        },
        hindsight: {
          status: projection.status,
          available: projection.available,
          bankId: projection.bankId ?? hindsight?.bankId ?? null,
          pendingProjections: activeMemories.filter((memory) => memory.projection?.status !== "synced").length,
          pendingDeletions: state.deletions.filter((item) => item.status !== "deleted").length
        },
        capabilities: {
          ingestion: "browser-directory",
          supportedFormats: ["md", "markdown", "txt", "pdf", "docx"],
          deferredFormats: [],
          candidateGeneration: "deterministic-source-blocks",
          recall: hindsight?.enabled ? "hindsight-with-explicit-local-fallback" : "deterministic-local-fallback",
          hindsightProjection: Boolean(hindsight?.enabled),
          remoteNetworkCalls: false
        },
        admission: { mode: admissionMode, policyVersion: policy.policyVersion }
      };
    },

    async ingest({ folderName, files, inventoryComplete = false }) {
      if (!Array.isArray(files) || (files.length === 0 && inventoryComplete !== true)) {
        throw new ProductError("files_required", "Sélectionne un dossier contenant des documents.");
      }
      if (files.length > MAX_FILES) {
        throw new ProductError("file_limit_exceeded", `Le lot dépasse la limite de ${MAX_FILES} fichiers.`);
      }

      const state = readState();
      const ingestedAt = clock();
      const seenPaths = new Set();
      const unsupported = [];
      const warnings = [];
      const accepted = [];
      let batchBytes = 0;

      for (const file of files) {
        const relativePath = normalizeRelativePath(file?.relativePath ?? file?.name);
        if (seenPaths.has(relativePath)) {
          throw new ProductError("duplicate_relative_path", `Le chemin ${relativePath} apparaît plusieurs fois.`);
        }
        seenPaths.add(relativePath);
        const extension = extensionOf(relativePath);
        if (isDefaultExcluded(relativePath)) {
          unsupported.push({
            relativePath,
            extension: extension.replace(".", "") || "unknown",
            reason: "default_excluded"
          });
          continue;
        }
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
          unsupported.push({
            relativePath,
            extension: extension.replace(".", "") || "unknown",
            reason: "format_unsupported"
          });
          continue;
        }
        let bytes;
        let text;
        let segments = null;
        let extractionWarnings = [];
        if (TEXT_EXTENSIONS.has(extension)) {
          if (typeof file.text !== "string") {
            throw new ProductError("text_content_required", `Le contenu texte de ${relativePath} est manquant.`);
          }
          text = file.text;
          bytes = Buffer.from(text, "utf8");
          if (bytes.length > MAX_TEXT_FILE_BYTES) {
            throw new ProductError("file_too_large", `${relativePath} dépasse la limite texte de 2 Mo.`);
          }
        } else {
          if (typeof file.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) {
            throw new ProductError("binary_content_required", `Le contenu binaire de ${relativePath} est manquant ou invalide.`);
          }
          bytes = Buffer.from(file.base64, "base64");
          if (bytes.toString("base64") !== file.base64) {
            throw new ProductError("binary_content_invalid", `Le contenu binaire de ${relativePath} est invalide.`);
          }
          if (bytes.length > MAX_BINARY_FILE_BYTES) {
            throw new ProductError("file_too_large", `${relativePath} dépasse la limite binaire de 8 Mo.`);
          }
          try {
            const extracted = await extractBinaryDocument(extension, bytes);
            segments = extracted.segments;
            extractionWarnings = extracted.warnings;
            text = segments.map((segment) => segment.text).join("\n\n");
          } catch (error) {
            if (error instanceof DocumentExtractionError) {
              throw new ProductError(error.code, `${relativePath} : ${error.message}`, 422);
            }
            throw error;
          }
        }
        batchBytes += bytes.length;
        if (batchBytes > MAX_BATCH_BYTES) {
          throw new ProductError("batch_too_large", "Le lot dépasse la limite de 20 Mo.");
        }
        const secretLike = isSecretLike(text);
        if (secretLike) {
          warnings.push({
            relativePath,
            code: "secret_like_source",
            message: "Un motif ressemblant à un secret a été détecté. Chaque candidate reste inactive jusqu’à validation."
          });
        }
        for (const warning of extractionWarnings) {
          warnings.push({ relativePath, ...warning });
        }
        accepted.push({ relativePath, extension, text, bytes, segments, secretLike });
      }

      let createdSources = 0;
      let changedSources = 0;
      let unchangedSources = 0;
      let createdCandidates = 0;
      const createdCandidateIds = [];
      let staleMemories = 0;
      let restoredSources = 0;

      for (const file of accepted) {
        const hash = contentHash(file.bytes);
        const sourceId = stableId("source:product", workspaceId, file.relativePath);
        const snapshotId = stableId("snap:product", sourceId, hash);
        const existing = state.sources.find((source) => source.sourceId === sourceId);
        if (
          existing?.status === "pending_removal" &&
          existing.removalReason === "missing_from_inventory"
        ) {
          if (restorePendingSource(state, existing)) restoredSources += 1;
        }
        if (
          existing?.status === "pending_removal" &&
          existing.removalReason === "user_requested"
        ) {
          unchangedSources += 1;
          continue;
        }
        if (existing?.contentHash === hash) {
          unchangedSources += 1;
          continue;
        }

        const artifactPath = snapshotArtifact(file.bytes, hash);
        if (!state.snapshots.some((snapshot) => snapshot.snapshotId === snapshotId)) {
          state.snapshots.push({
            snapshotId,
            sourceId,
            contentHash: hash,
            artifactPath,
            capturedAt: ingestedAt,
            lineCount: TEXT_EXTENSIONS.has(file.extension) ? normalizeText(file.text).split("\n").length : null,
            extractedText: file.text,
            extractionSegments: file.segments,
            immutable: true
          });
        }

        if (existing) {
          staleMemories += markSourceDerivedState(state, sourceId, ingestedAt);
          existing.contentHash = hash;
          existing.activeSnapshotId = snapshotId;
          existing.updatedAt = ingestedAt;
          existing.status = "active";
          existing.size = file.bytes.length;
          existing.lineCount = TEXT_EXTENSIONS.has(file.extension) ? normalizeText(file.text).split("\n").length : null;
          existing.sensitivity = file.secretLike ? "restricted_review" : "standard";
          existing.reviewState = file.secretLike ? "needs_review" : "ready_for_review";
          existing.removalReason = null;
          existing.removalDetectedAt = null;
          existing.deletedAt = null;
          existing.deletionReason = null;
          changedSources += 1;
        } else {
          state.sources.push({
            sourceId,
            workspaceId,
            folderName: cleanFolderName(folderName),
            relativePath: file.relativePath,
            sourceKind: file.extension.replace(".", ""),
            contentHash: hash,
            activeSnapshotId: snapshotId,
            status: "active",
            importedAt: ingestedAt,
            updatedAt: ingestedAt,
            size: file.bytes.length,
            lineCount: TEXT_EXTENSIONS.has(file.extension) ? normalizeText(file.text).split("\n").length : null,
            sensitivity: file.secretLike ? "restricted_review" : "standard",
            reviewState: file.secretLike ? "needs_review" : "ready_for_review"
          });
          createdSources += 1;
        }

        const blocks = file.segments
          ? binaryCandidateBlocks(file.segments)
          : candidateBlocks(file.text, file.relativePath);
        for (let index = 0; index < blocks.length; index += 1) {
          const block = blocks[index];
          const candidateId = stableId(
            "candidate",
            sourceId,
            snapshotId,
            String(block.lineStart),
            String(block.lineEnd),
            JSON.stringify(block.locator ?? null),
            String(index)
          );
          state.candidates.push({
            candidateId,
            sourceId,
            snapshotId,
            relativePath: file.relativePath,
            title: block.title,
            text: block.text,
            originalText: block.text,
            lineStart: block.lineStart,
            lineEnd: block.lineEnd,
            locator: block.locator ?? {
              kind: "text_lines",
              lineStart: block.lineStart,
              lineEnd: block.lineEnd
            },
            status: "pending",
            createdAt: ingestedAt,
            reviewedAt: null,
            memoryId: null,
            sensitivity: file.secretLike ? "restricted_review" : "standard"
          });
          createdCandidateIds.push(candidateId);
          createdCandidates += 1;
        }
      }

      const normalizedFolderName = cleanFolderName(folderName);
      let missingSources = 0;
      if (inventoryComplete === true) {
        const presentPaths = new Set(accepted.map((file) => file.relativePath));
        for (const source of state.sources) {
          if (
            source.folderName === normalizedFolderName &&
            source.status === "active" &&
            !presentPaths.has(source.relativePath)
          ) {
            if (markSourcePendingRemoval(state, source, "missing_from_inventory", ingestedAt)) {
              missingSources += 1;
            }
          }
        }
      }

      state.workspace.folderName = normalizedFolderName;
      state.workspace.updatedAt = ingestedAt;
      const secretLikeFiles = accepted.filter((file) => file.secretLike).length;
      const extractionWarnings = warnings.filter((warning) => warning.code !== "secret_like_source").length;
      writeState(state);
      appendEvent({
        event: "documents_ingested",
        at: ingestedAt,
        folderName: state.workspace.folderName,
        createdSources,
        changedSources,
        unchangedSources,
        unsupportedFiles: unsupported.length,
        secretLikeFiles,
        extractionWarnings,
        createdCandidates,
        staleMemories,
        restoredSources,
        missingSources,
        inventoryComplete: inventoryComplete === true
      });
      const changedDeletionIds = state.deletions
        .filter((item) => item.status !== "deleted" && item.reason === "source_changed")
        .map((item) => item.deletionId);
      for (const deletionId of changedDeletionIds) await attemptDeletion(deletionId);

      const admissionSummary = {
        auto_activate: 0,
        activate_ttl: 0,
        quarantine: 0,
        discard: 0,
        pending_verification: 0
      };
      if (admissionMode === "automatic") {
        for (const candidateId of createdCandidateIds) {
          const current = readState();
          const candidate = current.candidates.find((item) => item.candidateId === candidateId);
          const source = current.sources.find((item) => item.sourceId === candidate?.sourceId);
          const verification = await trustedVerification(candidate, source);
          const admitted = await admitCandidate(candidateId, { verification });
          admissionSummary[admitted.status] += 1;
        }
      }

      return {
        status: "ingested",
        summary: {
          receivedFiles: files.length,
          acceptedFiles: accepted.length,
          unsupportedFiles: unsupported.length,
          secretLikeFiles,
          extractionWarnings,
          createdSources,
          changedSources,
          unchangedSources,
          createdCandidates,
          staleMemories,
          restoredSources,
          missingSources,
          inventoryComplete: inventoryComplete === true,
          admission: admissionSummary
        },
        unsupported,
        warnings
      };
    },

    listCandidates(status = "pending") {
      const state = readState();
      const candidates = status === "all"
        ? state.candidates
        : state.candidates.filter((candidate) => candidate.status === status);
      return candidates
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    listMemories() {
      return expireTtlMemories().memories
        .slice()
        .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
    },

    listSources({ includeDeleted = false } = {}) {
      const state = readState();
      return state.sources
        .filter((source) => includeDeleted || source.status !== "deleted")
        .map((source) => ({
          sourceId: source.sourceId,
          relativePath: source.relativePath,
          folderName: source.folderName,
          sourceKind: source.sourceKind,
          status: source.status,
          removalReason: source.removalReason ?? null,
          removalDetectedAt: source.removalDetectedAt ?? null,
          updatedAt: source.updatedAt,
          candidateCount: state.candidates.filter((item) => item.sourceId === source.sourceId).length,
          memoryCount: state.memories.filter((item) => item.sourceId === source.sourceId).length
        }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    },

    stageSourceRemoval(sourceId, reason = "user_requested") {
      const state = readState();
      const source = state.sources.find((item) => item.sourceId === sourceId);
      if (!source || source.status === "deleted") {
        throw new ProductError("source_not_found", "Cette source n’existe pas.", 404);
      }
      if (!["user_requested", "missing_from_inventory"].includes(reason)) {
        throw new ProductError("removal_reason_invalid", "Le motif de retrait est invalide.");
      }
      const stagedAt = clock();
      const staged = markSourcePendingRemoval(state, source, reason, stagedAt);
      writeState(state);
      if (staged) {
        appendEvent({
          event: "source_removal_staged",
          at: stagedAt,
          sourceId,
          relativePath: source.relativePath,
          reason
        });
      }
      return { status: "pending_removal", source: this.listSources().find((item) => item.sourceId === sourceId) };
    },

    cancelSourceRemoval(sourceId) {
      const state = readState();
      const source = state.sources.find((item) => item.sourceId === sourceId);
      if (!source) throw new ProductError("source_not_found", "Cette source n’existe pas.", 404);
      if (source.status !== "pending_removal") {
        throw new ProductError("source_not_pending_removal", "Cette source n’attend pas de suppression.", 409);
      }
      const restoredAt = clock();
      restorePendingSource(state, source);
      source.updatedAt = restoredAt;
      writeState(state);
      appendEvent({
        event: "source_removal_cancelled",
        at: restoredAt,
        sourceId,
        relativePath: source.relativePath
      });
      return { status: "active", source: this.listSources().find((item) => item.sourceId === sourceId) };
    },

    async confirmSourceDeletion(sourceId, confirmation) {
      const state = readState();
      const source = state.sources.find((item) => item.sourceId === sourceId);
      if (!source) throw new ProductError("source_not_found", "Cette source n’existe pas.", 404);
      if (source.status !== "pending_removal") {
        throw new ProductError("source_not_pending_removal", "Cette source n’attend pas de suppression.", 409);
      }
      if (confirmation !== source.relativePath) {
        throw new ProductError(
          "deletion_confirmation_invalid",
          "La confirmation doit reprendre exactement le chemin de la source."
        );
      }
      const deletedAt = clock();
      const candidates = state.candidates.filter((item) => item.sourceId === sourceId);
      const memories = state.memories.filter((item) => item.sourceId === sourceId);
      const snapshots = state.snapshots.filter((item) => item.sourceId === sourceId);
      const remainingSnapshots = state.snapshots.filter((item) => item.sourceId !== sourceId);
      const deletionIds = [];

      for (const memory of memories) {
        removeVaultFile(memory.memoryPath);
        queueDerivedDeletion(state, memory, "source_deleted", deletedAt);
        deletionIds.push(stableId("deletion", memory.projection?.documentId ?? memory.memoryId));
      }
      for (const artifactPath of new Set(snapshots.map((snapshot) => snapshot.artifactPath))) {
        if (!remainingSnapshots.some((snapshot) => snapshot.artifactPath === artifactPath)) {
          removeVaultFile(artifactPath);
        }
      }

      state.memories = state.memories.filter((item) => item.sourceId !== sourceId);
      state.candidates = state.candidates.filter((item) => item.sourceId !== sourceId);
      state.snapshots = remainingSnapshots;
      source.status = "deleted";
      source.deletedAt = deletedAt;
      source.deletionReason = source.removalReason;
      source.contentHash = null;
      source.activeSnapshotId = null;
      source.size = 0;
      source.lineCount = null;
      source.sensitivity = null;
      source.reviewState = null;
      source.removalReason = null;
      source.removalDetectedAt = null;
      source.updatedAt = deletedAt;
      writeState(state);
      appendEvent({
        event: "source_deleted_canonically",
        at: deletedAt,
        sourceId,
        relativePath: source.relativePath,
        purgedCandidates: candidates.length,
        purgedMemories: memories.length,
        purgedSnapshots: snapshots.length,
        hindsightDocumentsQueued: deletionIds.length
      });

      for (const deletionId of deletionIds) await attemptDeletion(deletionId);
      const refreshed = readState();
      const deletionRows = refreshed.deletions.filter((item) => deletionIds.includes(item.deletionId));
      return {
        status: "deleted",
        sourceId,
        relativePath: source.relativePath,
        purged: {
          candidates: candidates.length,
          memories: memories.length,
          snapshots: snapshots.length
        },
        hindsight: {
          deleted: deletionRows.filter((item) => item.status === "deleted").length,
          pending: deletionRows.filter((item) => item.status !== "deleted").length
        }
      };
    },

    async reviewCandidate(candidateId, { action, text, title }) {
      if (!["approve", "reject"].includes(action)) {
        throw new ProductError("review_action_invalid", "L’action doit être approve ou reject.");
      }
      if (admissionMode === "automatic") {
        const current = readState().candidates.find((item) => item.candidateId === candidateId);
        if (!current) throw new ProductError("candidate_not_found", "Cette candidate n’existe pas.", 404);
        if (current.status !== "quarantined") {
          throw new ProductError(
            "review_reserved_for_quarantine",
            "La revue humaine est réservée aux exceptions persistantes.",
            409
          );
        }
        const state = readState();
        const source = state.sources.find((item) => item.sourceId === current.sourceId);
        const verification = await trustedVerification(current, source, "quarantine_resolution");
        const resolved = await admitCandidate(candidateId, { verification });
        const accepted = ["auto_activate", "activate_ttl"].includes(resolved.decision);
        if ((action === "approve" && !accepted) || (action === "reject" && resolved.decision !== "discard")) {
          throw new ProductError(
            "quarantine_resolution_not_verified",
            "La résolution de l’exception doit être confirmée par des signaux indépendants.",
            409
          );
        }
        return resolved;
      }
      const state = readState();
      const candidate = state.candidates.find((item) => item.candidateId === candidateId);
      if (!candidate) throw new ProductError("candidate_not_found", "Cette candidate n’existe pas.", 404);
      if (candidate.status !== "pending") {
        throw new ProductError("candidate_already_reviewed", "Cette candidate a déjà été traitée.", 409);
      }
      const reviewedAt = clock();
      candidate.reviewedAt = reviewedAt;

      if (action === "reject") {
        candidate.status = "rejected";
        writeState(state);
        appendEvent({ event: "candidate_rejected", at: reviewedAt, candidateId, sourceId: candidate.sourceId });
        return { status: "rejected", candidate };
      }

      const reviewedText = String(text ?? candidate.text).trim();
      const reviewedTitle = String(title ?? candidate.title).trim();
      if (!reviewedText) throw new ProductError("candidate_text_required", "Une mémoire approuvée ne peut pas être vide.");
      if (reviewedText.length > MAX_CANDIDATE_CHARS * 2) {
        throw new ProductError("candidate_text_too_large", "La mémoire éditée est trop longue.");
      }
      const memoryId = stableId("memory", candidate.candidateId);
      const source = state.sources.find((item) => item.sourceId === candidate.sourceId);
      const memory = {
        memoryId,
        candidateId: candidate.candidateId,
        sourceId: candidate.sourceId,
        snapshotId: candidate.snapshotId,
        relativePath: candidate.relativePath,
        title: reviewedTitle || candidate.title,
        text: reviewedText,
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd,
        locator: candidate.locator,
        workspaceId,
        sourceKind: source?.sourceKind ?? "document",
        sensitivity: candidate.sensitivity,
        status: "active",
        approvedAt: reviewedAt,
        staleAt: null,
        memoryPath: null,
        projection: {
          documentId: memoryId,
          status: "queued",
          attempts: 0,
          lastAttemptAt: null,
          syncedAt: null,
          errorCode: null
        }
      };
      memory.memoryPath = writeMemory(memory);
      candidate.status = "approved";
      candidate.title = memory.title;
      candidate.text = memory.text;
      candidate.memoryId = memoryId;
      state.memories.push(memory);
      writeState(state);
      appendEvent({
        event: "candidate_approved",
        at: reviewedAt,
        candidateId,
        memoryId,
        sourceId: candidate.sourceId,
        edited: memory.text !== candidate.originalText
      });
      memory.projection = await attemptProjection(memoryId);
      return { status: "approved", candidate, memory };
    },

    async search(query, limit = 10) {
      const normalizedQuery = String(query ?? "").trim();
      const tokens = tokenize(normalizedQuery);
      if (tokens.length === 0) {
        throw new ProductError("search_query_required", "Saisis au moins un mot à rechercher.");
      }
      const state = expireTtlMemories();
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
      const now = Date.parse(clock());
      const synced = state.memories.filter((memory) => (
        memory.status === "active" &&
        memory.projection?.status === "synced" &&
        (!memory.validUntil || Date.parse(memory.validUntil) > now)
      ));
      if (hindsight?.enabled && synced.length > 0) {
        try {
          const recalled = await hindsight.recall(normalizedQuery, { workspaceId });
          const activeById = new Map(synced.map((memory) => [memory.memoryId, memory]));
          const reconciled = recalled.results
            .map((result) => {
              const memory = activeById.get(result.memoryId);
              return memory ? citedMemory(memory, result.score) : null;
            })
            .filter(Boolean)
            .slice(0, boundedLimit);
          if (reconciled.length === 0) {
            return {
              query: normalizedQuery,
              mode: "deterministic-local-fallback",
              hindsightUsed: false,
              fallbackReason: "hindsight_no_reconciled_results",
              trace: recalled.trace,
              results: localSearch(state, normalizedQuery, boundedLimit)
            };
          }
          return {
            query: normalizedQuery,
            mode: "hindsight-governed-recall",
            hindsightUsed: true,
            fallbackReason: null,
            trace: recalled.trace,
            results: reconciled
          };
        } catch (error) {
          return {
            query: normalizedQuery,
            mode: "deterministic-local-fallback",
            hindsightUsed: false,
            fallbackReason: String(error?.code || "hindsight_unavailable"),
            trace: null,
            results: localSearch(state, normalizedQuery, boundedLimit)
          };
        }
      }
      return {
        query: normalizedQuery,
        mode: "deterministic-local-fallback",
        hindsightUsed: false,
        fallbackReason: hindsight?.enabled ? "no_synced_projection" : "hindsight_disabled",
        trace: null,
        results: localSearch(state, normalizedQuery, boundedLimit)
      };
    },

    async retryProjections() {
      const state = readState();
      const pending = state.memories
        .filter((memory) => memory.status === "active" && memory.projection?.status !== "synced")
        .map((memory) => memory.memoryId);
      let synced = 0;
      for (const memoryId of pending) {
        const projection = await attemptProjection(memoryId);
        if (projection.status === "synced") synced += 1;
      }
      const deletionIds = readState().deletions
        .filter((item) => item.status !== "deleted")
        .map((item) => item.deletionId);
      let deleted = 0;
      for (const deletionId of deletionIds) {
        const deletion = await attemptDeletion(deletionId);
        if (deletion?.status === "deleted") deleted += 1;
      }
      return {
        status: pending.length === synced && deletionIds.length === deleted ? "synced" : "pending",
        attempted: pending.length,
        synced,
        remaining: pending.length - synced,
        deletionsAttempted: deletionIds.length,
        deleted,
        deletionsRemaining: deletionIds.length - deleted
      };
    },

    getSource(sourceId, snapshotId = null) {
      const state = readState();
      const source = state.sources.find((item) => item.sourceId === sourceId);
      if (!source) throw new ProductError("source_not_found", "Cette source n’existe pas.", 404);
      const requestedSnapshot = snapshotId || source.activeSnapshotId;
      const snapshot = state.snapshots.find(
        (item) => item.snapshotId === requestedSnapshot && item.sourceId === sourceId
      );
      if (!snapshot) throw new ProductError("snapshot_not_found", "Ce snapshot n’existe pas.", 404);
      const artifactPath = path.resolve(vaultReal, snapshot.artifactPath);
      if (!isInside(vaultReal, artifactPath) || !fs.existsSync(artifactPath)) {
        throw new ProductError("snapshot_artifact_missing", "Le snapshot local est introuvable.", 500);
      }
      const stat = fs.lstatSync(artifactPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new ProductError("snapshot_artifact_invalid", "Le snapshot local est invalide.", 500);
      }
      const bytes = fs.readFileSync(artifactPath);
      if (contentHash(bytes) !== snapshot.contentHash) {
        throw new ProductError("snapshot_artifact_tampered", "Le snapshot local ne correspond plus à son empreinte.", 500);
      }
      return {
        source,
        snapshot,
        text: snapshot.extractedText ?? bytes.toString("utf8"),
        segments: snapshot.extractionSegments ?? null,
        bytes
      };
    }
  };
}
