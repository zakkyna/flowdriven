import { afterEach, expect, test } from "vitest";
import { cleanup } from "./test-helpers/tmp.ts";
import { triggerFlow, triggerRig } from "./test-helpers/trigger-rig.ts";

afterEach(cleanup);
test("the daily cap follows the injected day function, not the UTC day", async () => {
  const r = await triggerRig([
    {
      manifest: triggerFlow("local.day", [{ kind: "schedule", every: "1h" }], {
        limits: { max_runs_per_day: 1 },
      }),
    },
  ]);
  let day = "a";
  r.setDay(() => day);
  const options = { project: r.project, trigger: { kind: "schedule" } };
  await r.engine.beginStart("local.day", options).settled;
  expect(() => r.engine.beginStart("local.day", options)).toThrow("Daily run limit reached.");
  day = "b";
  await r.engine.beginStart("local.day", options).settled;
  expect(r.runsOf("local.day")).toHaveLength(2);
});
