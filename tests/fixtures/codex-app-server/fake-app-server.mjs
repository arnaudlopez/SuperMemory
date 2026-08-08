const notifications = [
  {
    method: "thread/started",
    params: { thread: { id: "thr_wrapper_fixture" } }
  },
  {
    method: "turn/started",
    params: {
      threadId: "thr_wrapper_fixture",
      turn: { id: "turn_wrapper_fixture" }
    }
  },
  {
    method: "item/completed",
    params: {
      threadId: "thr_wrapper_fixture",
      turnId: "turn_wrapper_fixture",
      item: {
        id: "item_wrapper_agent",
        type: "agentMessage",
        text: "Visible final answer"
      }
    }
  },
  {
    method: "turn/completed",
    params: {
      threadId: "thr_wrapper_fixture",
      turn: { id: "turn_wrapper_fixture", status: "completed" }
    }
  }
];

for (const notification of notifications) {
  process.stdout.write(`${JSON.stringify(notification)}\n`);
}
