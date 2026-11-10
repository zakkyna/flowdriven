import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CheckList } from "./CheckList";

test("shows the verdict next to the check that proved it", () => {
  render(
    <CheckList
      checks={[{ type: "command", required: true, summary: "flutter analyze exits 0", verdict: "passed" }]}
    />,
  );
  expect(screen.getByText("flutter analyze exits 0")).toBeTruthy();
  expect(screen.getByText("Passed")).toBeTruthy();
  expect(screen.getByText("command")).toBeTruthy();
});
test("marks judge-only steps and optional checks", () => {
  render(
    <CheckList
      checks={[
        { type: "judge", required: true, summary: "Numbers match" },
        { type: "files", required: false, summary: "Extra" },
      ]}
    />,
  );
  expect(screen.getByText("Judged, not verified")).toBeTruthy();
  expect(screen.getByText("(optional)")).toBeTruthy();
});
test("collapses evidence longer than 12 lines", () => {
  const evidence = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  render(
    <CheckList
      checks={[
        { type: "command", required: true, summary: "flutter test exits 0", verdict: "failed", evidence },
      ]}
    />,
  );
  expect(screen.queryByText(/line 13/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 20 lines" }));
  expect(screen.getByText(/line 20/)).toBeTruthy();
});
test("evidence expands and collapses with its state announced", () => {
  const evidence = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  render(
    <CheckList
      checks={[{ type: "files", required: false, summary: "Extra", evidence, verdict: "passed" }]}
    />,
  );
  const button = screen.getByRole("button", { name: "Show all 20 lines" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  const collapse = screen.getByRole("button", { name: "Show fewer lines" });
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(collapse);
  expect(screen.queryByText(/line 13/)).toBeNull();
});
test("counts evidence lines without a trailing newline and reports missing proof", () => {
  const evidence = `${Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
  const { container } = render(
    <CheckList
      checks={[
        { type: "command", required: true, summary: "Twelve lines", verdict: "passed", evidence },
        { type: "command", required: true, summary: "No proof", verdict: "passed", evidence: "" },
      ]}
    />,
  );
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  expect(screen.getByText("No evidence recorded")).toBeTruthy();
  expect(container.querySelectorAll("pre")).toHaveLength(1);
});

test("whitespace-only evidence has no evidence block", () => {
  const { container } = render(
    <CheckList
      checks={[{ type: "command", required: true, summary: "Check", verdict: "passed", evidence: "\n" }]}
    />,
  );
  expect(container.querySelector("pre")).toBeNull();
  expect(screen.getByText("No evidence recorded")).toBeTruthy();
});

test("a check line is an icon, the check text and the result word in its own column", () => {
  const { container } = render(
    <CheckList
      checks={[{ type: "command", required: true, summary: "flutter analyze exits 0", verdict: "passed" }]}
    />,
  );
  const row = container.querySelector("[data-verdict]") as HTMLElement;
  expect(row.getAttribute("data-verdict")).toBe("passed");
  const [icon, text, result] = Array.from(row.children) as HTMLElement[];
  expect(icon?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(text?.textContent).toContain("flutter analyze exits 0");
  expect(text?.textContent).toContain("command");
  expect(result?.textContent).toBe("Passed");
});
test("a check without a run result reads Not run yet, and a failed one reads Failed", () => {
  const { container } = render(
    <CheckList
      checks={[
        { type: "files", required: true, summary: "Report exists" },
        { type: "schema", required: true, summary: "Schema valid", verdict: "failed" },
      ]}
    />,
  );
  const rows = Array.from(container.querySelectorAll("[data-verdict]"));
  expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["pending", "failed"]);
  expect(rows.map((r) => (r.children[2] as HTMLElement).textContent)).toEqual(["Not run yet", "Failed"]);
});
test("check line styles: three columns, word right-aligned to the first line, pending muted", () => {
  const css = readFileSync("apps/desktop/src/ui/CheckList.module.css", "utf8");
  expect(css).toMatch(/\.row\s*\{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\) auto/s);
  expect(css).toMatch(/\.row\s*\{[^}]*align-items:\s*start/s);
  expect(css).toMatch(/\.result\s*\{[^}]*text-align:\s*right[^}]*white-space:\s*nowrap/s);
  expect(css).toMatch(/\[data-verdict="pending"\][^{]*\{[^}]*color:\s*var\(--text-muted\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
