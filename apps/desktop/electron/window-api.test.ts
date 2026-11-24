import { WindowPrefs } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { fakeShell } from "./test-helpers/fakes";
import { createWindowApi } from "./window-api";

test("TC-ELE-25 link opening checks https public addresses and calls shell.openExternal", async () => {
  const shell = fakeShell();
  const api = createWindowApi({
    shell,
    platform: "darwin",
    readColorMode: () => "system",
  });

  expect(await api.openLink("https://example.com/a?x=1")).toEqual({ opened: true });
  expect(await api.openLink("https://EXAMPLE.com/b")).toEqual({ opened: true });
  expect(shell.opened).toEqual(["https://example.com/a?x=1", "https://example.com/b"]);

  for (const refused of [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://10.0.0.5/x",
    "https://example/x",
    "http://example.com/",
    "javascript:alert(1)",
    "https://sam:pw@example.com/",
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    expect(await api.openLink(refused), refused).toEqual({ opened: false });
  }
  expect(shell.opened).toHaveLength(2);

  shell.setFailure(new Error("boom"));
  expect(await api.openLink("https://example.org/")).toEqual({ opened: false });
  expect(shell.opened).toEqual([
    "https://example.com/a?x=1",
    "https://example.com/b",
    "https://example.org/",
  ]);
});

test("getPrefs returns readColorMode or system fallback and platform", () => {
  const shell = fakeShell();
  const darkPrefs = createWindowApi({
    shell,
    platform: "darwin",
    readColorMode: () => "dark",
  }).getPrefs();
  expect(WindowPrefs.parse(darkPrefs)).toEqual({ colorMode: "dark", platform: "darwin" });

  const fallbackPrefs = createWindowApi({
    shell,
    platform: "linux",
    readColorMode: () => undefined,
  }).getPrefs();
  expect(WindowPrefs.parse(fallbackPrefs)).toEqual({ colorMode: "system", platform: "linux" });
});
