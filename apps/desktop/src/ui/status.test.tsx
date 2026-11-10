import {
  ApprovalState,
  CheckVerdict,
  ConnectionState,
  RequirementState,
  RiskLabel,
  RunState,
  SignOffState,
  StepRunState,
} from "@flowdriven/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ICON_NAMES, Icon } from "./icons";
import { StatusBadge } from "./StatusBadge";
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
      tone: "accent",
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
