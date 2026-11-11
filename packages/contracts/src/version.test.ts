import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "./index";

test("runner API contract is version 1", () => {
  expect(CONTRACT_VERSION).toBe(1);
});

test("the node project runs in UTC", () => {
  expect(new Date(0).getTimezoneOffset()).toBe(0);
});
