import { expect, test, vi } from "vitest";
import { z } from "zod";
import "./index";

test("contracts disable Zod JIT and construct parsers without Function", () => {
  expect(z.config().jitless).toBe(true);
  const functionSpy = vi.spyOn(globalThis, "Function");
  try {
    z.object({ value: z.string() }).parse({ value: "ok" });
    expect(functionSpy).not.toHaveBeenCalled();
  } finally {
    functionSpy.mockRestore();
  }
});

test("TC-CON-32 config is the first statement of the contract entrypoint", async () => {
  // @ts-expect-error Node is provided by the Vitest node environment.
  const { readFileSync } = await import("node:fs");
  expect(
    readFileSync(new URL("./index.ts", import.meta.url), "utf8")
      .trimStart()
      .startsWith('import "./config.ts";'),
  ).toBe(true);
});

test("TC-CON-32 new schemas parse without the Function constructor", async () => {
  const c = await import("./index.ts");
  const original = globalThis.Function;
  try {
    globalThis.Function = (() => {
      throw new Error("Function constructor called");
    }) as unknown as FunctionConstructor;
    c.ChatsCreateInput.parse({});
    c.ChatAct.parse({ action: "start" });
    c.RulesListInput.parse({});
    c.AgentIdInput.parse({ agentId: "codex" });
    c.ActivitySummary.parse({ needsYou: [], needsYouCount: 0, running: [], earlier: [] });
    c.SearchResult.parse({ recent: true, chats: [], flows: [] });
    c.Skill.parse({
      id: "skill",
      name: "Skill",
      about: "About",
      origin: "agent",
      usedBy: [],
      readable: true,
    });
    c.FlowsStartInput.parse({ flowId: "flow", source: "flows" });
    c.WindowPrefs.parse({ colorMode: "system", platform: "darwin" });
  } finally {
    globalThis.Function = original;
  }
});
