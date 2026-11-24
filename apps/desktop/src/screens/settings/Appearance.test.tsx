import { type LiveOperationName, operations } from "@flowdriven/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { windowApi } from "../../shell";
import { LanguageProvider } from "../../shell/language";
import { renderApp } from "../../test/render";
import { ToastProvider } from "../../ui/Toast";
import { Appearance } from "./Appearance";

type WindowWithShell = Window & {
  flowdrivenShell?: {
    kind?: string;
    window?: {
      getPrefs?: () => Promise<unknown>;
      setColorMode?: (mode: string) => Promise<unknown>;
      openLink?: (url: string) => Promise<unknown>;
      quit?: () => Promise<unknown>;
    };
  };
};

const originalShell = (window as WindowWithShell).flowdrivenShell;

afterEach(() => {
  if (originalShell === undefined) Reflect.deleteProperty(window, "flowdrivenShell");
  else (window as WindowWithShell).flowdrivenShell = originalShell;
});

test("TC-j12-02 Light, Auto and Dark call the window API and never the runner", async () => {
  const setColorMode = vi.fn();
  (window as WindowWithShell).flowdrivenShell = { window: { setColorMode } };

  const { client } = renderApp("#/settings", { scenario: "story-v2" });
  const group = await screen.findByRole("radiogroup", { name: "Color mode" });
  const radios = within(group).getAllByRole("radio");
  expect(radios).toHaveLength(3);

  const light = within(group).getByRole("radio", { name: "Light" });
  const auto = within(group).getByRole("radio", { name: /Auto/ });
  const dark = within(group).getByRole("radio", { name: "Dark" });
  expect(radios).toEqual([light, auto, dark]);
  expect(within(auto).getByText("Auto")).toBeTruthy();
  expect(within(auto).getByText("Matches your computer")).toBeTruthy();

  expect(auto.getAttribute("aria-checked")).toBe("true");
  const callsBeforeClicks = client.calls.length;

  fireEvent.click(light);
  fireEvent.click(dark);
  fireEvent.click(auto);

  expect(setColorMode.mock.calls).toEqual([["light"], ["dark"], ["system"]]);
  expect(auto.getAttribute("aria-checked")).toBe("true");
  expect(client.calls.slice(callsBeforeClicks)).toEqual([]);
  expect(client.calls.some((call) => call.operation === "settings.update")).toBe(false);
  expect(
    client.calls
      .filter((call) => call.operation !== "agents.list")
      .some((call) => operations[call.operation as LiveOperationName].writes.length > 0),
  ).toBe(false);
});

test("windowApi returns the window bridge only when all four functions exist", () => {
  Reflect.deleteProperty(window, "flowdrivenShell");
  expect(windowApi()).toBeUndefined();

  (window as WindowWithShell).flowdrivenShell = {
    window: { getPrefs: vi.fn(), setColorMode: vi.fn(), openLink: vi.fn() },
  };
  expect(windowApi()).toBeUndefined();

  const full = { getPrefs: vi.fn(), setColorMode: vi.fn(), openLink: vi.fn(), quit: vi.fn() };
  (window as WindowWithShell).flowdrivenShell = { window: full };
  expect(windowApi()).toBe(full);
});

test("Appearance loads initial preference from getPrefs and reverts with toast on save failure", async () => {
  const getPrefs = vi.fn().mockResolvedValue({
    ok: true,
    result: { colorMode: "dark", platform: "darwin" },
  });
  const setColorMode = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: { code: "unavailable", message: "Save failed" } })
    .mockRejectedValueOnce(new Error("Bridge down"));

  (window as WindowWithShell).flowdrivenShell = {
    window: { getPrefs, setColorMode, openLink: vi.fn(), quit: vi.fn() },
  };

  render(
    <LanguageProvider language="en">
      <ToastProvider>
        <Appearance />
      </ToastProvider>
    </LanguageProvider>,
  );

  const dark = screen.getByRole("radio", { name: "Dark" });
  const light = screen.getByRole("radio", { name: "Light" });
  await waitFor(() => expect(dark.getAttribute("aria-checked")).toBe("true"));

  fireEvent.click(light);
  await waitFor(() => expect(dark.getAttribute("aria-checked")).toBe("true"));
  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();

  fireEvent.click(light);
  await waitFor(() => expect(dark.getAttribute("aria-checked")).toBe("true"));
  expect(screen.getAllByText("Could not save. Try again.")).toHaveLength(2);
});

test("Appearance stays usable in a plain browser without preload", () => {
  Reflect.deleteProperty(window, "flowdrivenShell");
  const { client } = renderApp("#/settings", { scenario: "story-v2" });

  return screen.findByRole("radio", { name: "Dark" }).then((dark) => {
    const auto = screen.getByRole("radio", { name: /Auto/ });
    expect(auto.getAttribute("aria-checked")).toBe("true");
    const callsBeforeClick = client.calls.length;
    fireEvent.click(dark);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Could not save. Try again.")).toBeNull();
    expect(client.calls.slice(callsBeforeClick)).toEqual([]);
    expect(
      client.calls
        .filter((call) => call.operation !== "agents.list")
        .some((call) => operations[call.operation as LiveOperationName].writes.length > 0),
    ).toBe(false);
  });
});
