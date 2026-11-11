import { expect, test } from "vitest";
import { validateManifest } from "../index.ts";
import type { Issue } from "../issues.ts";
import { askStep, fileCheck, loop, sched, step, userStep } from "../test-data/flows.ts";

const codes = (issues: Issue[]) => issues.map((i) => `${i.code}@${i.path}`);
test("R4 refuses risky work before the first ask", () => {
  expect(
    codes(validateManifest(sched([step("a", { uses: ["mail"] }), askStep("p"), userStep("z")]))),
  ).toEqual(["unattended_prefix@steps.0"]);
  expect(codes(validateManifest(sched([step("a", { uses: ["w"] }), askStep("p"), userStep("z")])))).toEqual([
    "unattended_prefix@steps.0",
  ]);
  expect(
    codes(validateManifest(sched([step("a", { risky: ["x.y"] }), askStep("p"), userStep("z")]))),
  ).toEqual(["unattended_prefix@steps.0"]);
  expect(
    codes(
      validateManifest(
        sched([
          { id: "f", do: "flow", flow: "local.child@^1.0.0", checks: [fileCheck] },
          askStep("p"),
          userStep("z"),
        ]),
      ),
    ),
  ).toEqual(["unattended_prefix@steps.0"]);
  expect(
    codes(validateManifest(sched([loop("l", [step("n", { uses: ["mail"] })]), askStep("p"), userStep("z")]))),
  ).toEqual(["unattended_prefix@steps.0.steps.0"]);
  expect(codes(validateManifest(sched([step("a", { uses: ["mail"] })]))).sort()).toEqual([
    "light_needs_user_check@steps.0",
    "unattended_prefix@steps.0",
  ]);
});
test("R4 allows the same steps after the ask, or with a manual trigger", () => {
  expect(validateManifest(sched([askStep("p"), step("a", { uses: ["mail"] }), userStep("z")]))).toEqual([]);
  expect(
    validateManifest({
      ...sched([step("a", { uses: ["mail"] }), userStep("z")]),
      triggers: [{ kind: "manual" }],
    }),
  ).toEqual([]);
});

test("R4: an ask that carries a `when` does not end the unattended prefix", () => {
  const issues = validateManifest(
    sched([{ ...askStep("p"), when: "false" }, step("a", { uses: ["mail"] }), userStep("z")]),
  );
  expect(codes(issues)).toContain("unattended_prefix@steps.1");
});

test("R4 refuses a cli_tool whose declared commands merge, push or delete, before the first ask", () => {
  for (const command of ["gh pr merge *", "git push --force *", "rm *"]) {
    const manifest = sched(
      [step("a", { uses: ["cli"] }), askStep("p"), userStep("z")],
      [{ id: "cli", type: "cli_tool", commands: [command] }],
    );
    expect(
      validateManifest(manifest).map((i) => i.code),
      command,
    ).toContain("unattended_prefix");
  }
});

test("R4 permits a conditional ask itself in the unattended prefix", () => {
  const manifest = sched([{ ...askStep("p"), when: "false", risky: ["mail.send"] }, userStep("z")]);
  expect(codes(validateManifest(manifest))).not.toContain("unattended_prefix@steps.0");
});
