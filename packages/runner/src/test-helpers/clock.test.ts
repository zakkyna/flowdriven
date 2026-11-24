import { expect, test } from "vitest";
import { createClock, createIdGenerator } from "./clock.ts";

test("clock exposes the instant and zone and can advance", () => {
  const clock = createClock("2026-11-19T10:00:00.000Z", "Asia/Bangkok");
  expect(clock.zone).toBe("Asia/Bangkok");
  expect(clock.now().toISOString()).toBe("2026-11-19T10:00:00.000Z");
  clock.advance(1000);
  expect(clock.now().toISOString()).toBe("2026-11-19T10:00:01.000Z");
  expect(createClock("2026-11-19T10:00:00.000Z").zone).toBe("UTC");
});

test("ids count separately by prefix", () => {
  const id = createIdGenerator();
  expect(id("run")).toBe("run-000000000001");
  expect(id("ap")).toBe("ap-000000000001");
  expect(id("run")).toBe("run-000000000002");
});
