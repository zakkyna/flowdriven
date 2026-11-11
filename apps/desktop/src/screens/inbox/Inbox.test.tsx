import { readFileSync } from "node:fs";
import { Approval } from "@flowdriven/contracts";
import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "../../App";
import { RunnerProvider } from "../../runner/runner-context";
import { readyState, renderApp } from "../../test/render";
import { PayloadView } from "./PayloadView";

const css = readFileSync("apps/desktop/src/screens/inbox/Inbox.module.css", "utf8");

const list = () => screen.getByRole("list", { name: "Decisions" });

describe("Inbox", () => {
  test("lists waiting decisions newest first and opens the first", async () => {
    renderApp("#/inbox");
    expect(await screen.findByRole("tab", { name: "Waiting (5)", selected: true })).toBeTruthy();
    const items = within(list()).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain("Lead follow-up");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Approve the changes to Lead follow-up (version 1.3.0)",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getAllByText(/^\+/).length).toBeGreaterThan(0);
  });
  test("shows the full email payload and its actions", async () => {
    renderApp("#/inbox/ap-0011");
    expect(await screen.findByText("Priya Shah <priya@example.com>")).toBeTruthy();
    expect(screen.getByText("Re: Invoice 1042")).toBeTruthy();
    expect(screen.getByText(/^Hi Priya,/)).toBeTruthy();
    for (const name of ["Approve", "Edit", "Reject", "Approve all 3 similar for this run"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
  });
  test("approve all similar lists every item and approves each one", async () => {
    renderApp("#/inbox/ap-0011");
    fireEvent.click(await screen.findByRole("button", { name: "Approve all 3 similar for this run" }));
    const dialog = screen.getByRole("dialog", { name: "Approve 3 similar sends?" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    expect(within(dialog).getByText("This covers this run only and is logged.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve 3" }));
    expect(await screen.findByText("Approved 3 sends.")).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Waiting (2)" })).toBeTruthy();
  });
  test("edit approves with the edited text", async () => {
    const { client } = renderApp("#/inbox/ap-0012");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit the text") as HTMLTextAreaElement;
    expect(box.value).toMatch(/^Hi Tomás,/);
    fireEvent.change(box, { target: { value: "Hi Tomás, it ships Friday." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
    expect(await screen.findByText("Approved with edits.")).toBeTruthy();
    const approved = await client.call("approvals.list", { state: "approved" });
    expect(approved.find((a) => a.id === "ap-0012")?.payload).toMatchObject({
      body: "Hi Tomás, it ships Friday.",
    });
  });
  test("reject asks first and fails the run", async () => {
    const { client } = renderApp("#/inbox/ap-0014");
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog", { name: "Reject this post?" });
    expect(within(dialog).getByText("The run stops at step “Publish” and is marked failed.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Rejected.")).toBeTruthy();
    expect((await client.call("runs.status", { runId: "run-0004" })).state).toBe("failed");
  });
  test("simultaneous clicks resolve once while the request is in flight", async () => {
    const { client } = renderApp("#/inbox/ap-0014");
    const spy = vi.spyOn(client, "call");
    const approve = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    await screen.findByText("Approved.");
    expect(spy.mock.calls.filter(([name]) => name === "approvals.resolve")).toHaveLength(1);
  });
  test("resolved tab and empty states", async () => {
    renderApp("#/inbox");
    fireEvent.click(await screen.findByRole("tab", { name: "Resolved (2)" }));
    await waitFor(() => expect(within(list()).getAllByRole("listitem")).toHaveLength(2));
  });
  test("shows hidden characters and caps long recipient lists", async () => {
    renderApp("#/inbox/ap-0016", { scenario: "long" });
    expect(await screen.findByText("manager-01@example.com")).toBeTruthy();
    expect(screen.getByText("manager-05@example.com")).toBeTruthy();
    expect(screen.queryByText("manager-06@example.com")).toBeNull();
    expect(screen.getByText("and 11 more")).toBeTruthy();
    const tokens = screen.getAllByText(/^<U\+[0-9A-F]{4}>$/).map((el) => el.textContent);
    expect(tokens).toEqual(expect.arrayContaining(["<U+202E>", "<U+200B>"]));
    expect(document.body.innerHTML).not.toContain(String.fromCodePoint(0x202e));
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/inbox");
    expect(readyState(container, "inbox")).toBe("false");
    await screen.findByRole("tab", { name: "Waiting (5)" });
    await waitFor(() => expect(readyState(container, "inbox")).toBe("true"));
  });
  test("shows decision not found", async () => {
    renderApp("#/inbox/ap-9999");
    expect(await screen.findByRole("heading", { level: 1, name: "Decision not found" })).toBeTruthy();
    expect(screen.getByText("There is no decision ap-9999 in your inbox.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Inbox" }).getAttribute("href")).toBe("#/inbox");
  });
  test("empty", async () => {
    renderApp("#/inbox", { scenario: "empty" });
    expect(await screen.findByText("Nothing is waiting for you.")).toBeTruthy();
  });
});

test("a second click after 400 ms cannot approve another decision", async () => {
  const { client } = renderApp("#/inbox");
  const spy = vi.spyOn(client, "call");
  const button = await screen.findByRole("button", { name: "Approve" });
  fireEvent.click(button);
  await screen.findByText("Approved.");
  await new Promise((resolve) => setTimeout(resolve, 400));
  fireEvent.click(button);
  expect(spy.mock.calls.filter(([name]) => name === "approvals.resolve")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});

test("new arrivals do not replace the selected editor", async () => {
  const { client } = renderApp("#/inbox");
  const original = client.state.approvals.find((item) => item.id === "ap-0012");
  if (!original) throw new Error("Missing fixture");
  original.createdAt = "2098-01-01T00:00:00Z";
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  client.state.approvals.push({
    ...structuredClone(original),
    id: "ap-9000",
    summary: "New arrival",
    createdAt: "2099-01-01T00:00:00Z",
  });
  await client.call("approvals.resolve", { approvalId: "ap-0014", decision: "approve" });
  await screen.findByText("New arrival");
  expect((screen.getByLabelText("Edit the text") as HTMLTextAreaElement).value).toMatch(/^Hi Tomás,/);
  expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe("New arrival");
});

test("edit preview reveals hidden characters and sends the previewed text", async () => {
  const { client } = renderApp("#/inbox/ap-0012");
  const item = client.state.approvals.find((a) => a.id === "ap-0012");
  if (!item || item.payload.kind !== "email") throw new Error("Missing fixture");
  item.payload.body = `Hi ${String.fromCodePoint(0x202e)}evil`;
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByText("<U+202E>")).toBeTruthy();
  const spy = vi.spyOn(client, "call");
  fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
  await screen.findByText("Approved with edits.");
  expect(spy).toHaveBeenCalledWith("approvals.resolve", {
    approvalId: "ap-0012",
    decision: "edit",
    editedText: item.payload.body,
  });
});

test("expands recipients and reveals line breaks in single-line fields", async () => {
  const { client } = renderApp("#/inbox/ap-0016", { scenario: "long" });
  const item = client.state.approvals.find((a) => a.id === "ap-0016");
  if (!item || item.payload.kind !== "email") throw new Error("Missing fixture");
  item.payload.subject = "subject\nBcc: evil";
  fireEvent.click(await screen.findByRole("button", { name: "and 11 more" }));
  expect(screen.getByText("manager-16@example.com")).toBeTruthy();
  expect(screen.getByText("<U+000A>")).toBeTruthy();
});

test("reveals summary metadata and places errors inside the dialog", async () => {
  const { client } = renderApp("#/inbox/ap-0014");
  const item = client.state.approvals.find((a) => a.id === "ap-0014");
  if (!item) throw new Error("Missing fixture");
  item.summary = `Title${String.fromCodePoint(0x202e)}test`;
  item.stepTitle = `Step${String.fromCodePoint(0x200b)}test`;
  fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
  vi.spyOn(client, "call").mockRejectedValue(new Error("Runner down"));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("<U+200B>")).toBeTruthy();
  expect(screen.getAllByText("<U+202E>").length).toBeGreaterThan(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("Runner down");
});

test("approve all sends only the ids shown in its dialog", async () => {
  const { client } = renderApp("#/inbox/ap-0011");
  const spy = vi.spyOn(client, "call");
  fireEvent.click(await screen.findByRole("button", { name: "Approve all 3 similar for this run" }));
  const item = client.state.approvals.find((a) => a.id === "ap-0011");
  if (!item) throw new Error("Missing fixture");
  client.state.approvals.push({ ...structuredClone(item), id: "ap-9000" });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve 3" }));
  await screen.findByText("Approved 3 sends.");
  const calls = spy.mock.calls.filter(([name]) => name === "approvals.resolve");
  expect(calls.map(([, input]) => input)).toEqual(
    expect.arrayContaining([
      { approvalId: "ap-0011", decision: "approve" },
      { approvalId: "ap-0012", decision: "approve" },
      { approvalId: "ap-0013", decision: "approve" },
    ]),
  );
  expect(calls).toHaveLength(3);
  expect(client.state.approvals.find((a) => a.id === "ap-9000")?.state).toBe("pending");
});

test("patch preserves indentation and blank lines", async () => {
  render(
    <PayloadView
      payload={{ kind: "diff", files: [{ path: "test.yml", patch: "  indented\n\n+  added" }] }}
      editing={false}
      text=""
      setText={() => {}}
      picks={[]}
      setPicks={() => {}}
      pickable={false}
    />,
  );
  const patch = screen.getByText("+ added").parentElement;
  expect(patch?.children).toHaveLength(3);
  expect(patch?.children[0]?.textContent).toBe("  indented");
  expect(patch?.children[1]?.textContent).toBe("");
  expect(css).toMatch(/\.patch\s*\{[^}]*white-space:\s*pre-wrap/s);
  expect(css).toMatch(/\.patch\s*>\s*div\s*\{[^}]*min-height:/s);
});

test("tabs expose their panel and support arrow keys", async () => {
  renderApp("#/inbox");
  const waiting = await screen.findByRole("tab", { name: "Waiting (5)" });
  expect(waiting.getAttribute("aria-controls")).toBe(screen.getByRole("tabpanel").id);
  fireEvent.keyDown(waiting, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Resolved (2)" }).getAttribute("aria-selected")).toBe("true");
});

test("resolved decisions have no decision actions and feedback is in the detail panel", async () => {
  renderApp("#/inbox/ap-0014");
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  const status = await screen.findByRole("status");
  expect(status.parentElement?.querySelector("h2")?.textContent).toBeTruthy();
  expect(status.parentElement?.textContent).toContain("Approvals expire after 24 hours.");
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
});

test("expired decisions have no actions", async () => {
  const { client } = renderApp("#/inbox/ap-0014");
  const item = client.state.approvals.find((a) => a.id === "ap-0014");
  if (!item) throw new Error("Missing fixture");
  item.state = "expired";
  expect((await screen.findAllByText("Expired")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
});

test("batch cannot be dismissed while approvals are running", async () => {
  const { client } = renderApp("#/inbox/ap-0011");
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  vi.spyOn(client, "call").mockImplementation((name, input) => {
    if (name === "approvals.resolve")
      return new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => original(name, input as never));
    return original(name, input as never);
  });
  fireEvent.click(await screen.findByRole("button", { name: "Approve all 3 similar for this run" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Approve 3" }));
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveProperty("disabled", true);
  fireEvent.click(cancel);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  for (let i = 0; i < 3; i++) {
    await waitFor(() => expect(release).toBeDefined());
    const next = release;
    release = undefined;
    await act(async () => next?.());
  }
  await screen.findByText("Approved 3 sends.");
  expect(
    client.state.approvals
      .filter((a) => ["ap-0011", "ap-0012", "ap-0013"].includes(a.id))
      .map((a) => a.state),
  ).toEqual(["approved", "approved", "approved"]);
});

test.each(["approve", "edit", "reject"] as const)(
  "%s cannot be repeated before a delayed change event",
  async (decision) => {
    window.location.hash = "#/inbox/ap-0012";
    const client = createFixtureRunnerClient();
    const subscribe = client.subscribe.bind(client);
    const events: (() => void)[] = [];
    vi.spyOn(client, "subscribe").mockImplementation((listener) =>
      subscribe((event) => events.push(() => listener(event))),
    );
    const spy = vi.spyOn(client, "call");
    render(
      <RunnerProvider client={client}>
        <App />
      </RunnerProvider>,
    );
    await screen.findByRole("button", { name: "Approve" });
    if (decision === "edit") {
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      fireEvent.click(screen.getByRole("button", { name: "Approve with edits" }));
    } else if (decision === "reject") {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reject" }));
    } else fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(
      decision === "reject" ? "Rejected." : decision === "edit" ? "Approved with edits." : "Approved.",
    );
    const approve = screen.queryByRole("button", { name: "Approve" });
    if (approve) fireEvent.click(approve);
    expect(spy.mock.calls.filter(([name]) => name === "approvals.resolve")).toHaveLength(1);
    await act(async () => {
      for (const event of events.splice(0)) event();
    });
  },
);

test("a pending decision does not change a newer selection", async () => {
  const { client } = renderApp("#/inbox/ap-0012");
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  vi.spyOn(client, "call").mockImplementation((name, input) =>
    name === "approvals.resolve"
      ? new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => original(name, input as never))
      : original(name, input as never),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
  const other = client.state.approvals.find((a) => a.id === "ap-0011");
  if (!other) throw new Error("Missing fixture");
  fireEvent.click(within(list()).getByRole("button", { name: new RegExp(other.summary) }));
  await waitFor(() => expect(window.location.hash).toBe("#/inbox/ap-0011"));
  await act(async () => release?.());
  expect(window.location.hash).toBe("#/inbox/ap-0011");
  expect(screen.getByRole("heading", { level: 2, name: other.summary })).toBeTruthy();
});

test("a failed plain approval shows an alert in the detail", async () => {
  const { client } = renderApp("#/inbox/ap-0014");
  await screen.findByRole("button", { name: "Approve" });
  vi.spyOn(client, "call").mockRejectedValue(new Error("Approval failed"));
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Approval failed");
  expect(alert.parentElement?.querySelector("h2")).toBeTruthy();
});

test("the Inbox has one h1 and, with a decision open, one h2", async () => {
  renderApp("#/inbox/ap-0011");
  await screen.findByRole("heading", { level: 2, name: "Send a reply to Priya Shah about invoice 1042" });
  expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Inbox"]);
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  const heading = screen.getByRole("heading", { level: 1, name: "Inbox" });
  expect(heading.tabIndex).toBe(-1);
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.title).toBe("Inbox - FlowDriven");
  expect(
    screen.queryByText("Decisions waiting for you. Nothing risky happens until you approve it."),
  ).toBeNull();
});
test("the open decision is marked in the list and its title is the detail heading", async () => {
  renderApp("#/inbox/ap-0011");
  const heading = await screen.findByRole("heading", { level: 2 });
  const current = within(list())
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-current") === "true");
  expect(current).toHaveLength(1);
  expect(current[0]?.textContent).toContain(heading.textContent ?? "never");
});
test("waiting rows say when they expire, and resolved rows show the decision as icon plus word", async () => {
  renderApp("#/inbox");
  const tab = await screen.findByRole("tab", { name: "Waiting (5)" });
  expect(tab.textContent).toBe("Waiting (5)");
  expect(tab.hasAttribute("aria-label")).toBe(false);
  const waiting = await within(list()).findAllByRole("listitem");
  for (const item of waiting) expect(item.textContent).toMatch(/Expires \d+ \w+, \d\d:\d\d/);
  fireEvent.click(await screen.findByRole("tab", { name: "Resolved (2)" }));
  await waitFor(() => expect(within(list()).getAllByRole("listitem")).toHaveLength(2));
  for (const item of within(list()).getAllByRole("listitem")) {
    expect(item.textContent).toMatch(/Approved|Rejected|Expired/);
    expect(item.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  }
});
test("the list column and rows follow the approved layout", () => {
  expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*var\(--list-width\) minmax\(0, 1fr\)/s);
  expect(css).toMatch(/\.item\[aria-current="true"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(css).toMatch(/\.item\[aria-current="true"\]::before\s*\{[^}]*background:\s*var\(--accent\)/s);
  expect(css).toMatch(/\.summary\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  expect(css).toMatch(/\.tab\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(css).toMatch(/\.tab\[aria-selected="true"\]::after\s*\{[^}]*background:\s*var\(--accent\)/s);
  expect(css).toMatch(/\.items\s*\{[^}]*overflow-y:\s*auto/s);
  expect(css).toMatch(/\.detailScroll\s*\{[^}]*overflow-y:\s*auto/s);
  expect(css).toMatch(/\.count\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
});

test("everything that would be sent is above the buttons, under a strip that says what it is", async () => {
  renderApp("#/inbox/ap-0011");
  const strip = await screen.findByRole("heading", {
    level: 3,
    name: "This is the email that would be sent",
  });
  const card = strip.parentElement as HTMLElement;
  expect(within(card).getByText("Priya Shah <priya@example.com>")).toBeTruthy();
  expect(within(card).getByText("Re: Invoice 1042")).toBeTruthy();
  expect(within(card).getByText(/^Hi Priya,/)).toBeTruthy();
  const note = screen.getByText("Nothing is sent until you choose.");
  const approve = screen.getByRole("button", { name: "Approve" });
  expect(card.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("Approve is the only filled button, Edit and Reject match, Approve all is a text button with its explanation", async () => {
  renderApp("#/inbox/ap-0011");
  const approve = await screen.findByRole("button", { name: "Approve" });
  const edit = screen.getByRole("button", { name: "Edit" });
  const reject = screen.getByRole("button", { name: "Reject" });
  const all = screen.getByRole("button", { name: "Approve all 3 similar for this run" });
  expect(approve.getAttribute("data-variant")).toBe("primary");
  for (const button of [approve, edit, reject]) expect(button.getAttribute("data-size")).toBe("large");
  expect([edit, reject].map((b) => b.getAttribute("data-variant"))).toEqual(["secondary", "secondary"]);
  expect(all.getAttribute("data-variant")).toBe("text");
  const filled = within(screen.getByRole("main"))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("data-variant") === "primary");
  expect(filled).toEqual([approve]);
  const explanation = screen.getByText(
    "You see all 3 sends before anything is approved. This covers this run only.",
  );
  expect(all.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reject.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("the bar shows the decision state and its expiry, then when it was resolved", async () => {
  renderApp("#/inbox/ap-0014");
  const bar = await screen.findByRole("group", { name: "Decision state" });
  expect(within(bar).getByText("Waiting for you")).toBeTruthy();
  expect(within(bar).getByText(/^Expires \d+ \w+, \d\d:\d\d$/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await screen.findByText("Approved.");
  expect(within(screen.getByRole("group", { name: "Decision state" })).getByText("Approved")).toBeTruthy();
  expect(
    within(screen.getByRole("group", { name: "Decision state" })).getByText(/^Resolved \d+ \w+, \d\d:\d\d$/),
  ).toBeTruthy();
});
test("a post and a change are labelled for what they are", async () => {
  const post = renderApp("#/inbox/ap-0014");
  expect(
    await screen.findByRole("heading", { level: 3, name: "This is the post that would be published" }),
  ).toBeTruthy();
  expect(screen.getByText("Nothing is posted until you choose.")).toBeTruthy();
  post.unmount();
  renderApp("#/inbox");
  expect(
    await screen.findByRole("heading", { level: 3, name: "These are the changes you are approving" }),
  ).toBeTruthy();
  expect(screen.getByText("Nothing changes until you choose.")).toBeTruthy();
});
test("the decision styles follow the approved layout", () => {
  expect(css).toMatch(/\.col\s*\{[^}]*max-width:\s*var\(--decision-width\)/s);
  expect(css).toMatch(
    /\.strip\s*\{[^}]*background:\s*var\(--surface-sunken\)[^}]*border-bottom:\s*1px solid var\(--border\)/s,
  );
  expect(css).toMatch(
    /\.body\s*\{[^}]*font-size:\s*var\(--text-read\)[^}]*line-height:\s*1\.65[^}]*white-space:\s*pre-wrap/s,
  );
  expect(css).toMatch(/\.similar\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).toMatch(/\.hidden\s*\{[^}]*background:\s*var\(--bad-soft\)[^}]*color:\s*var\(--bad\)/s);
  expect(css).toMatch(/\.patch\s*\{[^}]*white-space:\s*pre-wrap/s);
});

function choice(overrides: Record<string, unknown> = {}): Approval {
  return Approval.parse({
    id: "ap-choice",
    kind: "ask",
    flowId: "dev.example.figma-to-flutter",
    flowName: "Figma to Flutter",
    runId: "run-0006",
    stepId: "pick",
    summary: "Which jobs get a prototype?",
    payload: {
      kind: "choice",
      question: "Which jobs?",
      options: [
        { key: "j1", label: "Job one" },
        { key: "j2", label: "Job two" },
      ],
      maxPick: 1,
    },
    editable: false,
    createdAt: "2026-11-10T09:00:00.000Z",
    expiresAt: "2026-11-12T09:00:00.000Z",
    state: "pending",
    ...overrides,
  });
}
function renderChoice(overrides: Record<string, unknown> = {}) {
  const view = renderApp("#/inbox/ap-choice");
  const run = view.client.state.runs.find((r) => r.id === "run-0006");
  const step = run?.steps.at(0);
  if (!run || !step) throw new Error("Missing run or step");
  run.state = "waiting_approval";
  step.stepId = "pick";
  step.state = "waiting_approval";
  view.client.state.approvals.push(choice(overrides));
  return view;
}
test("a choice shows its question, its options and one Send choice button", async () => {
  renderChoice();
  expect(await screen.findByText("Which jobs?")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Job one/ })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Job two/ })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Send choice" })).toHaveLength(1);
  for (const name of ["Approve", "Edit", "Reject"]) expect(screen.queryByRole("button", { name })).toBeNull();
});
test("Send choice sends the picked keys and shows Choice sent.", async () => {
  const { client } = renderChoice();
  const spy = vi.spyOn(client, "call");
  fireEvent.click(await screen.findByRole("checkbox", { name: /Job one/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send choice" }));
  await screen.findByText("Choice sent.");
  expect(spy).toHaveBeenCalledWith("approvals.answer", { approvalId: "ap-choice", picks: ["j1"] });
});
test("with maxPick 1 a second box is disabled until the first is cleared", async () => {
  renderChoice();
  const first = await screen.findByRole("checkbox", { name: /Job one/ });
  const second = screen.getByRole("checkbox", { name: /Job two/ });
  fireEvent.click(first);
  expect(second).toHaveProperty("disabled", true);
  fireEvent.click(first);
  expect(second).toHaveProperty("disabled", false);
});
test("a second click cannot send the choice twice and the choice sent is the one shown", async () => {
  const { client } = renderChoice();
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  const spy = vi.spyOn(client, "call").mockImplementation((name, input) =>
    name === "approvals.answer"
      ? new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => original(name, input as never))
      : original(name, input as never),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /Job one/ }));
  const button = screen.getByRole("button", { name: "Send choice" });
  fireEvent.click(button);
  fireEvent.click(button);
  const other = client.state.approvals.find((a) => a.id === "ap-0011");
  if (!other) throw new Error("Missing approval");
  fireEvent.click(within(list()).getByRole("button", { name: new RegExp(other.summary) }));
  await act(async () => release?.());
  expect(spy.mock.calls.filter(([name]) => name === "approvals.answer")).toEqual([
    ["approvals.answer", { approvalId: "ap-choice", picks: ["j1"] }],
  ]);
  expect(window.location.hash).toBe("#/inbox/ap-0011");
});
test("a resolved choice lists what was picked and offers no button", async () => {
  renderChoice({ state: "approved", picks: ["j1"], resolvedAt: "2026-11-10T10:00:00.000Z" });
  expect(await screen.findByText("Picked")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Job one/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("checkbox", { name: /Job one/ })).toHaveProperty("checked", true);
  expect(screen.queryByRole("button", { name: "Send choice" })).toBeNull();
});

test("a choice that releases tools names them before it is sent", async () => {
  const sentence = "Choosing releases these tools for the items you pick, in this run only:";
  const view = renderApp("#/inbox/ap-0017", { scenario: "looped" });
  expect(await screen.findByText(sentence)).toBeTruthy();
  expect(screen.getByText("host.prototype_publish")).toBeTruthy();
  view.unmount();
  renderChoice();
  await screen.findByRole("checkbox", { name: /Job one/ });
  expect(screen.queryByText(sentence)).toBeNull();
});

test("a weekly limit approval shows its action and harness", async () => {
  const view = renderApp("#/inbox/weekly-limit:claude-code");
  view.client.state.approvals.push(
    Approval.parse({
      id: "weekly-limit:claude-code",
      kind: "weekly_limit",
      summary: "Claude Code's weekly limit is 90% used and resets on Saturday. Keep running triggered flows?",
      payload: {
        kind: "text",
        text: "Claude Code's weekly limit is 90% used and resets on Saturday. Keep running triggered flows?",
      },
      editable: false,
      createdAt: "2026-11-11T09:00:00.000Z",
      expiresAt: "2026-11-14T09:00:00.000Z",
      state: "pending",
    }),
  );
  expect(await screen.findByText("Weekly limit")).toBeTruthy();
  expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
});
