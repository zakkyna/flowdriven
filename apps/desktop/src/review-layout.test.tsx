import { readFileSync } from "node:fs";
import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "./test/render";

const css = (path: string) => readFileSync(`apps/desktop/src/${path}`, "utf8");

test("brain labels have separate baseline-aligned pieces with spacing", async () => {
  renderApp("#/settings");
  const radio = await screen.findByRole("radio", { name: "Codex CLI" });
  const group = document.getElementById(radio.getAttribute("aria-describedby") ?? "");
  expect(group?.children.length).toBeGreaterThanOrEqual(4);
  expect(within(group as HTMLElement).getByText("Logged in").parentElement).toBe(group);
  expect(css("screens/settings/Settings.module.css")).toMatch(
    /\.brainDetails\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*baseline;[^}]*gap:\s*8px/s,
  );
});
test("fallback titles and risk tags use the section typography and baseline", () => {
  const style = css("screens/settings/Settings.module.css");
  expect(style).toMatch(/\.panel h3\s*\{[^}]*font-size:\s*var\(--text-m\);[^}]*font-weight:\s*600/s);
  expect(style).toMatch(/\.orderLine\s*\{[^}]*align-items:\s*baseline/s);
});
test("blocked reason keeps icon and text together", async () => {
  renderApp("#/runs/run-0006");
  const text = await screen.findByText(/flutter analyze still fails after 4 attempts/);
  expect(text.parentElement?.querySelector("svg")).not.toBeNull();
  expect(css("screens/runs/Runs.module.css")).toMatch(
    /\.reason\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*flex-start;[^}]*flex-wrap:\s*nowrap/s,
  );
});
test("project and report cells truncate without splitting words and retain titles", async () => {
  renderApp("#/runs");
  const table = await screen.findByRole("table", { name: "Runs" });
  const rows = within(table).getAllByRole("row");
  const cells = within(rows[1] as HTMLElement).getAllByRole("cell");
  for (const cell of cells.slice(4)) expect(cell.getAttribute("title")).toBe(cell.textContent);
  expect(css("screens/runs/Runs.module.css")).toMatch(
    /\.truncate\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/s,
  );
});
test("readiness help starts at the row text edge", async () => {
  renderApp("#/readiness/dev.example.social-posts");
  const row = await screen.findByRole("listitem", { name: "Instagram publishing" });
  expect(within(row).getByRole("button", { name: "Show me how" }).getAttribute("data-variant")).toBe("text");
  expect(css("ui/Button.module.css")).toMatch(
    /\[data-variant="text"\]\s*\{[^}]*padding:\s*0 10px;[^}]*margin-left:\s*-10px/s,
  );
});
test("inventory uses an icon instead of a browser marker", async () => {
  renderApp("#/harnesses");
  const card = await screen.findByRole("article", { name: "Codex" });
  const summary = within(card)
    .getByText(/^Skills \(/)
    .closest("summary");
  expect(summary?.querySelector("svg path")?.getAttribute("d")).toBe("M4 6l4 4 4-4");
  const style = css("screens/harnesses/Harnesses.module.css");
  expect(style).toMatch(/summary\s*\{[^}]*list-style:\s*none/s);
  expect(style).toMatch(/summary::-webkit-details-marker\s*\{[^}]*display:\s*none/s);
  expect(style).toMatch(/details\[open\] summary svg\s*\{[^}]*transform:\s*rotate\(0deg\)/s);
});
test("email metadata rows draw a continuous hairline", async () => {
  renderApp("#/inbox/ap-0011");
  const subject = await screen.findByText("Subject");
  expect(subject.parentElement?.querySelector("dd")).not.toBeNull();
  expect(css("screens/inbox/Inbox.module.css")).toMatch(
    /\.payloadRows > div\s*\{[^}]*display:\s*grid;[^}]*border-bottom:\s*1px solid var\(--border\)/s,
  );
});
test("sidebar flows have a scrollable zone and bottom clearance", () => {
  expect(css("nav/Sidebar.module.css")).toMatch(
    /\.flowsNav\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*padding:\s*0 8px 16px/s,
  );
});
