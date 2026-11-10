import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { readyState, renderApp } from "../../test/render";

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
  test("approve all similar lists every item and approves them together", async () => {
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
  test("a double click resolves once", async () => {
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
