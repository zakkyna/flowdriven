// apps/desktop/src/screens/harnesses/Harnesses.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { readyState, renderApp } from "../../test/render";

const card = (name: string) => screen.getByRole("article", { name });

describe("Harnesses", () => {
  test("shows each detected harness with its risk, quota, sandbox and inventory", async () => {
    renderApp("#/harnesses");
    await screen.findByRole("article", { name: "Codex" });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Codex",
      "Claude Code",
      "Antigravity",
      "OpenCode",
    ]);
    expect(within(card("Antigravity")).getByText("Unofficial")).toBeTruthy();
    expect(
      within(card("Antigravity")).getByText("Vendor terms prohibit this; your account could be suspended."),
    ).toBeTruthy();
    expect(
      within(card("Codex")).getByText(
        "ChatGPT plan usage is shared across apps, so the brain and workers draw from the same allowance.",
      ),
    ).toBeTruthy();
    expect(within(card("Claude Code")).getByText("Exhausted until 13:00")).toBeTruthy();
    expect(within(card("Claude Code")).getByText("MCP servers (3)")).toBeTruthy();
    expect(within(card("OpenCode")).getByText("No sandbox")).toBeTruthy();
    expect(within(card("OpenCode")).getByText("Detection only")).toBeTruthy();
    expect(within(card("OpenCode")).getByText("Inventory not supported yet.")).toBeTruthy();
    expect(screen.getByText("Copilot CLI (copilot)")).toBeTruthy();
    expect(screen.getByText("Gemini CLI (gemini)")).toBeTruthy();
  });
  test("consent is given through a dialog and revoked at once", async () => {
    renderApp("#/harnesses");
    fireEvent.click(
      within(await screen.findByRole("article", { name: "Antigravity" })).getByRole("button", {
        name: "Give consent",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Let FlowDriven run Antigravity?" });
    expect(within(dialog).getByText("Antigravity is labelled unofficial.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Give consent" }));
    expect(await within(card("Antigravity")).findByRole("button", { name: "Revoke consent" })).toBeTruthy();
    fireEvent.click(within(card("Claude Code")).getByRole("button", { name: "Revoke consent" }));
    expect(await screen.findByText("Consent revoked for Claude Code.")).toBeTruthy();
  });
  test("re-scan reports what it found", async () => {
    renderApp("#/harnesses");
    fireEvent.click(await screen.findByRole("button", { name: "Re-scan" }));
    expect(await screen.findByText("Scan finished. Found 4 harnesses.")).toBeTruthy();
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/harnesses");
    expect(readyState(container, "harnesses")).toBe("false");
    await screen.findByRole("article", { name: "Codex" });
    await waitFor(() => expect(readyState(container, "harnesses")).toBe("true"));
  });
  test("empty", async () => {
    renderApp("#/harnesses", { scenario: "empty" });
    expect(await screen.findByText("No harnesses found.")).toBeTruthy();
  });
});
test("uses singular words for one detected harness and one call", async () => {
  const { client } = renderApp("#/harnesses");
  client.state.harnesses.forEach((h, index) => {
    h.detected = index === 0;
    h.quota.today.calls = 1;
    h.quota.week.calls = 1;
  });
  expect(await screen.findByText("Today: 1 call. This week: 1 call.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
  expect(await screen.findByText("Scan finished. Found 1 harness.")).toBeTruthy();
});
test("shows a rescan failure", async () => {
  const { client } = renderApp("#/harnesses");
  const button = await screen.findByRole("button", { name: "Re-scan" });
  await screen.findByRole("article", { name: "Codex" });
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Scan failed"));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toBe("Scan failed");
});
test("shows a consent failure", async () => {
  const { client } = renderApp("#/harnesses");
  const claude = await screen.findByRole("article", { name: "Claude Code" });
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Consent failed"));
  fireEvent.click(within(claude).getByRole("button", { name: "Revoke consent" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Consent failed");
});
