import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { storeFaults } from "./store-faults.ts";

test("a named store fault rolls back the enclosing transaction", async () => {
  const fault = storeFaults();
  const store = await openSqliteStore(":memory:", { afterWrite: fault.afterWrite });
  try {
    fault.failAfter("audit_log");
    expect(() =>
      store.transaction(() => {
        store.putSetting("example", "saved");
        store.appendAudit({ at: "2026", kind: "example", detail: {} });
      }),
    ).toThrow("store fault: audit_log");
    expect(store.getSetting("example")).toBeUndefined();
    expect(store.listAudit()).toEqual([]);
    fault.clear();
    store.transaction(() => {
      store.putSetting("example", "saved");
      store.appendAudit({ at: "2026", kind: "example", detail: {} });
    });
    expect(store.getSetting("example")).toBe("saved");
    expect(store.listAudit()).toHaveLength(1);
  } finally {
    store.close();
  }
});
