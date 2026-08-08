const FORMATS = new Set(["summary", "decision", "risks", "timeline"]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

const text = { type: "string", minLength: 1, maxLength: 16_000 };
const textList = { type: "array", items: text, maxItems: 20 };

const schemas = Object.freeze({
  summary: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["answer", "key_points", "uncertainties"],
    properties: { answer: text, key_points: textList, uncertainties: textList }
  }),
  decision: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["answer", "options", "constraints", "recommendation", "evidence"],
    properties: { answer: text, options: textList, constraints: textList, recommendation: text, evidence: textList }
  }),
  risks: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["answer", "risks"],
    properties: {
      answer: text,
      risks: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["risk", "probability", "impact", "mitigation", "evidence"],
          properties: {
            risk: text,
            probability: { enum: ["low", "medium", "high", "unknown"] },
            impact: { enum: ["low", "medium", "high", "unknown"] },
            mitigation: text,
            evidence: textList
          }
        }
      }
    }
  }),
  timeline: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["answer", "events", "current_state"],
    properties: {
      answer: text,
      events: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "event", "evidence"],
          properties: { date: text, event: text, evidence: textList }
        }
      },
      current_state: text
    }
  })
});

function valid(value, schema) {
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === "string") {
    return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
  }
  if (schema.type === "array") {
    return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) && value.every((item) => valid(item, schema.items));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) return false;
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    return Object.entries(value).every(([key, item]) => valid(item, schema.properties[key]));
  }
  return false;
}

export function hindsightReflectSchema(format) {
  if (!FORMATS.has(format)) fail("hindsight_reflect_format_invalid");
  return structuredClone(schemas[format]);
}

export function validateHindsightReflectOutput(format, value) {
  const schema = hindsightReflectSchema(format);
  if (!valid(value, schema)) fail("reflect_structured_output_invalid");
  return value;
}

export const HINDSIGHT_REFLECT_FORMATS = Object.freeze([...FORMATS]);
