import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CONTENT_SECURITY_POLICY } from "./csp.mjs";

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

test("TC-ELE-03 the content security policy is exact and both copies match", () => {
  const json = JSON.parse(readFileSync("apps/desktop/electron/csp.json", "utf8")) as { policy: string };
  expect(json.policy).toBe(EXPECTED_CSP);
  expect(CONTENT_SECURITY_POLICY).toBe(EXPECTED_CSP);
  const split = (policy: string) => policy.split(";").map((part) => part.trim());
  expect(split(json.policy)).toEqual(split(EXPECTED_CSP));
  expect(split(CONTENT_SECURITY_POLICY)).toEqual(split(EXPECTED_CSP));
  for (const copy of [json.policy, CONTENT_SECURITY_POLICY]) {
    expect(copy).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:|ws:/);
    expect(split(copy)).toContain("img-src 'self' data:");
  }
});

test("the policy allows only the app's own files", () => {
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
});

test("built HTML has the strict policy and no inline script", async () => {
  const { build } = await import("vite");
  const { readFile, rm, mkdtemp, mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  await mkdir(path.resolve(".workflow/scratch"), { recursive: true });
  const output = await mkdtemp(path.resolve(".workflow/scratch/flowdriven-build-"));
  try {
    await build({
      configFile: path.resolve("apps/desktop/vite.config.mts"),
      build: { outDir: output },
      logLevel: "silent",
    });
    const html = await readFile(path.join(output, "index.html"), "utf8");
    const { Window } = await import("happy-dom");
    const document = new Window().document;
    document.write(html);
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    ).toBe(CONTENT_SECURITY_POLICY);
    for (const script of document.querySelectorAll("script")) expect(script.getAttribute("src")).toBeTruthy();
    expect(
      CONTENT_SECURITY_POLICY.split(";")
        .find((part) => part.trim().startsWith("script-src"))
        ?.trim(),
    ).toBe("script-src 'self'");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 30000);
