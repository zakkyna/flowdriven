import { visible } from "./text.ts";

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
  expect: { tools: string[]; schema: boolean; sessionId: string; started: boolean },
): { ok: true } | { ok: false; why: string } {
  const fail = (why: string): { ok: false; why: string } => ({ ok: false, why });
  if (!event || event.type !== "system" || event.subtype !== "init")
    return fail("The first event is not init.");
  if (!expect.started) return fail("The start hook did not run.");
  if (event.session_id !== expect.sessionId) return fail("The session id does not match.");
  const tools = event.tools;
  const expected = new Set(expect.tools);
  if (expect.schema) expected.add("StructuredOutput");
  if (
    (!expect.schema && expected.has("StructuredOutput")) ||
    !Array.isArray(tools) ||
    tools.some((tool: unknown) => typeof tool !== "string") ||
    new Set(tools).size !== tools.length ||
    tools.length !== expected.size ||
    tools.some((tool: string) => !expected.has(tool))
  )
    return fail("The tools do not match.");
  for (const key of ["mcp_servers", "skills", "slash_commands"]) {
    if (!Array.isArray(event[key]) || event[key].length !== 0) return fail(`${key} is not empty.`);
  }
  if (event.permissionMode !== "default") return fail("The permission mode is not default.");
  return { ok: true };
}
export type Tripwire = { check(event: StreamEvent): { tripped: false } | { tripped: true; tool: string } };
export function createTripwire(allowedIds: ReadonlySet<string>): Tripwire {
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
          if (typeof id !== "string" || !allowedIds.has(id))
            return { tripped: true, tool: typeof id === "string" ? (names.get(id) ?? "unknown") : "unknown" };
        }
      }
      return { tripped: false };
    },
  };
}
export type ResultInfo = {
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
