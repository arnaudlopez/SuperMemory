import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWorkingOffload } from "../scripts/lib/codex-working-offload.mjs";

const candidate = {
  working_set_id: "wset_x", evidence_id: "wev_x", admitted: true,
  durable: true, complete: true, reopen_verified: true, capture_coverage: "rich",
  token_estimate: 13_000, tool_name: "Bash", status: "selected"
};

test("offload receipts require complete reopened durable evidence but never replace output", () => {
  const eligible = evaluateWorkingOffload(candidate, { enabled: true });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.replacement_enabled, false);
  assert.equal(eligible.suppress_original, false);
  for (const patch of [
    { durable: false }, { complete: false }, { reopen_verified: false },
    { capture_coverage: "partial" }, { status: "spooled" }, { status: "timedout" },
    { status: "tombstoned" }, { status: "evicted" }, { status: "corrupt" }
  ]) assert.equal(evaluateWorkingOffload({ ...candidate, ...patch }, { enabled: true }).eligible, false);
  assert.equal(evaluateWorkingOffload(candidate, { enabled: false }).reason, "offload_disabled");
});

test("WM-AC08/09/10: explicit safe offload replaces only fully reopened allowlisted output", () => {
  const safe = evaluateWorkingOffload(candidate, {
    enabled: true,
    replacementSupported: true,
    thresholdTokens: 12_000,
    allowedTools: ["Bash"]
  });
  assert.equal(safe.eligible, true);
  assert.equal(safe.replacement_enabled, true);
  assert.equal(safe.suppress_original, true);
  assert.match(safe.replacement_text, /supermemory_working_open/);

  const partial = evaluateWorkingOffload({ ...candidate, complete: false }, {
    enabled: true,
    replacementSupported: true,
    thresholdTokens: 12_000,
    allowedTools: ["Bash"]
  });
  assert.equal(partial.suppress_original, false);

  const unsupported = evaluateWorkingOffload(candidate, {
    enabled: true,
    replacementSupported: false,
    thresholdTokens: 12_000,
    allowedTools: ["Bash"]
  });
  assert.equal(unsupported.suppress_original, false);
});
