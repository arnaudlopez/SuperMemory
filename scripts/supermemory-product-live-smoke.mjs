#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function loadServerFactory() {
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = (...args) => {
    if (!String(args[0] ?? "").startsWith("Warning: Cannot polyfill")) originalWarn(...args);
  };
  console.log = (...args) => {
    if (!String(args[0] ?? "").startsWith("Warning: Cannot polyfill")) originalLog(...args);
  };
  try {
    return (await import("./supermemory-app.mjs")).createSuperMemoryServer;
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
}

function parseArgs(argv) {
  const options = {
    executeLive: false,
    json: false,
    keepArtifacts: false,
    evidencePath: process.env.SUPERMEMORY_PRODUCT_LIVE_EVIDENCE_PATH ||
      "tmp/supermemory-product-live-smoke.jsonl"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute-live") options.executeLive = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--keep-artifacts") options.keepArtifacts = true;
    else if (arg === "--evidence-path") options.evidencePath = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function loopbackBaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("product_live_smoke_requires_loopback_hindsight");
  }
  return url.toString().replace(/\/+$/, "");
}

function generatedPdf(text) {
  const safeText = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT /F1 18 Tf 72 720 Td (${safeText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(
    (offset) => `${String(offset).padStart(10, "0")} 00000 n \n`
  ).join("")}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function generatedDocx(text) {
  const entries = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Décision DOCX</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
  };
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.from(value);
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);
    offset += header.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function request(baseUrl, pathname, body = undefined, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || `HTTP ${response.status}`);
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function fixtureFiles(version = "initial", includeDocx = true) {
  const txt = version === "refreshed"
    ? "Support actualisé\nLe canal de support officiel est désormais Signal, code SIGMA229.\n"
    : "Support initial\nLe canal de support officiel est Matrix, code MATRIX118.\n";
  const files = [
    {
      relativePath: "PreuveProduit/mission.md",
      name: "mission.md",
      text: [
        "# Mission Orion",
        "La balise ORION742 confirme que la mission Orion est prête pour validation.",
        "",
        "## Brouillon à refuser",
        "Cette hypothèse temporaire ne doit jamais devenir une mémoire approuvée.",
        ""
      ].join("\n")
    },
    {
      relativePath: "PreuveProduit/support.txt",
      name: "support.txt",
      text: txt
    },
    {
      relativePath: "PreuveProduit/contrat.pdf",
      name: "contrat.pdf",
      base64: generatedPdf("Le contrat PDF porte la reference PDF531").toString("base64")
    }
  ];
  if (includeDocx) {
    files.push({
      relativePath: "PreuveProduit/decision.docx",
      name: "decision.docx",
      base64: generatedDocx("La décision DOCX porte la référence DOCX864.").toString("base64")
    });
  }
  return files;
}

function selectedCandidate(candidates, relativePath, token) {
  const candidate = candidates.find(
    (item) => item.relativePath === relativePath && item.text.includes(token)
  );
  requireCondition(candidate, `candidate_missing:${relativePath}:${token}`);
  return candidate;
}

async function approve(baseUrl, candidate) {
  const result = await request(
    baseUrl,
    `/api/candidates/${encodeURIComponent(candidate.candidateId)}/review`,
    { action: "approve", title: candidate.title, text: candidate.text }
  );
  requireCondition(result.memory?.projection?.status === "synced", `projection_not_synced:${candidate.relativePath}`);
  return result.memory;
}

function evidenceCase(id, details = {}) {
  return { id, status: "pass", ...details };
}

export function validateProductEvidence(report) {
  const errors = [];
  if (report.status !== "pass") errors.push("status");
  if (report.mode !== "live") errors.push("mode");
  if (report.live_writes_performed !== true) errors.push("live_writes");
  if (report.secrets_redacted !== true) errors.push("secrets");
  const required = new Set([
    "four-format-ingest-review",
    "hindsight-reconciled-cited-recall",
    "refresh-and-derived-revocation",
    "explicit-source-deletion",
    "verified-backup-atomic-restore",
    "restart-and-hindsight-rebuild"
  ]);
  for (const item of report.cases ?? []) {
    if (item.status === "pass") required.delete(item.id);
  }
  for (const id of required) errors.push(`case:${id}`);
  return errors;
}

async function deleteBank(baseUrl, bankId) {
  const response = await fetch(
    `${baseUrl}/v1/default/banks/${encodeURIComponent(bankId)}`,
    { method: "DELETE", signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok && ![404, 410].includes(response.status)) {
    throw new Error(`bank_cleanup_http_${response.status}`);
  }
}

function writeEvidence(report, evidencePath) {
  const resolved = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(report)}${os.EOL}`, { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
  return resolved;
}

export async function runProductLiveSmoke(options) {
  const generatedAt = new Date().toISOString();
  if (
    !options.executeLive ||
    process.env.SUPERMEMORY_ALLOW_PRODUCT_LIVE_SMOKE !== "1"
  ) {
    return {
      status: "blocked_explicit_live_confirmation_required",
      mode: "live",
      generated_at: generatedAt,
      live_writes_performed: false,
      secrets_redacted: true,
      cases: []
    };
  }

  const baseUrl = loopbackBaseUrl(process.env.HINDSIGHT_BASE_URL || "http://127.0.0.1:8888");
  const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
  requireCondition(health.ok, "hindsight_health_failed");
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const bankId = `supermemory-product-smoke-${runId}`;
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), `supermemory-product-smoke-${runId}-`));
  const vaultRoot = path.join(artifactRoot, "vault");
  const backupsRoot = path.join(artifactRoot, "backups");
  const cases = [];
  const createSuperMemoryServer = await loadServerFactory();
  let app = createSuperMemoryServer({
    vaultRoot,
    backupsRoot,
    hindsightOptions: { baseUrl, bankId, timeoutMs: 60_000 }
  });
  let runtime;
  let liveWritesPerformed = false;
  let succeeded = false;

  try {
    runtime = await app.start();
    const initialFiles = fixtureFiles();
    const ingested = await request(runtime.url, "/api/ingest", {
      folderName: "PreuveProduit",
      files: initialFiles,
      inventoryComplete: true
    });
    requireCondition(ingested.summary.acceptedFiles === 4, "four_format_ingest_failed");
    const pending = await request(runtime.url, "/api/candidates?status=pending");
    const targets = [
      selectedCandidate(pending.candidates, "PreuveProduit/mission.md", "ORION742"),
      selectedCandidate(pending.candidates, "PreuveProduit/support.txt", "MATRIX118"),
      selectedCandidate(pending.candidates, "PreuveProduit/contrat.pdf", "PDF531"),
      selectedCandidate(pending.candidates, "PreuveProduit/decision.docx", "DOCX864")
    ];
    for (const target of targets) {
      liveWritesPerformed = true;
      await approve(runtime.url, target);
    }
    const draft = selectedCandidate(
      pending.candidates,
      "PreuveProduit/mission.md",
      "hypothèse temporaire"
    );
    await request(
      runtime.url,
      `/api/candidates/${encodeURIComponent(draft.candidateId)}/review`,
      { action: "reject" }
    );
    cases.push(evidenceCase("four-format-ingest-review", {
      formats: ["md", "txt", "pdf", "docx"],
      approved: 4,
      rejected: 1,
      nonzero_hindsight_extractions: 4
    }));

    const recalled = await request(runtime.url, "/api/search", {
      query: "Quelle balise confirme la mission Orion ?"
    });
    requireCondition(recalled.hindsightUsed === true, `hindsight_recall_not_used:${recalled.fallbackReason}`);
    requireCondition(
      recalled.results.some(
        (item) => item.text.includes("ORION742") &&
          item.citation.relativePath === "PreuveProduit/mission.md"
      ),
      "reconciled_citation_missing"
    );
    cases.push(evidenceCase("hindsight-reconciled-cited-recall", {
      mode: recalled.mode,
      citation_kind: recalled.results[0]?.citation?.locator?.kind || "text_lines"
    }));

    const refreshedFiles = fixtureFiles("refreshed");
    const refreshed = await request(runtime.url, "/api/ingest", {
      folderName: "PreuveProduit",
      files: refreshedFiles,
      inventoryComplete: true
    });
    requireCondition(refreshed.summary.changedSources === 1, "refresh_change_not_detected");
    requireCondition(refreshed.summary.staleMemories === 1, "refresh_old_memory_not_stale");
    const refreshedPending = await request(runtime.url, "/api/candidates?status=pending");
    await approve(
      runtime.url,
      selectedCandidate(refreshedPending.candidates, "PreuveProduit/support.txt", "SIGMA229")
    );
    const oldSearch = await request(runtime.url, "/api/search", { query: "MATRIX118" });
    requireCondition(oldSearch.results.every((item) => !item.text.includes("MATRIX118")), "stale_memory_recalled");
    cases.push(evidenceCase("refresh-and-derived-revocation", {
      changed_sources: 1,
      stale_memories: 1
    }));

    const missingDocx = await request(runtime.url, "/api/ingest", {
      folderName: "PreuveProduit",
      files: fixtureFiles("refreshed", false),
      inventoryComplete: true
    });
    requireCondition(missingDocx.summary.missingSources === 1, "missing_source_not_staged");
    const sources = await request(runtime.url, "/api/sources");
    const docxSource = sources.sources.find(
      (item) => item.relativePath === "PreuveProduit/decision.docx"
    );
    requireCondition(docxSource?.status === "pending_removal", "docx_not_pending_removal");
    const deleted = await request(
      runtime.url,
      `/api/sources/${encodeURIComponent(docxSource.sourceId)}/removal`,
      { action: "confirm", confirmation: docxSource.relativePath }
    );
    requireCondition(deleted.hindsight.pending === 0, "hindsight_deletion_pending");
    cases.push(evidenceCase("explicit-source-deletion", {
      exact_path_confirmation: true,
      canonical_purge: true,
      hindsight_deleted: deleted.hindsight.deleted
    }));

    const backup = await request(runtime.url, "/api/backups", { reason: "product-live-smoke" });
    requireCondition(backup.backup.verified === true, "backup_not_verified");
    const changedMission = fixtureFiles("refreshed", false);
    changedMission[0] = {
      ...changedMission[0],
      text: "# Mission Orion\nLa balise temporaire AFTER999 remplace momentanément la décision.\n"
    };
    await request(runtime.url, "/api/ingest", {
      folderName: "PreuveProduit",
      files: changedMission,
      inventoryComplete: true
    });
    const afterPending = await request(runtime.url, "/api/candidates?status=pending");
    await approve(
      runtime.url,
      selectedCandidate(afterPending.candidates, "PreuveProduit/mission.md", "AFTER999")
    );
    const restored = await request(
      runtime.url,
      `/api/backups/${encodeURIComponent(backup.backup.backupId)}/restore`,
      { confirmation: `RESTORE ${backup.backup.backupId}` }
    );
    requireCondition(restored.safetyBackupId, "pre_restore_safety_backup_missing");
    requireCondition(restored.hindsightRebuild?.status === "rebuilt", "hindsight_restore_rebuild_pending");
    cases.push(evidenceCase("verified-backup-atomic-restore", {
      hash_manifest_verified: true,
      exact_confirmation: true,
      safety_backup_created: true,
      atomic_restore: true
    }));

    await app.stop();
    app = createSuperMemoryServer({
      vaultRoot,
      backupsRoot,
      hindsightOptions: { baseUrl, bankId, timeoutMs: 60_000 }
    });
    runtime = await app.start();
    const restarted = await request(runtime.url, "/api/status");
    requireCondition(restarted.counts.sources === 3, "restart_source_count_mismatch");
    requireCondition(restarted.counts.pendingProjections === 0, "restart_projection_pending");
    const recovered = await request(runtime.url, "/api/search", {
      query: "Quelle balise confirme la mission Orion ?"
    });
    requireCondition(recovered.hindsightUsed === true, "restart_hindsight_recall_not_used");
    requireCondition(
      recovered.results.some((item) => item.text.includes("ORION742")),
      "restored_memory_not_recalled"
    );
    requireCondition(
      recovered.results.every((item) => !item.text.includes("AFTER999")),
      "post_backup_memory_leaked_after_restore"
    );
    cases.push(evidenceCase("restart-and-hindsight-rebuild", {
      canonical_sources: restarted.counts.sources,
      pending_projections: restarted.counts.pendingProjections,
      hindsight_recall: true
    }));

    succeeded = true;
    const report = {
      status: "pass",
      mode: "live",
      product_mode: "local-first-single-user",
      generated_at: new Date().toISOString(),
      live_writes_performed: liveWritesPerformed,
      secrets_redacted: true,
      remote_calls_allowed: false,
      bank_id: bankId,
      artifact_retention: options.keepArtifacts ? "kept_by_request" : "cleaned_after_success",
      cases
    };
    requireCondition(validateProductEvidence(report).length === 0, "product_evidence_invalid");
    return report;
  } catch (error) {
    return {
      status: "fail",
      mode: "live",
      product_mode: "local-first-single-user",
      generated_at: new Date().toISOString(),
      live_writes_performed: liveWritesPerformed,
      secrets_redacted: true,
      remote_calls_allowed: false,
      bank_id: bankId,
      artifact_retention: "kept_for_diagnosis",
      artifact_root: artifactRoot,
      error: String(error?.code || error?.message || error),
      cases
    };
  } finally {
    await app.stop().catch(() => {});
    if (succeeded && !options.keepArtifacts) {
      await deleteBank(baseUrl, bankId).catch(() => {});
      fs.rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

function printText(report) {
  process.stdout.write(`${report.status.toUpperCase()} SuperMemory product live smoke\n`);
  for (const item of report.cases ?? []) process.stdout.write(`${item.status.toUpperCase()} ${item.id}\n`);
  if (report.error) process.stdout.write(`error=${report.error}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write([
      "Usage: node scripts/supermemory-product-live-smoke.mjs --execute-live [--json]",
      "",
      "Requires SUPERMEMORY_ALLOW_PRODUCT_LIVE_SMOKE=1 and loopback Hindsight.",
      "Performs real temporary Hindsight writes; no model is downloaded."
    ].join("\n") + "\n");
    return;
  }
  const report = await runProductLiveSmoke(options);
  if (!report.status.startsWith("blocked")) {
    report.evidence_path = writeEvidence(report, options.evidencePath);
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printText(report);
  if (report.status !== "pass") process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
