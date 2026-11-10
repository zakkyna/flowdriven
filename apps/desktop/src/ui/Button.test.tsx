import { readdirSync, readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./Button";

const css = (file: string) => readFileSync(`apps/desktop/src/${file}`, "utf8");

test("a button is type=button with a variant, a size and its icon before its label", () => {
  render(
    <Button variant="primary" size="large" icon="plus">
      Add
    </Button>,
  );
  const button = screen.getByRole("button", { name: "Add" });
  expect(button.getAttribute("type")).toBe("button");
  expect(button.getAttribute("data-variant")).toBe("primary");
  expect(button.getAttribute("data-size")).toBe("large");
  expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
});
test("the defaults are secondary and default, and a quiet icon button is marked icon-only", () => {
  render(<Button>Plain</Button>);
  expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-variant")).toBe("secondary");
  expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-size")).toBe("default");
  render(<Button variant="quiet" icon="trash" aria-label="Delete" />);
  expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-icon-only")).toBe("true");
});
test("button styles follow the approved rules", () => {
  const button = css("ui/Button.module.css");
  expect(button).toMatch(/\.button\s*\{[^}]*height:\s*32px/);
  expect(button).toMatch(/\[data-size="small"\]\s*\{[^}]*height:\s*28px/);
  expect(button).toMatch(/\[data-size="large"\]\s*\{[^}]*height:\s*36px/);
  expect(button).toMatch(
    /\[data-variant="primary"\]\s*\{[^}]*background:\s*var\(--ink\)[^}]*color:\s*var\(--on-ink\)/s,
  );
  expect(button).toMatch(
    /\[data-variant="primary"\]:disabled\s*\{[^}]*background:\s*var\(--surface-selected\)/s,
  );
  expect(button).toMatch(/\[data-variant="text"\]\s*\{[^}]*text-decoration:\s*underline/s);
  expect(button).not.toMatch(/accent-hover/);
});
test("form controls take the app font and the theme colours", () => {
  const base = css("styles/base.css");
  expect(base).toMatch(/(?:^|\n)button,\s*input,\s*select,\s*textarea\s*\{[^}]*font:\s*inherit/);
  expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  expect(base).toMatch(/accent-color:\s*var\(--accent\)/);
});
test("the dialog has a hairline edge and no shadow", () => {
  const dialog = css("ui/Dialog.module.css");
  expect(dialog).not.toMatch(/box-shadow/);
  expect(dialog).toMatch(/\.panel\s*\{[^}]*border:\s*1px solid var\(--border\)/s);
});
test("no stylesheet removes the focus ring except the composer, which replaces it", () => {
  const files = (readdirSync("apps/desktop/src", { recursive: true }) as string[]).filter((f) =>
    f.endsWith(".css"),
  );
  for (const file of files) {
    const text = css(file);
    if (!/outline:\s*(none|0)\b/.test(text)) continue;
    expect(file).toBe("screens/builder/Builder.module.css");
    expect(text).toMatch(/:focus-within\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
  }
});
