import { RunDetail } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { RunView } from "../engine.ts";
import type { AuditEntry, ItemRow, StepRow } from "../storage.ts";
import { blockedCalls, toRunDetail } from "./map-run.ts";

const date = "2026-11-12T00:00:00.000Z";

function row(stepId: string, itemKey = "", extra: Partial<StepRow> = {}): StepRow {
  return {
    runId: "run-1",
    stepId,
    itemKey,
    state: "passed",
    attempts: [{ number: 1, replan: false, worker: "Scripted harness", startedAt: date }],
    outputs: {},
    checks: [],
    ...extra,
  };
}
function view(): RunView {
  const { manifest } = demoFlow();
  return {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: "a".repeat(64),
      flowVersion: "1.2.3",
      state: "blocked",
      project: ".",
      inputs: {},
      params: { min_score: 7 },
      requirements: [],
      startedAt: date,
      blockedReason: "Wait",
    },
    steps: manifest.steps.map((step) => row(step.id)),
    items: [],
    approvals: [],
    audit: [],
  };
}
function map(v: RunView): RunDetail {
  return RunDetail.parse(toRunDetail(v, () => "scripted"));
}
function line(kind: string, detail: Record<string, unknown>): AuditEntry {
  return { at: date, kind, runId: "run-1", detail: detail as AuditEntry["detail"] };
}
function read(stepId: string, itemKey = ""): AuditEntry {
  return line("page_read", { stepId, itemKey, attempt: 1, requirementId: "web", tool: "get_page_text" });
}
function withheld(stepId: string, itemKey: string, tool: string, sentence: string): AuditEntry {
  return line("page_withheld", { stepId, itemKey, attempt: 1, why: "moved", tool, sentence });
}
function leafOf(detail: RunDetail, index: number) {
  const step = detail.steps.at(index);
  if (!step || step.do === "loop") throw new Error("Expected a leaf step");
  return step;
}

test("a step row with outside true shows outside true, and a row without it shows nothing", () => {
  const v = view();
  const first = v.steps.at(0);
  if (!first) throw new Error("No step");
  first.outside = true;
  const d = map(v);
  expect(leafOf(d, 0).outside).toBe(true);
  expect("outside" in leafOf(d, 2)).toBe(false);
  const v2 = view();
  const second = v2.steps.at(2);
  if (!second) throw new Error("No step");
  second.outside = false;
  expect("outside" in leafOf(map(v2), 2)).toBe(false);
});

test("pagesRead counts the page_read lines of that step and item only, and is absent at zero", () => {
  const v = view();
  const stepId = v.manifest.steps.at(0)?.id ?? "";
  const other = v.manifest.steps.at(1)?.id ?? "";
  const pick = v.manifest.steps.at(2)?.id ?? "";
  v.audit = [
    read(stepId),
    read(stepId),
    read(stepId),
    read(stepId, "j1"),
    read(other),
    read(other, ""),
    line("tool_denied", { stepId, itemKey: "", tool: "navigate", reason: "No" }),
  ];
  const d = map(v);
  expect(leafOf(d, 0).pagesRead).toBe(3);
  expect("pagesRead" in leafOf(d, 2)).toBe(false);
  expect(pick).not.toBe(other);
  v.audit = [...v.audit, read(pick, "j1")];
  expect(leafOf(map(v), 2).pagesRead).toBeUndefined();
});

test("a page_withheld line appears under blocked calls with the tool and its sentence, grouped and counted with a tool_denied line that has the same tool and reason", () => {
  const sentence = "FlowDriven withheld this page because its address is not one this step declares.";
  const audit: AuditEntry[] = [
    withheld("a", "", "get_page_text", sentence),
    line("tool_denied", { stepId: "a", itemKey: "", tool: "get_page_text", reason: sentence }),
    withheld("a", "", "get_page_text", sentence),
    withheld("a", "", "get_page_text", "Other sentence."),
    withheld("a", "k1", "get_page_text", sentence),
    withheld("b", "", "get_page_text", sentence),
  ];
  expect(blockedCalls(audit, "a", "")).toEqual([
    { tool: "get_page_text", reason: sentence, count: 3 },
    { tool: "get_page_text", reason: "Other sentence.", count: 1 },
  ]);
  expect(blockedCalls(audit, "a", "k1")).toEqual([{ tool: "get_page_text", reason: sentence, count: 1 }]);
  const v = view();
  const stepId = v.manifest.steps.at(0)?.id ?? "";
  v.audit = [withheld(stepId, "", "get_page_text", sentence)];
  expect(leafOf(map(v), 0).blocked).toEqual([{ tool: "get_page_text", reason: sentence, count: 1 }]);
});

test("the 21st different row is dropped and a malformed audit detail is ignored", () => {
  const audit: AuditEntry[] = [];
  for (let i = 0; i < 21; i++) audit.push(withheld("a", "", `tool${i}`, "Sentence."));
  audit.push(line("page_withheld", { stepId: "a", itemKey: "", tool: 7, sentence: "Sentence." }));
  audit.push(line("page_withheld", { stepId: "a", itemKey: "", tool: "navigate", sentence: 9 }));
  audit.push(line("page_withheld", { stepId: "a", itemKey: "", sentence: "No tool." }));
  audit.push({ at: date, kind: "page_withheld", runId: "run-1", detail: "text" });
  audit.push({ at: date, kind: "page_withheld", runId: "run-1", detail: ["a"] });
  audit.push({ at: date, kind: "page_withheld", runId: "run-1", detail: null });
  const rows = blockedCalls(audit, "a", "");
  expect(rows).toHaveLength(20);
  expect(rows?.some((r) => r.tool === "tool20")).toBe(false);
  expect(rows?.every((r) => r.count === 1)).toBe(true);
  expect(
    blockedCalls([line("page_withheld", { stepId: "a", itemKey: "", tool: 7 })], "a", ""),
  ).toBeUndefined();
  // an existing row still counts after the 20 are full
  audit.push(withheld("a", "", "tool0", "Sentence."));
  expect(blockedCalls(audit, "a", "")?.at(0)?.count).toBe(2);
});

test("the detail parses against RunDetail of the contract, for a top-level step and for a step of a loop item", () => {
  const v = view();
  const top = v.manifest.steps.at(0)?.id ?? "";
  const first = v.steps.at(0);
  if (!first) throw new Error("No step");
  first.outside = true;
  const items: ItemRow[] = [
    {
      runId: "run-1",
      loopId: "review",
      key: "j1",
      position: 0,
      item: { title: "Job one" },
      status: "passed",
    },
  ];
  v.items = items;
  v.steps.push(row("page", "j1", { outside: true }), row("rough", "j1"));
  v.audit = [
    read(top),
    read("page", "j1"),
    read("page", "j1"),
    withheld("page", "j1", "get_page_text", "Withheld."),
  ];
  const d = map(v);
  expect(RunDetail.safeParse(d).success).toBe(true);
  expect(leafOf(d, 0)).toMatchObject({ outside: true, pagesRead: 1 });
  const loop = d.steps.at(1);
  if (!loop || loop.do !== "loop") throw new Error("Expected the loop");
  const page = loop.items?.at(0)?.steps.find((s) => s.stepId === "page");
  expect(page).toMatchObject({
    outside: true,
    pagesRead: 2,
    blocked: [{ tool: "get_page_text", reason: "Withheld.", count: 1 }],
  });
  const rough = loop.items?.at(0)?.steps.find((s) => s.stepId === "rough");
  expect(rough && "outside" in rough).toBe(false);
  expect(rough && "pagesRead" in rough).toBe(false);
});
