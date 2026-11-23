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

for (const tool of ["mcp__claude_ai_Gmail__send_message", "mcp__gmail__reply"]) {
  for (const field of ["to", "cc", "bcc"] as const) {
    test(`TC-SR1-12 ${tool} displays ASCII for ${field}`, () => {
      const address = `sam@b${String.fromCodePoint(0xfc)}cher.example.test`;
      const homograph = `sam@${String.fromCodePoint(0x430)}pple.example.test`;
      const input = {
        to: ["sam@example.test"],
        subject: "Hello",
        body: "Hello",
        [field]: [address, homograph, "sam@example.test"],
      };
      expect(heldPayload(input, tool)).toMatchObject({
        [field]: [
          `${address} (sam@xn--bcher-kva.example.test)`,
          `${homograph} (sam@xn--pple-43d.example.test)`,
          "sam@example.test",
        ],
      });
    });
  }
}

test("TC-SR1-12 shows ASCII for a named recipient", () => {
  const address = `sam@b${String.fromCodePoint(0xfc)}cher.example.test`;
  expect(
    heldPayload({ to: [`Sam <${address}>`], subject: "Hi", body: "Hi" }, "mcp__gmail__reply"),
  ).toMatchObject({ to: [`Sam <${address}> (sam@xn--bcher-kva.example.test)`] });
});

test("TC-SR1-12 splits recipients and shows each ASCII form", () => {
  const address = `b@b${String.fromCodePoint(0xfc)}cher.example.test`;
  expect(
    heldPayload({ to: [`a@x.test, ${address}`], subject: "Hi", body: "Hi" }, "mcp__gmail__reply"),
  ).toMatchObject({ to: ["a@x.test", `${address} (b@xn--bcher-kva.example.test)`] });
});

test("TC-SR1-12 trims a recipient before domain conversion", () => {
  const address = `sam@b${String.fromCodePoint(0xfc)}cher.example.test`;
  expect(heldPayload({ to: [` ${address} `], subject: "Hi", body: "Hi" }, "mcp__gmail__reply")).toMatchObject(
    { to: [`${address} (sam@xn--bcher-kva.example.test)`] },
  );
});

test("TC-SR1-12 blocks a domain that cannot be converted", () => {
  expect(
    heldPayload({ to: ["sam@bad domain.test"], subject: "Hi", body: "Hi" }, "mcp__gmail__reply"),
  ).toBeUndefined();
});
