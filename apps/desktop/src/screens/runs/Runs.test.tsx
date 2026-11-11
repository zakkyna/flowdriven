import { readFileSync } from "node:fs";
import { RunnerError } from "@flowdriven/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { readyState, renderApp } from "../../test/render";
import { waitingLabel } from "./WaitingLine";

const bodyRows = () =>
  within(screen.getByRole("table", { name: "Runs" }))
    .getAllByRole("row")
    .slice(1);
const bodyRow = (i: number) => bodyRows()[i] as HTMLElement;

describe("Runs", () => {
  test("lists every run newest first with its state words", async () => {
    renderApp("#/runs");
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    expect(bodyRows().map((r) => within(r).getAllByRole("cell")[0]?.textContent)).toEqual([
      "run-0007",
      "run-0006",
      "run-0005",
      "run-0004",
      "run-0003",
      "run-0002",
      "run-0001",
    ]);
    expect(within(bodyRow(5)).getByText("One-time")).toBeTruthy();
    expect(within(bodyRow(1)).getByText("Blocked")).toBeTruthy();
  });
  test("filters and clears filters", async () => {
    renderApp("#/runs");
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "~/Reports/q3-suppliers" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "blocked" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.lead-follow-up" } });
    expect(await screen.findByText("No runs match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
  });
  test("a blocked run shows why, the failing check and how to resume", async () => {
    renderApp("#/runs/run-0006");
    expect(await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" })).toBeTruthy();
    expect(screen.getByText(/flutter analyze still fails after 4 attempts/)).toBeTruthy();
    const step = screen.getByRole("region", { name: "Build the screens" });
    expect(within(step).getByText("attempt 4 of 4")).toBeTruthy();
    expect(within(step).getByText(/^flutter analyze: 3 errors/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume from step 3" }));
    expect(await screen.findAllByText("Running")).not.toHaveLength(0);
  });
  test("collapses evidence longer than 12 lines", async () => {
    renderApp("#/runs/run-0006");
    fireEvent.click(await screen.findByRole("button", { name: "Show all 20 lines" }));
    expect(screen.queryByRole("button", { name: "Show all 20 lines" })).toBeNull();
  });
  test("a done run shows its report, proofs and estimated cost", async () => {
    renderApp("#/runs/run-0005");
    expect(
      await screen.findByText("Built the Q3 supplier report from 14 files in ~/Reports/q3-suppliers."),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Cross-check every number" })).getByText(
        "Judged, not verified",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Estimated cost: $0.42. This is an estimate.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });
  test("a one-time run offers to save", async () => {
    renderApp("#/runs/run-0002");
    expect(await screen.findByText("Save this as a flow?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save as flow" }));
    expect(
      screen.getByText("Saving one-time flows arrives with the agent. Until then this run stays in history."),
    ).toBeTruthy();
  });
  test("shows run not found", async () => {
    renderApp("#/runs/run-9999");
    expect(await screen.findByRole("heading", { level: 1, name: "Run not found" })).toBeTruthy();
    expect(screen.getByText("There is no run run-9999 on this Mac.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All runs" })).toBeTruthy();
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/runs/run-0006");
    expect(readyState(container, "run")).toBe("false");
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    await waitFor(() => expect(readyState(container, "run")).toBe("true"));
  });
  test("empty", async () => {
    renderApp("#/runs", { scenario: "empty" });
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
  });
});
test("run detail joins worker and attempt with a comma", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Build the screens" });
  expect(step.textContent).toContain("Worker: Codex, attempt 4 of 4");
});
test("flags passed steps with missing or unsuccessful required checks and empty sections", async () => {
  const { client } = renderApp("#/runs/run-0005");
  const run = client.state.runs.find((item) => item.id === "run-0005");
  if (!run || !run.steps[0] || !run.steps[1]) throw new Error("Missing fixture steps");
  run.steps[0].state = "passed";
  run.steps[0].checks = [];
  run.steps[1].state = "passed";
  run.steps[1].checks = [{ type: "command", required: true, summary: "Failed check", verdict: "failed" }];
  run.inputs = [];
  run.usage = [];
  expect(await screen.findAllByText("Marked passed without a passing check")).toHaveLength(2);
  expect(screen.getByText("No inputs.")).toBeTruthy();
  expect(screen.getByText("No usage reported yet.")).toBeTruthy();
});
test("warns before resuming an interrupted step and ignores duplicate clicks", async () => {
  const { client } = renderApp("#/runs/run-0003");
  await screen.findByText("This step was stopped part-way. Resuming runs it again.");
  const original = client.call.bind(client);
  let resolve: (() => void) | undefined;
  let calls = 0;
  client.call = ((name, input) => {
    if (name === "runs.resume") {
      calls++;
      return new Promise((done) => {
        resolve = () => {
          void original(name, input).then(done);
        };
      });
    }
    return original(name, input);
  }) as typeof client.call;
  const button = screen.getByRole("button", { name: /Resume from step/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(calls).toBe(1);
  resolve?.();
});
test("keeps filters when returning from a run", async () => {
  renderApp("#/runs");
  await waitFor(() => expect(bodyRows()).toHaveLength(7));
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "blocked" } });
  fireEvent.click(within(bodyRow(0)).getByRole("link"));
  fireEvent.click(await screen.findByRole("link", { name: "All runs" }));
  await waitFor(() => expect(screen.getByLabelText("State")).toHaveProperty("value", "blocked"));
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "" } });
});
test("sorts timestamps by instant when fractional precision differs", async () => {
  const { client } = renderApp("#/runs");
  const first = client.state.runs.find((run) => run.id === "run-0001");
  const second = client.state.runs.find((run) => run.id === "run-0002");
  if (!first || !second) throw new Error("Missing runs");
  first.startedAt = "2026-11-11T00:00:00Z";
  second.startedAt = "2026-11-11T00:00:00.100Z";
  await waitFor(() => expect(bodyRow(0).textContent).toContain("run-0002"));
});
test("shows a failed resume", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const button = await screen.findByRole("button", { name: /Resume from step/ });
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Resume failed"));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toBe("Resume failed");
});
test("groups reported usage calls", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const run = client.state.runs.find((item) => item.id === "run-0006");
  if (!run) throw new Error("Missing run fixture");
  run.usage = [{ harnessId: "codex", name: "Codex", calls: 1234, wallSeconds: 1 }];
  expect(await screen.findByText("1,234")).toBeTruthy();
});
test("links a waiting run's approvals to the inbox", async () => {
  renderApp("#/runs/run-0007");
  const links = await screen.findAllByRole("link", { name: "Open in Inbox" });
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((link) => link.getAttribute("href")?.startsWith("#/inbox/"))).toBe(true);
});

test("unstarted and skipped steps show no worker", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Compare with the design" });
  expect(step.textContent).not.toContain("Worker:");
});

test("each run's state is an icon plus a word, and the run id is a link", async () => {
  renderApp("#/runs");
  await waitFor(() => expect(bodyRows()).toHaveLength(7));
  const first = bodyRow(0);
  expect(within(first).getByText("Waiting for you")).toBeTruthy();
  expect(first.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(first).getByRole("link", { name: "run-0007" }).getAttribute("href")).toBe("#/runs/run-0007");
});
test("Run detail puts All runs in the bar before the title", async () => {
  renderApp("#/runs/run-0006");
  const heading = await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
  const back = screen.getByRole("link", { name: "All runs" });
  expect(heading.closest("header")?.contains(back)).toBe(true);
  expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("a step block is a row with its number, state icon, title and state word", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Build the screens" });
  expect(within(step).getByText("3")).toBeTruthy();
  expect(step.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(step).getAllByText("Failed").length).toBeGreaterThan(0);
  expect(step.querySelector("h3")?.textContent).toBe("Build the screens");
});
test("Run detail keeps its six sections", async () => {
  renderApp("#/runs/run-0005");
  await screen.findByRole("heading", { level: 1, name: "Documents and reports" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Report",
    "Steps",
    "Inputs",
    "Outputs",
    "Approvals",
    "Usage",
  ]);
});
test("runs styles: hairline rows, 44 px table rows, steps as rows not cards", () => {
  const css = readFileSync("apps/desktop/src/screens/runs/Runs.module.css", "utf8");
  expect(css).toMatch(/\.table td\s*\{[^}]*height:\s*44px/s);
  expect(css).toMatch(/\.table th\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*font-size:\s*12\.5px/s);
  expect(css).toMatch(/\.step\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.step\s*\{[^}]*(border-radius|background)/s);
  expect(css).toMatch(/\.reason\s*\{[^}]*background:\s*var\(--bad-soft\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
});

test("a loop step lists its items with key, label, state word and note", async () => {
  renderApp("#/runs/run-0008", { scenario: "looped" });
  const list = await screen.findByRole("list", { name: "Items of Review every alert" });
  const rows = within(list)
    .getAllByRole("listitem")
    .filter((row) => row.parentElement === list);
  expect(rows).toHaveLength(5);
  expect(rows.at(0)?.textContent).toContain("j1");
  expect(rows.at(0)?.textContent).toContain("Job one");
  expect(rows.at(0)?.textContent).toContain("Passed");
  expect(rows.at(2)?.textContent).toContain("Failed");
  expect(rows.at(2)?.textContent).toContain("The score was missing.");
});
test("an item shows its own steps", async () => {
  renderApp("#/runs/run-0008", { scenario: "looped" });
  expect(
    within(await screen.findByRole("list", { name: "Steps of j1" })).getAllByRole("listitem"),
  ).toHaveLength(3);
  expect(within(screen.getByRole("list", { name: "Steps of j2" })).getAllByText("Skipped")).toHaveLength(2);
});
test("skip reasons are shown in words", async () => {
  renderApp("#/runs/run-0008", { scenario: "looped" });
  expect(await screen.findByText("Seen in an earlier run")).toBeTruthy();
  expect(screen.getByText("Over the item cap")).toBeTruthy();
  expect(screen.queryByText("skipped: seen in an earlier run")).toBeNull();
});
test("an ask step shows what was picked", async () => {
  const first = renderApp("#/runs/run-0008", { scenario: "looped" });
  const pick = first.client.state.runs
    .find((r) => r.id === "run-0008")
    ?.steps.find((s) => s.stepId === "pick");
  if (!pick) throw new Error("Missing pick");
  pick.state = "passed";
  pick.picks = [{ key: "j1", label: "Job one" }];
  expect(await screen.findByText("Picked: Job one")).toBeTruthy();
  first.unmount();
  const second = renderApp("#/runs/run-0008", { scenario: "looped" });
  const empty = second.client.state.runs
    .find((r) => r.id === "run-0008")
    ?.steps.find((s) => s.stepId === "pick");
  if (!empty) throw new Error("Missing pick");
  empty.state = "passed";
  empty.picks = [];
  expect(await screen.findByText("Nothing picked.")).toBeTruthy();
});
test("the full report loads from runs.export when asked and is shown as text", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const spy = vi.spyOn(client, "call");
  fireEvent.click(await screen.findByRole("button", { name: "Show full report" }));
  expect((await screen.findByLabelText("Full report")).textContent).toContain(
    "# Job alert review: run run-0008",
  );
  expect(spy.mock.calls.filter(([name]) => name === "runs.export")).toEqual([
    ["runs.export", { runId: "run-0008" }],
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Hide full report" }));
  expect(screen.queryByLabelText("Full report")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show full report" }));
  await screen.findByLabelText("Full report");
  expect(spy.mock.calls.filter(([name]) => name === "runs.export").length).toBeLessThanOrEqual(2);
});
test("a failed export says why and keeps the page", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  await screen.findByRole("button", { name: "Show full report" });
  vi.spyOn(client, "call").mockRejectedValueOnce(
    new RunnerError("unavailable", "The report is not available."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show full report" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The report is not available.");
  expect(screen.getByRole("heading", { name: "Steps" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show full report" }).hasAttribute("disabled")).toBe(false);
});
test("Run detail keeps its six sections for a looped run", async () => {
  renderApp("#/runs/run-0008", { scenario: "looped" });
  await screen.findByRole("heading", { level: 1, name: "Job alert review" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Report",
    "Steps",
    "Inputs",
    "Outputs",
    "Approvals",
    "Usage",
  ]);
});
test("a passed loop or ask step shows its state word and no alarm", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const pick = client.state.runs.find((r) => r.id === "run-0008")?.steps.find((s) => s.stepId === "pick");
  if (!pick) throw new Error("Missing pick");
  pick.state = "passed";
  pick.picks = [{ key: "j1", label: "Job one" }];
  const loop = await screen.findByRole("region", { name: "Review every alert" });
  const ask = screen.getByRole("region", { name: "Pick jobs" });
  for (const block of [loop, ask]) {
    expect(within(block).getAllByText("Passed").length).toBeGreaterThan(0);
    expect(within(block).queryByText("Marked passed without a passing check")).toBeNull();
    expect(
      Array.from(block.children[1]?.children ?? []).some((child) =>
        /^(Worker:|Attempt )/.test(child.textContent ?? ""),
      ),
    ).toBe(false);
  }
});

test("a step row inside an item keeps its name, its worker line and its state apart", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const step = client.state.runs.find((run) => run.id === "run-0008")?.steps.find((item) => item.items)
    ?.items?.[0]?.steps[0];
  if (!step) throw new Error("Missing item step");
  step.title = "rough";
  if (!step.worker) throw new Error("Missing worker");
  step.worker.name = "Scripted harness";
  const list = await screen.findByRole("list", { name: "Steps of j1" });
  const name = within(list).getByText("rough", { exact: true });
  const row = name.closest("li");
  if (!row) throw new Error("Missing step row");
  expect(within(row).getByText(/Worker: Scripted harness/).parentElement?.textContent).toContain(
    "Worker: Scripted harness, attempt 1 of 3",
  );
  const state = within(row)
    .getAllByText("Passed")
    .find((element) => element.parentElement?.querySelector("svg"))?.parentElement;
  expect(state?.querySelector("svg")).not.toBeNull();
  expect(state?.contains(name)).toBe(false);
});
test("a check whose label equals its type shows the word once", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const step = client.state.runs.find((run) => run.id === "run-0006")?.steps[0];
  if (!step) throw new Error("Missing fixture step");
  step.checks = [{ type: "schema", summary: "schema", required: true, verdict: "passed" }];
  const region = await screen.findByRole("region", { name: step.title });
  expect(within(region).getAllByText("schema")).toHaveLength(1);
});

test("the step block lists blocked calls under the words Blocked calls", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Build the screens" });
  const section = within(step).getByRole("region", { name: "Blocked calls" });
  expect(within(section).getByRole("heading", { name: "Blocked calls" })).toBeTruthy();
  expect(within(section).getByText("Write")).toBeTruthy();
  expect(within(section).getByText("This path is outside the folders this step declares.")).toBeTruthy();
  expect(within(section).getByText("(2 times)")).toBeTruthy();
  expect(section.querySelector("svg")).not.toBeNull();
});
test("an item lists its blocked calls too, and a hidden character in a tool name is shown", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const step = client.state.runs
    .find((run) => run.id === "run-0008")
    ?.steps.find((s) => s.items)
    ?.items?.at(0)
    ?.steps.at(0);
  if (!step) throw new Error("Missing item step");
  step.blocked = [{ tool: `Re${String.fromCodePoint(0x202e)}ad`, reason: "x", count: 1 }];
  const list = await screen.findByRole("list", { name: "Steps of j1" });
  expect(within(list).getByText("<U+202E>")).toBeTruthy();
  expect(within(list).getByText("(1 time)")).toBeTruthy();
});

test("waiting labels use the spec's words", () => {
  expect(waitingLabel({ reason: "ceiling", running: 4, ceiling: 4 })).toBe("Waiting: 4 of 4 running");
  expect(waitingLabel({ reason: "memory" })).toBe("Waiting for memory");
  expect(waitingLabel({ reason: "flow_overlap" })).toBe("Waiting for the earlier run of this flow");
  expect(waitingLabel({ reason: "quota", until: "2026-11-11T14:05:00.000Z", harnessId: "claude-code" })).toBe(
    "Waiting for Claude Code's limit (resets 14:05)",
  );
});
test("the Runs screen shows how many steps run and wait, each reason as icon plus words, and moves a run to the front", async () => {
  renderApp("#/runs");
  expect(await screen.findByText("1 step running, 2 waiting")).toBeTruthy();
  const queue = () => within(screen.getByRole("list", { name: "Queue" }));
  expect(queue().getByText("Waiting: 1 of 1 running")).toBeTruthy();
  expect(queue().getByText("Waiting for Claude Code's limit (resets 14:05)")).toBeTruthy();
  const button = queue().getAllByRole("button", { name: "Move to front" }).at(1);
  if (!button) throw new Error("Missing queue button");
  fireEvent.click(button);
  await waitFor(() =>
    expect(queue().getAllByRole("listitem").at(1)?.textContent).toContain("Waiting for Claude Code's limit"),
  );
});
test("a run that has a waiting reason shows the waiting words in place of its state words", async () => {
  const { client } = renderApp("#/runs");
  const run = client.state.runs.find((item) => item.id === "run-0005");
  if (!run) throw new Error("Missing run fixture");
  run.waiting = { reason: "flow_overlap" };
  run.state = "queued";
  const row = (await screen.findByText("run-0005")).closest("tr");
  if (!row) throw new Error("Missing run row");
  expect(within(row).getByText("Waiting for the earlier run of this flow")).toBeTruthy();
  expect(within(row).queryByText("Queued")).toBeNull();
});
test("the run screen shows tokens per step, or says they are not reported", async () => {
  renderApp("#/runs/run-0006");
  expect(
    await screen.findByText("Tokens: 4 in, 384 out, 8,454 cache read, 156 cache write (2 turns, 4.8 s)"),
  ).toBeTruthy();
  expect(screen.getAllByText("Tokens: not reported").length).toBeGreaterThan(0);
});
