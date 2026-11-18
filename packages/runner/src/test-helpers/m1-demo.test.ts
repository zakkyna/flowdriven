import { expect, test } from "vitest";
import { runM1Demo } from "./m1-demo-run.ts";

test("the M1 demo prints its eleven lines", { timeout: 60_000 }, async () => {
  expect(await runM1Demo()).toEqual([
    "alerts: 3 jobs",
    "scored: 3, pages read: 2",
    "fit: 1",
    "pick: 1 job",
    "plan: approved as your own words",
    "skill copy: name and description only",
    "build: 7 commands allowed in the job's folder, 0 refused",
    "proposal: passed checks and your sign-off",
    "run: done",
    "sends: 0, held calls: 0",
    "second run: 3 jobs seen, 0 scored",
  ]);
});
