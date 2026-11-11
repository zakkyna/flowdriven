import { expect, test } from "vitest";
import { parseEvent, parseRateLimit, parseUsage } from "./stream.ts";

const result =
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"total_cost_usd":0.00030814,"usage":{"input_tokens":4,"cache_creation_input_tokens":156,"cache_read_input_tokens":8454,"output_tokens":384},"modelUsage":{"claude-haiku-5-5":{"inputTokens":4,"outputTokens":384,"cacheReadInputTokens":8454,"cacheCreationInputTokens":156}},"result":"used 10 tokens"}';
const limit =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1794654000,"rateLimitType":"seven_day","utilization":0.78,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.29,"resetsAt":1794396000,"status":"allowed"},"seven_day":{"utilization":0.78,"resetsAt":1794654000,"status":"allowed_warning"}}}}';
const NOW = Date.parse("2026-11-11T09:00:00.000Z");
const ev = (line: string) => {
  const e = parseEvent(line);
  if (!e) throw new Error("bad line");
  return e;
};
test("the result event gives tokens per model, turns and cost, and the worker's text is not read", () => {
  expect(parseUsage(ev(result))).toEqual({
    models: [{ model: "claude-haiku-5-5", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 }],
    turns: 2,
    costUsd: 0.00030814,
  });
});
test("without modelUsage the aggregate usage is one model named unknown; junk counts become 0", () => {
  const e = ev(
    '{"type":"result","usage":{"input_tokens":5,"output_tokens":"many","cache_read_input_tokens":-3}}',
  );
  expect(parseUsage(e)).toEqual({
    models: [{ model: "unknown", input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }],
    turns: 0,
  });
  expect(parseUsage(ev('{"type":"result"}'))).toBeUndefined();
  expect(parseUsage(ev('{"type":"assistant","usage":{"input_tokens":1}}'))).toBeUndefined();
});
test("the rate-limit event gives the status, the type and both windows", () => {
  expect(parseRateLimit(ev(limit), NOW)).toEqual({
    status: "allowed_warning",
    type: "seven_day",
    utilization: 0.78,
    resetsAt: 1794654000,
    windows: {
      five_hour: { utilization: 0.29, resetsAt: 1794396000, status: "allowed" },
      seven_day: { utilization: 0.78, resetsAt: 1794654000, status: "allowed_warning" },
    },
  });
  expect(
    parseRateLimit(ev('{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}'), NOW),
  ).toEqual({ status: "rejected", windows: {} });
  expect(parseRateLimit(ev('{"type":"result"}'), NOW)).toBeUndefined();
});
test("sanitises what the stream says", () => {
  const big =
    '{"type":"result","num_turns":2.7,"total_cost_usd":-1,"modelUsage":{"' +
    "m".repeat(150) +
    '":{"inputTokens":1.9,"outputTokens":-4,"cacheReadInputTokens":1e30,"cacheCreationInputTokens":"x"}}}';
  const u = parseUsage(ev(big));
  expect(u?.models).toEqual([
    { model: "m".repeat(100), input: 1, output: 0, cacheRead: 1e12, cacheWrite: 0 },
  ]);
  expect(u?.turns).toBe(2);
  expect(u?.costUsd).toBeUndefined();
  const many =
    '{"type":"result","modelUsage":{' +
    Array.from({ length: 30 }, (_, i) => `"m${i}":{"inputTokens":1}`).join(",") +
    "}}";
  expect(parseUsage(ev(many))?.models).toHaveLength(20);
  const r = parseRateLimit(
    ev(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","utilization":7,"resetsAt":99999999999999,"unifiedWindows":{"seven_day":{"utilization":-2,"resetsAt":1}}}}',
    ),
    NOW,
  );
  expect(r).toEqual({ status: "allowed", utilization: 1, windows: { seven_day: { utilization: 0 } } });
});
