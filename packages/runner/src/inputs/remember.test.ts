import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { rememberStore } from "./remember.ts";

test("TC-STO-27 remembered answers are keyed by flow, kind and input", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const remembered = rememberStore(store);
    const row = {
      flowId: "f",
      inputId: "customer",
      kind: "remember",
      value: { type: "text", value: "Example Corp" },
      outside: true,
      savedAt: "2026",
      runId: "r",
    } as const;
    remembered.save(row);
    remembered.save({ ...row, value: { type: "text", value: "Other Corp" } });
    remembered.save({ ...row, kind: "last" });
    expect(remembered.read("f")).toHaveLength(2);
    expect(remembered.read("f")).toContainEqual({ ...row, value: { type: "text", value: "Other Corp" } });
    store.deleteFlowData("f");
    expect(remembered.read("f")).toEqual([]);
  } finally {
    store.close();
  }
});
