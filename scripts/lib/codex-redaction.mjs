import crypto from "node:crypto";

const SECRET_FIELD = /^(?:authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)$/i;
const ABSOLUTE_PATH = /(?:\/(?:Users|home|private|var|tmp|opt|srv|Volumes)\/[^\s"'`<>]+|[A-Za-z]:\\(?:[^\\\s"'`<>]+\\?)+)/g;
const SECRET_PATTERNS = [
  {
    type: "openai_key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED:OPENAI_KEY]"
  },
  {
    type: "github_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED:GITHUB_TOKEN]"
  },
  {
    type: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED:AWS_ACCESS_KEY]"
  },
  {
    type: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    replacement: "Bearer [REDACTED:TOKEN]"
  },
  {
    type: "credential_assignment",
    pattern: /\b(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*([^\s,;]{6,})/gi,
    replacement: "[REDACTED:CREDENTIAL]"
  },
  {
    type: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]"
  }
];

function assertEncryptionKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("capture_encryption_key_invalid");
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function hmacFingerprint(value, key, namespace = "value") {
  assertEncryptionKey(key);
  return `hmac-sha256:${crypto
    .createHmac("sha256", key)
    .update(`${namespace}\0${String(value)}`)
    .digest("hex")}`;
}

function boundedString(value, maxStringBytes, findings) {
  const bytes = Buffer.from(value);
  if (bytes.length <= maxStringBytes) return value;
  findings.truncated_strings += 1;
  return `${bytes.subarray(0, maxStringBytes).toString("utf8")}[TRUNCATED]`;
}

function redactString(value, encryptionKey, findings, maxStringBytes) {
  let redacted = value;
  for (const secret of SECRET_PATTERNS) {
    redacted = redacted.replace(secret.pattern, () => {
      findings.secret_matches[secret.type] = (findings.secret_matches[secret.type] ?? 0) + 1;
      return secret.replacement;
    });
  }
  redacted = redacted.replace(ABSOLUTE_PATH, (match) => {
    findings.path_matches += 1;
    return `[PATH:${hmacFingerprint(match, encryptionKey, "absolute-path")}]`;
  });
  // Bound the persisted representation, not the source representation. Path
  // fingerprints can be longer than the paths they replace; bounding first can
  // therefore produce output that exceeds the limit and changes on a second
  // redaction pass. Keeping the final representation bounded makes prepared
  // captures idempotent while preserving the fail-closed commit check.
  return boundedString(redacted, maxStringBytes, findings);
}

export function redactCodexPayload(value, {
  encryptionKey,
  maxDepth = 20,
  maxNodes = 20_000,
  maxStringBytes = 64 * 1024
} = {}) {
  assertEncryptionKey(encryptionKey);
  const findings = {
    secret_fields: 0,
    secret_matches: {},
    path_matches: 0,
    truncated_strings: 0
  };
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (entry, depth, key = "") => {
    nodes += 1;
    if (nodes > maxNodes) throw new Error("capture_payload_too_complex");
    if (depth > maxDepth) throw new Error("capture_payload_too_deep");
    if (SECRET_FIELD.test(key)) {
      findings.secret_fields += 1;
      return "[REDACTED:SECRET_FIELD]";
    }
    if (typeof entry === "string") {
      return redactString(entry, encryptionKey, findings, maxStringBytes);
    }
    if (
      entry === null ||
      typeof entry === "boolean" ||
      typeof entry === "number"
    ) {
      if (typeof entry === "number" && !Number.isFinite(entry)) {
        throw new Error("capture_payload_number_invalid");
      }
      return entry;
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) throw new Error("capture_payload_cycle");
      seen.add(entry);
      const result = entry.map((item) => visit(item, depth + 1));
      seen.delete(entry);
      return result;
    }
    if (typeof entry === "object") {
      if (seen.has(entry)) throw new Error("capture_payload_cycle");
      seen.add(entry);
      const result = {};
      for (const [childKey, childValue] of Object.entries(entry)) {
        result[childKey] = visit(childValue, depth + 1, childKey);
      }
      seen.delete(entry);
      return result;
    }
    throw new Error("capture_payload_type_unsupported");
  };

  return {
    payload: visit(value ?? {}, 0),
    findings,
    profile: "redaction.v1"
  };
}

export function sealBytesAead(bytes, {
  encryptionKey,
  aad = "supermemory.capture.v1",
  randomBytes = crypto.randomBytes
} = {}) {
  assertEncryptionKey(encryptionKey);
  const iv = Buffer.from(randomBytes(12));
  if (iv.length !== 12) throw new Error("capture_iv_invalid");
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()]);
  return {
    schema: "supermemory.aead.v1",
    algorithm: "aes-256-gcm",
    aad,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function openBytesAead(sealed, {
  encryptionKey,
  expectedAad = "supermemory.capture.v1"
} = {}) {
  assertEncryptionKey(encryptionKey);
  if (
    sealed?.schema !== "supermemory.aead.v1" ||
    sealed.algorithm !== "aes-256-gcm" ||
    sealed.aad !== expectedAad
  ) {
    throw new Error("capture_ciphertext_invalid");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(sealed.iv, "base64")
    );
    decipher.setAAD(Buffer.from(expectedAad));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final()
    ]);
  } catch {
    throw new Error("capture_ciphertext_auth_failed");
  }
}

export function sealJsonAead(value, options = {}) {
  return sealBytesAead(Buffer.from(canonicalJson(value)), options);
}

export function openJsonAead(value, options = {}) {
  const bytes = openBytesAead(value, options);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("capture_ciphertext_json_invalid");
  }
}
