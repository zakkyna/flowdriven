import { expect, test } from "vitest";
import { FlowManifest } from "../format/manifest.ts";
import { askStep, sched, step, userStep } from "../test-data/flows.ts";
import { classifyTool } from "./risky.ts";
import { validateManifest } from "./validate.ts";

test("classifyTool calls mark_thread_spam and mark_message_spam delete and keeps label_thread undefined", () => {
  expect(classifyTool("mark_thread_spam")).toBe("delete");
  expect(classifyTool("mark_message_spam")).toBe("delete");
  expect(classifyTool("label_thread")).toBeUndefined();
});

test("R4: a flow with a schedule that marks spam before its first ask is refused", () => {
  const manifest = FlowManifest.parse(
    sched(
      [step("a", { uses: ["mail"] }), askStep("p"), userStep("z")],
      [{ id: "mail", type: "mcp_server", tools: ["mark_thread_spam"] }],
    ),
  );
  expect(validateManifest(manifest)).toContainEqual(
    expect.objectContaining({ code: "unattended_prefix", path: "steps.0" }),
  );
});
