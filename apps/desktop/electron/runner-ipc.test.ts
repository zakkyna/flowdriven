import { describe, expect, test, vi } from "vitest";
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
      { type: "changed" },
    );
    expect(send).toHaveBeenCalledWith("runner:event", { type: "changed" });
    expect(destroyed).not.toHaveBeenCalled();
    expect(foreign).not.toHaveBeenCalled();
  });
});
