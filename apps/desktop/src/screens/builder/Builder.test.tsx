import { readFileSync } from "node:fs";
import { createFixtureRunnerClient, PREVIEW_AGENT_REPLY } from "@flowdriven/fixtures";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "../../App";
import { RunnerProvider, useRunnerQuery } from "../../runner/runner-context";
import { readyState, renderApp } from "../../test/render";

const FIGMA = "#/builder/dev.example.figma-to-flutter";
const rows = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
const row = (i: number) => rows()[i] as HTMLElement;
const titles = () => rows().map((r) => within(r).getAllByRole("button")[0]?.textContent);

test("New flow opens an empty conversation even when flows exist, and sends without a flow", async () => {
  const { client } = renderApp("#/builder/new");
  const heading = await screen.findByRole("heading", { level: 1, name: "New flow" });
  expect(heading.tabIndex).toBe(-1);
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.title).toBe("New flow - FlowDriven");
  expect(screen.getByText("Nothing drafted yet.")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
  const spy = vi.spyOn(client, "call");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Weekly report from my notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(PREVIEW_AGENT_REPLY)).toBeTruthy();
  expect(spy).toHaveBeenCalledWith("flows.build", {
    flowId: undefined,
    message: "Weekly report from my notes",
  });
  expect(window.location.hash).toBe("#/builder/new");
  expect(client.state.flows).toHaveLength(5);
});
test("leaving New flow drops the draft conversation", async () => {
  renderApp("#/builder/new");
  fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(PREVIEW_AGENT_REPLY);
  const go = (hash: string) =>
    act(() => {
      window.location.hash = hash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  go(FIGMA);
  await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
  go("#/builder/new");
  await screen.findByRole("heading", { level: 1, name: "New flow" });
  expect(screen.queryByText(PREVIEW_AGENT_REPLY)).toBeNull();
});

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
    const chat = await screen.findByRole("region", { name: "Chat" });
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
    const chat = await screen.findByRole("region", { name: "Chat" });
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
  expect(within(screen.getByRole("main")).getAllByText("Figma to Flutter")).toHaveLength(2);
});

function Probe({ skip, commits }: { skip: boolean; commits: boolean[] }) {
  const query = useRunnerQuery("runs.status", { runId: "run-0006" }, { skip });
  commits.push(query.loading);
  return <span>{query.loading ? "Loading" : "Ready"}</span>;
}

test("a re-enabled dependent query never commits stale ready data", async () => {
  const client = createFixtureRunnerClient();
  const commits: boolean[] = [];
  const view = (skip: boolean) => (
    <RunnerProvider client={client}>
      <Probe skip={skip} commits={commits} />
    </RunnerProvider>
  );
  const { rerender } = render(view(false));
  await screen.findByText("Ready");
  rerender(view(true));
  commits.length = 0;
  rerender(view(false));
  expect(commits[0]).toBe(true);
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

test("guards run and step edits while pending", async () => {
  const { client } = renderApp(FIGMA);
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  const spy = vi.spyOn(client, "call").mockImplementation((name, input) => {
    if (name === "flows.run" || name === "flows.update")
      return new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => original(name, input as never));
    return original(name, input as never);
  });
  const move = within(row(1)).getByRole("button", { name: "Move up" });
  fireEvent.click(move);
  fireEvent.click(move);
  expect(spy.mock.calls.filter(([name]) => name === "flows.update")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Run now" })).toHaveProperty("disabled", true);
  await act(async () => release?.());
  await screen.findByText("Version 1.0.1");
  const run = screen.getByRole("button", { name: "Run now" });
  fireEvent.click(run);
  fireEvent.click(run);
  expect(spy.mock.calls.filter(([name]) => name === "flows.run")).toHaveLength(1);
  expect(run).toHaveProperty("disabled", true);
  expect(run.textContent).toContain("Running");
  await act(async () => release?.());
});

test("chat guards submissions and preserves a draft when choosing a suggestion", async () => {
  const { client } = renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const suggestion = await within(chat).findByRole("button", { name: "Use the last folder" });
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  const spy = vi.spyOn(client, "call").mockImplementation((name, input) => {
    if (name === "flows.build")
      return new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => original(name, input as never));
    return original(name, input as never);
  });
  const input = within(chat).getByLabelText("Message");
  fireEvent.change(input, { target: { value: "my draft" } });
  fireEvent.click(suggestion);
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(spy.mock.calls.filter(([name]) => name === "flows.build")).toHaveLength(1);
  expect(within(chat).getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  await act(async () => release?.());
  expect(input).toHaveProperty("value", "my draft");
  fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(spy.mock.calls.filter(([name]) => name === "flows.build")).toHaveLength(2);
  await act(async () => release?.());
});

test("empty chat displays messages and failed sends retain the draft", async () => {
  const { client } = renderApp("#/builder", { scenario: "empty" });
  await screen.findByText("No flows yet.");
  const original = client.call.bind(client);
  const spy = vi.spyOn(client, "call").mockImplementation((name, input) => {
    if (name === "flows.build") return Promise.reject(new Error("Chat unavailable"));
    return original(name, input as never);
  });
  const input = screen.getByLabelText("Message");
  fireEvent.change(input, { target: { value: "New work" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Chat unavailable");
  expect(input).toHaveProperty("value", "New work");
  spy.mockImplementation((name, args) => original(name, args as never));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("New work")).toBeTruthy();
  expect(screen.getByText(PREVIEW_AGENT_REPLY)).toBeTruthy();
});

test("shows harness names, singular count, and clears errors on flow switch", async () => {
  const { client } = renderApp(FIGMA);
  const flow = client.state.flows.find((item) => item.manifest.id === "dev.example.figma-to-flutter");
  if (!flow) throw new Error("Fixture flow missing");
  flow.manifest.steps = flow.manifest.steps.slice(0, 1);
  const firstStep = flow.manifest.steps[0];
  if (!firstStep) throw new Error("Fixture step missing");
  firstStep.worker = { prefer: ["codex", "claude-code", "unknown"], effort: "medium" };
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  expect(screen.getByText("1 step")).toBeTruthy();
  expect(screen.getByText("Prefers Codex, Claude Code, unknown. Effort: medium.")).toBeTruthy();
  const original = client.call.bind(client);
  vi.spyOn(client, "call").mockImplementation((name, input) =>
    name === "flows.run" ? Promise.reject(new Error("Run failed")) : original(name, input as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  await screen.findByText("Run failed");
  fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.email-triage" } });
  await screen.findByRole("heading", { name: "Email triage and draft replies" });
  expect(screen.queryByText("Run failed")).toBeNull();
});

test("clears a failed update when leaving and returning to the flow", async () => {
  const { client } = renderApp(FIGMA);
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  const original = client.call.bind(client);
  vi.spyOn(client, "call").mockImplementation((name, input) =>
    name === "flows.update" ? Promise.reject(new Error("Update failed")) : original(name, input as never),
  );
  fireEvent.click(within(row(1)).getByRole("button", { name: "Move up" }));
  await screen.findByRole("alert");
  fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.email-triage" } });
  await screen.findByRole("heading", { name: "Email triage and draft replies" });
  fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.figma-to-flutter" } });
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("step boundaries, undo and duplicate", async () => {
  renderApp(FIGMA);
  await screen.findByRole("heading", { name: "Figma to Flutter" });
  expect(within(row(4)).getByRole("button", { name: "Move down" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
  fireEvent.click(within(row(0)).getByRole("button", { name: "Duplicate" }));
  await waitFor(() => expect(rows()).toHaveLength(6));
  expect(titles()[1]).toContain("Read the design");
});

test("chat scrolls to the newest message after an update", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const message = await within(chat).findByText(
    "Turn the frames in our Figma file into Flutter screens and push a branch. Never merge.",
  );
  const box = message.closest<HTMLElement>('[data-scroll="bottom"]');
  expect(box).not.toBeNull();
  if (!box) throw new Error("Message box missing");
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: 700 });
  box.scrollTop = 0;
  fireEvent.change(within(chat).getByLabelText("Message"), { target: { value: "New message" } });
  fireEvent.click(within(chat).getByRole("button", { name: "Send" }));
  await within(chat).findByText(PREVIEW_AGENT_REPLY);
  await waitFor(() => expect(box.scrollTop).toBe(700));
});

test("focuses the flow heading after loading and changing flows", async () => {
  renderApp(FIGMA);
  const first = await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
  await waitFor(() => expect(document.activeElement).toBe(first));
  expect(first.tabIndex).toBe(-1);
  fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.social-posts" } });
  const second = await screen.findByRole("heading", { level: 1, name: "One source into many social posts" });
  await waitFor(() => expect(document.activeElement).toBe(second));
});

test("each message is announced with its author and time, and shows neither", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  expect(within(chat).getByRole("heading", { level: 2, name: "Chat" })).toBeTruthy();
  expect(await within(chat).findByText("You, 10 Nov, 08:30:")).toBeTruthy();
  expect(within(chat).getByText("FlowDriven, 10 Nov, 08:31:")).toBeTruthy();
});
test("a question shows its suggestions directly under it", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const items = await within(chat).findAllByRole("listitem");
  expect(items).toHaveLength(2);
  const first = items[0] as HTMLElement;
  const second = items[1] as HTMLElement;
  expect(within(first).getByText("Which project folder holds the Flutter app?")).toBeTruthy();
  expect(
    within(first).getByRole("group", { name: "Answers to Which project folder holds the Flutter app?" }),
  ).toBeTruthy();
  expect(
    within(first)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Use the last folder", "Choose another folder"]);
  expect(
    within(second)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Yes, list every mismatch", "No, skip visual review"]);
  expect(within(chat).queryByRole("button", { pressed: true })).toBeNull();
});
test("the composer is a text area and an icon-only Send button that waits for text", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const send = within(chat).getByRole("button", { name: "Send" });
  expect(send.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(send.textContent).toBe("");
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(within(chat).getByLabelText("Message"), { target: { value: "Hello" } });
  expect(send).toHaveProperty("disabled", false);
});
test("an empty conversation says how to start", async () => {
  renderApp("#/builder/new");
  expect(await screen.findByText("Describe changes in your own words.")).toBeTruthy();
});
test("a new flow's pane says nothing has been drafted", async () => {
  renderApp("#/builder/new");
  const pane = await screen.findByRole("region", { name: "Flow details" });
  expect(within(pane).getByRole("heading", { level: 1, name: "New flow" })).toBeTruthy();
  expect(
    within(pane).getByText("Describe work you repeat, and the agent turns it into a flow."),
  ).toBeTruthy();
});
test("conversation styles follow the approved layout", () => {
  const css = readFileSync("apps/desktop/src/screens/builder/Builder.module.css", "utf8");
  expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--pane-width\)/s);
  expect(css).toMatch(
    /\.threadScroll\s*\{[^}]*overflow-y:\s*auto[^}]*display:\s*flex[^}]*flex-direction:\s*column/s,
  );
  expect(css).toMatch(/\.thread\s*\{[^}]*max-width:\s*var\(--reading-width\)[^}]*margin:\s*auto auto 0/s);
  expect(css).toMatch(/\.dock\s*\{[^}]*max-width:\s*var\(--dock-width\)/s);
  expect(css).toMatch(
    /\.bubble\s*\{[^}]*background:\s*var\(--surface-bubble\)[^}]*border-radius:\s*var\(--radius-bubble\)/s,
  );
  expect(css).toMatch(/\.composer\s*\{[^}]*border-radius:\s*var\(--radius-composer\)/s);
  expect(css).toMatch(/\.composer:focus-within\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
  expect(css).toMatch(/\.chip\s*\{[^}]*height:\s*30px[^}]*border-radius:\s*15px/s);
  expect(css).toMatch(/\.send\s*\{[^}]*background:\s*var\(--ink\)/s);
});
