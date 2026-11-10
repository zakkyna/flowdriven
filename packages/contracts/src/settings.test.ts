import { expect, test } from "vitest";
import { BUDGET_WARN_RATIO, budgetStatus, COST_PREVIEW_RATIO, sortByRisk } from "./index";

const b = (capUsd: number, spentUsd: number) => ({ month: "2026-11", capUsd, perRunCapUsd: null, spentUsd });
test("budget levels follow 0, 80% and 100%", () => {
  expect(BUDGET_WARN_RATIO).toBe(0.8);
  expect(COST_PREVIEW_RATIO).toBe(0.1);
  expect(budgetStatus(b(0, 0)).level).toBe("off");
  expect(budgetStatus(b(20, 15.99)).level).toBe("ok");
  expect(budgetStatus(b(20, 16)).level).toBe("warn");
  expect(budgetStatus(b(20, 20)).level).toBe("stopped");
  expect(budgetStatus(b(20, 16.4)).ratio).toBeCloseTo(0.82);
});
test("official routes sort first, stable inside a label", () => {
  const items = [
    { id: "a", risk: "gray" },
    { id: "b", risk: "official" },
    { id: "c", risk: "unofficial" },
    { id: "d", risk: "official" },
  ] as const;
  expect(sortByRisk([...items]).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
});
