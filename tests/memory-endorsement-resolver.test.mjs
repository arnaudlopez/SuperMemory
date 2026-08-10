import assert from "node:assert/strict";
import test from "node:test";
import { resolveMemoryEndorsement } from "../scripts/lib/memory-endorsement-resolver.mjs";

const proposal = {
  proposal_id: "proposal_home101_z2",
  thread_id: "thread_architecture",
  message_id: "message_assistant_1",
  text: "Home 101 exécute Hermes et Z2 conserve le vault canonique.",
  episode_id: "episode_assistant_1"
};

test("one same-thread proposal plus explicit short acceptance creates a cited endorsement", () => {
  const result = resolveMemoryEndorsement({
    userMessage: {
      thread_id: "thread_architecture",
      message_id: "message_user_2",
      episode_id: "episode_user_2",
      content: "OK, on part là-dessus."
    },
    candidateProposals: [proposal]
  });
  assert.equal(result.status, "endorsed");
  assert.equal(result.authority_role, "user_endorsement");
  assert.equal(result.text, proposal.text);
  assert.deepEqual(result.episode_ids, [proposal.episode_id, "episode_user_2"]);
  assert.deepEqual(result.message_ids, [proposal.message_id, "message_user_2"]);
});

test("multiple compatible targets make a short acceptance ambiguous", () => {
  const result = resolveMemoryEndorsement({
    userMessage: { thread_id: "thread_architecture", message_id: "message_user_2", episode_id: "episode_user_2", content: "OK." },
    candidateProposals: [proposal, { ...proposal, proposal_id: "proposal_other", message_id: "message_assistant_2", text: "Tout exécuter sur Z2." }]
  });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.activates_memory, false);
});

test("negation, conditional acceptance and cross-thread proposals never endorse", () => {
  for (const content of ["Non, pas ça.", "OK si les tests passent peut-être."]) {
    assert.notEqual(resolveMemoryEndorsement({
      userMessage: { thread_id: "thread_architecture", message_id: "message_user_2", episode_id: "episode_user_2", content },
      candidateProposals: [proposal]
    }).status, "endorsed");
  }
  assert.equal(resolveMemoryEndorsement({
    userMessage: { thread_id: "thread_other", message_id: "message_user_2", episode_id: "episode_user_2", content: "On part là-dessus." },
    candidateProposals: [proposal]
  }).status, "none");
});
