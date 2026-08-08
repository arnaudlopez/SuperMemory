#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProductBackupManager, ProductBackupError } from "./lib/product-backup.mjs";
import { createProductHindsight } from "./lib/product-hindsight.mjs";
import { createProductStore, ProductError } from "./lib/product-store.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultWebRoot = path.resolve(moduleDirectory, "..", "web");
const MAX_BODY_BYTES = 30 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 4310,
    vaultRoot: process.env.SUPERMEMORY_VAULT_ROOT || path.resolve("identity-vault"),
    backupsRoot: process.env.SUPERMEMORY_BACKUPS_ROOT || path.join(os.homedir(), ".supermemory", "backups"),
    admissionMode: process.env.SUPERMEMORY_ADMISSION_MODE === "automatic"
      ? "automatic"
      : "legacy_manual",
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      options.host = argv[++index];
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--vault-root") {
      options.vaultRoot = argv[++index];
    } else if (arg === "--backups-root") {
      options.backupsRoot = argv[++index];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--automatic-admission") {
      options.admissionMode = "automatic";
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (options.host !== "127.0.0.1") throw new Error("host_must_be_loopback");
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("port_invalid");
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/supermemory-app.mjs [--port <number>] [--vault-root <directory>] [--backups-root <directory>] [--automatic-admission] [--json]",
    "",
    "Starts the SuperMemory local web application on 127.0.0.1.",
    "Markdown, TXT, PDF and DOCX are extracted locally with source citations."
  ].join("\n");
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  const payload = contentType.startsWith("application/json")
    ? `${JSON.stringify(body)}\n`
    : body;
  res.writeHead(status, {
    ...securityHeaders(contentType),
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(res, error) {
  const productError = error instanceof ProductError
    ? error
    : error instanceof ProductBackupError
      ? new ProductError(
        error.code,
        error.message,
        error.code === "backup_not_found" ? 404 : error.code === "backup_integrity_failed" ? 409 : 400
      )
      : new ProductError("internal_error", "Une erreur locale inattendue est survenue.", 500);
  send(res, productError.status, {
    error: {
      code: productError.code,
      message: productError.message,
      details: productError.details
    }
  });
}

function assertLocalRequest(req) {
  const hostHeader = String(req.headers.host ?? "");
  const hostname = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : hostHeader.split(":")[0];
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new ProductError("local_host_required", "SuperMemory refuse les requêtes qui ne ciblent pas la boucle locale.", 403);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET")) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${hostHeader}`) {
      throw new ProductError("cross_origin_forbidden", "Cette requête ne vient pas de l’application locale.", 403);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) {
        reject(new ProductError("request_too_large", "La requête dépasse la limite locale de 21 Mo.", 413));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new ProductError("json_invalid", "La requête JSON est invalide."));
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sourceViewer({ source, snapshot, text, segments }, lineStart, lineEnd, locatorValue) {
  let locator = null;
  try {
    locator = locatorValue ? JSON.parse(locatorValue) : null;
  } catch {
    throw new ProductError("locator_invalid", "Le localisateur de citation est invalide.");
  }
  if (segments) {
    const rows = segments.map((segment) => {
      const highlighted = JSON.stringify(segment.locator) === JSON.stringify(locator);
      return `<section class="source-section${highlighted ? " highlighted" : ""}">
        <h2>${escapeHtml(segment.title)}</h2>
        <pre>${escapeHtml(segment.text)}</pre>
      </section>`;
    }).join("");
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(source.relativePath)} — SuperMemory</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="source-viewer">
  <header class="source-header"><div><strong>${escapeHtml(source.relativePath)}</strong><small>${escapeHtml(snapshot.snapshotId)}</small></div><a href="/source/${encodeURIComponent(source.sourceId)}/raw?snapshot=${encodeURIComponent(snapshot.snapshotId)}">Ouvrir le fichier brut ↗</a></header>
  <main class="source-sections">${rows}</main>
</body>
</html>`;
  }
  const start = Math.max(1, Number(lineStart) || 1);
  const end = Math.max(start, Number(lineEnd) || start);
  const rows = text.split("\n").map((line, index) => {
    const number = index + 1;
    const highlighted = number >= start && number <= end;
    return `<div class="source-line${highlighted ? " highlighted" : ""}" id="L${number}"><span>${number}</span><code>${escapeHtml(line) || " "}</code></div>`;
  }).join("");
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(source.relativePath)} — SuperMemory</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="source-viewer">
  <header class="source-header"><strong>${escapeHtml(source.relativePath)}</strong><small>${escapeHtml(snapshot.snapshotId)} · lignes ${start}-${end}</small></header>
  <main class="source-lines">${rows}</main>
</body>
</html>`;
}

function staticAsset(webRoot, pathname) {
  const assets = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"]
  };
  const entry = assets[pathname];
  if (!entry) return null;
  const filePath = path.join(webRoot, entry[0]);
  return { bytes: fs.readFileSync(filePath), contentType: entry[1] };
}

async function rebuildDerivedHindsight(hindsight, store) {
  if (!hindsight?.enabled) {
    return { status: "skipped", reason: "hindsight_disabled" };
  }
  const baseUrl = new URL(hindsight.baseUrl);
  if (
    baseUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(baseUrl.hostname)
  ) {
    return { status: "pending", reason: "hindsight_remote_forbidden" };
  }
  try {
    const response = await fetch(
      `${hindsight.baseUrl}/v1/default/banks/${encodeURIComponent(hindsight.bankId)}`,
      {
        method: "DELETE",
        headers: process.env.HINDSIGHT_API_KEY
          ? { Authorization: `Bearer ${process.env.HINDSIGHT_API_KEY}` }
          : {}
      }
    );
    if (!response.ok && ![404, 410].includes(response.status)) {
      return { status: "pending", reason: `hindsight_reset_http_${response.status}` };
    }
    const retry = await store.retryProjections();
    return {
      ...retry,
      status: retry.remaining === 0 && retry.deletionsRemaining === 0 ? "rebuilt" : "pending"
    };
  } catch (error) {
    return {
      status: "pending",
      reason: String(error?.code || error?.name || "hindsight_reset_failed")
    };
  }
}

export function createSuperMemoryServer({
  host = "127.0.0.1",
  port = 0,
  vaultRoot,
  webRoot = defaultWebRoot,
  clock,
  hindsight = null,
  hindsightOptions = {},
  backupsRoot = process.env.SUPERMEMORY_BACKUPS_ROOT || path.join(os.homedir(), ".supermemory", "backups"),
  backupManager = null,
  admissionMode = "legacy_manual",
  admissionPolicy = null,
  verifier = null
}) {
  if (host !== "127.0.0.1") throw new Error("host_must_be_loopback");
  const hindsightAdapter = hindsight ?? createProductHindsight(hindsightOptions);
  const store = createProductStore({
    vaultRoot,
    clock,
    hindsight: hindsightAdapter,
    admissionMode,
    admissionPolicy,
    verifier
  });
  const backups = backupManager ?? createProductBackupManager({ vaultRoot, backupsRoot, clock });
  let server;

  const requestHandler = async (req, res) => {
    try {
      assertLocalRequest(req);
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/api/status") {
        send(res, 200, await store.getStatus());
        return;
      }
      if (req.method === "GET" && pathname === "/api/candidates") {
        const defaultStatus = store.admissionMode === "automatic" ? "quarantined" : "pending";
        send(res, 200, { candidates: store.listCandidates(url.searchParams.get("status") || defaultStatus) });
        return;
      }
      if (req.method === "GET" && pathname === "/api/memories") {
        send(res, 200, { memories: store.listMemories() });
        return;
      }
      if (req.method === "GET" && pathname === "/api/sources") {
        send(res, 200, {
          sources: store.listSources({ includeDeleted: url.searchParams.get("includeDeleted") === "true" })
        });
        return;
      }
      if (req.method === "GET" && pathname === "/api/backups") {
        send(res, 200, { backups: backups.list() });
        return;
      }
      if (req.method === "POST" && pathname === "/api/backups") {
        const body = await readJsonBody(req);
        const created = backups.create({ reason: body.reason || "manual" });
        const { path: _privatePath, ...publicBackup } = created;
        send(res, 201, { status: "created", backup: publicBackup });
        return;
      }
      const restoreMatch = /^\/api\/backups\/([^/]+)\/restore$/.exec(pathname);
      if (req.method === "POST" && restoreMatch) {
        const backupId = decodeURIComponent(restoreMatch[1]);
        const body = await readJsonBody(req);
        const restored = backups.restore(backupId, body.confirmation);
        const hindsightRebuild = await rebuildDerivedHindsight(hindsightAdapter, store);
        send(res, 200, { ...restored, hindsightRebuild });
        return;
      }
      if (req.method === "POST" && pathname === "/api/ingest") {
        send(res, 201, await store.ingest(await readJsonBody(req)));
        return;
      }
      const reviewMatch = /^\/api\/candidates\/([^/]+)\/review$/.exec(pathname);
      if (req.method === "POST" && reviewMatch) {
        const candidateId = decodeURIComponent(reviewMatch[1]);
        const body = await readJsonBody(req);
        send(res, 200, await store.reviewCandidate(candidateId, {
          action: body.action,
          title: body.title,
          text: body.text
        }));
        return;
      }
      if (req.method === "POST" && pathname === "/api/search") {
        const body = await readJsonBody(req);
        send(res, 200, await store.search(body.query, body.limit));
        return;
      }
      if (req.method === "POST" && pathname === "/api/hindsight/retry") {
        send(res, 200, await store.retryProjections());
        return;
      }
      const sourceRemovalMatch = /^\/api\/sources\/([^/]+)\/removal$/.exec(pathname);
      if (req.method === "POST" && sourceRemovalMatch) {
        const sourceId = decodeURIComponent(sourceRemovalMatch[1]);
        const body = await readJsonBody(req);
        if (body.action === "stage") {
          send(res, 200, store.stageSourceRemoval(sourceId));
          return;
        }
        if (body.action === "cancel") {
          send(res, 200, store.cancelSourceRemoval(sourceId));
          return;
        }
        if (body.action === "confirm") {
          send(res, 200, await store.confirmSourceDeletion(sourceId, body.confirmation));
          return;
        }
        throw new ProductError("removal_action_invalid", "L’action de suppression est invalide.");
      }
      const sourceMatch = /^\/source\/([^/]+)$/.exec(pathname);
      if (req.method === "GET" && sourceMatch) {
        const sourceId = decodeURIComponent(sourceMatch[1]);
        const source = store.getSource(sourceId, url.searchParams.get("snapshot"));
        const html = sourceViewer(
          source,
          url.searchParams.get("lineStart"),
          url.searchParams.get("lineEnd"),
          url.searchParams.get("locator")
        );
        send(res, 200, html, "text/html; charset=utf-8");
        return;
      }
      const rawSourceMatch = /^\/source\/([^/]+)\/raw$/.exec(pathname);
      if (req.method === "GET" && rawSourceMatch) {
        const sourceId = decodeURIComponent(rawSourceMatch[1]);
        const source = store.getSource(sourceId, url.searchParams.get("snapshot"));
        const contentTypes = {
          pdf: "application/pdf",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          md: "text/markdown; charset=utf-8",
          markdown: "text/markdown; charset=utf-8",
          txt: "text/plain; charset=utf-8"
        };
        const disposition = source.source.sourceKind === "pdf" ? "inline" : "attachment";
        const filename = path.posix.basename(source.source.relativePath).replace(/["\r\n]/g, "_");
        const payload = source.bytes;
        res.writeHead(200, {
          ...securityHeaders(contentTypes[source.source.sourceKind] || "application/octet-stream"),
          "Content-Disposition": `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": payload.length
        });
        res.end(payload);
        return;
      }

      if (req.method === "GET") {
        const asset = staticAsset(webRoot, pathname);
        if (asset) {
          send(res, 200, asset.bytes, asset.contentType);
          return;
        }
      }
      send(res, 404, { error: { code: "not_found", message: "Ressource locale introuvable." } });
    } catch (error) {
      sendError(res, error);
    }
  };

  return {
    host,
    store,
    backups,
    async start() {
      if (server) throw new Error("server_already_started");
      server = http.createServer(requestHandler);
      server.requestTimeout = 30_000;
      server.headersTimeout = 10_000;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      return {
        host,
        port: typeof address === "object" && address ? address.port : port,
        url: `http://${host}:${typeof address === "object" && address ? address.port : port}/`,
        vaultRoot: store.vaultRoot
      };
    },
    async stop() {
      if (!server) return;
      const current = server;
      server = null;
      await new Promise((resolve, reject) => current.close((error) => error ? reject(error) : resolve()));
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const app = createSuperMemoryServer(options);
  const runtime = await app.start();
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ status: "ready", ...runtime })}\n`);
  } else {
    process.stdout.write(`SuperMemory est prêt sur ${runtime.url}\n`);
    process.stdout.write(`Vault local: ${runtime.vaultRoot}\n`);
    process.stdout.write("Appuie sur Ctrl-C pour arrêter.\n");
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
