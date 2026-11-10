import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Page } from "./Page";

test("a page has a bar with the title and actions, and a body with the description and the content", () => {
  const { container } = render(
    <Page
      screen="demo"
      ready
      title="Settings"
      description="Some words"
      actions={<button type="button">Go</button>}
      before={<a href="#/x">Back</a>}
    >
      <p>Content</p>
    </Page>,
  );
  const root = container.querySelector("[data-screen='demo']") as HTMLElement;
  expect(root.getAttribute("data-screen-ready")).toBe("true");
  const bar = root.querySelector("header") as HTMLElement;
  const heading = within(bar).getByRole("heading", { level: 1, name: "Settings" });
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(within(bar).getByRole("button", { name: "Go" })).toBeTruthy();
  const back = within(bar).getByRole("link", { name: "Back" });
  expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(bar).queryByText("Some words")).toBeNull();
  const column = root.querySelector("[data-size]") as HTMLElement;
  expect(root.querySelector('[data-scroll="top"]')?.contains(column)).toBe(true);
  expect(within(column).getByText("Some words")).toBeTruthy();
  expect(within(column).getByText("Content")).toBeTruthy();
});
test("size picks the column: medium by default", () => {
  const a = render(
    <Page screen="a" ready title="A">
      x
    </Page>,
  );
  expect(a.container.querySelector("[data-size]")?.getAttribute("data-size")).toBe("medium");
  a.unmount();
  const b = render(
    <Page screen="b" ready title="B" size="narrow">
      x
    </Page>,
  );
  expect(b.container.querySelector("[data-size]")?.getAttribute("data-size")).toBe("narrow");
  expect(screen.getByRole("heading", { level: 1, name: "B" })).toBeTruthy();
});
test("page styles: a 52 px bar with a hairline, a body that scrolls, three column widths", () => {
  const css = readFileSync("apps/desktop/src/ui/Page.module.css", "utf8");
  expect(css).toMatch(
    /\.bar\s*\{[^}]*height:\s*var\(--bar-height\)[^}]*border-bottom:\s*1px solid var\(--border\)/s,
  );
  expect(css).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto[^}]*padding:\s*24px 32px 32px/s);
  expect(css).toMatch(/\[data-size="narrow"\][^{]*\{[^}]*max-width:\s*var\(--decision-width\)/s);
  expect(css).toMatch(/\[data-size="medium"\][^{]*\{[^}]*max-width:\s*var\(--reading-width\)/s);
  expect(css).toMatch(/\[data-size="wide"\][^{]*\{[^}]*max-width:\s*var\(--wide-width\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
