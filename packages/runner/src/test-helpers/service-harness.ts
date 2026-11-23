import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { createClock, createIdGenerator } from "./clock.ts";

export async function createServiceHarness(
  testFolder: string,
  options: {
    caller?: "window" | "tool" | "phone";
    instant?: string;
    zone?: string;
    languages?: readonly string[];
  } = {},
) {
  const dataDir = await mkdtemp(join(testFolder, "runner-"));
  try {
    const store = await openSqliteStore(join(dataDir, "flowdriven.sqlite"));
    try {
      const clock = createClock(options.instant ?? "2026-11-19T10:00:00.000Z", options.zone);
      const newId = createIdGenerator();
      const service = createRunnerService({
        store,
        dataDir,
        mode: "demo",
        languages: options.languages ?? ["en", "id"],
        now: clock.now,
        newId,
      });
      try {
        await service.start().settled;
      } catch (error) {
        service.stop();
        throw error;
      }
      return {
        dataDir,
        store,
        service,
        clock,
        newId,
        call: (name: string, input: unknown) => service.call(name, input, options.caller),
        async close() {
          service.stop();
          store.close();
          await rm(dataDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      store.close();
      throw error;
    }
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
