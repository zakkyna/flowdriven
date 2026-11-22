import { FlowManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { createCapabilities } from "./capabilities.ts";

test("a used cli_tool that is not routed blocks the allow", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const hash = `sha256:${"1".repeat(64)}`;
    const manifest = FlowManifest.parse({
      format: "flowdriven-flow/1.1",
      id: "local.test",
      name: "Test",
      kind: "light",
      requirements: [{ id: "cli", type: "cli_tool", commands: ["curl x"] }],
      steps: [{ id: "worker", do: "worker", instructions: "Work", uses: ["cli"] }],
    });
    store.putFlow({ id: manifest.id, version: "1", hash, manifest, files: {}, registeredAt: "2026-11-12" });
    const caps = createCapabilities({
      store,
      now: () => new Date("2026-11-12T00:00:00Z"),
      facts: () => ({ hooks: true, chrome: false }),
    });
    const message = "FlowDriven cannot run the commands this flow uses, so there is nothing to allow.";
    expect(caps.get(manifest.id).allowBlocked).toBe(message);
    expect(() => caps.allow(manifest.id, hash)).toThrow(message);
    const update = (commands: string[]) =>
      store.putFlow({
        id: manifest.id,
        version: "1",
        hash,
        manifest: FlowManifest.parse({
          ...manifest,
          requirements: [{ id: "cli", type: "cli_tool", commands }],
        }),
        files: {},
        registeredAt: "2026-11-12",
      });
    update(["flutter analyze", "dart format lib"]);
    expect(caps.get(manifest.id).rows[0]).toMatchObject({
      details: ["flutter analyze", "dart format lib"],
      cost: "Adds about 2,000 tokens to each call of the step that uses it.",
    });
    update(["flutter analyze", "dart format *"]);
    expect(caps.get(manifest.id).rows[0]?.details).toEqual([]);
    expect(caps.get(manifest.id).allowBlocked).toBe(message);
    update(Array.from({ length: 9 }, (_, i) => `flutter test${i}`));
    expect(() => caps.get(manifest.id)).toThrow("This flow declares more than the preview can show.");
  } finally {
    store.close();
  }
});
