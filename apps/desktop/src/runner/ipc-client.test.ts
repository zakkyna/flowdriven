import { RunnerError } from "@flowdriven/contracts";
import { expect, test, vi } from "vitest";
import { IpcRunnerClient } from "./ipc-client";

function bridge(reply: unknown) {
  return { call: vi.fn().mockResolvedValue(reply), subscribe: vi.fn(() => vi.fn()) };
}

test("a valid input is sent and the parsed answer is returned", async () => {
  const b = bridge({
    ok: true,
    result: { contractVersion: 2, appVersion: "0.1.0", storeVersion: 7, mode: "demo" },
  });
  expect(await new IpcRunnerClient(b).call("runner.info", {})).toEqual({
    contractVersion: 2,
    appVersion: "0.1.0",
    storeVersion: 7,
    mode: "demo",
  });
  expect(b.call).toHaveBeenCalledWith("runner.info", {});

  b.call.mockResolvedValueOnce({
    ok: true,
    result: { contractVersion: 2, appVersion: "0.1.0", storeVersion: 7, mode: "demo", extra: true },
  });
  await expect(new IpcRunnerClient(b).call("runner.info", {})).rejects.toMatchObject({
    code: "unavailable",
    reason: "internal_error",
  });
});

test("an invalid input never leaves the renderer", async () => {
  const b = bridge(null);
  await expect(new IpcRunnerClient(b).call("runs.status", {} as never)).rejects.toMatchObject({
    code: "invalid_input",
  });
  expect(b.call).not.toHaveBeenCalled();
  await expect(new IpcRunnerClient(b).call("unknown" as never, {} as never)).rejects.toMatchObject({
    code: "not_found",
    message: "There is no operation unknown.",
  });
});

test("a failure keeps its code and message, and an unreadable answer becomes unavailable", async () => {
  const b = bridge({ ok: false, error: { code: "not_found", message: "x" } });
  const c = new IpcRunnerClient(b);
  await expect(c.call("runner.info", {})).rejects.toMatchObject({ code: "not_found", message: "x" });
  for (const reply of [{ ok: true, result: {} }, 42]) {
    b.call.mockResolvedValueOnce(reply);
    await expect(c.call("runner.info", {})).rejects.toMatchObject({
      code: "unavailable",
      message: "The engine sent an answer the app cannot read.",
      reason: "internal_error",
    });
  }
  b.call.mockResolvedValueOnce({ ok: false, error: { code: "unknown", message: "x" } });
  await expect(c.call("runner.info", {})).rejects.toMatchObject({
    code: "unavailable",
    message: "x",
    reason: "internal_error",
  });
});

test("a bridge that rejects or throws is unavailable", async () => {
  const b = bridge(null);
  const c = new IpcRunnerClient(b);
  b.call.mockRejectedValueOnce(new Error("bad"));
  b.call.mockImplementationOnce(() => {
    throw new Error("bad");
  });
  for (let i = 0; i < 2; i++)
    await expect(c.call("runner.info", {})).rejects.toMatchObject({
      code: "unavailable",
      message: "The engine is not reachable.",
    });
});

test("events are validated and unsubscribe reaches the bridge", () => {
  let emit: (value: unknown) => void = () => {};
  const unsubscribe = vi.fn();
  const b = {
    call: vi.fn(),
    subscribe: (listener: (value: unknown) => void) => {
      emit = listener;
      return unsubscribe;
    },
  };
  const listener = vi.fn();
  const off = new IpcRunnerClient(b).subscribe(listener);
  emit({ type: "changed", topics: ["bad"] });
  emit({ type: "changed", topics: ["chats", "runs"] });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ type: "changed", topics: ["chats", "runs"] });
  off();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("TC-IPC-19 The renderer client validates input before sending and output after", async () => {
  const b = bridge(null);
  const c = new IpcRunnerClient(b);
  const missingInput = c.call("flows.get", {} as never);
  await expect(missingInput).rejects.toBeInstanceOf(RunnerError);
  await expect(missingInput).rejects.toMatchObject({ code: "invalid_input" });

  const extraInput = c.call("flows.get", { flowId: "example.fill-timesheet", extra: 1 } as never);
  await expect(extraInput).rejects.toBeInstanceOf(RunnerError);
  await expect(extraInput).rejects.toMatchObject({ code: "invalid_input" });
  expect(b.call).not.toHaveBeenCalled();

  for (const reply of [{ ok: true, result: { invalid: true } }, { ok: true }, "x"]) {
    b.call.mockResolvedValueOnce(reply);
    const call = c.call("flows.get", { flowId: "example.fill-timesheet" });
    await expect(call).rejects.toBeInstanceOf(RunnerError);
    await expect(call).rejects.toMatchObject({ code: "unavailable", reason: "internal_error" });
  }
});

test("TC-IPC-20 The client keeps reason and params on an error", async () => {
  const b = bridge({
    ok: false,
    error: { code: "conflict", message: "x", reason: "card_answered", params: { via: "window" } },
  });
  const c = new IpcRunnerClient(b);
  const knownError = c.call("runner.info", {});
  await expect(knownError).rejects.toBeInstanceOf(RunnerError);
  await expect(knownError).rejects.toMatchObject({
    code: "conflict",
    message: "x",
    reason: "card_answered",
    params: { via: "window" },
  });

  b.call.mockResolvedValueOnce({ ok: false, error: { code: "weird", message: "x" } });
  const weirdError = c.call("runner.info", {});
  await expect(weirdError).rejects.toBeInstanceOf(RunnerError);
  await expect(weirdError).rejects.toMatchObject({ code: "unavailable", reason: "internal_error" });
});
