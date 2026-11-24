import { expect, test } from "vitest";
import { canAlwaysAllow, RISKY_KINDS } from "./always-allow.ts";

test("TC-j24-50 all 81 combinations allow only a fixed change from the window", () => {
  const effects = [
    "read",
    "local_write",
    "run_command",
    "change",
    "send",
    "post",
    "pay",
    "delete",
    "merge",
  ] as const;
  const places = ["fixed", "none", "outside"] as const;
  const callers = ["window", "tool", "phone"] as const;
  const rows = effects.flatMap((effect) =>
    places.flatMap((place) =>
      callers.map((caller) => ({
        effect,
        place,
        caller,
        allowed: canAlwaysAllow({ effect, place, caller }),
      })),
    ),
  );
  expect(rows).toHaveLength(81);
  expect(rows.filter((row) => row.allowed)).toEqual([
    { effect: "change", place: "fixed", caller: "window", allowed: true },
  ]);
  expect(RISKY_KINDS).toEqual(["send", "post", "pay", "delete", "merge"]);
  for (const effect of RISKY_KINDS)
    expect(rows.filter((row) => row.effect === effect && !row.allowed)).toHaveLength(9);
});
