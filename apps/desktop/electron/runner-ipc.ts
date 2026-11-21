import { OPERATION_NAMES, RUNNER_TOPICS } from "./contract-names";
import { MAX_FRAME_BYTES } from "./runner-link";
import { isAllowedNavigation } from "./security";

export const RUNNER_CALL_CHANNEL = "runner:call";
export const RUNNER_EVENT_CHANNEL = "runner:event";
export const METHOD_PATTERN = /^[a-z]+\.[A-Za-z]+$/;
export type FrameLike = { url: string; parent: unknown } | null;
export type RunnerReply =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: { code: string; message: string; reason?: string; params?: Record<string, unknown> };
    };
export type IpcLike = {
  handle(channel: string, listener: (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown): void;
};
export type WindowLike = {
  isDestroyed(): boolean;
  webContents: { mainFrame: { url: string }; send(channel: string, ...args: unknown[]): void };
};
export function isOwnMainFrame(frame: FrameLike): boolean {
  return frame !== null && frame.parent === null && isAllowedNavigation(frame.url);
}
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function registerRunnerIpc(options: {
  ipc: IpcLike;
  link: { call(method: string, params: Record<string, unknown>): Promise<unknown> };
}): void {
  options.ipc.handle(RUNNER_CALL_CHANNEL, async (event, ...args): Promise<RunnerReply> => {
    if (args.length !== 2 || !isOwnMainFrame(event.senderFrame))
      return { ok: false, error: { code: "not_allowed", message: "This window cannot call the engine." } };
    const [method, input] = args;
    if (typeof method !== "string" || !METHOD_PATTERN.test(method))
      return { ok: false, error: { code: "invalid_input", message: "Invalid method name." } };
    if (!(OPERATION_NAMES as readonly string[]).includes(method))
      return { ok: false, error: { code: "not_found", message: "Unknown method." } };
    if (!isPlainObject(input))
      return { ok: false, error: { code: "invalid_input", message: "The input must be an object." } };
    try {
      if (Buffer.byteLength(JSON.stringify(input)) > MAX_FRAME_BYTES) throw new Error();
    } catch {
      return { ok: false, error: { code: "invalid_input", message: "The input cannot be sent." } };
    }
    try {
      return { ok: true, result: await options.link.call(method, input) };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "message" in error &&
        typeof error.code === "string" &&
        typeof error.message === "string"
      )
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...("reason" in error && typeof error.reason === "string" ? { reason: error.reason } : {}),
            ...("params" in error && isPlainObject(error.params) ? { params: error.params } : {}),
          },
        };
      return { ok: false, error: { code: "unavailable", message: "The engine stopped." } };
    }
  });
}
export function broadcastRunnerEvent(windows: WindowLike[], event: unknown): void {
  if (
    !isPlainObject(event) ||
    Object.keys(event).length !== 2 ||
    event.type !== "changed" ||
    !Array.isArray(event.topics) ||
    event.topics.length === 0 ||
    !event.topics.every(
      (topic: unknown) => typeof topic === "string" && (RUNNER_TOPICS as readonly string[]).includes(topic),
    )
  )
    return;
  for (const window of windows)
    if (!window.isDestroyed() && isAllowedNavigation(window.webContents.mainFrame.url))
      window.webContents.send(RUNNER_EVENT_CHANNEL, event);
}
