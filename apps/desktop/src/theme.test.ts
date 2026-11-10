import { expect, test } from "vitest";
import { applyTheme, themeFromSearch } from "./theme";

test("the query overrides the system theme", () => {
  expect(themeFromSearch("?theme=dark")).toBe("dark");
  expect(themeFromSearch("?theme=light")).toBe("light");
  expect(themeFromSearch("?theme=blue")).toBeNull();
  const root = document.createElement("html");
  applyTheme("?theme=dark", root);
  expect(root.dataset.theme).toBe("dark");
  applyTheme("", root);
  expect(root.dataset.theme).toBeUndefined();
});
