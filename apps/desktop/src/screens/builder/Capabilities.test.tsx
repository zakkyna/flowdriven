import { RunnerError } from "@flowdriven/contracts/v1";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "../../test/render";

const builder = "#/builder/dev.example.job-review";
const flowId = "dev.example.job-review";
async function section() {
  return within(await screen.findByRole("region", { name: "What this flow may touch" }));
}
async function rowOf(text: string) {
  const view = await section();
  const item = view.getByText(text, { exact: false }).closest("li");
  if (!item) throw new Error(`Missing row for ${text}`);
  return within(item);
}
function flowHash(client: ReturnType<typeof renderApp>["client"]): string {
  const flow = client.state.flows.find((f) => f.manifest.id === flowId);
  if (!flow) throw new Error("Missing flow");
  return flow.hash;
}

test("lists the Chrome row, the folder row and two dropped rows, each with an icon and words", async () => {
  renderApp(builder, { scenario: "looped" });
  const view = await section();
  const items = view.getAllByRole("listitem");
  expect(items).toHaveLength(4);
  const chrome = within(items[0] as HTMLElement);
  const folder = within(items[1] as HTMLElement);
  expect(chrome.getByText(/^Reads pages on www\.upwork\.com in your own browser/)).toBeTruthy();
  expect(folder.getByText("Reads and writes files in job-review.")).toBeTruthy();
  for (const routed of [chrome, folder]) {
    expect(routed.getByText(/^Provider: /)).toBeTruthy();
    expect(routed.getAllByText((_, node) => node?.querySelector("svg") !== null).length).toBeGreaterThan(0);
  }
  for (const index of [2, 3]) {
    const dropped = within(items[index] as HTMLElement);
    expect(dropped.getByText(/^Not available: /)).toBeTruthy();
    expect(dropped.queryByText(/^Provider: /)).toBeNull();
    expect((items[index] as HTMLElement).querySelector("svg")).not.toBeNull();
  }
});
test("the Chrome row says it is unofficial with the personal browser sentence, who enforces it, that it can run while away and its token cost", async () => {
  renderApp(builder, { scenario: "looped" });
  const chrome = await rowOf("in your own browser");
  expect(chrome.getByText("Provider: Claude in Chrome inside Claude Code")).toBeTruthy();
  expect(chrome.getByText("Enforced by: FlowDriven hook in Claude Code")).toBeTruthy();
  expect(chrome.getByText("Unofficial")).toBeTruthy();
  expect(chrome.queryByText("Official")).toBeNull();
  expect(
    chrome.getByText("This uses your personal browser. Every site you are logged into is reachable from it."),
  ).toBeTruthy();
  expect(chrome.getByText("Can run while you are away: yes")).toBeTruthy();
  expect(chrome.getByText("Adds about 12,000 tokens to each call of a step that uses it.")).toBeTruthy();
  const folder = await rowOf("files in job-review");
  expect(folder.getByText("Official")).toBeTruthy();
});
test("a dropped row says Not available with its reason, and the templates are behind Details", async () => {
  renderApp(builder, { scenario: "looped" });
  const dropped = await rowOf("A connector");
  expect(dropped.getByText("Not available: FlowDriven cannot provide this yet.")).toBeTruthy();
  expect(dropped.queryByText("Details")).toBeNull();
  const chrome = await rowOf("in your own browser");
  const summary = chrome.getByText("Details");
  expect(summary.tagName).toBe("SUMMARY");
  const details = summary.closest("details");
  expect(details?.hasAttribute("open")).toBe(false);
  expect(
    within(details as HTMLElement).getByText("https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}"),
  ).toBeTruthy();
});
test("the caps line and the triggers line are shown for the job-alert flow", async () => {
  renderApp(builder, { scenario: "looped" });
  const view = await section();
  expect(view.getByText("Up to 24 runs a day and 20 items a run.")).toBeTruthy();
  expect(
    view.getByText("A new version of this flow turns its triggers off until you OK them again."),
  ).toBeTruthy();
});
test("with no allow the section says the flow cannot run and has an Allow button; pressing it calls flows.allowCapabilities with the flow's hash and then shows Allowed for this version and a Withdraw button", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const view = await section();
  expect(view.getByText("This flow cannot run until you allow this.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Withdraw" })).toBeNull();
  const spy = vi.spyOn(client, "call");
  fireEvent.click(view.getByRole("button", { name: "Allow" }));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith("flows.allowCapabilities", { flowId, hash: flowHash(client) }),
  );
  expect(await view.findByText("Allowed for this version")).toBeTruthy();
  expect(view.getByRole("button", { name: "Withdraw" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(view.queryByText("This flow cannot run until you allow this.")).toBeNull();
});
test("Withdraw calls flows.withdrawCapabilities and the state goes back to none", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  client.state.capabilityConsents[flowId] = { hash: flowHash(client) };
  const view = await section();
  expect(await view.findByText("Allowed for this version")).toBeTruthy();
  const spy = vi.spyOn(client, "call");
  fireEvent.click(view.getByRole("button", { name: "Withdraw" }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith("flows.withdrawCapabilities", { flowId }));
  expect(await view.findByText("This flow cannot run until you allow this.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Allow" })).toBeTruthy();
  expect(client.state.capabilityConsents[flowId]).toBeUndefined();
});
test("a stale state says This flow changed. Allow again.", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  client.state.capabilityConsents[flowId] = { hash: `sha256:${"1".repeat(64)}` };
  const view = await section();
  expect(await view.findByText("This flow changed. Allow again.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Allow" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Withdraw" })).toBeNull();
});
test("an error from the allow is shown in an alert and the buttons are enabled again; a not_allowed answer from flows.capabilities shows its sentence and no button", async () => {
  const first = renderApp(builder, { scenario: "looped" });
  const view = await section();
  const allow = view.getByRole("button", { name: "Allow" });
  vi.spyOn(first.client, "call").mockRejectedValueOnce(
    new RunnerError("not_allowed", "This flow cannot be allowed now."),
  );
  fireEvent.click(allow);
  expect((await view.findByRole("alert")).textContent).toContain("This flow cannot be allowed now.");
  expect(view.getByRole("button", { name: "Allow" })).toHaveProperty("disabled", false);
  expect(view.getByText("This flow cannot run until you allow this.")).toBeTruthy();
  first.unmount();

  const second = renderApp(builder, { scenario: "looped" });
  const original = second.client.call.bind(second.client);
  vi.spyOn(second.client, "call").mockImplementation(((name: string, input: unknown) =>
    name === "flows.capabilities"
      ? Promise.reject(new RunnerError("not_allowed", "This flow declares more than the preview can show."))
      : original(name as never, input as never)) as typeof second.client.call);
  const refused = await section();
  expect((await refused.findByRole("alert")).textContent).toContain(
    "This flow declares more than the preview can show.",
  );
  expect(refused.queryByRole("button")).toBeNull();
  expect(refused.queryByRole("listitem")).toBeNull();
});
test("a flow that needs no allow shows its rows and no state line and no button", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const original = client.call.bind(client);
  vi.spyOn(client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await original(name as never, input as never);
    return name === "flows.capabilities" ? { ...(answer as object), needsAllow: false } : answer;
  }) as typeof client.call);
  const view = await section();
  expect(view.getAllByRole("listitem")).toHaveLength(4);
  expect(view.queryByRole("button")).toBeNull();
  expect(view.queryByText("This flow cannot run until you allow this.")).toBeNull();
  expect(view.queryByText("Allowed for this version")).toBeNull();
  expect(view.queryByText("This flow changed. Allow again.")).toBeNull();
});
test("the section sits between What this flow does and Triggers, and its heading has the id capabilities-heading", async () => {
  renderApp(builder, { scenario: "looped" });
  const heading = await screen.findByRole("heading", { name: "What this flow may touch" });
  expect(heading.id).toBe("capabilities-heading");
  const before = screen.getByRole("heading", { name: "What this flow does" });
  const after = await screen.findByRole("heading", { name: "Triggers" });
  expect(before.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(heading.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
const SENTENCE = "FlowDriven cannot provide the web pages this flow reads yet, so there is nothing to allow.";
function droppedWebRows(rows: Record<string, unknown>[]) {
  return rows.map((row) =>
    row.type === "web"
      ? {
          requirementId: row.requirementId,
          type: "web",
          sentence: row.sentence,
          routed: false,
          reason: "This Claude Code cannot use Chrome.",
          away: false,
          details: [],
        }
      : row,
  );
}
test("the panel shows the sentence of allowBlocked and no Allow button, and with no allowBlocked it shows Allow even when an unused web row is not routed", async () => {
  const first = renderApp(builder, { scenario: "looped" });
  const original = first.client.call.bind(first.client);
  vi.spyOn(first.client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await original(name as never, input as never);
    if (name !== "flows.capabilities") return answer;
    const caps = answer as { rows: Record<string, unknown>[] };
    return { ...caps, rows: droppedWebRows(caps.rows), allowBlocked: SENTENCE };
  }) as typeof first.client.call);
  const blocked = await section();
  const notice = await blocked.findByText(SENTENCE);
  expect(notice.closest("span")?.querySelector("svg")).not.toBeNull();
  expect(blocked.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(blocked.queryByText("This flow cannot run until you allow this.")).toBeNull();
  first.unmount();

  // The sentence is whatever the read model says, not a constant of the panel.
  const custom = renderApp(builder, { scenario: "looped" });
  const customOriginal = custom.client.call.bind(custom.client);
  vi.spyOn(custom.client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await customOriginal(name as never, input as never);
    return name === "flows.capabilities"
      ? { ...(answer as object), allowBlocked: "Nothing can be allowed right now." }
      : answer;
  }) as typeof custom.client.call);
  const customView = await section();
  expect(await customView.findByText("Nothing can be allowed right now.")).toBeTruthy();
  expect(customView.queryByRole("button", { name: "Allow" })).toBeNull();
  custom.unmount();

  const second = renderApp(builder, { scenario: "looped" });
  const secondOriginal = second.client.call.bind(second.client);
  vi.spyOn(second.client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await secondOriginal(name as never, input as never);
    if (name !== "flows.capabilities") return answer;
    const caps = answer as { rows: Record<string, unknown>[] };
    return { ...caps, rows: droppedWebRows(caps.rows) };
  }) as typeof second.client.call);
  const open = await section();
  expect(await open.findByRole("button", { name: "Allow" })).toBeTruthy();
  expect(open.queryByText(SENTENCE)).toBeNull();
});
test("Allow sends the hash of the capabilities answer on the screen", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const newer = `sha256:${"b".repeat(64)}`;
  const original = client.call.bind(client);
  vi.spyOn(client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await original(name as never, input as never);
    return name === "flows.get" ? { ...(answer as object), hash: newer } : answer;
  }) as typeof client.call);
  const view = await section();
  const shown = flowHash(client);
  expect(shown).not.toBe(newer);
  const spy = vi.spyOn(client, "call");
  fireEvent.click(view.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith("flows.allowCapabilities", { flowId, hash: shown }));
  expect(spy).not.toHaveBeenCalledWith("flows.allowCapabilities", { flowId, hash: newer });
});
test("the screen sends the pins of the rows it shows when the owner presses Allow", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const original = client.call.bind(client);
  const pin = `sha256:${"a".repeat(64)}`;
  const spy = vi.spyOn(client, "call").mockImplementation((async (name: string, input: unknown) => {
    const answer = await original(name as never, input as never);
    if (name !== "flows.capabilities") return answer;
    const caps = answer as { rows: Record<string, unknown>[] };
    return { ...caps, rows: caps.rows.map((row, index) => (index === 0 ? { ...row, pin } : row)) };
  }) as typeof client.call);
  const view = await section();
  fireEvent.click(view.getByRole("button", { name: "Allow" }));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith("flows.allowCapabilities", {
      flowId,
      hash: flowHash(client),
      pins: expect.objectContaining({ jobs_web: pin }),
    }),
  );
});
