import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";
import { buildCodexWorkingMap, workingMapInputHash } from "./codex-working-map.mjs";

const WORKING_ID = /^wset_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_ID = /^wev_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function tokens(value) {
  return [...new Set(String(value ?? "").toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(code);
  return number;
}

function excerpt(value, maximum = 320) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

function encodeCursor(value) {
  return Buffer.from(canonicalJson(value)).toString("base64url");
}

function decodeCursor(value) {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (decoded?.schema !== "supermemory.working-open-cursor.v1") fail("working_cursor_invalid");
    return decoded;
  } catch (error) {
    if (error?.code === "working_cursor_invalid") throw error;
    fail("working_cursor_invalid");
  }
}

export function createCodexWorkingRecall({
  workingStore,
  captureStore,
  workspaceId,
  projectId,
  maxSearchLimit = 20,
  maxOpenTokens = 20_000,
  defaultOpenTokens = 8_000,
  mapMaxTokens = 8_000,
  mapTargetTokens = 4_000,
  clock = () => new Date().toISOString()
} = {}) {
  if (
    !workingStore || typeof workingStore.resolveWorkingSet !== "function" ||
    typeof workingStore.openEvidence !== "function" ||
    !captureStore || typeof captureStore.readEvents !== "function" ||
    typeof workspaceId !== "string" || typeof projectId !== "string"
  ) fail("working_recall_configuration_invalid");
  boundedInteger(maxSearchLimit, 20, 1, 20, "working_limit_invalid");
  boundedInteger(maxOpenTokens, 20_000, 1, 20_000, "working_limit_invalid");
  boundedInteger(defaultOpenTokens, 8_000, 1, maxOpenTokens, "working_limit_invalid");
  boundedInteger(mapMaxTokens, 8_000, 128, 8_000, "working_limit_invalid");
  boundedInteger(mapTargetTokens, 4_000, 128, mapMaxTokens, "working_limit_invalid");

  const boundState = (input = {}) => {
    for (const key of ["workspace_id", "workspaceId", "project_id", "projectId", "cwd", "session_id", "sessionId"]) {
      if (Object.hasOwn(input, key)) fail("scope_argument_forbidden");
    }
    const workingSetId = input.working_set_id ?? input.workingSetId;
    if (typeof workingSetId !== "string" || !WORKING_ID.test(workingSetId)) {
      fail("not_found_or_not_authorized");
    }
    try {
      const state = workingStore.resolveWorkingSet({ workspaceId, projectId, workingSetId });
      if (state.manifest.workspace_id !== workspaceId || state.manifest.project_id !== projectId) {
        fail("not_found_or_not_authorized");
      }
      return state;
    } catch {
      fail("not_found_or_not_authorized");
    }
  };

  const activeEntry = (state, evidenceId) => {
    if (typeof evidenceId !== "string" || !EVIDENCE_ID.test(evidenceId)) fail("not_found_or_not_authorized");
    const entry = state.entries.find((candidate) => candidate.evidence_id === evidenceId);
    const now = Date.parse(clock());
    if (
      !entry || !["selected", "active"].includes(entry.status) || entry.complete === false ||
      (entry.expires_at && Date.parse(entry.expires_at) <= now)
    ) fail("not_found_or_not_authorized");
    return entry;
  };

  const reopen = (state, entry) => {
    try {
      return workingStore.openEvidence({
        workspaceId,
        projectId,
        sessionId: state.manifest.session_id,
        workingSetId: state.manifest.working_set_id,
        evidenceId: entry.evidence_id,
        captureStore
      });
    } catch {
      fail("not_found_or_not_authorized");
    }
  };

  const citation = (state, entry) => ({
    kind: "working_evidence",
    working_set_id: state.manifest.working_set_id,
    evidence_id: entry.evidence_id,
    episode_id: entry.episode_id,
    event_id: entry.event_id,
    content_hash: entry.content_hash
  });

  const search = (input = {}) => {
    const state = boundState(input);
    const query = String(input.query ?? "").trim();
    if (!query || query.length > 4_000) fail("working_query_invalid");
    const limit = boundedInteger(input.limit, 8, 1, maxSearchLimit, "working_limit_invalid");
    const queryTokens = tokens(query);
    const ranked = [];
    const now = Date.parse(clock());
    for (const entry of state.entries) {
      if (
        !["selected", "active"].includes(entry.status) || entry.complete === false ||
        (entry.expires_at && Date.parse(entry.expires_at) <= now)
      ) continue;
      let opened;
      try {
        opened = reopen(state, entry);
      } catch {
        continue;
      }
      const serialized = canonicalJson(opened.payload);
      const haystack = `${entry.title ?? ""} ${entry.kind ?? ""} ${serialized}`.toLocaleLowerCase("fr");
      const matches = queryTokens.filter((token) => haystack.includes(token)).length;
      if (matches === 0) continue;
      ranked.push({
        memory_tier: "working",
        text: excerpt(serialized),
        title: entry.title,
        score: matches / queryTokens.length,
        evidence_ids: [entry.evidence_id],
        episode_ids: [entry.episode_id],
        content_hash: entry.content_hash,
        observed_at: entry.created_at,
        valid_from: entry.created_at,
        valid_to: entry.expires_at,
        citations: [citation(state, entry)]
      });
    }
    ranked.sort((left, right) => right.score - left.score || left.evidence_ids[0].localeCompare(right.evidence_ids[0]));
    return {
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: state.manifest.working_set_id,
      coverage: state.manifest.capture_coverage,
      results: ranked.slice(0, limit),
      bounded: ranked.length > limit,
      limit
    };
  };

  const open = (input = {}) => {
    const state = boundState(input);
    const entry = activeEntry(state, input.evidence_id ?? input.evidenceId);
    const opened = reopen(state, entry);
    const serialized = canonicalJson(opened.payload);
    const expectedHash = hash(serialized);
    if (expectedHash !== entry.content_hash) fail("not_found_or_not_authorized");
    const maxTokens = boundedInteger(input.max_tokens ?? input.maxTokens, defaultOpenTokens, 1, maxOpenTokens, "working_limit_invalid");
    const pageCharacters = maxTokens * 4;
    let offset = 0;
    if (input.cursor !== undefined && input.cursor !== null) {
      if (typeof input.cursor !== "string" || input.cursor.length > 2_048) fail("working_cursor_invalid");
      const cursor = decodeCursor(input.cursor);
      if (
        cursor.working_set_id !== state.manifest.working_set_id || cursor.evidence_id !== entry.evidence_id ||
        cursor.content_hash !== entry.content_hash || !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 || cursor.offset >= serialized.length
      ) fail("working_cursor_invalid");
      offset = cursor.offset;
    }
    const end = Math.min(serialized.length, offset + pageCharacters);
    const content = serialized.slice(offset, end);
    const nextCursor = end < serialized.length ? encodeCursor({
      schema: "supermemory.working-open-cursor.v1",
      working_set_id: state.manifest.working_set_id,
      evidence_id: entry.evidence_id,
      content_hash: entry.content_hash,
      offset: end
    }) : null;
    return {
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: state.manifest.working_set_id,
      evidence_id: entry.evidence_id,
      content,
      content_hash: entry.content_hash,
      offset,
      next_cursor: nextCursor,
      complete: nextCursor === null,
      citation: citation(state, entry)
    };
  };

  const neighbors = (input = {}) => {
    const state = boundState(input);
    const entry = activeEntry(state, input.evidence_id ?? input.evidenceId);
    const before = boundedInteger(input.before, 3, 0, 10, "working_limit_invalid");
    const after = boundedInteger(input.after, 3, 0, 10, "working_limit_invalid");
    const now = Date.parse(clock());
    const entries = state.entries.filter((candidate) => (
      ["selected", "active"].includes(candidate.status) &&
      (!candidate.expires_at || Date.parse(candidate.expires_at) > now)
    ))
      .sort((left, right) => left.source_sequence - right.source_sequence || left.evidence_id.localeCompare(right.evidence_id));
    const index = entries.findIndex((candidate) => candidate.evidence_id === entry.evidence_id);
    if (index < 0) fail("not_found_or_not_authorized");
    const present = (candidate) => ({
      evidence_id: candidate.evidence_id,
      episode_id: candidate.episode_id,
      kind: candidate.kind,
      title: candidate.title,
      observed_at: candidate.created_at,
      content_hash: candidate.content_hash,
      citation: citation(state, candidate)
    });
    return {
      workspace_id: workspaceId,
      project_id: projectId,
      working_set_id: state.manifest.working_set_id,
      evidence_id: entry.evidence_id,
      before: entries.slice(Math.max(0, index - before), index).map(present),
      after: entries.slice(index + 1, index + 1 + after).map(present)
    };
  };

  const map = (input = {}) => {
    const state = boundState(input);
    const expectedHash = workingMapInputHash(state);
    if (typeof workingStore.readDerivedMap === "function") {
      try {
        const cached = workingStore.readDerivedMap({
          workspaceId,
          projectId,
          sessionId: state.manifest.session_id,
          workingSetId: state.manifest.working_set_id
        });
        if (cached?.input_hash === expectedHash) return cached;
      } catch {
        // Derived maps are disposable and rebuilt from authoritative journals.
      }
    }
    const built = buildCodexWorkingMap({
      state,
      reopen: (entry) => reopen(state, entry),
      maxTokens: mapMaxTokens,
      targetTokens: mapTargetTokens,
      clock
    });
    if (typeof workingStore.writeDerivedMap === "function") {
      workingStore.writeDerivedMap({
        workspaceId,
        projectId,
        sessionId: state.manifest.session_id,
        workingSetId: state.manifest.working_set_id,
        map: built
      });
    }
    return built;
  };

  return Object.freeze({
    workspaceId,
    projectId,
    assertBound: (input = {}) => ({ manifest: boundState(input).manifest }),
    search,
    open,
    neighbors,
    map
  });
}
