import { expect, test } from "vitest";

test("the ui project runs in UTC", () => {
  expect(new Date(0).getTimezoneOffset()).toBe(0);
});
