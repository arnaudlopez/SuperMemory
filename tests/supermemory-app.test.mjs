import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSuperMemoryServer } from "../scripts/supermemory-app.mjs";

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, body };
}

async function jsonRequest(baseUrl, pathname, body, options = {}) {
  return request(baseUrl, pathname, {
    method: options.method ?? "POST",
    body: JSON.stringify(body),
    headers: options.headers
  });
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function generatedPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
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
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function generatedDocx() {
  const entries = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Feuille de route</w:t></w:r></w:p><w:p><w:r><w:t>Le jalon DOCX est valide vendredi.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
  };
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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

test("local web product supports ingest, review, cited search, deduplication, change invalidation, and restart", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-product-"));
  const vaultRoot = path.join(tempRoot, "identity-vault");
  let app = createSuperMemoryServer({ vaultRoot, hindsightOptions: { enabled: false } });
  let runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  assert.equal(runtime.host, "127.0.0.1");
  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const index = await request(runtime.url, "/");
  assert.equal(index.response.status, 200);
  assert.match(index.body, /Transformez vos documents en connaissances vérifiables/);
  assert.match(index.response.headers.get("content-security-policy"), /connect-src 'self'/);

  const initial = await request(runtime.url, "/api/status");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.mode, "local-first");
  assert.equal(initial.body.counts.sources, 0);
  assert.deepEqual(initial.body.capabilities.supportedFormats, ["md", "markdown", "txt", "pdf", "docx"]);
  assert.deepEqual(initial.body.capabilities.deferredFormats, []);
  assert.equal(initial.body.capabilities.hindsightProjection, false);
  assert.equal(initial.body.capabilities.remoteNetworkCalls, false);

  const files = [
    {
      relativePath: "Acme/projet.md",
      name: "projet.md",
      text: [
        "# Projet Atlas",
        "La date de lancement proposée est mardi.",
        "",
        "## Budget",
        "Le budget validé est de 42 000 euros.",
        ""
      ].join("\n")
    },
    {
      relativePath: "Acme/contact.txt",
      name: "contact.txt",
      text: "Contact principal\nAlice Martin pilote la livraison.\npassword: à confirmer\n"
    }
  ];
  const ingest = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Acme",
    files
  });
  assert.equal(ingest.response.status, 201);
  assert.equal(ingest.body.status, "ingested");
  assert.equal(ingest.body.summary.receivedFiles, 2);
  assert.equal(ingest.body.summary.acceptedFiles, 2);
  assert.equal(ingest.body.summary.unsupportedFiles, 0);
  assert.equal(ingest.body.summary.createdSources, 2);
  assert.equal(ingest.body.summary.createdCandidates, 3);
  assert.equal(ingest.body.summary.secretLikeFiles, 1);
  assert.equal(ingest.body.warnings[0].code, "secret_like_source");
  assert.deepEqual(ingest.body.unsupported, []);

  const statePath = path.join(vaultRoot, "00_inbox", "supermemory-product", "state.json");
  assert.equal(fs.existsSync(statePath), true);
  const stateStat = fs.statSync(statePath);
  assert.equal(stateStat.mode & 0o777, 0o600);
  const snapshotFiles = listFiles(
    path.join(vaultRoot, "00_inbox", "snapshots", "sha256")
  ).filter((entry) => entry.endsWith(".snapshot"));
  assert.equal(snapshotFiles.length, 2);

  const pending = await request(runtime.url, "/api/candidates?status=pending");
  assert.equal(pending.response.status, 200);
  assert.equal(pending.body.candidates.length, 3);
  const launchCandidate = pending.body.candidates.find((candidate) => candidate.text.includes("lancement"));
  const contactCandidate = pending.body.candidates.find((candidate) => candidate.relativePath.endsWith("contact.txt"));
  assert.ok(launchCandidate);
  assert.ok(contactCandidate);
  assert.equal(contactCandidate.sensitivity, "restricted_review");
  assert.equal(launchCandidate.lineStart, 2);
  assert.equal(launchCandidate.lineEnd, 2);

  const approve = await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(launchCandidate.candidateId)}/review`,
    {
      action: "approve",
      title: "Lancement du projet Atlas",
      text: "Le lancement du projet Atlas est planifié mardi."
    }
  );
  assert.equal(approve.response.status, 200);
  assert.equal(approve.body.status, "approved");
  assert.equal(approve.body.memory.status, "active");
  assert.equal(
    fs.existsSync(path.join(vaultRoot, approve.body.memory.memoryPath)),
    true
  );

  const reject = await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(contactCandidate.candidateId)}/review`,
    { action: "reject" }
  );
  assert.equal(reject.response.status, 200);
  assert.equal(reject.body.status, "rejected");

  const search = await jsonRequest(runtime.url, "/api/search", { query: "lancement mardi" });
  assert.equal(search.response.status, 200);
  assert.equal(search.body.mode, "deterministic-local-fallback");
  assert.equal(search.body.hindsightUsed, false);
  assert.equal(search.body.results.length, 1);
  assert.equal(search.body.results[0].title, "Lancement du projet Atlas");
  assert.equal(search.body.results[0].citation.relativePath, "Acme/projet.md");
  assert.equal(search.body.results[0].citation.lineStart, 2);

  const citation = search.body.results[0].citation;
  const viewer = await request(
    runtime.url,
    `/source/${encodeURIComponent(citation.sourceId)}?snapshot=${encodeURIComponent(citation.snapshotId)}&lineStart=${citation.lineStart}&lineEnd=${citation.lineEnd}`
  );
  assert.equal(viewer.response.status, 200);
  assert.match(viewer.body, /Acme\/projet\.md/);
  assert.match(viewer.body, /source-line highlighted/);
  assert.match(viewer.body, /La date de lancement proposée est mardi/);

  const duplicate = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Acme",
    files
  });
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.body.summary.unchangedSources, 2);
  assert.equal(duplicate.body.summary.createdCandidates, 0);
  const afterDuplicate = await request(runtime.url, "/api/candidates?status=all");
  assert.equal(afterDuplicate.body.candidates.length, 3);

  await app.stop();
  app = createSuperMemoryServer({ vaultRoot, hindsightOptions: { enabled: false } });
  runtime = await app.start();
  const afterRestart = await request(runtime.url, "/api/status");
  assert.equal(afterRestart.body.counts.sources, 2);
  assert.equal(afterRestart.body.counts.approvedMemories, 1);
  const persistedSearch = await jsonRequest(runtime.url, "/api/search", { query: "Atlas mardi" });
  assert.equal(persistedSearch.body.results.length, 1);

  const changed = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Acme",
    files: [
      {
        relativePath: "Acme/projet.md",
        name: "projet.md",
        text: "# Projet Atlas\nLa date de lancement est désormais vendredi.\n"
      },
      files[1]
    ]
  });
  assert.equal(changed.response.status, 201);
  assert.equal(changed.body.summary.changedSources, 1);
  assert.equal(changed.body.summary.unchangedSources, 1);
  assert.equal(changed.body.summary.staleMemories, 1);
  assert.equal(changed.body.summary.createdCandidates, 1);

  const staleStatus = await request(runtime.url, "/api/status");
  assert.equal(staleStatus.body.counts.approvedMemories, 0);
  assert.equal(staleStatus.body.counts.staleMemories, 1);
  const staleSearch = await jsonRequest(runtime.url, "/api/search", { query: "mardi" });
  assert.equal(staleSearch.body.results.length, 0);
  const newPending = await request(runtime.url, "/api/candidates?status=pending");
  assert.ok(newPending.body.candidates.some((candidate) => candidate.text.includes("vendredi")));

  const unsafe = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Unsafe",
    files: [{ relativePath: "../secret.txt", name: "secret.txt", text: "nope" }]
  });
  assert.equal(unsafe.response.status, 400);
  assert.equal(unsafe.body.error.code, "relative_path_invalid");

  const crossOrigin = await jsonRequest(
    runtime.url,
    "/api/search",
    { query: "Atlas" },
    { headers: { Origin: "https://example.com" } }
  );
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.body.error.code, "cross_origin_forbidden");
});

test("local web product ingests exact PDF and DOCX binaries with page and section citations", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-binary-"));
  const vaultRoot = path.join(tempRoot, "vault");
  const app = createSuperMemoryServer({ vaultRoot, hindsightOptions: { enabled: false } });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const pdf = generatedPdf("Le contrat PDF est signe lundi");
  const docx = generatedDocx();
  const ingest = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Binaires",
    files: [
      { relativePath: "Binaires/contrat.pdf", name: "contrat.pdf", base64: pdf.toString("base64") },
      { relativePath: "Binaires/route.docx", name: "route.docx", base64: docx.toString("base64") }
    ]
  });
  assert.equal(ingest.response.status, 201);
  assert.equal(ingest.body.summary.acceptedFiles, 2);
  assert.equal(ingest.body.summary.createdSources, 2);

  const snapshots = listFiles(path.join(vaultRoot, "00_inbox", "snapshots", "sha256"));
  const snapshotBytes = snapshots.map((file) => fs.readFileSync(file));
  assert.ok(snapshotBytes.some((bytes) => bytes.equals(pdf)));
  assert.ok(snapshotBytes.some((bytes) => bytes.equals(docx)));

  const pending = await request(runtime.url, "/api/candidates?status=pending");
  const pdfCandidate = pending.body.candidates.find((candidate) => candidate.relativePath.endsWith(".pdf"));
  const docxCandidate = pending.body.candidates.find((candidate) => candidate.relativePath.endsWith(".docx"));
  assert.deepEqual(pdfCandidate.locator, { kind: "pdf_page", page: 1 });
  assert.deepEqual(docxCandidate.locator, {
    kind: "docx_section",
    section: 1,
    heading: "Feuille de route"
  });

  for (const candidate of [pdfCandidate, docxCandidate]) {
    const approved = await jsonRequest(
      runtime.url,
      `/api/candidates/${encodeURIComponent(candidate.candidateId)}/review`,
      { action: "approve" }
    );
    assert.equal(approved.response.status, 200);
  }

  const pdfSearch = await jsonRequest(runtime.url, "/api/search", { query: "contrat PDF lundi" });
  assert.equal(pdfSearch.body.results[0].citation.label, "Binaires/contrat.pdf, page 1");
  const pdfCitation = pdfSearch.body.results[0].citation;
  const viewer = await request(
    runtime.url,
    `/source/${encodeURIComponent(pdfCitation.sourceId)}?snapshot=${encodeURIComponent(pdfCitation.snapshotId)}&locator=${encodeURIComponent(JSON.stringify(pdfCitation.locator))}`
  );
  assert.match(viewer.body, /source-section highlighted/);
  assert.match(viewer.body, /Le contrat PDF est signe lundi/);

  const rawResponse = await fetch(new URL(
    `/source/${encodeURIComponent(pdfCitation.sourceId)}/raw?snapshot=${encodeURIComponent(pdfCitation.snapshotId)}`,
    runtime.url
  ));
  assert.equal(rawResponse.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await rawResponse.arrayBuffer()), pdf);

  const malformed = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Binaires",
    files: [{ relativePath: "Binaires/casse.pdf", name: "casse.pdf", base64: Buffer.from("broken").toString("base64") }]
  });
  assert.equal(malformed.response.status, 422);
  assert.equal(malformed.body.error.code, "pdf_malformed");

  const oversized = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Binaires",
    files: [{
      relativePath: "Binaires/trop-grand.docx",
      name: "trop-grand.docx",
      base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")
    }]
  });
  assert.equal(oversized.response.status, 400);
  assert.equal(oversized.body.error.code, "file_too_large");
});

test("local web product exposes verified backup and exact-confirmation restore recovery", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-backup-api-"));
  const vaultRoot = path.join(tempRoot, "vault");
  const backupsRoot = path.join(tempRoot, "backups");
  const app = createSuperMemoryServer({
    vaultRoot,
    backupsRoot,
    hindsightOptions: { enabled: false }
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Recovery",
    files: [{
      relativePath: "Recovery/source.md",
      name: "source.md",
      text: "# Référence\nLa valeur sauvegardée est SAFE321.\n"
    }],
    inventoryComplete: true
  });
  let pending = await request(runtime.url, "/api/candidates?status=pending");
  await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(pending.body.candidates[0].candidateId)}/review`,
    { action: "approve" }
  );

  const created = await jsonRequest(runtime.url, "/api/backups", { reason: "api-test" });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.backup.verified, true);
  assert.equal(created.body.backup.path, undefined);
  const backupId = created.body.backup.backupId;

  await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Recovery",
    files: [{
      relativePath: "Recovery/source.md",
      name: "source.md",
      text: "# Référence\nLa valeur temporaire est CHANGED654.\n"
    }],
    inventoryComplete: true
  });
  pending = await request(runtime.url, "/api/candidates?status=pending");
  await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(pending.body.candidates[0].candidateId)}/review`,
    { action: "approve" }
  );

  const refused = await jsonRequest(
    runtime.url,
    `/api/backups/${encodeURIComponent(backupId)}/restore`,
    { confirmation: "RESTORE wrong" }
  );
  assert.equal(refused.response.status, 400);
  assert.equal(refused.body.error.code, "restore_confirmation_invalid");

  const restored = await jsonRequest(
    runtime.url,
    `/api/backups/${encodeURIComponent(backupId)}/restore`,
    { confirmation: `RESTORE ${backupId}` }
  );
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.status, "restored");
  assert.equal(restored.body.hindsightRebuild.status, "skipped");
  assert.match(restored.body.safetyBackupId, /^backup-/);

  const recovered = await jsonRequest(runtime.url, "/api/search", { query: "SAFE321" });
  assert.equal(recovered.body.results.length, 1);
  assert.match(recovered.body.results[0].text, /SAFE321/);
  const missingChanged = await jsonRequest(runtime.url, "/api/search", { query: "CHANGED654" });
  assert.equal(missingChanged.body.results.length, 0);
  const backups = await request(runtime.url, "/api/backups");
  assert.equal(backups.body.backups.length, 2);
  assert.ok(backups.body.backups.every((item) => item.verified));
});

test("explicit automatic mode exposes Exceptions and activates verified standard memory without review", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-automatic-api-"));
  const app = createSuperMemoryServer({
    vaultRoot: path.join(tempRoot, "vault"),
    admissionMode: "automatic",
    hindsightOptions: { enabled: false },
    verifier: {
      async verify() {
        return {
          status: "verified",
          verifier: { provider: "fixture", model: "verifier-v1", prompt_version: "verify-v1", independent: true },
          signals: {
            evidence_entailment: 0.99,
            source_trust: 0.98,
            extraction_agreement: 0.96,
            scope_valid: true,
            ontology_compatible: true,
            contradiction_risk: 0
          }
        };
      }
    }
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const ingest = await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Automatic",
    files: [{ relativePath: "Automatic/decision.md", text: "# Decision\nUse automatic verified admission." }]
  });
  assert.equal(ingest.body.summary.admission.auto_activate, 1);
  const status = await request(runtime.url, "/api/status");
  assert.equal(status.body.admission.mode, "automatic");
  assert.equal(status.body.counts.approvedMemories, 1);
  assert.equal(status.body.counts.exceptions, 0);
  const exceptions = await request(runtime.url, "/api/candidates");
  assert.deepEqual(exceptions.body.candidates, []);
  const search = await jsonRequest(runtime.url, "/api/search", { query: "automatic verified" });
  assert.equal(search.body.results.length, 1);
  assert.ok(search.body.results[0].citation.snapshotId);
});

test("automatic review ignores forged HTTP verifier signals and keeps quarantine non-recallable", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-forged-verifier-"));
  const app = createSuperMemoryServer({
    vaultRoot: path.join(tempRoot, "vault"),
    admissionMode: "automatic",
    hindsightOptions: { enabled: false },
    verifier: {
      async verify() {
        return {
          status: "verified",
          verifier: { provider: "server", model: "server-verifier", prompt_version: "verify-v1", independent: true },
          signals: {
            evidence_entailment: 0.99,
            source_trust: 0.95,
            extraction_agreement: 0.94,
            scope_valid: true,
            ontology_compatible: true,
            contradiction_risk: 0.8,
            high_impact: true
          }
        };
      }
    }
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await jsonRequest(runtime.url, "/api/ingest", {
    folderName: "Risk",
    files: [{ relativePath: "Risk/claim.md", text: "# Claim\nA high impact claim is disputed." }]
  });
  const exceptions = await request(runtime.url, "/api/candidates");
  assert.equal(exceptions.body.candidates.length, 1);
  const candidateId = exceptions.body.candidates[0].candidateId;
  const forged = await jsonRequest(
    runtime.url,
    `/api/candidates/${encodeURIComponent(candidateId)}/review`,
    {
      action: "approve",
      verification: {
        status: "verified",
        verifier: { provider: "attacker", model: "fake", prompt_version: "fake", independent: true },
        signals: {
          evidence_entailment: 1,
          source_trust: 1,
          extraction_agreement: 1,
          scope_valid: true,
          ontology_compatible: true,
          contradiction_risk: 0
        }
      }
    }
  );
  assert.equal(forged.response.status, 409);
  assert.equal(forged.body.error.code, "quarantine_resolution_not_verified");
  const status = await request(runtime.url, "/api/status");
  assert.equal(status.body.counts.approvedMemories, 0);
  assert.equal(status.body.counts.exceptions, 1);
  const search = await jsonRequest(runtime.url, "/api/search", { query: "high impact disputed" });
  assert.deepEqual(search.body.results, []);
});

test("Topic Continuity UI APIs proxy only Working Set-bound work and exception operations", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supermemory-topic-ui-"));
  const calls = [];
  const daemonProxy = {
    async post(route, body) {
      calls.push({ route, body });
      if (route === "/v1/topic/context") return {
        topic: { topic_id: "topic_demo", title: "Sujet courant" },
        membership: { resolution: "exact" }, memberships: [{}, {}],
        working_view: { budget: { selected_tokens: 1000, capacity_tokens: 100000 } },
        working_map: { sections: { goal: [], constraints: [], current_state: [], decisions: [], next_actions: [], open_questions: [] } }
      };
      if (route === "/v1/exceptions/query") return { results: [{ fingerprint: "sha256:demo", level: "visible" }] };
      if (route === "/v1/exceptions/resolve") return { status: "resolved", fingerprint: body.fingerprint };
      if (route === "/v1/admin/rebuild") return { status: "rebuilt" };
      throw new Error("unexpected_route");
    }
  };
  const app = createSuperMemoryServer({
    vaultRoot: path.join(tempRoot, "vault"),
    hindsightOptions: { enabled: false },
    daemonProxy
  });
  const runtime = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const workingSetId = "wset_018f7c0e-7b7d-7abc-8def-0123456789ad";
  const work = await request(runtime.url, `/api/work?workingSetId=${workingSetId}`);
  assert.equal(work.body.topic.topic_id, "topic_demo");
  const exceptions = await request(runtime.url, `/api/authority-exceptions?workingSetId=${workingSetId}`);
  assert.equal(exceptions.body.results.length, 1);
  const resolved = await jsonRequest(runtime.url, "/api/authority-exceptions/resolve", {
    workingSetId, fingerprint: "sha256:demo", decision: "Prefer primary evidence"
  });
  assert.equal(resolved.body.status, "resolved");
  assert.deepEqual(calls.map((item) => item.route), [
    "/v1/topic/context", "/v1/exceptions/query", "/v1/exceptions/resolve"
  ]);
  assert.equal(calls.some((item) => Object.hasOwn(item.body, "topic_id")), false);
});
