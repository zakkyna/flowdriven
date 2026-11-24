import { expect, test } from "vitest";
import * as contract from "./index";

test("TC-CON-15 start outcomes and window sources", () => {
  const { StartOutcome, FlowsStartInput, FlowsStartOutput } = contract;
  const started = { outcome: "started", startId: "start-000000000001", runId: "run-000000000001" };
  expect(StartOutcome.safeParse(started).success).toBe(true);
  expect(FlowsStartOutput.safeParse(started).success).toBe(true);
  expect(StartOutcome.safeParse({ outcome: "started", startId: started.startId }).success).toBe(false);
  for (const outcome of ["asked", "needs_confirmation"]) {
    expect(
      StartOutcome.safeParse({
        outcome,
        startId: started.startId,
        chatId: "chat-1",
        questionId: "wq-1",
        reused: false,
      }).success,
    ).toBe(true);
    expect(StartOutcome.safeParse({ outcome, startId: started.startId }).success).toBe(false);
  }
  for (const reason of ["permission_off", "daily_limit", "flow_deleted", "agent_cannot_be_limited", "paused"])
    expect(StartOutcome.safeParse({ outcome: "refused", startId: started.startId, reason }).success).toBe(
      reason !== "paused",
    );
  expect(FlowsStartInput.safeParse({ flowId: "example.build-apk", source: "flows" }).success).toBe(true);
  expect(
    FlowsStartInput.safeParse({ flowId: "example.build-apk", source: "again", fromRunId: started.runId })
      .success,
  ).toBe(true);
  for (const source of ["again", "chat", "schedule", "after", "try_next", "proactive", "phone", "tool"])
    expect(FlowsStartInput.safeParse({ flowId: "f", source }).success).toBe(false);
  expect(FlowsStartInput.safeParse({ flowId: "f", source: "flows", fromRunId: started.runId }).success).toBe(
    false,
  );
});
