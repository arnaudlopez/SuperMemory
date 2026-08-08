import assert from "node:assert/strict";
import test from "node:test";
import {
  eventTimeOverlaps,
  legacyObservedEventTime,
  normalizeTemporalExpression,
  validateEventTime
} from "../scripts/lib/codex-temporal-normalizer.mjs";

test("TR-AC01/02: observed time and event interval remain distinct without false precision", () => {
  const eventTime = normalizeTemporalExpression({
    text: "J'ai commencé ce traitement le mois dernier.",
    observedAt: "2026-04-12T10:00:00+02:00"
  });
  assert.deepEqual(eventTime, {
    kind: "interval",
    earliest: "2026-03-01T00:00:00.000Z",
    latest: "2026-03-31T23:59:59.999Z",
    granularity: "month",
    anchor_timestamp: "2026-04-12T08:00:00.000Z",
    normalization: "relative_expression"
  });
  const unknown = normalizeTemporalExpression({ text: "C'était récemment.", observedAt: "2026-04-12T10:00:00Z" });
  assert.equal(unknown.kind, "uncertain");
  assert.equal(unknown.earliest, null);
  assert.equal(unknown.latest, null);
});

test("relative day, week and explicit dates produce deterministic bounded intervals", () => {
  const yesterday = normalizeTemporalExpression({ text: "hier", observedAt: "2026-08-08T12:00:00Z" });
  assert.equal(yesterday.earliest, "2026-08-07T00:00:00.000Z");
  const week = normalizeTemporalExpression({ text: "la semaine dernière", observedAt: "2026-08-08T12:00:00Z" });
  assert.equal(week.earliest, "2026-07-27T00:00:00.000Z");
  assert.equal(week.latest, "2026-08-02T23:59:59.999Z");
  const explicit = normalizeTemporalExpression({ text: "le 2026-02-17", observedAt: "2026-08-08T12:00:00Z" });
  assert.equal(explicit.normalization, "explicit");
  assert.equal(eventTimeOverlaps(explicit, { start: "2026-02-01T00:00:00Z", end: "2026-02-28T23:59:59Z" }), true);
});

test("legacy observations stay uncertain and malformed event windows fail closed", () => {
  const legacy = legacyObservedEventTime("2026-08-08T12:00:00Z");
  assert.equal(legacy.normalization, "legacy_observed_only");
  assert.equal(legacy.earliest, null);
  assert.throws(() => validateEventTime({
    kind: "interval",
    earliest: "2026-02-02T00:00:00Z",
    latest: "2026-02-01T00:00:00Z",
    granularity: "day",
    anchor_timestamp: "2026-08-08T12:00:00Z",
    normalization: "explicit"
  }), /event_time_window_invalid/);
});
