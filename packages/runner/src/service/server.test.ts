import { PassThrough } from "node:stream";
import { RunnerError } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { connectRpcClient } from "../test-helpers/rpc-client.ts";
import { serveRpc } from "./server.ts";

function setup(
  call: (method: string, params: Record<string, unknown>) => Promise<unknown> = async (_method, params) =>
    params,
  options: { maxFrameBytes?: number; endWaitMs?: number } = {},
) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  let text = "";
  fromServer.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const server = serveRpc({
    input: toServer,
    output: fromServer,
    call,
    knows: (name) => name === "ok" || name === "runner.info",
    ...options,
  });
  return {
    toServer,
    fromServer,
    server,
    frames: () =>
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
const request = (id: number, method = "ok", params: Record<string, unknown> = {}) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a request gets one answer with its result", async () => {
  const s = setup();
  const client = connectRpcClient({ input: s.fromServer, output: s.toServer });
  await expect(client.call("runner.info", {})).resolves.toEqual({});
  const value = String.fromCodePoint(0xe9, 0x1f600);
  for (const byte of Buffer.from(request(55, "ok", { value }))) s.toServer.write(Buffer.from([byte]));
  await tick();
  expect(s.frames()).toContainEqual({ jsonrpc: "2.0", id: 55, result: { value } });
  client.close();
  await s.server.done;
});
test("errors carry their code in data and a number", async () => {
  const s = setup(async (_m, p) => {
    if (p.known) throw new RunnerError("not_found", "x");
    throw new Error("boom");
  });
  s.toServer.write(request(1, "ok", { known: true }) + request(2));
  await tick();
  expect(s.frames()).toEqual([
    { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "x", data: { code: "not_found" } } },
    {
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32003, message: "Internal error", data: { code: "unavailable" } },
    },
  ]);
  expect(JSON.stringify(s.frames())).not.toContain("boom");
  s.toServer.end();
  await s.server.done;
});
test("an unknown method is -32601 and an invalid request is -32600 with a null id, and the server goes on", async () => {
  const s = setup();
  s.toServer.write(request(1, "unknown") + '{"jsonrpc":"2.0","id":null,"method":"ok"}\n' + request(2));
  await tick();
  expect(s.frames()).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found", data: { code: "not_found" } },
    },
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid request", data: { code: "invalid_input" } },
    },
    { jsonrpc: "2.0", id: 2, result: {} },
  ]);
  s.toServer.end();
  await s.server.done;
});
test("a line that is not a JSON object, or is too long, is answered once with -32600 and ends the connection", async () => {
  for (const line of ["[]\n", "a".repeat(65)]) {
    const s = setup(undefined, { maxFrameBytes: 64 });
    s.toServer.write(line);
    expect(await s.server.done).toBe("protocol_error");
    s.toServer.write(request(1));
    await tick();
    expect(s.frames()).toEqual([
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid frame", data: { code: "invalid_input" } },
      },
    ]);
  }
});
test("events are notifications and the end of input ends the server after the answers in flight", {
  timeout: 20_000,
}, async () => {
  let finish: (value: unknown) => void = () => {};
  const s = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = connectRpcClient({ input: s.fromServer, output: s.toServer });
  const events: unknown[] = [];
  client.subscribe((event) => events.push(event));
  s.server.notify({ type: "changed", topics: ["runs"] });
  expect(events).toEqual([{ type: "changed", topics: ["runs"] }]);
  const result = client.call("runner.info", {});
  s.toServer.end();
  await tick();
  finish({ done: true });
  await expect(result).resolves.toEqual({ done: true });
  expect(await s.server.done).toBe("end");
  const before = s.frames().length;
  s.server.notify({ type: "changed", topics: ["runs"] });
  expect(s.frames()).toHaveLength(before);
  const stuck = setup(() => new Promise(() => {}), { endWaitMs: 20 });
  stuck.toServer.end(request(1));
  expect(await stuck.server.done).toBe("end");
});
test("requests run concurrently and each id gets exactly one answer", async () => {
  let finish: (value: unknown) => void = () => {};
  const s = setup(async (_m, p) =>
    p.slow
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : "fast",
  );
  s.toServer.write(request(1, "ok", { slow: true }) + request(2));
  await tick();
  expect(s.frames()).toEqual([{ jsonrpc: "2.0", id: 2, result: "fast" }]);
  finish("slow");
  await tick();
  expect(s.frames()).toEqual([
    { jsonrpc: "2.0", id: 2, result: "fast" },
    { jsonrpc: "2.0", id: 1, result: "slow" },
  ]);
  s.toServer.end();
  await s.server.done;
});
test("an answer over the limit becomes unavailable", async () => {
  const s = setup(async () => "x".repeat(500), { maxFrameBytes: 128 });
  s.toServer.end(request(1));
  await s.server.done;
  expect(s.frames()).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32003, message: "The answer is too large.", data: { code: "unavailable" } },
    },
  ]);
});
