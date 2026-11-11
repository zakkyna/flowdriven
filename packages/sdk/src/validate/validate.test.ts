import { expect, test } from "vitest";
import { parseManifest } from "../format/parse.ts";
import { classifyCommand, classifyTool, validateManifest } from "../index.ts";
import type { Issue } from "../issues.ts";
import { askStep, flow, loopFlow, sched, step, userStep } from "../test-data/flows.ts";
import { upworkJobReview } from "../test-data/upwork.ts";

const codes = (issues: Issue[]) => issues.map((i) => `${i.code}@${i.path}`);
const ok = (raw: unknown) => {
  const r = parseManifest(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.manifest;
};
test("the Upwork example has no errors", () =>
  expect(validateManifest(ok(upworkJobReview)).filter((i) => i.severity === "error")).toEqual([]));
test("a step needs a required check", () => {
  expect(codes(validateManifest(flow({ steps: [step("a", { checks: [] }), userStep("b")] })))).toEqual([
    "no_required_check@steps.0",
  ]);
  expect(
    codes(
      validateManifest(
        flow({ steps: [step("a", { checks: [{ type: "user", required: false }] }), userStep("b")] }),
      ),
    ),
  ).toEqual(["no_required_check@steps.0"]);
});
test("only judge checks give a warning", () =>
  expect(
    validateManifest(
      flow({ steps: [step("a", { checks: [{ type: "judge", rubric: "r.md" }] }), userStep("b")] }),
    ),
  ).toContainEqual(expect.objectContaining({ code: "judged_only", severity: "warning" })));
test("a light flow must end with a user check, a build flow need not, an ask counts", () => {
  expect(codes(validateManifest(flow({ steps: [step("a")] })))).toEqual(["light_needs_user_check@steps.0"]);
  expect(validateManifest(flow({ kind: "build", steps: [step("a")] }))).toEqual([]);
  expect(validateManifest(flow({ steps: [step("a"), askStep("b")] }))).toEqual([]);
});
test("uses, skill and approves must point at declared requirements", () => {
  expect(codes(validateManifest(flow({ steps: [step("a", { uses: ["ghost"] }), userStep("b")] })))).toEqual([
    "unknown_requirement@steps.0.uses.0",
  ]);
  expect(
    codes(
      validateManifest(
        flow({ steps: [step("a", { do: "skill", skill: "fs", uses: ["fs"] }), userStep("b")] }),
      ),
    ),
  ).toEqual(["skill_requirement@steps.0"]);
  expect(
    codes(validateManifest(flow({ steps: [askStep("a", { approves: ["fs.nope"] }), userStep("b")] }))),
  ).toEqual(["unknown_approves_tool@steps.0.ask.approves.0"]);
});
test("command and probe checks stay within the declared requirements", () => {
  const reqs = [
    { id: "cli", type: "cli_tool", commands: ["flutter analyze", "dart format *"] },
    { id: "mail", type: "mcp_server", tools: ["search_threads"] },
  ];
  const one = (check: Record<string, unknown>, uses = ["cli", "mail"]) =>
    codes(
      validateManifest(
        flow({ requirements: reqs, steps: [step("a", { uses, checks: [check] }), userStep("b")] }),
      ),
    );
  expect(one({ type: "command", cmd: "flutter", args: ["analyze"] })).toEqual([]);
  expect(one({ type: "command", cmd: "dart", args: ["format", "lib", "test"] })).toEqual([]);
  expect(one({ type: "command", cmd: "flutter", args: ["test"] })).toEqual([
    "undeclared_command@steps.0.checks.0.cmd",
  ]);
  expect(one({ type: "command", cmd: "flutter", args: ["analyze"] }, [])).toEqual([
    "undeclared_command@steps.0.checks.0.cmd",
  ]);
  expect(one({ type: "probe", tool: "mail.search_threads" })).toEqual([]);
  expect(one({ type: "probe", tool: "mail.send_message" })).toEqual([
    "undeclared_probe_tool@steps.0.checks.0.tool",
  ]);
});
test("references: undeclared param, forward reference, loop variable", () => {
  expect(
    codes(validateManifest(flow({ steps: [step("a", { when: "params.nope" }), userStep("b")] }))),
  ).toEqual(["unknown_reference@steps.0.when"]);
  expect(
    codes(
      validateManifest(
        flow({ steps: [step("a", { instructions: "x ${steps.b.outputs.y}" }), userStep("b")] }),
      ),
    ),
  ).toEqual(["unknown_reference@steps.0.instructions"]);
  expect(codes(validateManifest(flow({ steps: [step("a", { when: "((" }), userStep("b")] })))).toEqual([
    "expression_syntax@steps.0.when",
  ]);
  expect(
    validateManifest(loopFlow({ as: "job", nested: [step("n", { instructions: "x ${job.id}" })] })),
  ).toEqual([]);
});
test("an ask inside a loop is refused", () =>
  expect(codes(validateManifest(loopFlow({ as: "job", nested: [step("n"), askStep("p")] })))).toContain(
    "ask_in_loop@steps.0.steps.1",
  ));
test("duplicate and reserved ids", () => {
  expect(codes(validateManifest(flow({ steps: [step("a"), userStep("a")] })))).toEqual([
    "duplicate_id@steps.1",
  ]);
  expect(codes(validateManifest(flow({ steps: [step("in"), userStep("b")] })))).toEqual([
    "reserved_id@steps.0",
  ]);
  expect(
    codes(
      validateManifest(
        flow({ steps: [step("a", { outputs: [{ id: "passed", type: "json" }] }), userStep("b")] }),
      ),
    ),
  ).toEqual(["reserved_id@steps.0.outputs.0"]);
});
test("check files must exist when the folder listing is given", () => {
  const m = flow({
    steps: [step("a", { checks: [{ type: "schema", file: "checks/a.json" }] }), userStep("b")],
  });
  expect(codes(validateManifest(m, { files: new Set(["flow.yaml"]) }))).toEqual([
    "missing_file@steps.0.checks.0.file",
  ]);
  expect(validateManifest(m, { files: new Set(["flow.yaml", "checks/a.json"]) })).toEqual([]);
  expect(validateManifest(m)).toEqual([]);
});
test("classifyTool", () => {
  expect(classifyTool("gmail.send")).toBe("send");
  expect(classifyTool("prototype_publish")).toBe("post");
  expect(classifyTool("deleteThread")).toBe("delete");
  expect(classifyTool("label_thread")).toBeUndefined();
  expect(classifyTool("search_threads")).toBeUndefined();
});

test("classifyTool splits camelCase after an acronym and on any non-letter separator", () => {
  expect(classifyTool("SMSSend")).toBe("send");
  expect(classifyTool("HTTPPost")).toBe("post");
  expect(classifyTool("APIDelete")).toBe("delete");
  expect(classifyTool("send:message")).toBe("send");
  expect(classifyTool("mail/send")).toBe("send");
  for (const name of ["list_posts", "get_sender", "list_payments", "sendmessage"])
    expect(classifyTool(name)).toBeUndefined();
});

test("R4 refuses an acronym-camel send tool before the first ask", () => {
  const manifest = sched(
    [step("a", { uses: ["mail"] }), askStep("p"), userStep("z")],
    [{ id: "mail", type: "mcp_server", tools: ["SMSSend"] }],
  );
  expect(validateManifest(manifest).map((i) => i.code)).toContain("unattended_prefix");
});

test("classifyCommand identifies risky commands and permits read-only commands", () => {
  for (const command of ["git push origin main", "git status", "pnpm test"])
    expect(classifyCommand(command)).toBeUndefined();
  for (const [command, action] of [
    ["npm publish", "post"],
    ["git push -f origin main", "delete"],
    ["* --version", "delete"],
    ["/bin/rm file", "delete"],
    ["git push origin +main", "delete"],
    ["gh pr merge 1", "merge"],
    ["tool delete", "delete"],
  ])
    expect(classifyCommand(command ?? "")).toBe(action);
});

test("M1 an mcp_server with no tools list is not invisible to R4 (spec 9.4: tools are the exact names the flow may call)", () => {
  const manifest = sched([step("a", { uses: ["mail"] }), askStep("p"), userStep("z")]);
  const malformed = {
    ...manifest,
    requirements: [{ id: "mail", type: "mcp_server" }],
  } as unknown as typeof manifest;
  expect(codes(validateManifest(malformed))).toContain("unattended_prefix@steps.0");
  const empty = {
    ...manifest,
    requirements: [{ id: "mail", type: "plugin", tools: [] }],
  } as unknown as typeof manifest;
  expect(codes(validateManifest(empty))).toContain("unattended_prefix@steps.0");
});

test("connected requirements require nonempty tools except skills", () => {
  for (const type of ["mcp_server", "plugin"]) {
    for (const tools of [undefined, []]) {
      const manifest = {
        format: "flowdriven-flow/1.1",
        id: "local.test",
        name: "Test",
        kind: "build",
        requirements: [{ id: "x", type, ...(tools === undefined ? {} : { tools }) }],
        steps: [step("a")],
      };
      expect(parseManifest(manifest).ok).toBe(false);
    }
  }
  expect(
    parseManifest({
      format: "flowdriven-flow/1.1",
      id: "local.test",
      name: "Test",
      kind: "build",
      requirements: [{ id: "x", type: "skill" }],
      steps: [step("a")],
    }).ok,
  ).toBe(true);
});

test("M2 a builtin whose name is risky is refused before the first ask (spec 13.3 does a risky CLI as a builtin that asks first)", () => {
  const manifest = sched([
    { id: "a", do: "builtin", builtin: "send_email", checks: [{ type: "user" }] },
    askStep("p"),
    userStep("z"),
  ]);
  expect(codes(validateManifest(manifest))).toContain("unattended_prefix@steps.0");
});

test("M4 a reference to an output the step does not declare is reported (plan Task 4 'references to unknown steps or outputs')", () => {
  const manifest = sched([
    step("a", { outputs: [{ id: "o", type: "text" }] }),
    step("b", { instructions: "${a.nope} ${steps.a.outputs.nope}" }),
    askStep("p"),
    userStep("z"),
  ]);
  expect(codes(validateManifest(manifest))).toContain("unknown_reference@steps.1.instructions");
  for (const instructions of ["${a.nope}", "${steps.a.outputs.nope}"]) {
    const single = sched([
      step("a", { outputs: [{ id: "o", type: "text" }] }),
      step("b", { instructions }),
      askStep("p"),
      userStep("z"),
    ]);
    expect(codes(validateManifest(single))).toContain("unknown_reference@steps.1.instructions");
  }
  const valid = sched([
    step("a", { outputs: [{ id: "o", type: "text" }] }),
    step("b", { instructions: "${a.o.deep} ${steps.a.outputs.o.deep} ${a.passed}" }),
    askStep("p"),
    userStep("z"),
  ]);
  expect(codes(validateManifest(valid))).not.toContain("unknown_reference@steps.1.instructions");
});
