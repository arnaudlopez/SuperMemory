import crypto from "node:crypto";
import { canonicalJson } from "./codex-redaction.mjs";

const NONCE = /^[A-Za-z0-9._-]{12,180}$/;

function digest(message) {
  return `sha256:${crypto.createHash("sha256").update(String(message)).digest("hex")}`;
}

function signingPayload({ agent_id, turn_id, nonce, message_hash }) {
  return canonicalJson({ agent_id, turn_id, nonce, message_hash });
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function signPersonalTurnIntent({ token, agent_id, turn_id, nonce, message_hash } = {}) {
  if (!token || !agent_id || !turn_id || !nonce || !message_hash) fail("intent_signature_input_invalid");
  return `hmac-sha256:${crypto.createHmac("sha256", token).update(signingPayload({ agent_id, turn_id, nonce, message_hash })).digest("hex")}`;
}

function explicit(operation, message) {
  const patterns = {
    add: /\b(?:ajoute|ajouter|m[ée]morise|m[ée]moriser|retiens|retenir|note|noter|enregistre|enregistrer|remember|save|record|add)\b/i,
    update: /\b(?:mets?\s+[àa]\s+jour|corrige|corriger|modifie|modifier|remplace|remplacer|update|correct|modify|replace)\b/i,
    resolve: /\b(?:r[ée]sous|r[ée]soudre|tranche|corrige|resolve|settle|correct)\b/i,
    supersede: /\b(?:supers[èe]de|superseder|remplace|remplacer|supersede|replace)\b/i,
    forget: /\b(?:oublie|oublier|supprime|supprimer|efface|effacer|confirme|confirmer|forget|delete|remove|confirm)\b/i
  };
  return patterns[operation]?.test(String(message ?? "")) === true;
}

export function createPersonalMutationIntentGate() {
  const verify = ({ token, scope, operation, userInstruction } = {}) => {
    const instruction = userInstruction ?? {};
    if (!NONCE.test(String(instruction.nonce ?? ""))) fail("intent_nonce_invalid");
    if (instruction.agent_id !== scope?.agentId) fail("intent_agent_mismatch");
    if (!instruction.message || digest(instruction.message) !== instruction.message_hash) fail("intent_message_hash_invalid");
    const expected = signPersonalTurnIntent({ token, ...instruction });
    const actualBytes = Buffer.from(String(instruction.signature ?? ""));
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) fail("intent_signature_invalid");
    if (!explicit(operation, instruction.message)) fail("explicit_intent_required");
    return Object.freeze({ allowed: true, nonce: instruction.nonce, turn_id: instruction.turn_id, message_hash: instruction.message_hash });
  };
  return Object.freeze({ verify });
}
