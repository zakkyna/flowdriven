import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { serveRpc } from "./server.ts";

// Server rule: every request with an id gets exactly one answer. A call that
// resolves with a value JSON cannot encode (BigInt, a cycle) or with undefined
// gets no answer, or an answer with no "result" member (which the app's link
// treats as a protocol failure and kills the runner for).
test("review S2: results JSON cannot encode still get one valid answer", { timeout: 20_000 }, async () => {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  let text = "";
  fromServer.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const values: Record<string, unknown> = { big: 1n, cycle, none: undefined };
  serveRpc({
    input: toServer,
    output: fromServer,
    call: async (method) => values[method],
    knows: () => true,
  });
  let id = 0;
  for (const method of Object.keys(values))
    toServer.write(`${JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: {} })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const frames = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  for (const n of [1, 2, 3]) {
    const answers = frames.filter((f) => f.id === n);
    expect(answers, `answers for id ${n}`).toHaveLength(1);
    expect(Object.hasOwn(answers.at(0) ?? {}, "result") || Object.hasOwn(answers.at(0) ?? {}, "error")).toBe(
      true,
    );
  }
});
