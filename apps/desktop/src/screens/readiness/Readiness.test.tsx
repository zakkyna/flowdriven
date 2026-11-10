import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { readyState, renderApp } from "../../test/render";

const row = (name: string) => screen.getByRole("listitem", { name });

test("the banner says ready or not ready with an icon, and marks its state", async () => {
  const ready = renderApp("#/readiness/dev.example.documents-and-reports");
  const readyBanner = (await screen.findByText("Ready to run. Every required item is OK.")).closest(
    "[data-state]",
  ) as HTMLElement;
  expect(readyBanner.getAttribute("data-state")).toBe("ready");
  expect(readyBanner.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  ready.unmount();
  renderApp("#/readiness/dev.example.social-posts");
  const banner = (await screen.findByText("Not ready. 4 required items need attention.")).closest(
    "[data-state]",
  ) as HTMLElement;
  expect(banner.getAttribute("data-state")).toBe("attention");
});
test("each requirement shows its state as icon plus word at the end of its row", async () => {
  renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  expect(within(ffmpeg).getByText("Missing")).toBeTruthy();
  expect(ffmpeg.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});
test("readiness styles: tinted banner, flat rows, a sunken fix guide", () => {
  const css = readFileSync("apps/desktop/src/screens/readiness/Readiness.module.css", "utf8");
  expect(css).toMatch(/\.banner\[data-state="ready"\]\s*\{[^}]*background:\s*var\(--ok-soft\)/s);
  expect(css).toMatch(/\.banner\[data-state="attention"\]\s*\{[^}]*background:\s*var\(--wait-soft\)/s);
  expect(css).toMatch(/\.row\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.list\s*\{[^}]*border-radius/s);
  expect(css).toMatch(
    /\.guide\s*\{[^}]*background:\s*var\(--surface-sunken\)[^}]*border-radius:\s*var\(--radius-m\)/s,
  );
  expect(css).not.toMatch(/accent-soft/);
});

describe("Readiness", () => {
  test("opens the first flow that is not ready", async () => {
    renderApp("#/readiness");
    expect(await screen.findByText("Not ready. 1 required item needs attention.")).toBeTruthy();
    expect((screen.getByLabelText("Flow") as HTMLSelectElement).value).toBe("dev.example.figma-to-flutter");
    expect(
      within(row("Figma MCP server")).getByText("Enforcement: enforced by the harness's settings"),
    ).toBeTruthy();
  });
  test("shows every state, optional items and risk labels", async () => {
    renderApp("#/readiness/dev.example.social-posts");
    expect(await screen.findByText("Not ready. 4 required items need attention.")).toBeTruthy();
    for (const word of ["OK", "Missing", "Needs login", "Failed"])
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    const tiktok = row("TikTok browser session");
    expect(within(tiktok).getByText("Optional")).toBeTruthy();
    expect(within(tiktok).getByText("Unofficial")).toBeTruthy();
    expect(within(tiktok).getByText("Optional. Steps that use it are skipped.")).toBeTruthy();
    expect(within(row("WordPress site")).queryByRole("button", { name: "Install for me" })).toBeNull();
  });
  test("install for me shows the exact command and asks first", async () => {
    renderApp("#/readiness/dev.example.social-posts");
    fireEvent.click(
      within(await screen.findByRole("listitem", { name: "FFmpeg" })).getByRole("button", {
        name: "Install for me",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Install FFmpeg?" });
    expect(within(dialog).getByText("brew install ffmpeg")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));
    expect(await screen.findByText("Marked FFmpeg as OK. Sample data: nothing was installed.")).toBeTruthy();
    expect(await screen.findByText("Not ready. 3 required items need attention.")).toBeTruthy();
  });
  test("show me how marks unverified guides and copies commands", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp("#/readiness/dev.example.social-posts");
    fireEvent.click(
      within(await screen.findByRole("listitem", { name: "TikTok browser session" })).getByRole("button", {
        name: "Show me how",
      }),
    );
    expect(screen.getByText("Publisher's instructions, not verified")).toBeTruthy();
    fireEvent.click(within(row("FFmpeg")).getByRole("button", { name: "Show me how" }));
    expect(within(row("FFmpeg")).getByText("Open Terminal.")).toBeTruthy();
    fireEvent.click(within(row("FFmpeg")).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("brew install ffmpeg"));
  });
  test("check again asks the runner for a fresh report", async () => {
    const { client } = renderApp("#/readiness/dev.example.social-posts");
    await screen.findByText("Not ready. 4 required items need attention.");
    const spy = vi.spyOn(client, "call");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("readiness.check", { flowId: "dev.example.social-posts" }),
    );
  });
  test("every row with an install command shows it", async () => {
    renderApp("#/readiness/dev.example.social-posts");
    expect(
      within(await screen.findByRole("listitem", { name: "FFmpeg" })).getByText("brew install ffmpeg"),
    ).toBeTruthy();
  });
  test("a ready flow says so", async () => {
    renderApp("#/readiness/dev.example.documents-and-reports");
    expect(await screen.findByText("Ready to run. Every required item is OK.")).toBeTruthy();
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/readiness/dev.example.social-posts");
    expect(readyState(container, "readiness")).toBe("false");
    await screen.findByText("Not ready. 4 required items need attention.");
    await waitFor(() => expect(readyState(container, "readiness")).toBe("true"));
  });
  test("shows flow not found", async () => {
    renderApp("#/readiness/dev.example.nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Flow not found" })).toBeTruthy();
    expect(screen.getByText("There is no flow dev.example.nope on this Mac.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Readiness" }).getAttribute("href")).toBe("#/readiness");
  });
  test("empty", async () => {
    renderApp("#/readiness", { scenario: "empty" });
    expect(await screen.findByText("No flows to check yet.")).toBeTruthy();
  });
});
test("reports clipboard failures with an accessible command name", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    configurable: true,
  });
  renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Show me how" }));
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Copy" }));
  expect((await within(ffmpeg).findByRole("status")).textContent).toBe(
    "Could not copy. Select the command and copy it by hand.",
  );
});
test("does not probe the selected default flow twice", async () => {
  const { client } = renderApp("#/readiness");
  const spy = vi.spyOn(client, "call");
  await screen.findByText("Not ready. 1 required item needs attention.");
  expect(
    spy.mock.calls.filter(
      ([name, input]) =>
        name === "readiness.check" && "flowId" in input && input.flowId === "dev.example.figma-to-flutter",
    ),
  ).toHaveLength(1);
});
test("shows an install failure", async () => {
  const { client } = renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Install for me" }));
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Install failed"));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Install failed");
});
test("can retry after a failed check again", async () => {
  const { client } = renderApp("#/readiness/dev.example.social-posts");
  await screen.findByText("Not ready. 4 required items need attention.");
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Check failed"));
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Check failed");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Not ready. 4 required items need attention.")).toBeTruthy();
});
test("reports when the clipboard is unavailable", async () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Show me how" }));
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Copy" }));
  expect((await within(ffmpeg).findByRole("status")).textContent).toBe(
    "Could not copy. Select the command and copy it by hand.",
  );
});
test("checks again from a guide", async () => {
  const { client } = renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Show me how" }));
  const spy = vi.spyOn(client, "call");
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Check again" }));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith("readiness.check", { flowId: "dev.example.social-posts" }),
  );
});
test("shows when a readiness recheck is in progress", async () => {
  const { client } = renderApp("#/readiness/dev.example.social-posts");
  await screen.findByText("Not ready. 4 required items need attention.");
  vi.spyOn(client, "call").mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(screen.getByRole("button", { name: "Checking..." })).toHaveProperty("disabled", true);
});
test("confirms a successful copy", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Show me how" }));
  fireEvent.click(within(ffmpeg).getByRole("button", { name: "Copy" }));
  expect((await within(ffmpeg).findByRole("status")).textContent).toBe("Copied");
});

test.each(["check", "install"])("%s performs exactly one recheck", async (mode) => {
  const { client } = renderApp("#/readiness/dev.example.social-posts");
  await screen.findByText("Not ready. 4 required items need attention.");
  const spy = vi.spyOn(client, "call");
  if (mode === "check") fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  else {
    fireEvent.click(within(row("FFmpeg")).getByRole("button", { name: "Install for me" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install" }));
    await screen.findByText("Not ready. 3 required items need attention.");
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Check again" })).toHaveProperty("disabled", false),
  );
  expect(spy.mock.calls.filter(([name]) => name === "readiness.check")).toHaveLength(1);
});
