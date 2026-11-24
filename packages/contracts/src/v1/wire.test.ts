import { describe, expect, test } from "vitest";
import {
  encodeFrame,
  LineFramer,
  MAX_FRAME_BYTES,
  parseFrame,
  RPC_ERROR_NUMBERS,
  RpcAnswer,
  RpcNotification,
  RpcRequest,
  utf8Length,
} from "./wire.ts";

describe("wire", () => {
  test("a frame is one JSON object on one line and at most 1,048,576 bytes", () => {
    expect(encodeFrame({ a: 1 })).toBe('{"a":1}\n');
    expect(MAX_FRAME_BYTES).toBe(1_048_576);
    expect(() => encodeFrame("a".repeat(19), 20)).toThrowError(expect.objectContaining({ code: "too_long" }));
    expect(utf8Length(String.fromCodePoint(0x1f600))).toBe(4);
  });
  test("the line framer splits chunks, counts bytes and refuses a long line before it ends", () => {
    const f = new LineFramer();
    expect(f.push("a\nb")).toEqual(["a"]);
    expect(f.push("c\n\n")).toEqual(["bc"]);
    const emoji = String.fromCodePoint(0x1f600);
    const split = new LineFramer(4);
    expect(split.push(emoji.slice(0, 1))).toEqual([]);
    expect(split.push(`${emoji.slice(1)}\n`)).toEqual([emoji]);
    expect(() => new LineFramer(8).push("123456789")).toThrowError(
      expect.objectContaining({ code: "too_long" }),
    );
    expect(() => new LineFramer(8).push("123456789\n")).toThrowError(
      expect.objectContaining({ code: "too_long" }),
    );
    expect(new LineFramer().push("a\nb\n")).toEqual(["a", "b"]);
  });
  test("a frame that is not a JSON object is refused", () => {
    expect(() => parseFrame("{")).toThrowError(expect.objectContaining({ code: "bad_json" }));
    for (const line of ["[1]", "null", "1", '"x"'])
      expect(() => parseFrame(line)).toThrowError(expect.objectContaining({ code: "not_object" }));
  });
  test("the request, answer and notification schemas", () => {
    expect(RpcRequest.safeParse({ jsonrpc: "2.0", method: "x" }).success).toBe(true);
    expect(RpcRequest.safeParse({ jsonrpc: "2.0", method: "x", id: null }).success).toBe(false);
    expect(RpcAnswer.safeParse({ jsonrpc: "2.0", id: 1, result: { ok: true } }).success).toBe(true);
    expect(RpcAnswer.safeParse({ jsonrpc: "2.0", id: 1, result: null }).success).toBe(true);
    expect(
      RpcAnswer.safeParse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -1, message: "x", data: { code: "not_found" } },
      }).success,
    ).toBe(true);
    expect(RpcAnswer.safeParse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } }).success).toBe(
      false,
    );
    expect(
      RpcNotification.safeParse({
        jsonrpc: "2.0",
        method: "event",
        params: { type: "changed", topics: ["runs"] },
      }).success,
    ).toBe(true);
    expect(RPC_ERROR_NUMBERS).toEqual({
      invalid_input: -32602,
      not_found: -32001,
      not_allowed: -32002,
      unavailable: -32003,
    });
  });
});
