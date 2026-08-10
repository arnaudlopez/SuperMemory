const SEMANTICS = Object.freeze({
  gmail: Object.freeze({
    draft_created: new Set(["created"]),
    draft_updated: new Set(["updated"]),
    email_sent: new Set(["sent"]),
    email_failed: new Set(["failed"])
  }),
  google_calendar: Object.freeze({
    event_created: new Set(["created"]),
    event_updated: new Set(["updated"]),
    event_deleted: new Set(["deleted"]),
    event_failed: new Set(["failed"])
  })
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function optionalString(value, max = 512) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).slice(0, max);
}

export function normalizePersonalActionReceipt(input = {}) {
  const connector = String(input.connector ?? "");
  const action = String(input.action ?? "");
  const status = String(input.status ?? "");
  if (!SEMANTICS[connector]?.[action]?.has(status)) fail("action_receipt_semantics_invalid");
  const receipt = {
    schema: "supermemory.personal-action-receipt.v1",
    connector,
    action,
    status
  };
  const externalId = optionalString(input.external_id ?? input.externalId, 256);
  const operationId = optionalString(input.operation_id ?? input.operationId, 256);
  const subject = optionalString(input.subject, 512);
  const title = optionalString(input.title, 512);
  const occurredAt = optionalString(input.occurred_at ?? input.occurredAt, 64);
  if (externalId) receipt.external_id = externalId;
  if (operationId) receipt.operation_id = operationId;
  if (subject) receipt.subject = subject;
  if (title) receipt.title = title;
  if (occurredAt) receipt.occurred_at = occurredAt;
  if (Array.isArray(input.recipients)) receipt.recipient_count = input.recipients.length;
  if (Array.isArray(input.attendees)) receipt.attendee_count = input.attendees.length;
  return Object.freeze(receipt);
}
