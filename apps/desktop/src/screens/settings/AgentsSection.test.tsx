import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderApp } from "../../test/render";

afterEach(() => {
  cleanup();
});

test("TC-j12-05 Agent rows show state words and the one right button without usage rows", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(client) {
      const claude = client.state.agents.find((agent) => agent.id === "claude-code");
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (claude) {
        claude.state = "ready";
        claude.usage = { status: "warning", fiveHour: 0.9, sevenDay: 0.4 };
      }
      if (codex) {
        codex.state = "needs_login";
        codex.usage = { status: "limited", fiveHour: 1 };
      }
    },
  });

  const heading1 = await screen.findByRole("heading", { level: 2, name: "AI agents" });
  const section1 = heading1.closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;

  const claudeRow = within(section1).getByText("Claude Code").closest("li");
  const codexRow1 = within(section1).getByText("Codex").closest("li");
  expect(claudeRow).not.toBeNull();
  expect(codexRow1).not.toBeNull();
  if (!claudeRow || !codexRow1) return;

  expect(within(claudeRow).getByText("Ready")).toBeTruthy();
  expect(claudeRow.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(claudeRow).queryAllByRole("button")).toEqual([]);

  expect(within(codexRow1).getByText("Not signed in")).toBeTruthy();
  expect(codexRow1.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  const signInButton = within(codexRow1).getByRole("button", { name: "Sign in" });
  fireEvent.click(signInButton);
  await waitFor(() => {
    expect(first.client.calls.filter((call) => call.operation === "agents.signIn")).toEqual([
      { operation: "agents.signIn", input: { agentId: "codex" } },
    ]);
  });

  expect(section1.textContent).not.toMatch(/plan limits/i);
  expect(section1.textContent).not.toMatch(/5-hour|five-hour|7-day|90%|100%/i);
  first.unmount();

  const second = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(client) {
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (codex) codex.state = "not_installed";
    },
  });
  const section2 = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;
  const codexRow2 = within(section2).getByText("Codex").closest("li");
  expect(codexRow2).not.toBeNull();
  if (!codexRow2) return;
  expect(within(codexRow2).getByText("Not installed")).toBeTruthy();
  expect(within(codexRow2).getByRole("button", { name: "Set up" })).toBeTruthy();
  second.unmount();

  const third = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(client) {
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (codex) codex.state = "installing";
    },
  });
  const section3 = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section3).not.toBeNull();
  if (!section3) return;
  const codexRow3 = within(section3).getByText("Codex").closest("li");
  expect(codexRow3).not.toBeNull();
  if (!codexRow3) return;
  expect(within(codexRow3).getByText("Installing")).toBeTruthy();
  expect(within(codexRow3).getByText("Installing...")).toBeTruthy();
  expect(within(codexRow3).queryAllByRole("button")).toEqual([]);
  third.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(client) {
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (codex) codex.state = "waiting_login";
    },
  });
  const section4 = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section4).not.toBeNull();
  if (!section4) return;
  const codexRow4 = within(section4).getByText("Codex").closest("li");
  expect(codexRow4).not.toBeNull();
  if (!codexRow4) return;
  expect(within(codexRow4).getByText("Waiting for sign-in")).toBeTruthy();
  expect(within(codexRow4).getByText("Waiting for you to sign in...")).toBeTruthy();
  expect(within(codexRow4).queryAllByRole("button")).toEqual([]);
});

test("TC-j12-07 Set up in Settings calls agents.setUp once with no dialog", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "off",
    setup(c) {
      const codex = c.state.agents.find((agent) => agent.id === "codex");
      if (codex) codex.state = "not_installed";
    },
  });

  const section = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section).not.toBeNull();
  if (!section) return;
  const codexRow = within(section).getByText("Codex").closest("li");
  expect(codexRow).not.toBeNull();
  if (!codexRow) return;

  fireEvent.click(within(codexRow).getByRole("button", { name: "Set up" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "agents.setUp")).toEqual([
      { operation: "agents.setUp", input: { agentId: "codex" } },
    ]);
  });
});

test("Unknown agent hides problem lines, Scan again shows rescan toasts, and Indonesian renders", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(client) {
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (codex) {
        codex.state = "unknown";
        codex.problem = { code: "too_old", detail: "old" };
      }
    },
  });

  const section1 = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;
  const codexRow = within(section1).getByText("Codex").closest("li");
  expect(codexRow).not.toBeNull();
  if (!codexRow) return;

  expect(within(codexRow).getByText("Not checked")).toBeTruthy();
  expect(within(codexRow).queryAllByRole("button")).toEqual([]);
  expect(codexRow.textContent).not.toMatch(/too_old|Update|old/i);

  fireEvent.click(within(section1).getByRole("button", { name: "Scan again" }));
  expect(await screen.findByText("Nothing new found.")).toBeTruthy();
  expect(first.client.calls.filter((call) => call.operation === "agents.rescan")).toEqual([
    { operation: "agents.rescan", input: {} },
  ]);
  first.unmount();

  const second = renderApp("#/settings", { scenario: "story-v2", language: "en" });
  const baseCall = second.client.call.bind(second.client);
  second.client.call = (async (operation, input) => {
    if (operation === "agents.rescan") {
      await baseCall(operation, input);
      const updated = structuredClone(second.client.state.agents);
      const codex = updated.find((agent) => agent.id === "codex");
      if (codex) codex.state = "needs_login";
      return { agents: updated, found: ["codex"] };
    }
    return baseCall(operation, input);
  }) as typeof second.client.call;

  const section2 = (await screen.findByRole("heading", { level: 2, name: "AI agents" })).closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;
  fireEvent.click(within(section2).getByRole("button", { name: "Scan again" }));
  expect(await screen.findByText("Scanned. 2 AI agents found.")).toBeTruthy();
  expect(second.client.calls.filter((call) => call.operation === "agents.rescan")).toEqual([
    { operation: "agents.rescan", input: {} },
  ]);
  second.unmount();

  renderApp("#/settings", { scenario: "story-v2", language: "id" });
  const sectionId = (await screen.findByRole("heading", { level: 2, name: "Agen AI" })).closest("section");
  expect(sectionId).not.toBeNull();
  if (!sectionId) return;
  expect(within(sectionId).getByText("Siap")).toBeTruthy();
  expect(within(sectionId).getByText("Belum dipasang")).toBeTruthy();
  expect(within(sectionId).getByRole("button", { name: "Siapkan" })).toBeTruthy();
  expect(within(sectionId).getByRole("button", { name: "Cari lagi" })).toBeTruthy();
});
