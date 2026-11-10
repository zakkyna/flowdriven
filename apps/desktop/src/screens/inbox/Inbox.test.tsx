import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
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
