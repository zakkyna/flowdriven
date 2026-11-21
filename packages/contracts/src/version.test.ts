import { expect, test } from "vitest";
import { CONTRACT_VERSION, checkContractVersion, isSupportedContractVersion, operations } from "./index";

test("TC-j01-11 runner API contract is version 2 and only version 2 is supported", () => {
  expect(CONTRACT_VERSION).toBe(2);
  expect([1, 2, 3].map(isSupportedContractVersion)).toEqual([false, true, false]);
});

test("TC-CON-01 checks the contract version", () => {
  expect(CONTRACT_VERSION).toBe(2);
  expect([2, 1, 3, "2", undefined, 2.5].map(checkContractVersion)).toEqual([
    "ok",
    "contract_mismatch",
    "contract_mismatch",
    "contract_mismatch",
    "contract_mismatch",
    "contract_mismatch",
  ]);
});

test("TC-CON-01 runner.info accepts a mismatched version for checking", () => {
  expect(
    operations["runner.info"].output.safeParse({
      contractVersion: 1,
      appVersion: "0.1.0",
      storeVersion: 6,
      mode: "live",
    }).success,
  ).toBe(true);
});

test("the node project runs in UTC", () => {
  expect(new Date(0).getTimezoneOffset()).toBe(0);
});
