import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_VERSION = 1;

export class ProductBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductBackupError";
    this.code = code;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeBackupId(value) {
  if (typeof value !== "string" || !/^backup-[A-Za-z0-9._-]{8,160}$/.test(value)) {
    throw new ProductBackupError("backup_id_invalid", "L’identifiant de sauvegarde est invalide.");
  }
  return value;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest("hex")}`;
}

function walkFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        throw new ProductBackupError("backup_symlink_forbidden", "Une sauvegarde ne peut pas contenir de lien symbolique.");
      }
      if (stat.isDirectory()) visit(fullPath);
      else if (stat.isFile()) files.push(fullPath);
      else throw new ProductBackupError("backup_entry_unsupported", "La sauvegarde contient une entrée non prise en charge.");
    }
  };
  visit(root);
  return files.sort();
}

function fileRows(root) {
  return walkFiles(root).map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: path.relative(root, filePath).split(path.sep).join("/"),
      size: stat.size,
      mode: stat.mode & 0o777,
      sha256: sha256(filePath)
    };
  });
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readManifest(backupPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, "manifest.json"), "utf8"));
    if (
      manifest.version !== MANIFEST_VERSION ||
      !Array.isArray(manifest.files) ||
      typeof manifest.backupId !== "string"
    ) {
      throw new Error("invalid");
    }
    return manifest;
  } catch {
    throw new ProductBackupError("backup_manifest_invalid", "Le manifeste de sauvegarde est invalide.");
  }
}

function markProjectionForRebuild(vaultPath) {
  const statePath = path.join(vaultPath, "00_inbox", "supermemory-product", "state.json");
  if (!fs.existsSync(statePath)) return 0;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    throw new ProductBackupError("backup_state_invalid", "L’état produit de la sauvegarde est invalide.");
  }
  let queued = 0;
  for (const memory of state.memories ?? []) {
    if (memory.status !== "active") continue;
    memory.projection ??= { documentId: memory.memoryId };
    memory.projection.status = "queued";
    memory.projection.syncedAt = null;
    memory.projection.errorCode = "restore_requires_rebuild";
    if (memory.memoryPath) {
      const memoryPath = path.resolve(vaultPath, memory.memoryPath);
      if (!isInside(vaultPath, memoryPath) || !fs.existsSync(memoryPath)) {
        throw new ProductBackupError("backup_state_invalid", "Un fichier mémoire restauré est introuvable.");
      }
      const stat = fs.lstatSync(memoryPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new ProductBackupError("backup_state_invalid", "Un fichier mémoire restauré est dangereux.");
      }
      const markdown = fs.readFileSync(memoryPath, "utf8").replace(
        /^hindsight_projection_status:.*$/m,
        'hindsight_projection_status: "queued"'
      );
      fs.writeFileSync(memoryPath, markdown, { mode: 0o600 });
      fs.chmodSync(memoryPath, 0o600);
    }
    queued += 1;
  }
  atomicJson(statePath, state);
  return queued;
}

export function createProductBackupManager({
  vaultRoot,
  backupsRoot,
  clock = () => new Date().toISOString()
}) {
  const vaultPath = path.resolve(vaultRoot);
  const backupsPath = path.resolve(backupsRoot);
  if (isInside(vaultPath, backupsPath)) {
    throw new ProductBackupError(
      "backup_inside_vault",
      "Le dossier de sauvegarde doit se trouver hors du vault canonique."
    );
  }
  fs.mkdirSync(vaultPath, { recursive: true, mode: 0o700 });
  fs.mkdirSync(backupsPath, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(vaultPath).isSymbolicLink() || fs.lstatSync(backupsPath).isSymbolicLink()) {
    throw new ProductBackupError("backup_root_unsafe", "Les chemins de sauvegarde ne peuvent pas être symboliques.");
  }

  const verify = (backupId) => {
    safeBackupId(backupId);
    const backupPath = path.join(backupsPath, backupId);
    if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isDirectory()) {
      throw new ProductBackupError("backup_not_found", "Cette sauvegarde locale n’existe pas.");
    }
    const manifest = readManifest(backupPath);
    if (manifest.backupId !== backupId) {
      throw new ProductBackupError("backup_manifest_mismatch", "Le manifeste ne correspond pas à la sauvegarde.");
    }
    const dataPath = path.join(backupPath, "vault");
    const actual = fileRows(dataPath);
    if (actual.length !== manifest.files.length) {
      throw new ProductBackupError("backup_integrity_failed", "Le nombre de fichiers de la sauvegarde a changé.");
    }
    for (let index = 0; index < actual.length; index += 1) {
      const expected = manifest.files[index];
      const current = actual[index];
      if (
        expected.path !== current.path ||
        expected.size !== current.size ||
        expected.sha256 !== current.sha256
      ) {
        throw new ProductBackupError("backup_integrity_failed", `Le fichier ${expected.path} a été altéré.`);
      }
    }
    return { backupPath, dataPath, manifest };
  };

  const create = ({ reason = "manual" } = {}) => {
    const createdAt = clock();
    const stamp = createdAt.replace(/[^0-9A-Za-z]/g, "-");
    const backupId = safeBackupId(`backup-${stamp}-${crypto.randomUUID().slice(0, 8)}`);
    const temporary = path.join(backupsPath, `.creating-${crypto.randomUUID()}`);
    const finalPath = path.join(backupsPath, backupId);
    fs.mkdirSync(temporary, { mode: 0o700 });
    try {
      const dataPath = path.join(temporary, "vault");
      fs.cpSync(vaultPath, dataPath, {
        recursive: true,
        errorOnExist: true,
        dereference: false,
        preserveTimestamps: true
      });
      const manifest = {
        version: MANIFEST_VERSION,
        backupId,
        createdAt,
        reason: String(reason).slice(0, 80),
        source: "supermemory-local-vault",
        files: fileRows(dataPath)
      };
      atomicJson(path.join(temporary, "manifest.json"), manifest);
      fs.renameSync(temporary, finalPath);
      return {
        backupId,
        createdAt,
        reason: manifest.reason,
        files: manifest.files.length,
        bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
        path: finalPath,
        verified: true
      };
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  };

  return {
    vaultRoot: vaultPath,
    backupsRoot: backupsPath,

    create,

    list() {
      const rows = [];
      for (const entry of fs.readdirSync(backupsPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
        try {
          const { manifest } = verify(entry.name);
          rows.push({
            backupId: manifest.backupId,
            createdAt: manifest.createdAt,
            reason: manifest.reason,
            files: manifest.files.length,
            bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
            verified: true
          });
        } catch (error) {
          rows.push({
            backupId: entry.name,
            createdAt: null,
            reason: null,
            files: null,
            bytes: null,
            verified: false,
            errorCode: error.code || "backup_invalid"
          });
        }
      }
      return rows.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    },

    verify(backupId) {
      const { manifest } = verify(backupId);
      return {
        backupId,
        verified: true,
        files: manifest.files.length,
        bytes: manifest.files.reduce((sum, file) => sum + file.size, 0)
      };
    },

    restore(backupId, confirmation) {
      safeBackupId(backupId);
      if (confirmation !== `RESTORE ${backupId}`) {
        throw new ProductBackupError(
          "restore_confirmation_invalid",
          `La confirmation doit être exactement RESTORE ${backupId}.`
        );
      }
      const selected = verify(backupId);
      const safety = create({ reason: `pre-restore:${backupId}` });
      const parent = path.dirname(vaultPath);
      const staging = path.join(parent, `.${path.basename(vaultPath)}.restore-${crypto.randomUUID()}`);
      const rollback = path.join(parent, `.${path.basename(vaultPath)}.rollback-${crypto.randomUUID()}`);
      try {
        fs.cpSync(selected.dataPath, staging, {
          recursive: true,
          errorOnExist: true,
          dereference: false,
          preserveTimestamps: true
        });
        const queuedProjections = markProjectionForRebuild(staging);
        fs.renameSync(vaultPath, rollback);
        try {
          fs.renameSync(staging, vaultPath);
        } catch (error) {
          fs.renameSync(rollback, vaultPath);
          throw error;
        }
        fs.rmSync(rollback, { recursive: true, force: true });
        return {
          status: "restored",
          backupId,
          safetyBackupId: safety.backupId,
          queuedProjections,
          restoredAt: clock()
        };
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        if (fs.existsSync(rollback) && !fs.existsSync(vaultPath)) fs.renameSync(rollback, vaultPath);
        throw error;
      }
    }
  };
}
