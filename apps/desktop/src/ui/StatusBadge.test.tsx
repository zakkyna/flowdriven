import { AgentState, ApprovalState, RunState, StepRunState, TouchRule } from "@flowdriven/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, expect, test } from "vitest";
import { LanguageProvider } from "../shell/language";
import { Dialog } from "./Dialog";
import { StatusBadge, TouchBadge } from "./StatusBadge";
import { ToastProvider, useToast } from "./Toast";

afterEach(() => {
  cleanup();
});

test("TC-UI-12 Every run state shows an icon and its words", () => {
  const orderedStates: readonly RunState[] = [
    "queued",
    "checking",
    "running",
    "waiting_approval",
    "needs_login",
    "retrying",
    "blocked",
    "interrupted",
    "stopped",
    "done",
    "failed",
  ];
  const expectedWords = [
    "Waiting to start",
    "Starting",
    "Running",
    "Needs you",
    "Waiting for sign-in",
    "Trying again",
    "Stuck",
    "Stopped unexpectedly",
    "Stopped by you",
    "Finished",
    "Failed",
  ];
  expect(orderedStates).toHaveLength(RunState.options.length);
  expect([...orderedStates].sort()).toEqual([...RunState.options].sort());

  const iconsByCode: Record<string, string> = {};
  const icons: string[] = [];

  for (let i = 0; i < orderedStates.length; i++) {
    const code = orderedStates[i];
    const words = expectedWords[i];
    if (!code || !words) throw new Error("Missing state or expected word");
    const { container, unmount } = render(
      <LanguageProvider language="en">
        <StatusBadge kind="run" code={code} />
      </LanguageProvider>,
    );
    expect(screen.getByText(words)).toBeTruthy();
    expect(container.textContent).toBe(words);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    const svg = svgs[0];
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    const iconName = svg?.getAttribute("data-icon");
    expect(iconName).toBeTruthy();
    if (!iconName) throw new Error(`Missing data-icon for ${code}`);
    iconsByCode[code] = iconName;
    icons.push(iconName);
    expect(container.querySelector("[aria-label]")).toBeNull();
    unmount();
  }

  expect(new Set(icons).size).toBeGreaterThan(1);
  expect(
    new Set([iconsByCode.done, iconsByCode.failed, iconsByCode.waiting_approval, iconsByCode.stopped]).size,
  ).toBe(4);
});

function renderGroupBadge(
  entry:
    | { kind: "step"; code: StepRunState }
    | { kind: "decision"; code: ApprovalState }
    | { kind: "agent"; code: AgentState },
): ReactElement {
  switch (entry.kind) {
    case "step":
      return <StatusBadge kind="step" code={entry.code} />;
    case "decision":
      return <StatusBadge kind="decision" code={entry.code} />;
    case "agent":
      return <StatusBadge kind="agent" code={entry.code} />;
  }
}

test("TC-UI-13 Step, decision and agent states also show icon plus words", () => {
  const groups = [
    {
      kind: "step" as const,
      entries: StepRunState.options.map((code) => ({ kind: "step" as const, code })),
    },
    {
      kind: "decision" as const,
      entries: ApprovalState.options.map((code) => ({ kind: "decision" as const, code })),
    },
    {
      kind: "agent" as const,
      entries: AgentState.options.map((code) => ({ kind: "agent" as const, code })),
    },
  ];

  for (const lang of ["en", "id"] as const) {
    for (const { kind, entries } of groups) {
      const seenTexts = new Set<string>();
      for (const entry of entries) {
        const { code } = entry;
        const { container, unmount } = render(
          <LanguageProvider language={lang}>{renderGroupBadge(entry)}</LanguageProvider>,
        );
        const svg = container.querySelector("svg[aria-hidden='true']");
        expect(svg, `${lang} ${kind}.${code} svg`).not.toBeNull();
        const text = container.textContent ?? "";
        expect(text.length, `${lang} ${kind}.${code} text`).toBeGreaterThan(0);
        expect(text, `${lang} ${kind}.${code} not code`).not.toBe(code);
        expect(text, `${lang} ${kind}.${code} not key`).not.toBe(`status.${code}`);
        expect(text, `${lang} ${kind}.${code} no dots`).not.toContain(".");
        expect(seenTexts.has(text), `${lang} ${kind}.${code} unique: ${text}`).toBe(false);
        seenTexts.add(text);
        unmount();
      }
    }
  }

  const stepPending = render(
    <LanguageProvider language="en">
      <StatusBadge kind="step" code="pending" />
    </LanguageProvider>,
  );
  expect(stepPending.container.textContent).toBe("Not started");
  stepPending.unmount();

  const decisionPending = render(
    <LanguageProvider language="en">
      <StatusBadge kind="decision" code="pending" />
    </LanguageProvider>,
  );
  expect(decisionPending.container.textContent).toBe("Needs you");
  decisionPending.unmount();

  const idWaiting = render(
    <LanguageProvider language="id">
      <StatusBadge kind="run" code="waiting_approval" />
    </LanguageProvider>,
  );
  expect(idWaiting.container.textContent).toBe("Menunggu persetujuan");
  idWaiting.unmount();

  const idNeedsLogin = render(
    <LanguageProvider language="id">
      <StatusBadge kind="run" code="needs_login" />
    </LanguageProvider>,
  );
  expect(idNeedsLogin.container.textContent).toBe("Perlu login");
  idNeedsLogin.unmount();
});

function ToastTrigger(): ReactElement {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast("Approved. The run continues.")}>
      Trigger
    </button>
  );
}

test("TC-UI-14 Status never relies on color", () => {
  const runTexts = new Set<string>();
  for (const code of RunState.options) {
    const { container, unmount } = render(
      <LanguageProvider language="en">
        <StatusBadge kind="run" code={code} />
      </LanguageProvider>,
    );
    const words = container.textContent ?? "";
    expect(words.length).toBeGreaterThan(0);
    expect(screen.getByText(words)).toBeTruthy();
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector("[aria-label]")).toBeNull();
    expect(runTexts.has(words)).toBe(false);
    runTexts.add(words);
    unmount();
  }

  expect(TouchBadge).toBeTypeOf("function");
  if (!TouchBadge) throw new Error("TouchBadge is missing");

  const expectedTouchWords: Record<TouchRule, string> = {
    runs_alone: "Does on its own",
    asks_first: "Asks you first",
    not_allowed: "Never does",
  };
  const touchTexts = new Set<string>();
  for (const rule of TouchRule.options) {
    const { container, unmount } = render(
      <LanguageProvider language="en">
        <TouchBadge rule={rule} />
      </LanguageProvider>,
    );
    const words = expectedTouchWords[rule];
    expect(screen.getByText(words)).toBeTruthy();
    expect(container.textContent).toBe(words);
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector("[aria-label]")).toBeNull();
    expect(touchTexts.has(words)).toBe(false);
    touchTexts.add(words);
    unmount();
  }

  const dialogView = render(
    <LanguageProvider language="en">
      <Dialog
        title="Delete this flow?"
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        This removes the flow from your list.
      </Dialog>
    </LanguageProvider>,
  );
  expect(screen.getByRole("dialog", { name: "Delete this flow?" })).toBeTruthy();
  dialogView.unmount();

  const toastView = render(
    <ToastProvider>
      <ToastTrigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
  expect(screen.getByRole("status").textContent).toBe("Approved. The run continues.");
  toastView.unmount();
});
