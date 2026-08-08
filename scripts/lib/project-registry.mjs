import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withVaultMutationLock } from "./registry-transaction.mjs";

const REGISTRY_SCHEMA = "supermemory.project-registry-event.v1";
const PROJECT_MARKER_SCHEMA = "supermemory.project-marker.v1";
const CHECKOUT_MARKER_SCHEMA = "supermemory.checkout-marker.v1";
const PROJECT_ID = /^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ID = /^ws_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKOUT_ID = /^co_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProjectRegistryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ProjectRegistryError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ProjectRegistryError(code, message, details);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertId(value, pattern, code) {
  if (!pattern.test(String(value ?? ""))) fail(code, `Invalid identifier: ${value ?? ""}`);
  return value;
}

function cleanDisplayName(value) {
  const name = String(value ?? "Projet local").trim().replace(/\s+/g, " ");
  if (!name) return "Projet local";
  return name.slice(0, 160);
}

function formatUuid(bytes) {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export function generateUuidV7({
  now = Date.now(),
  randomBytes = crypto.randomBytes
} = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    fail("uuid_time_invalid", "UUIDv7 timestamp is invalid.");
  }
  const bytes = Buffer.from(randomBytes(16));
  if (bytes.length !== 16) fail("uuid_random_invalid", "UUIDv7 requires 16 random bytes.");
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function makeId(prefix, now, randomBytes) {
  return `${prefix}_${generateUuidV7({ now, randomBytes })}`;
}

function writeAndSync(filePath, content, mode = 0o600, exclusive = false) {
  const descriptor = fs.openSync(filePath, exclusive ? "wx" : "w", mode);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
    // Directory fsync is not portable. File fsync + atomic rename remains the baseline.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicWrite(filePath, content, mode = 0o600) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("registry_path_invalid", `Unsafe registry target: ${filePath}`);
    }
  }
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    writeAndSync(tempPath, content, mode, true);
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, mode);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureRootDirectory(requestedRoot) {
  const resolved = path.resolve(requestedRoot);
  if (!fs.existsSync(resolved)) fail("vault_root_missing", `Vault root does not exist: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("vault_root_invalid", "The vault root must be a real directory.");
  }
  return fs.realpathSync(resolved);
}

function ensureSafeDirectory(rootReal, relativeDirectory) {
  let current = rootReal;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail("registry_path_invalid", `Unsafe registry directory: ${relativeDirectory}`);
      }
    } else {
      fs.mkdirSync(next, { mode: 0o700 });
    }
    current = fs.realpathSync(next);
    if (!isInside(rootReal, current)) fail("vault_scope_escape", "Registry directory escaped the vault.");
    fs.chmodSync(current, 0o700);
  }
  return current;
}

function realProjectDirectory(requestedRoot) {
  const resolved = path.resolve(requestedRoot);
  if (!fs.existsSync(resolved)) fail("project_root_missing", `Project root does not exist: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("project_root_invalid", "The project root must be a real directory.");
  }
  return fs.realpathSync(resolved);
}

function gitOutput(projectRoot, argument) {
  const result = spawnSync("git", ["-C", projectRoot, "rev-parse", argument], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) return null;
  const output = result.stdout.trim();
  return output || null;
}

function absoluteGitPath(projectRoot, value) {
  const resolved = path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
  if (!fs.existsSync(resolved)) fail("git_metadata_missing", `Git metadata is missing: ${resolved}`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("git_metadata_invalid", `Git metadata is unsafe: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function inspectProjectLayout(requestedRoot) {
  const initialRoot = realProjectDirectory(requestedRoot);
  const topLevel = gitOutput(initialRoot, "--show-toplevel");
  if (!topLevel) {
    const markerDirectory = path.join(initialRoot, ".supermemory");
    return {
      root: initialRoot,
      kind: "non_git",
      gitCommonDirectory: null,
      gitDirectory: null,
      projectMarkerPath: path.join(markerDirectory, "project.json"),
      checkoutMarkerPath: path.join(markerDirectory, "checkout.json")
    };
  }

  const root = realProjectDirectory(topLevel);
  const rawCommon = gitOutput(root, "--git-common-dir");
  const rawGit = gitOutput(root, "--git-dir");
  if (!rawCommon || !rawGit) fail("git_metadata_missing", "Git metadata could not be resolved.");
  const gitCommonDirectory = absoluteGitPath(root, rawCommon);
  const gitDirectory = absoluteGitPath(root, rawGit);
  const projectMarkerDirectory = path.join(gitCommonDirectory, "supermemory");
  const checkoutMarkerDirectory = path.join(gitDirectory, "supermemory");
  return {
    root,
    kind: gitDirectory === gitCommonDirectory ? "git_primary" : "git_worktree",
    gitCommonDirectory,
    gitDirectory,
    projectMarkerPath: path.join(projectMarkerDirectory, "project.json"),
    checkoutMarkerPath: path.join(checkoutMarkerDirectory, "checkout.json")
  };
}

function ensureMarkerDirectory(layout, markerPath) {
  const boundary = layout.kind === "non_git"
    ? layout.root
    : markerPath === layout.projectMarkerPath
      ? layout.gitCommonDirectory
      : layout.gitDirectory;
  const relative = path.relative(boundary, path.dirname(markerPath)).split(path.sep).join("/");
  return ensureSafeDirectory(boundary, relative);
}

function readJsonFile(filePath, code) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code, `Unsafe marker: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(code, `Unreadable JSON file: ${filePath}`);
  }
}

function validateProjectMarker(marker) {
  if (!marker) return null;
  if (marker.schema !== PROJECT_MARKER_SCHEMA) fail("project_marker_invalid", "Unsupported project marker.");
  assertId(marker.project_id, PROJECT_ID, "project_marker_invalid");
  assertId(marker.workspace_id, WORKSPACE_ID, "project_marker_invalid");
  return marker;
}

function validateCheckoutMarker(marker) {
  if (!marker) return null;
  if (marker.schema !== CHECKOUT_MARKER_SCHEMA) fail("checkout_marker_invalid", "Unsupported checkout marker.");
  assertId(marker.project_id, PROJECT_ID, "checkout_marker_invalid");
  assertId(marker.workspace_id, WORKSPACE_ID, "checkout_marker_invalid");
  assertId(marker.checkout_id, CHECKOUT_ID, "checkout_marker_invalid");
  return marker;
}

function readMarkers(layout) {
  const project = validateProjectMarker(readJsonFile(layout.projectMarkerPath, "project_marker_invalid"));
  const checkout = validateCheckoutMarker(readJsonFile(layout.checkoutMarkerPath, "checkout_marker_invalid"));
  if (!project && checkout) fail("marker_pair_invalid", "Checkout marker exists without a project marker.");
  if (
    project &&
    checkout &&
    (project.project_id !== checkout.project_id || project.workspace_id !== checkout.workspace_id)
  ) {
    fail("marker_pair_invalid", "Project and checkout markers disagree.");
  }
  return { project, checkout };
}

export function resolveProjectMarkerBinding(projectRoot) {
  const layout = inspectProjectLayout(projectRoot);
  const markers = readMarkers(layout);
  if (!markers.project || !markers.checkout) {
    return { status: "unbound", root: layout.root };
  }
  return {
    status: "bound",
    root: layout.root,
    projectId: markers.project.project_id,
    workspaceId: markers.project.workspace_id,
    checkoutId: markers.checkout.checkout_id
  };
}

function rootIdentity(root) {
  const stat = fs.statSync(root, { bigint: true });
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    pathFingerprint: `sha256:${sha256(root)}`
  };
}

function gitCommonFingerprint(layout) {
  return layout.gitCommonDirectory ? `sha256:${sha256(layout.gitCommonDirectory)}` : null;
}

function registryPaths(vaultRoot, { create = false } = {}) {
  const relativeDirectory = "00_inbox/supermemory-product";
  const directory = create
    ? ensureSafeDirectory(vaultRoot, relativeDirectory)
    : path.join(vaultRoot, ...relativeDirectory.split("/"));
  if (!create) {
    let current = vaultRoot;
    for (const segment of relativeDirectory.split("/")) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) break;
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail("registry_path_invalid", `Unsafe registry directory: ${relativeDirectory}`);
      }
    }
  }
  return {
    directory,
    registry: path.join(directory, "projects.jsonl"),
    legacyState: path.join(directory, "state.json")
  };
}

function eventContent(event) {
  return `${JSON.stringify(event)}\n`;
}

function readEvents(registryPath) {
  if (!fs.existsSync(registryPath)) return [];
  const stat = fs.lstatSync(registryPath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail("project_registry_invalid", "Project registry is unsafe.");
  const content = fs.readFileSync(registryPath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      fail("project_registry_invalid", `Invalid JSONL at line ${index + 1}.`);
    }
  });
}

function activeAlias(checkout) {
  return checkout.aliases.find((alias) => alias.status === "active") ?? null;
}

function assertNoActiveAliasCollision(view, fingerprint, checkoutId = null) {
  for (const checkout of view.checkouts.values()) {
    if (checkout.checkoutId === checkoutId) continue;
    if (activeAlias(checkout)?.pathFingerprint === fingerprint) {
      fail("alias_conflict", "This project root is already bound to another checkout.", {
        conflicting_checkout_id: checkout.checkoutId
      });
    }
  }
}

function reduceEvents(events) {
  const view = {
    projects: new Map(),
    checkouts: new Map(),
    legacyMappings: new Map(),
    eventIds: new Set()
  };

  for (const event of events) {
    if (event?.schema !== REGISTRY_SCHEMA || typeof event.event_type !== "string") {
      fail("project_registry_invalid", "Unsupported project registry event.");
    }
    if (!event.event_id || view.eventIds.has(event.event_id)) {
      fail("project_registry_invalid", "Duplicate or missing project registry event id.");
    }
    view.eventIds.add(event.event_id);

    if (event.event_type === "project.created") {
      assertId(event.project_id, PROJECT_ID, "project_registry_invalid");
      assertId(event.workspace_id, WORKSPACE_ID, "project_registry_invalid");
      if (view.projects.has(event.project_id)) fail("project_registry_invalid", "Project was created twice.");
      for (const project of view.projects.values()) {
        if (project.workspaceId === event.workspace_id) {
          fail("project_registry_invalid", "Workspace is already owned by another project.");
        }
      }
      view.projects.set(event.project_id, {
        projectId: event.project_id,
        workspaceId: event.workspace_id,
        displayName: cleanDisplayName(event.display_name),
        status: "active",
        createdAt: event.occurred_at,
        nativeMemoriesMode: "disabled",
        checkoutIds: []
      });
      continue;
    }

    if (event.event_type === "legacy.workspace_mapped") {
      const project = view.projects.get(event.project_id);
      if (!project || project.workspaceId !== event.workspace_id || !event.legacy_workspace_id) {
        fail("project_registry_invalid", "Legacy workspace mapping is invalid.");
      }
      const existing = view.legacyMappings.get(event.legacy_workspace_id);
      if (existing && existing.workspaceId !== event.workspace_id) {
        fail("project_registry_invalid", "Legacy workspace is mapped more than once.");
      }
      view.legacyMappings.set(event.legacy_workspace_id, {
        legacyWorkspaceId: event.legacy_workspace_id,
        projectId: event.project_id,
        workspaceId: event.workspace_id,
        mappedAt: event.occurred_at
      });
      continue;
    }

    if (event.event_type === "checkout.bound") {
      assertId(event.checkout_id, CHECKOUT_ID, "project_registry_invalid");
      const project = view.projects.get(event.project_id);
      if (!project || project.workspaceId !== event.workspace_id || view.checkouts.has(event.checkout_id)) {
        fail("project_registry_invalid", "Checkout binding is invalid.");
      }
      assertNoActiveAliasCollision(view, event.alias.path_fingerprint);
      const checkout = {
        checkoutId: event.checkout_id,
        projectId: event.project_id,
        workspaceId: event.workspace_id,
        kind: event.checkout_kind,
        gitCommonDirectoryFingerprint: event.git_common_dir_fingerprint ?? null,
        aliases: [{
          pathFingerprint: event.alias.path_fingerprint,
          device: event.alias.device,
          inode: event.alias.inode,
          status: "active",
          firstSeenAt: event.occurred_at,
          lastSeenAt: event.occurred_at
        }]
      };
      view.checkouts.set(checkout.checkoutId, checkout);
      project.checkoutIds.push(checkout.checkoutId);
      continue;
    }

    if (event.event_type === "checkout.alias_moved" || event.event_type === "checkout.rebound") {
      const checkout = view.checkouts.get(event.checkout_id);
      if (
        !checkout ||
        checkout.projectId !== event.project_id ||
        checkout.workspaceId !== event.workspace_id
      ) {
        fail("project_registry_invalid", "Checkout alias transition is invalid.");
      }
      assertNoActiveAliasCollision(view, event.alias.path_fingerprint, checkout.checkoutId);
      const previous = activeAlias(checkout);
      if (!previous || previous.pathFingerprint !== event.previous_path_fingerprint) {
        fail("project_registry_invalid", "Previous checkout alias does not match.");
      }
      previous.status = "historical";
      previous.lastSeenAt = event.occurred_at;
      checkout.aliases.push({
        pathFingerprint: event.alias.path_fingerprint,
        device: event.alias.device,
        inode: event.alias.inode,
        status: "active",
        firstSeenAt: event.occurred_at,
        lastSeenAt: event.occurred_at,
        transition: event.event_type === "checkout.rebound" ? "owner_rebound" : "moved"
      });
      continue;
    }

    fail("project_registry_invalid", `Unknown event type: ${event.event_type}`);
  }
  return view;
}

function publicView(view) {
  return {
    projects: [...view.projects.values()].map((project) => ({ ...project })),
    checkouts: [...view.checkouts.values()].map((checkout) => ({
      ...checkout,
      aliases: checkout.aliases.map((alias) => ({ ...alias }))
    })),
    legacyMappings: [...view.legacyMappings.values()].map((mapping) => ({ ...mapping }))
  };
}

function createEventFactory(clock, randomBytes) {
  return (eventType, payload) => {
    const occurredAt = clock();
    const now = Date.parse(occurredAt);
    if (!Number.isFinite(now)) fail("clock_invalid", "Clock must return an RFC3339 timestamp.");
    return {
      schema: REGISTRY_SCHEMA,
      event_id: `preg_${generateUuidV7({ now, randomBytes })}`,
      event_type: eventType,
      occurred_at: occurredAt,
      ...payload
    };
  };
}

function detectLegacyState(legacyStatePath) {
  const state = readJsonFile(legacyStatePath, "legacy_state_invalid");
  if (!state) return null;
  if (state.version !== 1 || typeof state.workspace?.workspaceId !== "string") {
    fail("legacy_state_invalid", "Unsupported product state exists at the legacy path.");
  }
  return {
    version: 1,
    workspaceId: state.workspace.workspaceId,
    status: "legacy_unbound"
  };
}

function markerValueProject(projectId, workspaceId, createdAt) {
  return {
    schema: PROJECT_MARKER_SCHEMA,
    project_id: projectId,
    workspace_id: workspaceId,
    created_at: createdAt
  };
}

function markerValueCheckout(projectId, workspaceId, checkoutId, createdAt) {
  return {
    schema: CHECKOUT_MARKER_SCHEMA,
    project_id: projectId,
    workspace_id: workspaceId,
    checkout_id: checkoutId,
    created_at: createdAt
  };
}

function prepareMarker(layout, target, value) {
  ensureMarkerDirectory(layout, target);
  if (fs.existsSync(target)) fail("marker_already_exists", `Marker already exists: ${target}`);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  writeAndSync(temp, `${JSON.stringify(value, null, 2)}\n`, 0o600, true);
  return { target, temp };
}

function installRegistryAndMarkers({
  vaultRoot,
  registryPath,
  markerPlans,
  buildEvents
}) {
  const prepared = markerPlans.map((plan) => prepareMarker(plan.layout, plan.target, plan.value));
  const renamedTargets = [];
  try {
    return withVaultMutationLock(vaultRoot, () => {
      const registryExisted = fs.existsSync(registryPath);
      const previousContent = registryExisted ? fs.readFileSync(registryPath, "utf8") : "";
      const currentEvents = readEvents(registryPath);
      const currentView = reduceEvents(currentEvents);
      for (const marker of prepared) {
        if (fs.existsSync(marker.target)) fail("marker_already_exists", `Marker already exists: ${marker.target}`);
      }
      const additions = buildEvents(currentView);
      const nextEvents = [...currentEvents, ...additions];
      const nextView = reduceEvents(nextEvents);
      try {
        atomicWrite(registryPath, nextEvents.map(eventContent).join(""));
        for (const marker of prepared) {
          fs.renameSync(marker.temp, marker.target);
          fs.chmodSync(marker.target, 0o600);
          syncDirectory(path.dirname(marker.target));
          renamedTargets.push(marker.target);
        }
      } catch (error) {
        if (registryExisted) atomicWrite(registryPath, previousContent);
        else if (fs.existsSync(registryPath)) fs.rmSync(registryPath, { force: true });
        for (const target of renamedTargets) fs.rmSync(target, { force: true });
        throw error;
      }
      return nextView;
    });
  } finally {
    for (const marker of prepared) {
      if (fs.existsSync(marker.temp)) fs.rmSync(marker.temp, { force: true });
    }
  }
}

function mutateRegistry({ vaultRoot, registryPath, buildEvents }) {
  return withVaultMutationLock(vaultRoot, () => {
    const currentEvents = readEvents(registryPath);
    const currentView = reduceEvents(currentEvents);
    const additions = buildEvents(currentView);
    if (additions.length === 0) return currentView;
    const nextEvents = [...currentEvents, ...additions];
    const nextView = reduceEvents(nextEvents);
    atomicWrite(registryPath, nextEvents.map(eventContent).join(""));
    return nextView;
  });
}

export function createProjectRegistry({
  vaultRoot,
  clock = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes
} = {}) {
  if (!vaultRoot) fail("vault_root_required", "A vault root is required.");
  const vaultReal = ensureRootDirectory(vaultRoot);
  const paths = registryPaths(vaultReal);
  const event = createEventFactory(clock, randomBytes);

  const snapshot = () => publicView(reduceEvents(readEvents(paths.registry)));

  const resolveProject = (projectRoot) => {
    const layout = inspectProjectLayout(projectRoot);
    const markers = readMarkers(layout);
    const view = reduceEvents(readEvents(paths.registry));
    const legacy = detectLegacyState(paths.legacyState);

    if (!markers.project) {
      if (legacy && !view.legacyMappings.has(legacy.workspaceId)) {
        return { status: "legacy_unbound", projectRoot: layout.root, legacy };
      }
      return { status: "unbound", projectRoot: layout.root };
    }

    const project = view.projects.get(markers.project.project_id);
    if (!project || project.workspaceId !== markers.project.workspace_id) {
      return {
        status: "orphan_marker",
        projectRoot: layout.root,
        projectId: markers.project.project_id,
        workspaceId: markers.project.workspace_id
      };
    }
    if (!markers.checkout) {
      return {
        status: "unbound_checkout",
        projectRoot: layout.root,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        kind: layout.kind
      };
    }

    const checkout = view.checkouts.get(markers.checkout.checkout_id);
    if (
      !checkout ||
      checkout.projectId !== project.projectId ||
      checkout.workspaceId !== project.workspaceId
    ) {
      return {
        status: "orphan_checkout_marker",
        projectRoot: layout.root,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        checkoutId: markers.checkout.checkout_id
      };
    }

    const identity = rootIdentity(layout.root);
    const collision = [...view.checkouts.values()].find((candidate) => (
      candidate.checkoutId !== checkout.checkoutId &&
      activeAlias(candidate)?.pathFingerprint === identity.pathFingerprint
    ));
    if (collision) {
      return {
        status: "alias_conflict",
        projectRoot: layout.root,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        checkoutId: checkout.checkoutId,
        conflictingCheckoutId: collision.checkoutId
      };
    }

    const alias = activeAlias(checkout);
    if (alias?.pathFingerprint === identity.pathFingerprint) {
      return {
        status: "bound",
        projectRoot: layout.root,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        checkoutId: checkout.checkoutId,
        kind: checkout.kind,
        captureScope: "project"
      };
    }
    if (alias && alias.device === identity.device && alias.inode === identity.inode) {
      return {
        status: "moved",
        projectRoot: layout.root,
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        checkoutId: checkout.checkoutId,
        kind: checkout.kind,
        previousPathFingerprint: alias.pathFingerprint,
        nextPathFingerprint: identity.pathFingerprint
      };
    }
    return {
      status: "binding_conflict",
      projectRoot: layout.root,
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      checkoutId: checkout.checkoutId,
      reason: "checkout_identity_changed"
    };
  };

  const initProject = ({
    projectRoot,
    displayName,
    linkProjectId = null,
    adoptLegacyWorkspace = false,
    rebindCheckout = false
  } = {}) => {
    if (!projectRoot) fail("project_root_required", "A project root is required.");
    registryPaths(vaultReal, { create: true });
    const layout = inspectProjectLayout(projectRoot);
    const markers = readMarkers(layout);
    const identity = rootIdentity(layout.root);
    const legacy = detectLegacyState(paths.legacyState);
    const initialView = reduceEvents(readEvents(paths.registry));
    const legacyMapped = !legacy || initialView.legacyMappings.has(legacy.workspaceId);
    if (legacy && !legacyMapped && !adoptLegacyWorkspace) {
      fail(
        "legacy_workspace_mapping_required",
        "The legacy product workspace must be explicitly mapped before project initialization.",
        { legacy_workspace_id: legacy.workspaceId }
      );
    }

    if (markers.project && linkProjectId && markers.project.project_id !== linkProjectId) {
      fail("project_link_conflict", "Existing project marker conflicts with the requested link.");
    }

    if (!markers.project) {
      const now = Date.parse(clock());
      if (!Number.isFinite(now)) fail("clock_invalid", "Clock must return an RFC3339 timestamp.");
      const existingProject = linkProjectId ? initialView.projects.get(linkProjectId) : null;
      if (linkProjectId && !existingProject) fail("linked_project_not_found", "Linked project does not exist.");
      const projectId = existingProject?.projectId ?? makeId("prj", now, randomBytes);
      const workspaceId = existingProject?.workspaceId ?? makeId("ws", now, randomBytes);
      const checkoutId = makeId("co", now, randomBytes);
      const createdAt = clock();
      const projectMarker = markerValueProject(projectId, workspaceId, createdAt);
      const checkoutMarker = markerValueCheckout(projectId, workspaceId, checkoutId, createdAt);
      const nextView = installRegistryAndMarkers({
        vaultRoot: vaultReal,
        registryPath: paths.registry,
        markerPlans: [
          { layout, target: layout.projectMarkerPath, value: projectMarker },
          { layout, target: layout.checkoutMarkerPath, value: checkoutMarker }
        ],
        buildEvents(view) {
          const additions = [];
          let project = view.projects.get(projectId);
          if (!project) {
            additions.push(event("project.created", {
              project_id: projectId,
              workspace_id: workspaceId,
              display_name: cleanDisplayName(displayName ?? path.basename(layout.root))
            }));
            project = { projectId, workspaceId };
          } else if (project.workspaceId !== workspaceId) {
            fail("project_link_conflict", "Linked project workspace changed.");
          }
          if (legacy && !view.legacyMappings.has(legacy.workspaceId)) {
            additions.push(event("legacy.workspace_mapped", {
              legacy_workspace_id: legacy.workspaceId,
              project_id: projectId,
              workspace_id: workspaceId,
              migration_status: "mapping_only"
            }));
          }
          additions.push(event("checkout.bound", {
            checkout_id: checkoutId,
            project_id: projectId,
            workspace_id: workspaceId,
            checkout_kind: linkProjectId ? "multi_root" : layout.kind,
            git_common_dir_fingerprint: gitCommonFingerprint(layout),
            alias: {
              path_fingerprint: identity.pathFingerprint,
              device: identity.device,
              inode: identity.inode
            }
          }));
          return additions;
        }
      });
      return {
        status: existingProject ? "linked" : "created",
        projectId,
        workspaceId,
        checkoutId,
        projectRoot: layout.root,
        legacy: legacy ? {
          legacyWorkspaceId: legacy.workspaceId,
          migrationStatus: "mapping_only"
        } : null,
        registry: publicView(nextView)
      };
    }

    const project = initialView.projects.get(markers.project.project_id);
    if (!project || project.workspaceId !== markers.project.workspace_id) {
      fail("orphan_marker", "Project marker is not present in the canonical registry.");
    }

    if (!markers.checkout) {
      const now = Date.parse(clock());
      if (!Number.isFinite(now)) fail("clock_invalid", "Clock must return an RFC3339 timestamp.");
      const checkoutId = makeId("co", now, randomBytes);
      const createdAt = clock();
      const nextView = installRegistryAndMarkers({
        vaultRoot: vaultReal,
        registryPath: paths.registry,
        markerPlans: [{
          layout,
          target: layout.checkoutMarkerPath,
          value: markerValueCheckout(project.projectId, project.workspaceId, checkoutId, createdAt)
        }],
        buildEvents(view) {
          const currentProject = view.projects.get(project.projectId);
          if (!currentProject || currentProject.workspaceId !== project.workspaceId) {
            fail("project_link_conflict", "Project disappeared during checkout binding.");
          }
          const additions = [];
          if (legacy && !view.legacyMappings.has(legacy.workspaceId)) {
            additions.push(event("legacy.workspace_mapped", {
              legacy_workspace_id: legacy.workspaceId,
              project_id: project.projectId,
              workspace_id: project.workspaceId,
              migration_status: "mapping_only"
            }));
          }
          additions.push(event("checkout.bound", {
            checkout_id: checkoutId,
            project_id: project.projectId,
            workspace_id: project.workspaceId,
            checkout_kind: layout.kind,
            git_common_dir_fingerprint: gitCommonFingerprint(layout),
            alias: {
              path_fingerprint: identity.pathFingerprint,
              device: identity.device,
              inode: identity.inode
            }
          }));
          return additions;
        }
      });
      return {
        status: "checkout_bound",
        projectId: project.projectId,
        workspaceId: project.workspaceId,
        checkoutId,
        projectRoot: layout.root,
        registry: publicView(nextView)
      };
    }

    const resolution = resolveProject(layout.root);
    if (resolution.status === "bound") {
      if (legacy && !initialView.legacyMappings.has(legacy.workspaceId)) {
        mutateRegistry({
          vaultRoot: vaultReal,
          registryPath: paths.registry,
          buildEvents(view) {
            if (view.legacyMappings.has(legacy.workspaceId)) return [];
            return [event("legacy.workspace_mapped", {
              legacy_workspace_id: legacy.workspaceId,
              project_id: project.projectId,
              workspace_id: project.workspaceId,
              migration_status: "mapping_only"
            })];
          }
        });
      }
      return { ...resolution, status: "already_bound" };
    }

    if (resolution.status === "moved") {
      const nextView = mutateRegistry({
        vaultRoot: vaultReal,
        registryPath: paths.registry,
        buildEvents(view) {
          const checkout = view.checkouts.get(resolution.checkoutId);
          const previous = activeAlias(checkout);
          if (previous?.pathFingerprint === identity.pathFingerprint) return [];
          if (
            !previous ||
            previous.pathFingerprint !== resolution.previousPathFingerprint ||
            previous.device !== identity.device ||
            previous.inode !== identity.inode
          ) {
            fail("binding_conflict", "Checkout changed while recording its move.");
          }
          return [event("checkout.alias_moved", {
            checkout_id: checkout.checkoutId,
            project_id: checkout.projectId,
            workspace_id: checkout.workspaceId,
            previous_path_fingerprint: previous.pathFingerprint,
            alias: {
              path_fingerprint: identity.pathFingerprint,
              device: identity.device,
              inode: identity.inode
            }
          })];
        }
      });
      return {
        status: "moved",
        projectId: resolution.projectId,
        workspaceId: resolution.workspaceId,
        checkoutId: resolution.checkoutId,
        projectRoot: layout.root,
        registry: publicView(nextView)
      };
    }

    if (resolution.status === "binding_conflict" && rebindCheckout) {
      const nextView = mutateRegistry({
        vaultRoot: vaultReal,
        registryPath: paths.registry,
        buildEvents(view) {
          const checkout = view.checkouts.get(resolution.checkoutId);
          const previous = activeAlias(checkout);
          if (!previous) fail("binding_conflict", "Checkout has no active alias.");
          return [event("checkout.rebound", {
            checkout_id: checkout.checkoutId,
            project_id: checkout.projectId,
            workspace_id: checkout.workspaceId,
            previous_path_fingerprint: previous.pathFingerprint,
            owner_confirmed: true,
            alias: {
              path_fingerprint: identity.pathFingerprint,
              device: identity.device,
              inode: identity.inode
            }
          })];
        }
      });
      return {
        status: "rebound",
        projectId: resolution.projectId,
        workspaceId: resolution.workspaceId,
        checkoutId: resolution.checkoutId,
        projectRoot: layout.root,
        registry: publicView(nextView)
      };
    }

    fail(
      resolution.status,
      "Project binding is not safe to initialize automatically.",
      resolution
    );
  };

  return {
    vaultRoot: vaultReal,
    registryPath: paths.registry,
    initProject,
    resolveProject,
    status: resolveProject,
    snapshot,
    detectLegacyState: () => detectLegacyState(paths.legacyState)
  };
}
