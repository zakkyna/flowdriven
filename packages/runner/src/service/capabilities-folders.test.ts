import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createCapabilities } from "./capabilities.ts";

const stores: Store[] = [];
const homes: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const hash = `sha256:${"1".repeat(64)}`;
async function setup(ref = "~/work") {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "folder-caps-")));
  homes.push(home);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [
      { id: "work", type: "path", ref, access: "read_write" },
      { id: "notes", type: "path", ref: "~/notes", access: "read" },
    ],
    steps: [{ id: "worker", do: "worker", instructions: "Work", uses: ["work"] }],
  });
  store.putFlow({ id: manifest.id, version: "1", hash, manifest, files: {}, registeredAt: "2026-11-12" });
  const caps = createCapabilities({
    store,
    now: () => new Date("2026-11-12T00:00:00Z"),
    facts: () => ({ hooks: true, chrome: false }),
    home,
    dataDir: join(home, "data", "FlowDriven"),
  });
  const allow = () => {
    const rows = caps.get("local.test").rows;
    const pins = Object.fromEntries(rows.map((row) => [row.requirementId, row.pin ?? ""]));
    return caps.allow("local.test", hash, pins);
  };
  return { home, store, caps, allow };
}
test("every declared extra folder is pinned with its resolved path, and the allow stores it with its access", async () => {
  const { home, store, caps, allow } = await setup();
  expect(caps.get("local.test").rows[0]).toMatchObject({
    pin: join(home, "work"),
    details: [join(home, "work"), "You can take this back with Withdraw."],
  });
  allow();
  expect(store.getCapabilityConsent("local.test")?.pins).toEqual({
    skills: {},
    folders: {
      work: { path: join(home, "work"), access: "read_write" },
      notes: { path: join(home, "notes"), access: "read" },
    },
  });
});
test("allow writes one folder_granted row per folder, and Withdraw writes one folder_revoked row per pinned folder", async () => {
  const { home, store, caps, allow } = await setup();
  allow();
  caps.withdraw("local.test");
  for (const kind of ["folder_granted", "folder_revoked"]) {
    const rows = store.listAudit().filter((row) => row.kind === kind);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        { flowId: "local.test", requirementId: "work", path: join(home, "work"), access: "read_write" },
        { flowId: "local.test", requirementId: "notes", path: join(home, "notes"), access: "read" },
      ]),
    );
  }
});
test("consentOf is stale when the folder's symlink now points elsewhere", async () => {
  const { home, caps, allow } = await setup();
  mkdirSync(join(home, "one"));
  mkdirSync(join(home, "two"));
  symlinkSync(join(home, "one"), join(home, "work"));
  allow();
  rmSync(join(home, "work"));
  symlinkSync(join(home, "two"), join(home, "work"));
  expect(caps.consentOf("local.test")).toBe("stale");
});
test("a declared extra folder that does not resolve is a dropped row with its reason and blocks the allow", async () => {
  const { caps, home } = await setup("~/work");
  symlinkSync(join(home, "missing"), join(home, "work"));
  const preview = caps.get("local.test");
  expect(preview.rows[0]).toMatchObject({ routed: false, reason: expect.any(String) });
  expect(preview.allowBlocked).toBeTruthy();
  expect(() => caps.allow("local.test", hash)).toThrow();
});
