const KINDS = new Set(["instant", "interval", "uncertain"]);
const GRANULARITIES = new Set(["exact", "minute", "hour", "day", "week", "month", "year", "unknown"]);
const NORMALIZATIONS = new Set(["explicit", "relative_expression", "inferred", "legacy_observed_only"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function instant(value, code = "temporal_timestamp_invalid") {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) fail(code);
  return timestamp;
}

function iso(value) {
  return value.toISOString();
}

function dayBounds(value) {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000 - 1);
  return [start, end];
}

function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1) - 1);
  return [start, end];
}

function yearBounds(year) {
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1) - 1)];
}

function weekBounds(value) {
  const [day] = dayBounds(value);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  const start = new Date(day.getTime() - mondayOffset * 86_400_000);
  return [start, new Date(start.getTime() + 7 * 86_400_000 - 1)];
}

function result({ kind, earliest, latest, granularity, anchorTimestamp, normalization }) {
  return validateEventTime({
    kind,
    earliest: earliest ? iso(earliest) : null,
    latest: latest ? iso(latest) : null,
    granularity,
    anchor_timestamp: iso(anchorTimestamp),
    normalization
  });
}

export function validateEventTime(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("event_time_invalid");
  const allowed = new Set(["kind", "earliest", "latest", "granularity", "anchor_timestamp", "normalization"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("event_time_shape_invalid");
  if (!KINDS.has(value.kind) || !GRANULARITIES.has(value.granularity) || !NORMALIZATIONS.has(value.normalization)) {
    fail("event_time_invalid");
  }
  const anchor = instant(value.anchor_timestamp, "event_time_anchor_invalid");
  const earliest = value.earliest === null ? null : instant(value.earliest, "event_time_bound_invalid");
  const latest = value.latest === null ? null : instant(value.latest, "event_time_bound_invalid");
  if ((earliest === null) !== (latest === null)) fail("event_time_bound_invalid");
  if (earliest && earliest.getTime() > latest.getTime()) fail("event_time_window_invalid");
  if (value.kind === "instant" && (!earliest || earliest.getTime() !== latest.getTime())) fail("event_time_instant_invalid");
  if (value.kind !== "uncertain" && !earliest) fail("event_time_bound_required");
  return Object.freeze({
    kind: value.kind,
    earliest: earliest ? iso(earliest) : null,
    latest: latest ? iso(latest) : null,
    granularity: value.granularity,
    anchor_timestamp: iso(anchor),
    normalization: value.normalization
  });
}

export function legacyObservedEventTime(observedAt) {
  const anchor = instant(observedAt, "event_time_anchor_invalid");
  return result({
    kind: "uncertain",
    earliest: null,
    latest: null,
    granularity: "unknown",
    anchorTimestamp: anchor,
    normalization: "legacy_observed_only"
  });
}

export function normalizeTemporalExpression({ text, observedAt, explicit = null } = {}) {
  const anchor = instant(observedAt, "event_time_anchor_invalid");
  if (explicit) return validateEventTime({ ...explicit, anchor_timestamp: explicit.anchor_timestamp ?? iso(anchor) });
  const source = String(text ?? "").normalize("NFKC").toLocaleLowerCase("fr");

  const isoDate = source.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (isoDate) {
    const candidate = new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00.000Z`);
    if (candidate.getUTCFullYear() === Number(isoDate[1]) && candidate.getUTCMonth() === Number(isoDate[2]) - 1 && candidate.getUTCDate() === Number(isoDate[3])) {
      const [earliest, latest] = dayBounds(candidate);
      return result({ kind: "interval", earliest, latest, granularity: "day", anchorTimestamp: anchor, normalization: "explicit" });
    }
  }

  const daysAgo = source.match(/(?:il y a|\b)(\d{1,3})\s+jours?\b|\b(\d{1,3})\s+days?\s+ago\b/);
  if (daysAgo) {
    const count = Number(daysAgo[1] ?? daysAgo[2]);
    const [earliest, latest] = dayBounds(new Date(anchor.getTime() - count * 86_400_000));
    return result({ kind: "interval", earliest, latest, granularity: "day", anchorTimestamp: anchor, normalization: "relative_expression" });
  }

  if (/\b(hier|yesterday)\b/.test(source)) {
    const [earliest, latest] = dayBounds(new Date(anchor.getTime() - 86_400_000));
    return result({ kind: "interval", earliest, latest, granularity: "day", anchorTimestamp: anchor, normalization: "relative_expression" });
  }
  if (/\b(aujourd['’]hui|today)\b/.test(source)) {
    const [earliest, latest] = dayBounds(anchor);
    return result({ kind: "interval", earliest, latest, granularity: "day", anchorTimestamp: anchor, normalization: "relative_expression" });
  }
  if (/\b(le mois dernier|mois dernier|last month)\b/.test(source)) {
    const [earliest, latest] = monthBounds(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1);
    return result({ kind: "interval", earliest, latest, granularity: "month", anchorTimestamp: anchor, normalization: "relative_expression" });
  }
  if (/\b(la semaine dernière|semaine dernière|last week)\b/.test(source)) {
    const [thisWeek] = weekBounds(anchor);
    const [earliest, latest] = weekBounds(new Date(thisWeek.getTime() - 7 * 86_400_000));
    return result({ kind: "interval", earliest, latest, granularity: "week", anchorTimestamp: anchor, normalization: "relative_expression" });
  }
  if (/\b(l['’]année dernière|année dernière|last year)\b/.test(source)) {
    const [earliest, latest] = yearBounds(anchor.getUTCFullYear() - 1);
    return result({ kind: "interval", earliest, latest, granularity: "year", anchorTimestamp: anchor, normalization: "relative_expression" });
  }

  return result({
    kind: "uncertain",
    earliest: null,
    latest: null,
    granularity: "unknown",
    anchorTimestamp: anchor,
    normalization: "inferred"
  });
}

export function eventTimeOverlaps(eventTime, { start, end } = {}) {
  const value = validateEventTime(eventTime);
  if (!value.earliest) return false;
  const windowStart = start ? instant(start, "temporal_window_invalid").getTime() : Number.NEGATIVE_INFINITY;
  const windowEnd = end ? instant(end, "temporal_window_invalid").getTime() : Number.POSITIVE_INFINITY;
  if (windowStart > windowEnd) fail("temporal_window_invalid");
  return Date.parse(value.latest) >= windowStart && Date.parse(value.earliest) <= windowEnd;
}
