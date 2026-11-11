import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { serveRpc } from "./server.ts";

// notify() ignores the writable's backpressure: when the reader (the app) is
// slow or stalled, every "changed" event is queued in the runner's memory,
// although such events only say "reload" and could be coalesced or dropped.
test("review S3: events to a reader that does not read do not queue without limit", () => {
  const toServer = new PassThrough();
  const fromServer = new PassThrough(); // nobody reads it
  const server = serveRpc({ input: toServer, output: fromServer, call: async () => ({}), knows: () => true });
  for (let i = 0; i < 50_000; i++) server.notify({ type: "changed", topics: ["runs"] });
  expect(fromServer.writableLength).toBeLessThanOrEqual(1_048_576);
});
