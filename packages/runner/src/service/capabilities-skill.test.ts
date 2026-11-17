import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { readSkillFolder, skillSource } from "../skills/skill-folder.ts";
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
async function setup() {
  const home = mkdtempSync(join(tmpdir(), "flowdriven-skill-"));
  homes.push(home);
  const dir = join(home, ".claude", "skills", "writer");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  const write = (body: string) => writeFileSync(file, `---\nname: writer\ndescription: Writes\n---\n${body}`);
  write("Hello");
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [{ id: "writer", type: "skill", ref: "claude-code:writer" }],
    steps: [{ id: "worker", do: "worker", instructions: "Write", uses: ["writer"] }],
  });
  store.putFlow({ id: manifest.id, version: "1", hash, manifest, files: {}, registeredAt: "2026-11-12" });
  const readSkill = (ref: string | undefined) => {
    const source = skillSource(ref, { home });
    return source?.kind === "installed"
      ? readSkillFolder(source.dir, source.name)
      : { ok: false as const, reason: "Cannot read." };
  };
  const caps = createCapabilities({
    store,
    now: () => new Date("2026-11-12T00:00:00Z"),
    facts: () => ({ hooks: true, chrome: false, skills: ["writer"] }),
    readSkill,
  });
  return { caps, store, file, write, readSkill };
}
test("the skill row carries its hash as pin, its size as cost, and the details Version <first 12 hex>, <n> files, <n> characters, changed <date>", async () => {
  const { caps, readSkill } = await setup();
  const result = readSkill("claude-code:writer");
  if (!result.ok) throw new Error(result.reason);
  const row = caps.get("local.test").rows[0];
  expect(row).toMatchObject({
    pin: result.skill.hash,
    cost: "Adds about 100 tokens to each call of the step that uses it.",
    details: [
      `Version ${result.skill.hash.slice(7, 19)}, 1 files, 5 characters, changed ${result.skill.modifiedAt}`,
    ],
  });
});
test("a claude-code or flow skill that cannot be read is a dropped row with the reading reason, and the allow is blocked; a skill with no ref does not block the allow", async () => {
  const { caps, file, store } = await setup();
  rmSync(file);
  const preview = caps.get("local.test");
  expect(preview.rows[0]).toMatchObject({ routed: false, reason: "This skill has no SKILL.md file." });
  expect(preview.allowBlocked).toBeTruthy();
  expect(() => caps.allow("local.test", hash)).toThrow();
  const flow = store.getFlow("local.test");
  if (!flow) throw new Error("Missing flow");
  for (const ref of ["flow:writer", undefined]) {
    const manifest = FlowManifest.parse({
      ...FlowManifest.parse(flow.manifest),
      requirements: [{ id: "writer", type: "skill", ...(ref ? { ref } : {}) }],
    });
    store.putFlow({ ...flow, manifest });
    const next = caps.get("local.test");
    if (ref) {
      expect(next.rows[0]).toMatchObject({ routed: false, reason: "Cannot read." });
      expect(next.allowBlocked).toBeTruthy();
    } else {
      expect(next.allowBlocked).toBeUndefined();
      expect(caps.allow("local.test", hash).consent).toBe("given");
    }
  }
});
test("allow reads the skill again and stores its pin when it equals the pin the screen sent, and refuses with Something this flow uses changed since you looked at it. Reload and check it again. when one differs or is missing", async () => {
  const { caps, store, write } = await setup();
  const pin = caps.get("local.test").rows[0]?.pin;
  if (!pin) throw new Error("Missing pin");
  expect(() => caps.allow("local.test", hash)).toThrow(
    "Something this flow uses changed since you looked at it. Reload and check it again.",
  );
  write("Changed");
  expect(() => caps.allow("local.test", hash, { writer: pin })).toThrow(
    "Something this flow uses changed since you looked at it. Reload and check it again.",
  );
  const next = caps.get("local.test").rows[0]?.pin;
  if (!next) throw new Error("Missing pin");
  caps.allow("local.test", hash, { writer: next });
  expect(store.getCapabilityConsent("local.test")?.pins).toEqual({ skills: { writer: next }, folders: {} });
});
test("R9: consentOf is stale after SKILL.md changes, and given again after a new allow", async () => {
  const { caps, write } = await setup();
  const pin = caps.get("local.test").rows[0]?.pin;
  if (!pin) throw new Error("Missing pin");
  caps.allow("local.test", hash, { writer: pin });
  expect(caps.consentOf("local.test")).toBe("given");
  write("Changed");
  expect(caps.consentOf("local.test")).toBe("stale");
  const next = caps.get("local.test").rows[0]?.pin;
  if (!next) throw new Error("Missing pin");
  caps.allow("local.test", hash, { writer: next });
  expect(caps.consentOf("local.test")).toBe("given");
});
test("the allow's audit row lists the pinned skills by requirement id and hash", async () => {
  const { caps, store } = await setup();
  const pin = caps.get("local.test").rows[0]?.pin;
  if (!pin) throw new Error("Missing pin");
  caps.allow("local.test", hash, { writer: pin });
  expect(store.listAudit().find((row) => row.kind === "capabilities_allowed")?.detail).toMatchObject({
    flowId: "local.test",
    hash,
    skills: { writer: pin },
  });
});
