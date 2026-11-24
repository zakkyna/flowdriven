import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ColorMode as ContractColorMode } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { AppearanceError, type ColorMode, createAppearance } from "./appearance";
import { fakeFs, fakeNativeTheme, fakeWindow } from "./test-helpers/fakes";
import { WINDOW_BACKGROUND } from "./window-colors";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  await mkdir(path.resolve(".workflow/scratch"), { recursive: true });
  const dir = await mkdtemp(path.resolve(".workflow/scratch/flowdriven-appearance-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("TC-j12-03 Main sets nativeTheme and keeps the choice in its own file", async () => {
  await withTempDir(async (dir) => {
    const nativeTheme1 = fakeNativeTheme();
    const appearance1 = createAppearance({
      fs: { readFileSync, mkdir, writeFile, rename, rm },
      nativeTheme: nativeTheme1,
      userDataDir: dir,
    });

    await appearance1.set("light");
    await appearance1.set("dark");
    await appearance1.set("system");

    expect(nativeTheme1.themeSourceHistory).toEqual(["light", "dark", "system"]);
    const saved = JSON.parse(readFileSync(path.join(dir, "window.json"), "utf8")) as unknown;
    expect(saved).toEqual({ version: 1, colorMode: "system" });
    expect(ContractColorMode.options).toEqual(["light", "system", "dark"]);

    const nativeTheme2 = fakeNativeTheme({ themeSource: "light" });
    const appearance2 = createAppearance({
      fs: { readFileSync, mkdir, writeFile, rename, rm },
      nativeTheme: nativeTheme2,
      userDataDir: dir,
    });
    expect(appearance2.load()).toEqual({ colorMode: "system" });
    expect(nativeTheme2.themeSource).toBe("system");

    await expect(appearance2.set("purple" as ColorMode)).rejects.toMatchObject({
      name: "AppearanceError",
      code: "invalid_input",
    });
    expect(JSON.parse(readFileSync(path.join(dir, "window.json"), "utf8"))).toEqual({
      version: 1,
      colorMode: "system",
    });
    expect(nativeTheme2.themeSource).toBe("system");
    expect(AppearanceError.prototype).toBeInstanceOf(Error);
  });
});

test("TC-j12-04 Appearance survives a restart and a broken file gives Auto", async () => {
  await withTempDir(async (root) => {
    const savedDir = path.join(root, "saved");
    const missingDir = path.join(root, "missing");
    const brokenDir = path.join(root, "broken");
    const dirInPlace = path.join(root, "dir-in-place");

    await mkdir(savedDir, { recursive: true });
    await writeFile(path.join(savedDir, "window.json"), JSON.stringify({ version: 1, colorMode: "dark" }));
    await mkdir(missingDir, { recursive: true });
    await mkdir(brokenDir, { recursive: true });
    await writeFile(path.join(brokenDir, "window.json"), "not json {");
    await mkdir(path.join(dirInPlace, "window.json"), { recursive: true });

    const results: ColorMode[] = [];
    for (const userDataDir of [savedDir, missingDir, brokenDir, dirInPlace]) {
      const nativeTheme = fakeNativeTheme();
      const appearance = createAppearance({
        fs: { readFileSync, mkdir, writeFile, rename, rm },
        nativeTheme,
        userDataDir,
      });
      const loaded = appearance.load();
      results.push(loaded.colorMode);
      expect(nativeTheme.themeSource).toBe(loaded.colorMode);
    }

    expect(results).toEqual(["dark", "system", "system", "system"]);
  });
});

test("TC-ELE-08 Color mode: the three values map to nativeTheme and are saved atomically", async () => {
  const fs = fakeFs();
  const nativeTheme = fakeNativeTheme();
  const appearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });

  await appearance.set("dark");
  await appearance.set("light");
  await appearance.set("system");

  expect(nativeTheme.themeSourceHistory).toEqual(["dark", "light", "system"]);

  const windowPath = path.join("U", "window.json");
  const tempPath = path.join("U", "window.json.tmp");
  expect(fs.log.some((entry) => entry.op === "writeFile" && entry.path === windowPath)).toBe(false);

  const writes = fs.log
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.op === "writeFile" && entry.path === tempPath);
  const renames = fs.log
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.op === "rename" && entry.path === tempPath && entry.to === windowPath);

  expect(writes).toHaveLength(3);
  expect(renames).toHaveLength(3);
  for (let i = 0; i < 3; i += 1) {
    const writeIndex = writes[i]?.index ?? -1;
    const renameIndex = renames[i]?.index ?? -1;
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(renameIndex).toBeGreaterThan(writeIndex);
  }

  expect(JSON.parse(fs.files.get(windowPath) ?? "")).toEqual({ version: 1, colorMode: "system" });
  expect(fs.files.has(tempPath)).toBe(false);
});

test("TC-ELE-09 A failed save leaves the old file and reports unavailable", async () => {
  const windowPath = path.join("U", "window.json");
  const tempPath = path.join("U", "window.json.tmp");
  const fs = fakeFs({
    files: { [windowPath]: JSON.stringify({ version: 1, colorMode: "dark" }) },
  });
  const nativeTheme = fakeNativeTheme({ themeSource: "dark", shouldUseDarkColors: true });
  const appearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });

  fs.setFailure("rename", new Error("disk error"));

  await expect(appearance.set("light")).rejects.toMatchObject({
    name: "AppearanceError",
    code: "unavailable",
  });
  expect(JSON.parse(fs.files.get(windowPath) ?? "")).toEqual({ version: 1, colorMode: "dark" });
  expect(nativeTheme.themeSource).toBe("dark");
  expect(fs.files.has(tempPath)).toBe(false);
  expect(fs.log).toContainEqual({ op: "rm", path: tempPath });
});

test("TC-ELE-10 An unreadable or wrong file gives Auto", async () => {
  const windowPath = path.join("U", "window.json");
  const badContents: (string | undefined)[] = [
    undefined,
    "",
    "{",
    "[]",
    JSON.stringify({ version: 2, colorMode: "dark" }),
    JSON.stringify({ version: 1, colorMode: "purple" }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, colorMode: "dark", extra: 1 }),
    JSON.stringify({ version: 1, colorMode: "dark", keepRunning: true }),
  ];

  for (const content of badContents) {
    const fs = fakeFs(content === undefined ? undefined : { files: { [windowPath]: content } });
    const nativeTheme = fakeNativeTheme();
    const appearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });
    expect(() => appearance.load()).not.toThrow();
    expect(appearance.load(), content ?? "missing").toEqual({ colorMode: "system" });
  }

  const validFs = fakeFs({
    files: { [windowPath]: JSON.stringify({ version: 1, colorMode: "dark" }) },
  });
  const validAppearance = createAppearance({
    fs: validFs,
    nativeTheme: fakeNativeTheme(),
    userDataDir: "U",
  });
  expect(validAppearance.load()).toEqual({ colorMode: "dark" });

  await validAppearance.set("dark");
  const written = JSON.parse(validFs.files.get(windowPath) ?? "") as Record<string, unknown>;
  expect(Object.keys(written).sort()).toEqual(["colorMode", "version"]);
  expect(written).toEqual({ version: 1, colorMode: "dark" });
});

test("TC-ELE-12 The window background follows the theme", async () => {
  const fs = fakeFs();
  const nativeTheme = fakeNativeTheme({ shouldUseDarkColors: false });
  const appearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });

  const liveWindow = fakeWindow();
  const destroyedWindow = fakeWindow({ destroyed: true });

  appearance.track(liveWindow);
  appearance.track(destroyedWindow);

  await appearance.set("dark");
  nativeTheme.shouldUseDarkColors = false;
  nativeTheme.emitUpdated();

  expect(liveWindow.backgroundColors).toEqual([
    WINDOW_BACKGROUND.light,
    WINDOW_BACKGROUND.dark,
    WINDOW_BACKGROUND.light,
  ]);
  expect(destroyedWindow.backgroundColors).toEqual([]);

  liveWindow.setDestroyed(true);
  nativeTheme.shouldUseDarkColors = true;
  nativeTheme.emitUpdated();

  expect(liveWindow.backgroundColors).toEqual([
    WINDOW_BACKGROUND.light,
    WINDOW_BACKGROUND.dark,
    WINDOW_BACKGROUND.light,
  ]);
});
