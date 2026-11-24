import { readFileSync } from "node:fs";
import {
  ApprovalState,
  CheckVerdict,
  ConnectionState,
  RequirementState,
  RiskLabel,
  RunState,
  SignOffState,
  StepRunState,
} from "@flowdriven/contracts/v1";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ICON_NAMES, Icon } from "./icons";
import { Badge, StateIcon, StatusBadge, ToneIcon } from "./StatusBadge";
import { type StatusDomain, statusOf } from "./status";

const domains: [StatusDomain, readonly string[]][] = [
  ["run", RunState.options],
  ["step", StepRunState.options],
  ["check", CheckVerdict.options],
  ["requirement", RequirementState.options],
  ["approval", ApprovalState.options],
  ["signOff", SignOffState.options],
  ["connection", ConnectionState.options],
  ["risk", RiskLabel.options],
];

describe("status", () => {
  test("every state of every domain has an icon and words", () => {
    for (const [domain, values] of domains)
      for (const value of values) {
        const { unmount, container } = render(<StatusBadge domain={domain} value={value} />);
        const p = statusOf(domain, value);
        expect(screen.getByText(p.label)).toBeTruthy();
        expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
        unmount();
      }
  });
  test("uses the agreed words", () => {
    expect(statusOf("run", "waiting_approval")).toEqual({
      icon: "hand",
      label: "Waiting for you",
      tone: "wait",
    });
    expect(statusOf("run", "checking").label).toBe("Checking readiness");
    expect(statusOf("requirement", "needs_login").label).toBe("Needs login");
    expect(statusOf("signOff", "stale").label).toBe("Changed since approval");
    expect(statusOf("check", "pending").label).toBe("Not run yet");
    expect(() => statusOf("run", "nope")).toThrow();
  });
  test("every icon draws something", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("svg")?.childElementCount).toBeGreaterThan(0);
      unmount();
    }
  });
});

test("status table keys exactly match contract states", async () => {
  const { statuses } = await import("./status");
  for (const [domain, values] of domains)
    expect(Object.keys(statuses[domain]).sort()).toEqual([...values].sort());
});

test("a state mark is an icon plus a word and only a ring spins", () => {
  for (const [domain, values] of domains)
    for (const value of values) {
      const { unmount, container } = render(<StatusBadge domain={domain} value={value} />);
      const presentation = statusOf(domain, value);
      const svg = container.querySelector("svg[aria-hidden='true']");
      expect(svg, `${domain}.${value}`).not.toBeNull();
      expect(screen.getByText(presentation.label)).toBeTruthy();
      expect(svg?.getAttribute("data-spin") === "true", `${domain}.${value}`).toBe(
        presentation.icon === "ring",
      );
      unmount();
    }
});
test("ToneIcon and StateIcon draw only an icon", () => {
  const a = render(<ToneIcon icon="check" tone="ok" />);
  expect(a.container.textContent).toBe("");
  expect(a.container.querySelector("svg")).not.toBeNull();
  a.unmount();
  const b = render(<StateIcon domain="run" value="running" />);
  expect(b.container.textContent).toBe("");
  expect(b.container.querySelector("svg")?.getAttribute("data-spin")).toBe("true");
});
test("icons use the 16 px grid with a 1.5 stroke, and the dash icon is dashed", () => {
  const { container } = render(<Icon name="check" />);
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
  expect(svg?.getAttribute("width")).toBe("16");
  expect(svg?.getAttribute("stroke-width")).toBe("1.5");
  expect(svg?.hasAttribute("data-spin")).toBe(false);
  const dash = render(<Icon name="dash" size={14} />);
  expect(dash.container.querySelector("path")?.getAttribute("stroke-dasharray")).toBe("2.2 2.4");
  expect(dash.container.querySelector("svg")?.getAttribute("width")).toBe("14");
  expect(ICON_NAMES).toEqual(expect.arrayContaining(["tick", "list", "mark", "builder", "arrow-up"]));
});
test("a tag shows its label and an optional icon", () => {
  const { container } = render(
    <Badge tone="bad" icon="alert">
      Marked passed without a passing check
    </Badge>,
  );
  expect(screen.getByText("Marked passed without a passing check")).toBeTruthy();
  expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});
test("the spin rule exists once and the reduced-motion rule still removes it", () => {
  const base = readFileSync("apps/desktop/src/styles/base.css", "utf8");
  expect(base).toMatch(/\[data-spin="true"\]\s*\{[^}]*animation:\s*fd-spin 1\.1s linear infinite/);
  expect(base).toMatch(/@keyframes fd-spin/);
  expect(base).toMatch(/animation:\s*none !important/);
});
