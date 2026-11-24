import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const electronDir = fileURLToPath(new URL(".", import.meta.url));

function listNonTestElectronFiles(root: string): { rel: string; path: string }[] {
  const files: { rel: string; path: string }[] = [];
  for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const rel = entry.split(sep).join("/");
    if (!/\.(?:ts|tsx|mts)$/.test(rel) || /\.test\.(?:ts|tsx|mts)$/.test(rel)) continue;
    if (rel.split("/").includes("test-helpers")) continue;
    files.push({ rel, path: join(root, entry) });
  }
  return files;
}

function scanLoginItem(root: string): string[] {
  const setLogin = ["set", "LoginItemSettings"].join("");
  const getLogin = ["get", "LoginItemSettings"].join("");
  const openAtLogin = ["open", "AtLogin"].join("");
  const loginFile = ["login", "-item.ts"].join("");
  const termRegex = new RegExp(`\\b(?:${setLogin}|${getLogin}|${openAtLogin})\\b`);

  const findings: string[] = [];
  for (const file of listNonTestElectronFiles(root)) {
    if (file.rel.split("/").at(-1) === loginFile) {
      findings.push(`${file.rel}: forbidden file ${loginFile}`);
    }
    const source = readFileSync(file.path, "utf8");
    const match = source.match(termRegex);
    if (match) {
      findings.push(`${file.rel}: ${match[0]}`);
    }
  }
  return findings;
}

function scanTrayAndMenu(root: string): string[] {
  const trayWord = ["Tr", "ay"].join("");
  const menuWord = ["Me", "nu"].join("");
  const trayFile = ["tr", "ay.ts"].join("");
  const electronImportRegex = new RegExp(
    `import\\s*(?:type\\s*)?\\{[^}]*\\b(?:${trayWord}|${menuWord})\\b[^}]*\\}\\s*from\\s*["']electron["']`,
    "s",
  );
  const newTrayRegex = new RegExp(`\\bnew\\s+${trayWord}\\b`);

  const findings: string[] = [];
  for (const file of listNonTestElectronFiles(root)) {
    if (file.rel.split("/").at(-1) === trayFile) {
      findings.push(`${file.rel}: forbidden file ${trayFile}`);
    }
    const source = readFileSync(file.path, "utf8");
    if (electronImportRegex.test(source)) {
      findings.push(`${file.rel}: forbidden electron import (${trayWord}/${menuWord})`);
    }
    if (newTrayRegex.test(source)) {
      findings.push(`${file.rel}: new ${trayWord}`);
    }
  }
  return findings;
}

test("TC-ELE-14 no login item is set (source rule)", () => {
  expect(scanLoginItem(electronDir)).toEqual([]);

  const tempRoot = mkdtempSync(join(tmpdir(), "flowdriven-ele14-"));
  try {
    mkdirSync(join(tempRoot, "test-helpers"), { recursive: true });
    const setLogin = ["set", "LoginItemSettings"].join("");
    const openAtLogin = ["open", "AtLogin"].join("");
    const loginFile = ["login", "-item.ts"].join("");

    writeFileSync(join(tempRoot, "bad.ts"), `app.${setLogin}({ ${openAtLogin}: true });\n`);
    writeFileSync(join(tempRoot, loginFile), "export const x = 1;\n");
    writeFileSync(join(tempRoot, "ok.test.ts"), `app.${setLogin}({ ${openAtLogin}: true });\n`);
    writeFileSync(join(tempRoot, "test-helpers", "helper.ts"), `app.${setLogin}({});\n`);

    expect(scanLoginItem(tempRoot).sort()).toEqual([
      `bad.ts: ${setLogin}`,
      `${loginFile}: forbidden file ${loginFile}`,
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("TC-ELE-16 no tray icon is created (source rule)", () => {
  expect(scanTrayAndMenu(electronDir)).toEqual([]);

  const tempRoot = mkdtempSync(join(tmpdir(), "flowdriven-ele16-"));
  try {
    mkdirSync(join(tempRoot, "test-helpers"), { recursive: true });
    const trayWord = ["Tr", "ay"].join("");
    const menuWord = ["Me", "nu"].join("");
    const trayFile = ["tr", "ay.ts"].join("");

    writeFileSync(join(tempRoot, "bad-tray.ts"), `import { ${trayWord} } from "electron";\n`);
    writeFileSync(join(tempRoot, "bad-menu.ts"), `import { ${menuWord} } from 'electron';\n`);
    writeFileSync(join(tempRoot, "bad-new.ts"), `export const t = new ${trayWord}("icon.png");\n`);
    writeFileSync(join(tempRoot, trayFile), "export const t = 1;\n");
    writeFileSync(join(tempRoot, "ignored.test.ts"), `import { ${trayWord} } from "electron";\n`);
    writeFileSync(join(tempRoot, "test-helpers", "h.ts"), `import { ${menuWord} } from "electron";\n`);

    expect(scanTrayAndMenu(tempRoot).sort()).toEqual([
      `bad-menu.ts: forbidden electron import (${trayWord}/${menuWord})`,
      `bad-new.ts: new ${trayWord}`,
      `bad-tray.ts: forbidden electron import (${trayWord}/${menuWord})`,
      `${trayFile}: forbidden file ${trayFile}`,
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
