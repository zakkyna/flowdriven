import type { LimitWindow, RateLimit } from "../harness.ts";
import type { ModelUsage } from "../storage.ts";
import { CHROME_PREFIX } from "./browser.ts";
import { POST_TEXT, STOP } from "./browser-post.ts";
import { visible } from "./text.ts";

export const MAX_START_HOOK_EVENTS = 8;
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
export const LIMITS_NOT_APPLIED =
  "Claude Code did not apply the limits FlowDriven asked for. The step was stopped before it could act.";
export function tripSentence(tool: string): string {
  return `A tool ran without FlowDriven's check (${visible(tool, 60)}). The step was stopped.`;
}

export class LineReader {
  private tail = Buffer.alloc(0);
  private maxBytes: number;

  constructor(maxBytes = MAX_LINE_BYTES) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Uint8Array | string): { lines: string[]; overflow: boolean } {
    const bytes = Buffer.concat([this.tail, Buffer.from(chunk)]);
    const lines: string[] = [];
    let start = 0;
    let overflow = false;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 10) {
        if (i - start > this.maxBytes) overflow = true;
        lines.push(bytes.subarray(start, i).toString("utf8"));
        start = i + 1;
      }
    }
    this.tail = Buffer.from(bytes.subarray(start));
    if (this.tail.length > this.maxBytes) overflow = true;
    return { lines, overflow };
  }

  rest(): string {
    return this.tail.toString("utf8");
  }
}

export type StreamEvent = { type: string; [key: string]: unknown };
export function startHookEvent(event: StreamEvent): { is: false } | { is: true; failed: boolean } {
  if (
    event.type !== "system" ||
    (event.subtype !== "hook_started" && event.subtype !== "hook_response") ||
    event.hook_event !== "SessionStart"
  )
    return { is: false };
  return { is: true, failed: event.subtype === "hook_response" && event.exit_code !== 0 };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseEvent(line: string): StreamEvent | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return object(value) && typeof value.type === "string" ? { ...value, type: value.type } : undefined;
  } catch {
    return undefined;
  }
}
export function checkFirstEvent(
  event: StreamEvent | undefined,
  expect: { tools: string[]; schema: boolean; sessionId: string; started: boolean; browser?: boolean },
): { ok: true } | { ok: false; why: string } {
  const fail = (why: string): { ok: false; why: string } => ({ ok: false, why });
  if (!event || event.type !== "system" || event.subtype !== "init")
    return fail("The first event is not init.");
  if (!expect.started) return fail("The start hook did not run.");
  if (event.session_id !== expect.sessionId) return fail("The session id does not match.");
  if (expect.browser) {
    const servers = event.mcp_servers;
    const server = Array.isArray(servers) && servers.length === 1 ? servers.at(0) : undefined;
    if (!object(server) || server.name !== "claude-in-chrome" || server.status !== "connected")
      return fail(STOP.chromeDown);
  }
  const tools = event.tools;
  const expected = new Set(expect.tools);
  if (expect.schema) expected.add("StructuredOutput");
  const builtIn = Array.isArray(tools)
    ? tools.filter((tool: unknown) => typeof tool === "string" && !tool.startsWith(CHROME_PREFIX))
    : [];
  if (
    (!expect.schema && expected.has("StructuredOutput")) ||
    !Array.isArray(tools) ||
    tools.some((tool: unknown) => typeof tool !== "string") ||
    new Set(tools).size !== tools.length ||
    (expect.browser && !tools.some((tool: string) => tool.startsWith(CHROME_PREFIX))) ||
    (expect.browser ? builtIn.length : tools.length) !== expected.size ||
    (expect.browser ? builtIn : tools).some((tool: string) => !expected.has(tool))
  )
    return fail("The tools do not match.");
  for (const key of expect.browser
    ? ["skills", "slash_commands"]
    : ["mcp_servers", "skills", "slash_commands"]) {
    if (!Array.isArray(event[key]) || event[key].length !== 0) return fail(`${key} is not empty.`);
  }
  if (event.permissionMode !== "default") return fail("The permission mode is not default.");
  return { ok: true };
}
export type Tripwire = { check(event: StreamEvent): { tripped: false } | { tripped: true; tool: string } };
export function createTripwire(
  allowedIds: ReadonlySet<string>,
  chrome?: { ids: ReadonlySet<string>; posted: ReadonlyMap<string, string> },
): Tripwire {
  const names = new Map<string, string>();
  return {
    check(event) {
      const message = event.message;
      if (!object(message) || !Array.isArray(message.content)) return { tripped: false };
      for (const block of message.content as unknown[]) {
        if (!object(block)) continue;
        if (
          event.type === "assistant" &&
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        )
          names.set(block.id, block.name);
        if (event.type === "user" && block.type === "tool_result" && block.is_error !== true) {
          const id = block.tool_use_id;
          if (typeof id === "string" && chrome?.ids.has(id)) {
            const content = block.content;
            const first = Array.isArray(content) && content.length === 1 ? content.at(0) : undefined;
            const text =
              typeof content === "string"
                ? content
                : object(first) && first.type === "text" && typeof first.text === "string"
                  ? first.text
                  : undefined;
            if (text === undefined || (text !== POST_TEXT.unchecked && text !== chrome.posted.get(id)))
              return { tripped: true, tool: names.get(id) ?? "unknown" };
            continue;
          }
          if (typeof id !== "string" || !allowedIds.has(id))
            return { tripped: true, tool: typeof id === "string" ? (names.get(id) ?? "unknown") : "unknown" };
        }
      }
      return { tripped: false };
    },
  };
}
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(1e12, Math.floor(v)) : 0;
export function parseUsage(
  event: StreamEvent,
): { models: ModelUsage[]; turns: number; costUsd?: number } | undefined {
  if (event.type !== "result") return undefined;
  const entries: [string, unknown][] = object(event.modelUsage)
    ? Object.entries(event.modelUsage).slice(0, 20)
    : object(event.usage)
      ? [["unknown", event.usage]]
      : [];
  if (!object(event.modelUsage) && !object(event.usage)) return undefined;
  const models = entries.map(([name, value]) => {
    const v = object(value) ? value : {};
    const aggregate = !object(event.modelUsage);
    return {
      model: name.slice(0, 100) || "unknown",
      input: count(v[aggregate ? "input_tokens" : "inputTokens"]),
      output: count(v[aggregate ? "output_tokens" : "outputTokens"]),
      cacheRead: count(v[aggregate ? "cache_read_input_tokens" : "cacheReadInputTokens"]),
      cacheWrite: count(v[aggregate ? "cache_creation_input_tokens" : "cacheCreationInputTokens"]),
    };
  });
  return {
    models,
    turns: count(event.num_turns),
    ...(typeof event.total_cost_usd === "number" &&
    Number.isFinite(event.total_cost_usd) &&
    event.total_cost_usd >= 0
      ? { costUsd: event.total_cost_usd }
      : {}),
  };
}
export function parseRateLimit(event: StreamEvent, nowMs: number): RateLimit | undefined {
  if (
    event.type !== "rate_limit_event" ||
    !object(event.rate_limit_info) ||
    typeof event.rate_limit_info.status !== "string"
  )
    return undefined;
  const info = event.rate_limit_info;
  const window = (v: Record<string, unknown>): LimitWindow => ({
    ...(typeof v.utilization === "number" && Number.isFinite(v.utilization)
      ? { utilization: Math.max(0, Math.min(1, v.utilization)) }
      : {}),
    ...(typeof v.resetsAt === "number" &&
    Number.isFinite(v.resetsAt) &&
    v.resetsAt >= nowMs / 1000 &&
    v.resetsAt <= nowMs / 1000 + 8 * 86400
      ? { resetsAt: v.resetsAt }
      : {}),
    ...(typeof v.status === "string" ? { status: v.status } : {}),
  });
  const w = object(info.unifiedWindows) ? info.unifiedWindows : {};
  const top = window(info);
  return {
    status: info.status as string,
    ...(typeof info.rateLimitType === "string" ? { type: info.rateLimitType } : {}),
    ...(top.utilization === undefined ? {} : { utilization: top.utilization }),
    ...(top.resetsAt === undefined ? {} : { resetsAt: top.resetsAt }),
    windows: {
      ...(object(w.five_hour) ? { five_hour: window(w.five_hour) } : {}),
      ...(object(w.seven_day) ? { seven_day: window(w.seven_day) } : {}),
    },
  };
}
export type ResultInfo = {
  usage?: ReturnType<typeof parseUsage>;
  ok: boolean;
  text: string;
  structured?: unknown;
  apiErrorStatus?: number;
  authFailed: boolean;
  denials: number;
};
export function parseResult(event: StreamEvent): ResultInfo {
  const text = typeof event.result === "string" ? event.result : "";
  return {
    ...(parseUsage(event) === undefined ? {} : { usage: parseUsage(event) }),
    ok: event.subtype === "success" && event.is_error === false,
    text,
    ...(Object.hasOwn(event, "structured_output") ? { structured: event.structured_output } : {}),
    ...(typeof event.api_error_status === "number" ? { apiErrorStatus: event.api_error_status } : {}),
    authFailed: event.terminal_reason === "api_error" && text.startsWith("Not logged in"),
    denials: Array.isArray(event.permission_denials) ? event.permission_denials.length : 0,
  };
}
export function isAuthFailure(event: StreamEvent): boolean {
  return event.type === "assistant" && event.error === "authentication_failed";
}
export function isRateLimited(event: StreamEvent): boolean {
  return (
    event.type === "rate_limit_event" &&
    object(event.rate_limit_info) &&
    event.rate_limit_info.status === "rejected"
  );
}
