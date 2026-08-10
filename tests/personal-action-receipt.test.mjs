import assert from "node:assert/strict";
import test from "node:test";
import { normalizePersonalActionReceipt } from "../scripts/lib/personal-action-receipt.mjs";

test("Gmail action receipts preserve action level without retaining raw payloads", () => {
  const draft = normalizePersonalActionReceipt({
    connector: "gmail",
    action: "draft_created",
    status: "created",
    externalId: "draft_123",
    subject: "Décision SuperMemory",
    recipients: ["paul@example.test"],
    body: "full body must not be stored",
    attachments: [{ name: "secret.pdf" }],
    oauth_token: "secret"
  });
  assert.equal(draft.action, "draft_created");
  assert.equal(draft.status, "created");
  assert.equal(draft.external_id, "draft_123");
  assert.equal(draft.body, undefined);
  assert.equal(draft.attachments, undefined);
  assert.equal(draft.oauth_token, undefined);
  assert.throws(() => normalizePersonalActionReceipt({ connector: "gmail", action: "draft_created", status: "sent" }), { message: "action_receipt_semantics_invalid" });
});
