// Belongs in: apps/desktop/src/screens/harnesses/review-03-a5.test.tsx
import type { HarnessCard } from "@flowdriven/contracts/v1";
import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { HarnessCardView } from "./HarnessCardView";

const card: HarnessCard = {
  id: "claude-code",
  name: "Claude Code",
  binary: "claude",
  detected: true,
  version: "2.1.318",
  path: "/x/claude",
  login: "logged_in",
  risk: "gray",
  vendorProhibited: false,
  consent: "given",
  sandbox: "none",
  adapter: "full",
  quota: { state: "unknown", today: { calls: 0 }, week: { calls: 0 } },
  inventory: {
    supported: true,
    skills: [],
    plugins: [],
    // `claude mcp list` truncated by visible(.., 120): two long names that share their first 120 characters,
    // or the same name listed twice, give the same scope and source.
    mcpServers: [
      { name: "a".repeat(120), scope: "user", source: "config", connection: "connected" },
      { name: "a".repeat(120), scope: "user", source: "config", connection: "failed" },
    ],
  },
};
test("two inventory entries with the same name, scope and source do not share a React key", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = render(
    <HarnessCardView card={card} busy={false} onGive={() => {}} onRevoke={() => {}} />,
  );
  expect(container.querySelectorAll("details li")).toHaveLength(2);
  expect(error.mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringContaining("same key"));
  error.mockRestore();
});
