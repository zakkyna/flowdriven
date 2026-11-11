import { z } from "zod";
import "./config.ts";
import { RunnerEvent } from "./client.ts";
import { Notice } from "./notice.ts";
import { RUNNER_ERROR_CODES, type RunnerErrorCode } from "./operations.ts";

export const MAX_FRAME_BYTES = 1_048_576;
export const RpcId = z.union([z.string().min(1), z.number().int()]);
export const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: RpcId.optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type RpcRequest = z.infer<typeof RpcRequest>;
export const RpcErrorBody = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.object({ code: z.enum(RUNNER_ERROR_CODES) }),
});
export const RpcResult = z
  .object({ jsonrpc: z.literal("2.0"), id: RpcId, result: z.unknown() })
  .refine((value) => "result" in value);
export const RpcFailure = z.object({ jsonrpc: z.literal("2.0"), id: RpcId.nullable(), error: RpcErrorBody });
export const RpcAnswer = z.union([RpcResult, RpcFailure]);
export type RpcAnswer = z.infer<typeof RpcAnswer>;
export const RpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("event"),
  params: RunnerEvent,
});
export type RpcNotification = z.infer<typeof RpcNotification>;
export const RpcNoticeFrame = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("notice"),
  params: Notice,
});
export type RpcNoticeFrame = z.infer<typeof RpcNoticeFrame>;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_ERROR_NUMBERS: Record<RunnerErrorCode, number> = {
  invalid_input: -32602,
  not_found: -32001,
  not_allowed: -32002,
  unavailable: -32003,
};
export function rpcResult(id: string | number, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
export function rpcFailure(
  id: string | number | null,
  code: RunnerErrorCode,
  message: string,
  number = RPC_ERROR_NUMBERS[code],
) {
  return { jsonrpc: "2.0" as const, id, error: { code: number, message, data: { code } } };
}
export class FrameError extends Error {
  code: "too_long" | "bad_json" | "not_object";
  constructor(code: FrameError["code"], message: string) {
    super(message);
    this.name = "FrameError";
    this.code = code;
  }
}
export function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}
export function encodeFrame(value: unknown, maxBytes = MAX_FRAME_BYTES): string {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new FrameError("not_object", "Value cannot be encoded.");
  if (utf8Length(text) > maxBytes) throw new FrameError("too_long", "Frame is too long.");
  return `${text}\n`;
}
export function parseFrame(line: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new FrameError("bad_json", "Invalid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new FrameError("not_object", "Frame is not an object.");
  return value as Record<string, unknown>;
}
export class LineFramer {
  private tail = "";
  private bytes = 0;
  private high = "";
  private maxBytes: number;
  constructor(maxBytes = MAX_FRAME_BYTES) {
    this.maxBytes = maxBytes;
  }
  push(text: string): string[] {
    text = this.high + text;
    this.high = "";
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      this.high = text.slice(-1);
      text = text.slice(0, -1);
    }
    const parts = text.split("\n");
    const lines: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts.at(i) ?? "";
      this.bytes += utf8Length(part);
      if (this.bytes > this.maxBytes) throw new FrameError("too_long", "Frame is too long.");
      this.tail += part;
      if (i < parts.length - 1) {
        if (this.tail) lines.push(this.tail);
        this.tail = "";
        this.bytes = 0;
      }
    }
    return lines;
  }
}
