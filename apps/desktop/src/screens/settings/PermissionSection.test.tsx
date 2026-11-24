import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { RunnerProvider } from "../../runner/runner-context";
import { LanguageProvider } from "../../shell/language";
import { renderApp } from "../../test/render";
import { Button } from "../../ui/Button";
import { ToastProvider } from "../../ui/Toast";
import { PermissionDialog } from "./PermissionDialog";

afterEach(() => {
  cleanup();
});

test('TC-j12-08 Turning the permission on needs "Give permission"', async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "off",
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Permission" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const permissionSwitch = within(section).getByRole("switch", {
    name: "FlowDriven may run your AI agents",
  });
  expect(permissionSwitch.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(permissionSwitch);

  const dialog = screen.getByRole("dialog", { name: "Before you start" });
  expect(
    within(dialog).getByText(
      "FlowDriven runs your flows on the AI agents on this Mac: Claude Code, Codex and any you add later. Give permission once for all of them. FlowDriven only does what each flow is allowed to do, and asks you before anything risky.",
    ),
  ).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/Anthropic|OpenAI|companies|makers|subscription/i);
  const giveButton = within(dialog).getByRole("button", { name: "Give permission" });
  const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
  expect(giveButton).toBeTruthy();
  expect(cancelButton).toBeTruthy();

  fireEvent.click(cancelButton);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([]);
  expect(permissionSwitch.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(permissionSwitch);
  const dialogAgain = screen.getByRole("dialog", { name: "Before you start" });
  fireEvent.click(within(dialogAgain).getByRole("button", { name: "Give permission" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
    { operation: "settings.update", input: { patch: { agentPermission: "on" } } },
  ]);
  await waitFor(() => expect(permissionSwitch.getAttribute("aria-checked")).toBe("true"));
});

test('TC-j12-09 Turning the permission off needs "Turn off", and "Keep on" changes nothing', async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "on",
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Permission" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const permissionSwitch = within(section).getByRole("switch", {
    name: "FlowDriven may run your AI agents",
  });
  expect(permissionSwitch.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(permissionSwitch);

  const dialog = screen.getByRole("dialog", { name: "Stop FlowDriven from running AI agents?" });
  expect(within(dialog).getByText("Flows stop until you turn this on again.")).toBeTruthy();
  const turnOffButton = within(dialog).getByRole("button", { name: "Turn off" });
  const keepOnButton = within(dialog).getByRole("button", { name: "Keep on" });
  expect(turnOffButton.getAttribute("data-variant")).toBe("danger");
  expect(keepOnButton).toBeTruthy();

  fireEvent.click(keepOnButton);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([]);
  expect(permissionSwitch.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(permissionSwitch);
  const dialogAgain = screen.getByRole("dialog", { name: "Stop FlowDriven from running AI agents?" });
  fireEvent.click(within(dialogAgain).getByRole("button", { name: "Turn off" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
    { operation: "settings.update", input: { patch: { agentPermission: "off" } } },
  ]);
  await waitFor(() => expect(permissionSwitch.getAttribute("aria-checked")).toBe("false"));
});

function TurnOnHarness({ client }: { client: ReturnType<typeof createFixtureRunnerClient> }) {
  const [open, setOpen] = useState(false);
  return (
    <RunnerProvider client={client}>
      <LanguageProvider language="en">
        <ToastProvider>
          <Button onClick={() => setOpen(true)}>Turn on permission</Button>
          <PermissionDialog open={open} onClose={() => setOpen(false)} />
        </ToastProvider>
      </LanguageProvider>
    </RunnerProvider>
  );
}

test('PermissionDialog opens from "Turn on permission" with the same "Before you start" dialog', async () => {
  const client = createFixtureRunnerClient({ scenario: "story-v2", permission: "off" });

  render(<TurnOnHarness client={client} />);

  fireEvent.click(screen.getByRole("button", { name: "Turn on permission" }));
  const dialog = screen.getByRole("dialog", { name: "Before you start" });
  expect(
    within(dialog).getByText(
      "FlowDriven runs your flows on the AI agents on this Mac: Claude Code, Codex and any you add later. Give permission once for all of them. FlowDriven only does what each flow is allowed to do, and asks you before anything risky.",
    ),
  ).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/Anthropic|OpenAI|companies|makers|subscription/i);

  fireEvent.click(within(dialog).getByRole("button", { name: "Give permission" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
    { operation: "settings.update", input: { patch: { agentPermission: "on" } } },
  ]);
});

test("Permission save failure shows toast and leaves switch unchanged", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "off",
    failSettingsUpdate: true,
  });

  const heading1 = await screen.findByRole("heading", { level: 2, name: "Permission" });
  const section1 = heading1.closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;

  const switch1 = within(section1).getByRole("switch", { name: "FlowDriven may run your AI agents" });
  fireEvent.click(switch1);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Before you start" })).getByRole("button", {
      name: "Give permission",
    }),
  );

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(switch1.getAttribute("aria-checked")).toBe("false");
  first.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "on",
    failSettingsUpdate: true,
  });

  const heading2 = await screen.findByRole("heading", { level: 2, name: "Permission" });
  const section2 = heading2.closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;

  const switch2 = within(section2).getByRole("switch", { name: "FlowDriven may run your AI agents" });
  fireEvent.click(switch2);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Stop FlowDriven from running AI agents?" })).getByRole(
      "button",
      { name: "Turn off" },
    ),
  );

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(switch2.getAttribute("aria-checked")).toBe("true");
});

test("Permission section and dialogs render in Bahasa Indonesia", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "id",
    permission: "off",
  });

  const heading1 = await screen.findByRole("heading", { level: 2, name: "Izin" });
  const section1 = heading1.closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;

  const switch1 = within(section1).getByRole("switch", {
    name: "FlowDriven boleh menjalankan agen AI Anda",
  });
  expect(switch1.getAttribute("aria-checked")).toBe("false");
  expect(within(switch1).getByText("Mati")).toBeTruthy();

  fireEvent.click(switch1);
  const dialogOn = screen.getByRole("dialog", { name: "Sebelum mulai" });
  expect(within(dialogOn).getByRole("button", { name: "Beri izin" })).toBeTruthy();
  expect(within(dialogOn).getByRole("button", { name: "Batal" })).toBeTruthy();
  first.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "id",
    permission: "on",
  });

  const heading2 = await screen.findByRole("heading", { level: 2, name: "Izin" });
  const section2 = heading2.closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;

  const switch2 = within(section2).getByRole("switch", {
    name: "FlowDriven boleh menjalankan agen AI Anda",
  });
  expect(switch2.getAttribute("aria-checked")).toBe("true");
  expect(within(switch2).getByText("Nyala")).toBeTruthy();

  fireEvent.click(switch2);
  const dialogOff = screen.getByRole("dialog", { name: "Hentikan FlowDriven menjalankan agen AI?" });
  expect(within(dialogOff).getByText("Flow berhenti sampai Anda menyalakannya lagi.")).toBeTruthy();
  expect(within(dialogOff).getByRole("button", { name: "Matikan" })).toBeTruthy();
  expect(within(dialogOff).getByRole("button", { name: "Tetap nyala" })).toBeTruthy();
});
