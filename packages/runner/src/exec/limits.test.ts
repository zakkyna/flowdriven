import { expect, test } from "vitest";
import { limits } from "./limits.ts";

const step = (retry: number, effort?: "low" | "medium" | "high", cap?: number) =>
  ({
    do: "worker",
    retry,
    ...(effort ? { worker: { effort } } : {}),
    ...(cap ? { limits: { max_attempts: cap } } : {}),
  }) as never;
const flow = {} as never;
test("a low step gets one more attempt, at medium, before the re-plan, when max_attempts leaves room for both", () => {
  expect(limits(step(1, "low"), flow)).toMatchObject({ attempts: 4, mediumAt: 3, replanAt: 4 });
  expect(limits(step(1, "low", 4), flow)).toMatchObject({ attempts: 4, mediumAt: 3, replanAt: 4 });
  expect(limits(step(1, "medium"), flow)).toMatchObject({ attempts: 3, replanAt: 3 });
  expect(limits(step(1, "medium"), flow).mediumAt).toBeUndefined();
  expect(limits(step(1), flow)).toMatchObject({ attempts: 3, replanAt: 3 });
});
test("with less room the re-plan keeps its attempt and the medium attempt is dropped", () => {
  expect(limits(step(1, "low", 3), flow)).toMatchObject({ attempts: 3, replanAt: 3 });
  expect(limits(step(1, "low", 3), flow).mediumAt).toBeUndefined();
  expect(limits(step(1, "low", 2), flow)).toMatchObject({ attempts: 2, replanAt: 3 });
  expect(limits(step(1, "medium", 2), flow)).toMatchObject({ attempts: 2, replanAt: 3 });
});
