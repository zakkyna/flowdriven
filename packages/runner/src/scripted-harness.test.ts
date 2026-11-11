import { expect, test } from "vitest";
import type { StepRequest } from "./harness.ts";
import { scriptedHarness } from "./scripted-harness.ts";

const req = (overrides: Partial<StepRequest> = {}): StepRequest => ({
  runId: "r",
  stepId: "a",
  itemKey: "",
  attempt: 1,
  replan: false,
  kind: "worker",
  title: "",
  instructions: "",
  uses: [],
  outputs: [],
  maxDurationMs: 1000,
  signal: new AbortController().signal,
  ...overrides,
});
test("scripted harness: keys, sequences, hang, loudness", async () => {
  const h = scriptedHarness({
    steps: { "a@k1": { text: "item" }, a: [{ exit: "failed" }, { text: "second" }], b: { hang: true } },
  });
  expect((await h.runStep(req({ stepId: "a", itemKey: "k1" }))).text).toBe("item");
  expect((await h.runStep(req())).exit).toBe("failed");
  expect((await h.runStep(req())).text).toBe("second");
  expect((await h.runStep(req())).text).toBe("second");
  const ctl = new AbortController();
  const p = h.runStep(req({ stepId: "b", signal: ctl.signal }));
  ctl.abort();
  await expect(p).rejects.toMatchObject({ name: "AbortError" });
  await expect(h.runStep(req({ stepId: "zzz" }))).rejects.toThrow("no script for step zzz");
  expect(h.calls.length).toBe(6);
  expect(h.name).toBe("Scripted harness");
});
