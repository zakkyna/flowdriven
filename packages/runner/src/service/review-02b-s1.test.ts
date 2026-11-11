import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { serveRpc } from "./server.ts";

// A request whose id is so long that neither its answer nor the fallback
// "The answer is too large." fits in a frame makes write() throw inside the
// task; the task rejects, and when input ends while it is in flight the
// server's done never resolves (the runner never exits at end of stdin).
test("review S1: a request with a huge id still lets the server end", { timeout: 20_000 }, async () => {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  let text = "";
  fromServer.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  const server = serveRpc({
    input: toServer,
    output: fromServer,
    call: () => new Promise((resolve) => setTimeout(() => resolve("x".repeat(200)), 50)),
    knows: () => true,
    endWaitMs: 500,
  });
  const id = "i".repeat(1_048_576 - 60);
  const frame = JSON.stringify({ jsonrpc: "2.0", id, method: "ok" });
  expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(1_048_576);
  toServer.write(`${frame}\n`);
  toServer.end();
  const outcome = await Promise.race([
    server.done,
    new Promise((resolve) => setTimeout(() => resolve("still waiting after 3 s"), 3000)),
  ]);
  process.off("unhandledRejection", onRejection);
  expect(outcome).toBe("end");
  expect(rejections).toEqual([]);
  expect(text.length).toBeGreaterThan(0);
});
