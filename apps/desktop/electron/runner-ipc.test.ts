import { operationNames, RunnerTopic } from "@flowdriven/contracts";
import { describe, expect, test, vi } from "vitest";
import { OPERATION_NAMES, RUNNER_TOPICS } from "./contract-names";
import {
  broadcastRunnerEvent,
  type FrameLike,
  type IpcLike,
  isOwnMainFrame,
  registerRunnerIpc,
} from "./runner-ipc";

const own = { url: "app://flowdriven/index.html#/runs", parent: null };
function setup() {
  let handler: (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown = () => undefined;
  const ipc: IpcLike = {
    handle: (_channel, listener) => {
      handler = listener;
    },
  };
  const link = { call: vi.fn().mockResolvedValue({ value: 1 }) };
  registerRunnerIpc({ ipc, link });
  return { call: (frame: FrameLike, ...args: unknown[]) => handler({ senderFrame: frame }, ...args), link };
}
describe("runner IPC", () => {
  test("a call from the app's own main frame is forwarded and answered with its result", async () => {
    const { call, link } = setup();
    expect(isOwnMainFrame(own)).toBe(true);
    expect(await call(own, "flows.list", { x: 1 })).toEqual({ ok: true, result: { value: 1 } });
    expect(link.call).toHaveBeenCalledWith("flows.list", { x: 1 });
    expect(await call(own, "flows.list", Object.create(null))).toEqual({ ok: true, result: { value: 1 } });
  });
  test("refuses a call from a foreign frame, a sub-frame, a bad method name or a non-object input", async () => {
    const { call, link } = setup();
    for (const frame of [{ url: "https://example.com", parent: null }, { ...own, parent: {} }, null])
      expect(await call(frame, "flows.list", {})).toEqual({
        ok: false,
        error: { code: "not_allowed", message: "This window cannot call the engine." },
      });
    for (const method of ["flows.list; x", "../x", 42, "Flows.list"])
      expect(await call(own, method, {})).toEqual({
        ok: false,
        error: { code: "invalid_input", message: "Invalid method name." },
      });
    for (const input of [[], null, "x", new (class Example {})()])
      expect(await call(own, "flows.list", input)).toEqual({
        ok: false,
        error: { code: "invalid_input", message: "The input must be an object." },
      });
    for (const args of [["flows.list"], ["flows.list", {}, 1]])
      expect(await call(own, ...args)).toEqual({
        ok: false,
        error: { code: "not_allowed", message: "This window cannot call the engine." },
      });
    expect(link.call).not.toHaveBeenCalled();
  });
  test("a failure keeps its code and message and anything else becomes unavailable", async () => {
    const { call, link } = setup();
    link.call
      .mockRejectedValueOnce({ code: "not_found", message: "Missing" })
      .mockRejectedValueOnce(new Error("secret"));
    expect(await call(own, "runs.status", {})).toEqual({
      ok: false,
      error: { code: "not_found", message: "Missing" },
    });
    expect(await call(own, "runs.status", {})).toEqual({
      ok: false,
      error: { code: "unavailable", message: "The engine stopped." },
    });
  });
  test("events go only to live windows on the app origin", () => {
    const send = vi.fn(),
      destroyed = vi.fn(),
      foreign = vi.fn();
    broadcastRunnerEvent(
      [
        { isDestroyed: () => false, webContents: { mainFrame: { url: own.url }, send } },
        { isDestroyed: () => true, webContents: { mainFrame: { url: own.url }, send: destroyed } },
        {
          isDestroyed: () => false,
          webContents: { mainFrame: { url: "https://example.com" }, send: foreign },
        },
      ],
      { type: "changed", topics: ["flows"] },
    );
    expect(send).toHaveBeenCalledWith("runner:event", { type: "changed", topics: ["flows"] });
    expect(destroyed).not.toHaveBeenCalled();
    expect(foreign).not.toHaveBeenCalled();
  });
});

test("TC-IPC-08 rejects untrusted frames", async () => {
  const { call, link } = setup();
  for (const frame of [
    null,
    { ...own, parent: own },
    ...[
      "https://example.com/",
      "app://flowdriven:8080/",
      "app://sam@flowdriven/",
      "app://other/",
      "file:///index.html",
    ].map((url) => ({ url, parent: null })),
  ])
    expect(await call(frame, "flows.list", {})).toMatchObject({ ok: false, error: { code: "not_allowed" } });
  expect(link.call).not.toHaveBeenCalled();
  expect(await call(own, "flows.list", {})).toMatchObject({ ok: true });
});
test("TC-IPC-09 rejects argument counts", async () => {
  const { call, link } = setup();
  for (const args of [[], ["flows.list"], ["flows.list", {}, {}]])
    expect(await call(own, ...args)).toMatchObject({ ok: false, error: { code: "not_allowed" } });
  expect(link.call).not.toHaveBeenCalled();
});
test("TC-IPC-10 accepts only live operations", async () => {
  const { call, link } = setup();
  for (const method of ["flows.nope", "flows.build", "harnesses.list", "queue.list", "usage.summary"])
    expect(await call(own, method, {})).toMatchObject({ ok: false, error: { code: "not_found" } });
  for (const method of ["Flows.list", "flows", "flows.list.extra", "flows.list ", "../x.y"])
    expect(await call(own, method, {})).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  expect(link.call).not.toHaveBeenCalled();
  expect(await call(own, "flows.list", {})).toMatchObject({ ok: true });
});
test("TC-IPC-11 validates serialized input size", async () => {
  const { call, link } = setup();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const input of [
    [],
    null,
    "x",
    new Map(),
    new (class Example {})(),
    circular,
    { x: 1n },
    { flowId: "x".repeat(1_048_576) },
  ])
    expect(await call(own, "flows.get", input)).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  expect(link.call).not.toHaveBeenCalled();
  expect(await call(own, "flows.get", { flowId: "example.fill-timesheet" })).toMatchObject({ ok: true });
});
test("TC-IPC-12 preserves reason and params", async () => {
  const { call, link } = setup();
  link.call
    .mockRejectedValueOnce({
      code: "conflict",
      message: "The hash moved.",
      reason: "hash_mismatch",
      params: { flow: "Fill timesheet" },
    })
    .mockRejectedValueOnce(new Error("boom"))
    .mockRejectedValueOnce({ code: "unavailable", message: "x", reason: "engine_stopped" });
  expect(await call(own, "flows.get", {})).toEqual({
    ok: false,
    error: {
      code: "conflict",
      message: "The hash moved.",
      reason: "hash_mismatch",
      params: { flow: "Fill timesheet" },
    },
  });
  expect(await call(own, "flows.get", {})).toEqual({
    ok: false,
    error: { code: "unavailable", message: "The engine stopped." },
  });
  expect(await call(own, "flows.get", {})).toEqual({
    ok: false,
    error: { code: "unavailable", message: "x", reason: "engine_stopped" },
  });
});
test("TC-IPC-13 broadcasts only valid events", () => {
  const send = vi.fn(),
    foreign = vi.fn(),
    destroyed = vi.fn();
  const windows = [
    { isDestroyed: () => false, webContents: { mainFrame: { url: own.url }, send } },
    { isDestroyed: () => false, webContents: { mainFrame: { url: "https://example.com/" }, send: foreign } },
    { isDestroyed: () => true, webContents: { mainFrame: { url: own.url }, send: destroyed } },
  ];
  const valid = { type: "changed", topics: ["flows", "chats"] };
  for (const event of [
    valid,
    { type: "changed", topics: ["harnesses"] },
    { type: "changed", topics: [] },
    { type: "changed", topics: ["flows"], extra: 1 },
    { type: "other" },
    "x",
    null,
  ])
    broadcastRunnerEvent(windows, event);
  expect(send).toHaveBeenCalledExactlyOnceWith("runner:event", valid);
  expect(foreign).not.toHaveBeenCalled();
  expect(destroyed).not.toHaveBeenCalled();
});

test("main names match the contract", () => {
  expect(OPERATION_NAMES).toEqual(operationNames);
  expect(RUNNER_TOPICS).toEqual(RunnerTopic.options);
});
