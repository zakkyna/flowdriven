import { createFixtureRunnerClient, PREVIEW_AGENT_REPLY } from "@flowdriven/fixtures";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "../../App";
import { RunnerProvider } from "../../runner/runner-context";
import { readyState, renderApp } from "../../test/render";

const FIGMA = "#/builder/dev.example.figma-to-flutter";
const rows = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
const row = (i: number) => rows()[i] as HTMLElement;
const titles = () => rows().map((r) => within(r).getAllByRole("button")[0]?.textContent);

describe("Builder", () => {
  test("shows the flow, its playback and every step with its checks", async () => {
    renderApp(FIGMA);
    expect(await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" })).toBeTruthy();
    expect(screen.getByText("Build flow")).toBeTruthy();
    expect(screen.getByText("Version 1.0.0")).toBeTruthy();
    expect(screen.getByText("Approved for version 1.0.0")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What this flow does" })).toBeTruthy();
    await waitFor(() =>
      expect(titles()).toEqual([
        "Read the design",
        "Plan widgets and tokens",
        "Build the screens",
        "Compare with the design",
        "Push the branch",
      ]),
    );
    expect(within(row(3)).getByText("Judged, not verified")).toBeTruthy();
    expect(await within(row(2)).findByText("flutter analyze exits 0")).toBeTruthy();
    expect(within(row(2)).getAllByText("Failed").length).toBeGreaterThan(0);
  });
  test("moves a step, goes stale, and undoes", async () => {
    renderApp(FIGMA);
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    expect(within(row(0)).getByRole("button", { name: "Move up" })).toHaveProperty("disabled", true);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Move up" }));
    await screen.findByText("Version 1.0.1");
    expect(titles()[0]).toBe("Plan widgets and tokens");
    expect(screen.getByText("Changed since approval")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Version 1.0.0");
    expect(titles()[0]).toBe("Read the design");
  });
  test("delete asks first and retires the id", async () => {
    renderApp(FIGMA);
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    await waitFor(() => expect(rows()).toHaveLength(5));
    fireEvent.click(within(row(4)).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Push the branch”?" });
    expect(within(dialog).getByText("The step id open-pr is retired and never reused.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete step" }));
    await waitFor(() => expect(rows()).toHaveLength(4));
  });
  test("adds a step at the end", async () => {
    renderApp(FIGMA);
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    fireEvent.change(screen.getByLabelText("Step title"), { target: { value: "Notify the team" } });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Add a step" })).getByRole("button", { name: "Add step" }),
    );
    await waitFor(() => expect(titles().at(-1)).toBe("Notify the team"));
  });
  test("chat shows the conversation and the preview reply", async () => {
    renderApp(FIGMA);
    const chat = await screen.findByRole("complementary", { name: "Chat" });
    expect(
      await within(chat).findByText(
        "Turn the frames in our Figma file into Flutter screens and push a branch. Never merge.",
      ),
    ).toBeTruthy();
    fireEvent.change(within(chat).getByLabelText("Message"), {
      target: { value: "Add a step that posts to Slack" },
    });
    fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
    expect(await within(chat).findByText(PREVIEW_AGENT_REPLY)).toBeTruthy();
  });
  test("Run now opens the new run", async () => {
    renderApp(FIGMA);
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(window.location.hash).toBe("#/runs/run-0008"));
  });
  test("the flow picker and the default flow", async () => {
    renderApp("#/builder");
    expect(await screen.findByRole("heading", { level: 1, name: "Documents and reports" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.email-triage" } });
    await waitFor(() => expect(window.location.hash).toBe("#/builder/dev.example.email-triage"));
  });
  test("a stale version cannot run", async () => {
    renderApp(FIGMA);
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    fireEvent.click(within(row(1)).getByRole("button", { name: "Move up" }));
    await screen.findByText("Version 1.0.1");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "This version needs your approval before it runs.",
    );
    expect(window.location.hash).toBe(FIGMA);
  });
  test("chat suggestions send as messages, and Cmd+Enter sends", async () => {
    renderApp(FIGMA);
    const chat = await screen.findByRole("complementary", { name: "Chat" });
    fireEvent.click(await within(chat).findByRole("button", { name: "Use the last folder" }));
    await waitFor(() => expect(within(chat).getAllByText(PREVIEW_AGENT_REPLY)).toHaveLength(1));
    fireEvent.change(within(chat).getByLabelText("Message"), { target: { value: "Also notify the team" } });
    fireEvent.keyDown(within(chat).getByLabelText("Message"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(within(chat).getAllByText(PREVIEW_AGENT_REPLY)).toHaveLength(2));
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp(FIGMA);
    expect(readyState(container, "builder")).toBe("false");
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    await waitFor(() => expect(readyState(container, "builder")).toBe("true"));
  });
  test("shows flow not found", async () => {
    renderApp("#/builder/dev.example.nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Flow not found" })).toBeTruthy();
    expect(screen.getByText("There is no flow dev.example.nope on this Mac.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Builder" }).getAttribute("href")).toBe("#/builder");
  });
  test("empty", async () => {
    renderApp("#/builder", { scenario: "empty" });
    expect(await screen.findByText("No flows yet.")).toBeTruthy();
  });
});
test("does not repeat a summary equal to the flow name", async () => {
  renderApp("#/builder/dev.example.figma-to-flutter");
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  expect(screen.getAllByText("Figma to Flutter")).toHaveLength(2);
});

test("late dependent queries never mark the loading Builder ready", async () => {
  window.location.hash = "#/builder";
  const client = createFixtureRunnerClient();
  const original = client.call.bind(client);
  const releases: (() => void)[] = [];
  vi.spyOn(client, "call").mockImplementation((name, input) =>
    new Promise<void>((resolve) => releases.push(resolve)).then(() => original(name, input)),
  );
  const { container } = render(
    <RunnerProvider client={client}>
      <App />
    </RunnerProvider>,
  );
  const check = () => {
    if (screen.queryByText("Loading")) expect(readyState(container, "builder")).toBe("false");
  };
  check();
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      for (const release of releases.splice(0)) release();
    });
    check();
  }
  await waitFor(() => expect(readyState(container, "builder")).toBe("true"));
});
test("revisiting a flow waits for its re-enabled run query", async () => {
  const { client, container } = renderApp(FIGMA);
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  vi.spyOn(client, "call").mockImplementation((name, input) => {
    if (name === "runs.status")
      return new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => original("runs.status", input as { runId: string }));
    return original(name, input);
  });
  act(() => {
    window.location.hash = "#/builder/dev.example.nope";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await screen.findByRole("heading", { name: "Flow not found" });
  act(() => {
    window.location.hash = FIGMA;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await waitFor(() => expect(release).toBeDefined());
  expect(readyState(container, "builder")).toBe("false");
  expect(screen.getByText("Loading")).toBeTruthy();
  await act(async () => release?.());
  await waitFor(() => expect(readyState(container, "builder")).toBe("true"));
});
