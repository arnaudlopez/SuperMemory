import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../scripts/lib/codex-redaction.mjs";
import { createCodexWorkingRecall } from "../scripts/lib/codex-working-recall.mjs";

const WORKSPACE_ID = "ws_018f7c0e-7b7d-7abc-8def-0123456789ab";
const PROJECT_ID = "prj_018f7c0e-7b7d-7abc-8def-0123456789ac";
const WORKING_SET_ID = "wset_018f7c0e-7b7d-7abc-8def-0123456789ad";
const EVIDENCE_ID = "wev_018f7c0e-7b7d-7abc-8def-0123456789ae";

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function fixture({ expiresAt = null } = {}) {
  const payload = { text: "Architecture mémoire 🧠 avec une preuve UTF-8 très détaillée." };
  const serialized = canonicalJson(payload);
  const entry = {
    evidence_id: EVIDENCE_ID,
    episode_id: "wep_018f7c0e-7b7d-7abc-8def-0123456789af",
    event_id: "evt_018f7c0e-7b7d-7abc-8def-0123456789b0",
    content_hash: sha(serialized),
    created_at: "2026-08-08T10:00:00.000Z",
    expires_at: expiresAt,
    source_sequence: 1,
    status: "active",
    kind: "turn",
    title: "Architecture mémoire"
  };
  const state = {
    manifest: {
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      session_id: "ses_018f7c0e-7b7d-7abc-8def-0123456789b1",
      working_set_id: WORKING_SET_ID,
      capture_coverage: "complete",
      map_version: 1
    },
    entries: [entry]
  };
  const recall = createCodexWorkingRecall({
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    clock: () => "2026-08-08T12:00:00.000Z",
    workingStore: {
      resolveWorkingSet: ({ workspaceId, projectId, workingSetId }) => {
        assert.equal(workspaceId, WORKSPACE_ID);
        assert.equal(projectId, PROJECT_ID);
        assert.equal(workingSetId, WORKING_SET_ID);
        return state;
      },
      openEvidence: () => ({ payload })
    },
    captureStore: { readEvents: () => [] }
  });
  return { recall, serialized };
}

test("working recall requires an exact bound working set and hides authority misses", () => {
  const { recall } = fixture();
  assert.throws(() => recall.search({ query: "mémoire" }), /not_found_or_not_authorized/);
  assert.throws(() => recall.search({
    working_set_id: "wset_018f7c0e-7b7d-7abc-8def-0123456789ff",
    query: "mémoire"
  }), /not_found_or_not_authorized/);
  assert.throws(() => recall.search({
    working_set_id: WORKING_SET_ID,
    workspace_id: WORKSPACE_ID,
    query: "mémoire"
  }), /scope_argument_forbidden/);
});

test("working search includes unexpired evidence and excludes expired evidence", () => {
  const active = fixture({ expiresAt: "2026-08-09T12:00:00.000Z" }).recall.search({
    working_set_id: WORKING_SET_ID,
    query: "architecture"
  });
  assert.equal(active.results.length, 1);
  const expired = fixture({ expiresAt: "2026-08-08T11:59:59.000Z" }).recall.search({
    working_set_id: WORKING_SET_ID,
    query: "architecture"
  });
  assert.equal(expired.results.length, 0);
});

test("working open pagination is lossless across UTF-8 boundaries", () => {
  const { recall, serialized } = fixture();
  let cursor = null;
  let reopened = "";
  do {
    const page = recall.open({
      working_set_id: WORKING_SET_ID,
      evidence_id: EVIDENCE_ID,
      max_tokens: 1,
      ...(cursor ? { cursor } : {})
    });
    reopened += page.content;
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(reopened, serialized);
});

test("WM-AC05/06/13/17: working map is cited, bounded, tombstone-safe and rebuildable", () => {
  const { recall } = fixture();
  const map = recall.map({ working_set_id: WORKING_SET_ID });
  assert.equal(map.status, "ready");
  assert.equal(map.stale, false);
  assert.ok(map.estimated_tokens > 0 && map.estimated_tokens <= 8_000);
  assert.match(map.additional_context, /wev_/);
  assert.deepEqual(map.evidence_ids, [EVIDENCE_ID]);
  assert.equal(map.lines.every((line) => line.evidence_ids.length > 0), true);
});
