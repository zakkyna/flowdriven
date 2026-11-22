import { expect, test } from "vitest";
import { heldPayload } from "./held.ts";

test("TC-SR1-12 shows a non-ASCII domain in ASCII", () => {
  const address = `sam@b${String.fromCodePoint(0xfc)}cher.example.test`;
  expect(heldPayload({ to: [address] })).toContain("sam@xn--bcher-kva.example.test");
});

test("TC-SR1-12 the held place uses sorted lower-case ASCII recipients", async () => {
  const { decide } = await import("../claude/decide.ts");
  const name = "mcp__claude_ai_Gmail__send_message";
  const address = `Sam@B${String.fromCodePoint(0xfc)}cher.example.test`;
  const policy = {
    tools: [name],
    folders: [],
    cwd: "/tmp",
    addDirs: [],
    schema: false,
    sessionId: "s",
    declaredTools: [{ tool: name, cover: "gmail.send_message" }],
    touches: [
      {
        touchId: "send",
        effect: "send" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: ["gmail.send_message"],
      },
    ],
  };
  const call = {
    hook_event_name: "PreToolUse",
    session_id: "s",
    tool_use_id: "id",
    tool_name: name,
    tool_input: { to: [address], cc: "z@example.test", bcc: ["a@example.test"] },
  };
  expect(decide(policy, call)).toMatchObject({
    outcome: "hold",
    held: {
      place: { kind: "address", value: "a@example.test, sam@xn--bcher-kva.example.test, z@example.test" },
    },
  });
  expect(decide(policy, { ...call, tool_input: {} })).toMatchObject({
    outcome: "hold",
    held: { fixedPlace: false },
  });
});
