import { expect, test } from "vitest";
import {
  BUDGET_WARN_RATIO,
  budgetStatus,
  COST_PREVIEW_RATIO,
  DEFAULT_KEEPER,
  KeeperSettings,
  Settings,
  SettingsPatch,
  sortByRisk,
} from "./index";

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

test("the keeper's defaults are the design's starting values", () => {
  expect(DEFAULT_KEEPER).toEqual({
    ceiling: 4,
    reserveMb: null,
    quotaLines: { fiveHour: 0.9, sevenDay: 0.9 },
    effortModels: { "claude-code": { low: "haiku", medium: "sonnet", high: "opus" } },
  });
});
test("the keeper's bounds", () => {
  expect(KeeperSettings.safeParse({ ceiling: 0 }).success).toBe(false);
  expect(KeeperSettings.safeParse({ quotaLines: { fiveHour: 0.2 } }).success).toBe(false);
  expect(
    KeeperSettings.safeParse({
      effortModels: { "claude-code": { low: "--yolo", medium: "sonnet", high: "opus" } },
    }).success,
  ).toBe(false);
  expect(SettingsPatch.parse({ keeper: { ceiling: 1 } }).keeper).toEqual({ ceiling: 1 });
  expect(SettingsPatch.parse({ keeper: { quotaLines: { sevenDay: 0.8 } } }).keeper).toEqual({
    quotaLines: { sevenDay: 0.8 },
  });
});
test("settings carry the keeper", () => {
  expect(Settings.shape.keeper).toBeDefined();
});
