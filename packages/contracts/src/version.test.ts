import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "./index";

test("runner API contract is version 0", () => {
  expect(CONTRACT_VERSION).toBe(0);
});

test("the node project runs in UTC", () => {
  expect(new Date(0).getTimezoneOffset()).toBe(0);
});
