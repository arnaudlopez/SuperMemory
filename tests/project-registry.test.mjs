import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createProjectRegistry,
  generateUuidV7,
  ProjectRegistryError
} from "../scripts/lib/project-registry.mjs";

const projectCli = path.resolve("scripts/supermemory-project.mjs");

function fixture(t, prefix = "supermemory-project-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  return { root, vault };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env }
  });
  if (options.expectFailure !== true && result.status !== 0) {
    assert.fail([
      `${command} ${args.join(" ")} failed with ${result.status}`,
      result.stdout,
      result.stderr
    ].join("\n"));
  }
  return result;
}

function git(projectRoot, ...args) {
  return run("git", ["-C", projectRoot, ...args]);
}

function createGitProject(directory) {
  fs.mkdirSync(directory, { recursive: true });
  git(directory, "init", "-q");
  git(directory, "config", "user.email", "supermemory-tests@example.invalid");
  git(directory, "config", "user.name", "SuperMemory Tests");
  fs.writeFileSync(path.join(directory, "README.md"), "# Fixture\n");
  git(directory, "add", "README.md");
  git(directory, "commit", "-q", "-m", "fixture");
}

function readRegistry(vault) {
  const registry = path.join(vault, "00_inbox", "supermemory-product", "projects.jsonl");
  return fs.readFileSync(registry, "utf8");
}

test("UUIDv7 identifiers carry the timestamp, version and RFC variant", () => {
  const uuid = generateUuidV7({
    now: 1_718_000_000_123,
    randomBytes: () => Buffer.alloc(16, 0xaa)
  });
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(Number.parseInt(uuid.replaceAll("-", "").slice(0, 12), 16), 1_718_000_000_123);
});

test("status is read-only for an unbound project", (t) => {
  const { root, vault } = fixture(t);
  const project = path.join(root, "unbound");
  fs.mkdirSync(project);

  const registry = createProjectRegistry({ vaultRoot: vault });
  assert.deepEqual(registry.status(project), {
    status: "unbound",
    projectRoot: fs.realpathSync(project)
  });
  assert.equal(fs.existsSync(path.join(vault, "00_inbox")), false);
  assert.equal(fs.existsSync(path.join(project, ".supermemory")), false);
});

test("Git init is idempotent and keeps stable project, workspace and checkout IDs", (t) => {
  const { root, vault } = fixture(t);
  const project = path.join(root, "git-project");
  createGitProject(project);

  const registry = createProjectRegistry({ vaultRoot: vault });
  const created = registry.initProject({ projectRoot: project, displayName: "Stable project" });
  assert.equal(created.status, "created");
  assert.match(created.projectId, /^prj_.+-7[0-9a-f]{3}-[89ab]/);
  assert.match(created.workspaceId, /^ws_.+-7[0-9a-f]{3}-[89ab]/);
  assert.match(created.checkoutId, /^co_.+-7[0-9a-f]{3}-[89ab]/);

  const status = registry.status(project);
  assert.equal(status.status, "bound");
  assert.equal(status.projectId, created.projectId);
  assert.equal(status.workspaceId, created.workspaceId);
  assert.equal(status.checkoutId, created.checkoutId);

  const again = registry.initProject({ projectRoot: project });
  assert.equal(again.status, "already_bound");
  assert.equal(again.projectId, created.projectId);
  assert.equal(again.workspaceId, created.workspaceId);
  assert.equal(again.checkoutId, created.checkoutId);
  assert.equal(readRegistry(vault).trim().split("\n").length, 2);

  assert.equal(fs.existsSync(path.join(project, ".git", "supermemory", "project.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".git", "supermemory", "checkout.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".supermemory")), false);
  assert.equal(readRegistry(vault).includes(fs.realpathSync(project)), false);
});

test("a moved root preserves IDs and records the old alias as historical", (t) => {
  const { root, vault } = fixture(t);
  const original = path.join(root, "original");
  const moved = path.join(root, "renamed");
  fs.mkdirSync(original);

  const registry = createProjectRegistry({ vaultRoot: vault });
  const created = registry.initProject({ projectRoot: original });
  fs.renameSync(original, moved);

  const pending = registry.status(moved);
  assert.equal(pending.status, "moved");
  assert.equal(pending.projectId, created.projectId);
  assert.equal(pending.workspaceId, created.workspaceId);
  assert.equal(pending.checkoutId, created.checkoutId);

  const recorded = registry.initProject({ projectRoot: moved });
  assert.equal(recorded.status, "moved");
  const after = registry.status(moved);
  assert.equal(after.status, "bound");
  assert.equal(after.projectId, created.projectId);
  assert.equal(after.workspaceId, created.workspaceId);
  assert.equal(after.checkoutId, created.checkoutId);

  const checkout = registry.snapshot().checkouts[0];
  assert.deepEqual(checkout.aliases.map((alias) => alias.status), ["historical", "active"]);
  assert.equal(readRegistry(vault).includes(fs.realpathSync(moved)), false);
});

test("a Git worktree shares project/workspace identity but has its own checkout", (t) => {
  const { root, vault } = fixture(t);
  const primary = path.join(root, "primary");
  const worktree = path.join(root, "feature");
  createGitProject(primary);

  const registry = createProjectRegistry({ vaultRoot: vault });
  const first = registry.initProject({ projectRoot: primary });
  git(primary, "worktree", "add", "-q", "-b", "feature-fixture", worktree);
  const second = registry.initProject({ projectRoot: worktree });

  assert.equal(second.status, "checkout_bound");
  assert.equal(second.projectId, first.projectId);
  assert.equal(second.workspaceId, first.workspaceId);
  assert.notEqual(second.checkoutId, first.checkoutId);
  assert.equal(registry.status(worktree).status, "bound");
  assert.equal(registry.snapshot().projects[0].checkoutIds.length, 2);
});

test("copied non-Git markers fail closed until an explicit checkout rebind", (t) => {
  const { root, vault } = fixture(t);
  const source = path.join(root, "source");
  const copy = path.join(root, "copy");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "notes.md"), "fixture\n");

  const registry = createProjectRegistry({ vaultRoot: vault });
  const created = registry.initProject({ projectRoot: source });
  const before = readRegistry(vault);
  fs.cpSync(source, copy, { recursive: true });

  const conflict = registry.status(copy);
  assert.equal(conflict.status, "binding_conflict");
  assert.equal(conflict.projectId, created.projectId);
  assert.throws(
    () => registry.initProject({ projectRoot: copy }),
    (error) => error instanceof ProjectRegistryError && error.code === "binding_conflict"
  );
  assert.equal(readRegistry(vault), before);

  const rebound = registry.initProject({ projectRoot: copy, rebindCheckout: true });
  assert.equal(rebound.status, "rebound");
  assert.equal(registry.status(copy).status, "bound");
  assert.equal(registry.status(source).status, "binding_conflict");
});

test("explicit multi-root linking keeps one project/workspace and distinct checkouts", (t) => {
  const { root, vault } = fixture(t);
  const firstRoot = path.join(root, "root-a");
  const secondRoot = path.join(root, "root-b");
  fs.mkdirSync(firstRoot);
  fs.mkdirSync(secondRoot);

  const registry = createProjectRegistry({ vaultRoot: vault });
  const first = registry.initProject({ projectRoot: firstRoot });
  const linked = registry.initProject({
    projectRoot: secondRoot,
    linkProjectId: first.projectId
  });

  assert.equal(linked.status, "linked");
  assert.equal(linked.projectId, first.projectId);
  assert.equal(linked.workspaceId, first.workspaceId);
  assert.notEqual(linked.checkoutId, first.checkoutId);
  assert.equal(registry.status(firstRoot).status, "bound");
  assert.equal(registry.status(secondRoot).status, "bound");
  assert.equal(registry.snapshot().projects.length, 1);
  assert.equal(registry.snapshot().checkouts.length, 2);
});

test("legacy workspace mapping is explicit and does not rewrite product state", (t) => {
  const { root, vault } = fixture(t);
  const project = path.join(root, "legacy-project");
  const productDirectory = path.join(vault, "00_inbox", "supermemory-product");
  const statePath = path.join(productDirectory, "state.json");
  fs.mkdirSync(project);
  fs.mkdirSync(productDirectory, { recursive: true });
  const legacyState = `${JSON.stringify({
    version: 1,
    workspace: { workspaceId: "workspace:local", displayName: "Legacy" },
    untouched: { proof: true }
  }, null, 2)}\n`;
  fs.writeFileSync(statePath, legacyState);

  const registry = createProjectRegistry({ vaultRoot: vault });
  assert.equal(registry.status(project).status, "legacy_unbound");
  assert.throws(
    () => registry.initProject({ projectRoot: project }),
    (error) => (
      error instanceof ProjectRegistryError &&
      error.code === "legacy_workspace_mapping_required"
    )
  );
  assert.equal(fs.existsSync(path.join(project, ".supermemory")), false);
  assert.equal(fs.existsSync(registry.registryPath), false);

  const adopted = registry.initProject({
    projectRoot: project,
    adoptLegacyWorkspace: true
  });
  assert.equal(adopted.status, "created");
  assert.equal(adopted.legacy.legacyWorkspaceId, "workspace:local");
  assert.equal(adopted.legacy.migrationStatus, "mapping_only");
  assert.equal(fs.readFileSync(statePath, "utf8"), legacyState);
  assert.deepEqual(registry.snapshot().legacyMappings.map((mapping) => mapping.legacyWorkspaceId), [
    "workspace:local"
  ]);
});

test("CLI init and status expose the same stable identity as JSON", (t) => {
  const { root, vault } = fixture(t);
  const project = path.join(root, "cli-project");
  fs.mkdirSync(project);

  const initialized = run(process.execPath, [
    projectCli,
    "init",
    "--vault-root",
    vault,
    "--project-root",
    project,
    "--name",
    "CLI project",
    "--json"
  ]);
  const created = JSON.parse(initialized.stdout);
  assert.equal(created.ok, true);
  assert.equal(created.status, "created");

  const inspected = run(process.execPath, [
    projectCli,
    "status",
    "--vault-root",
    vault,
    "--project-root",
    project,
    "--json"
  ]);
  const status = JSON.parse(inspected.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.status, "bound");
  assert.equal(status.projectId, created.projectId);
  assert.equal(status.workspaceId, created.workspaceId);
  assert.equal(status.checkoutId, created.checkoutId);
});
