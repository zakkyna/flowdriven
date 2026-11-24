import { expect, test } from "vitest";

test("TC-REPO-07 detects network modules and calls, but not comments or strings", async () => {
  const { findNetworkUse } = await import("./network-rules.ts");
  const findings: [string, string][] = [
    ['import https from "node:https"', "node:https"],
    ['import { request } from "node:http"', "node:http"],
    ['const net = require("node:net")', "node:net"],
    ['import tls from "node:tls"', "node:tls"],
    ['import dgram from "node:dgram"', "node:dgram"],
    ['import http2 from "node:http2"', "node:http2"],
    ['import { net } from "electron"', "net"],
    ["await fetch(url)", "fetch"],
    ["new WebSocket(url)", "WebSocket"],
    ["new XMLHttpRequest()", "XMLHttpRequest"],
    ["session.fetch(url)", "session.fetch"],
    ['import x from "undici"', "undici"],
    ['import ws from "ws"', "ws"],
  ];
  for (const [source, name] of findings) expect(findNetworkUse(source)).toEqual([name]);
  for (const source of [
    'import fs from "node:fs"',
    'import { spawn } from "node:child_process"',
    "prefetch(x)",
    "// we never call fetch(url) here",
    'const s = "node:https"',
  ])
    expect(findNetworkUse(source)).toEqual([]);
});

const newFindings: [string, string][] = [
  ['import dns from "dns"', "dns"],
  ['require("node:dns")', "node:dns"],
  ["globalThis.fetch(url)", "fetch"],
  ["window.fetch(url)", "fetch"],
  ["self.fetch(url)", "fetch"],
  ["fetch?.(url)", "fetch"],
  ["fetch.call(null, url)", "fetch"],
  ["fetch.apply(null, [url])", "fetch"],
  ['const { net } = require("electron")', "net"],
  ['import * as electron from "electron"; electron.net.fetch(url)', "net"],
  ['import electron from "electron"; electron.net.fetch(url)', "net"],
  ['require("electron").net.fetch(url)', "net"],
  ["defaultSession.fetch(url)", "session.fetch"],
  ['session.fromPartition("x").fetch(url)', "session.fetch"],
  ["new globalThis.WebSocket(url)", "WebSocket"],
  ["import(name)", "import"],
  ["require(name)", "require"],
  ['import("fs" + name)', "import"],
  ['require("fs" + name)', "require"],
  ["const x = `value ${fetch(url)}`", "fetch"],
  [`const x = /"/; fetch(url); const y = /"/`, "fetch"],
];

test.each(newFindings)("TC-REPO-07 detects %s", async (source, name) => {
  const { findNetworkUse } = await import("./network-rules.ts");
  expect(findNetworkUse(source)).toContain(name);
});

test("TC-REPO-08 also checks JavaScript and CTS sources", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { findNetworkUse } = await import("./network-rules.ts");
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const folders = [
    "packages/contracts/src",
    "packages/sdk/src",
    "packages/runner/src",
    "packages/fixtures/src",
    "apps/desktop/electron",
    "apps/desktop/src",
  ];
  const findings: string[] = [];
  for (const folder of folders) {
    for (const path of readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })) {
      if (!/\.(?:js|mjs|cjs|cts)$/.test(path) || /\.test\.(?:js|mjs|cjs|cts)$/.test(path)) continue;
      for (const finding of findNetworkUse(readFileSync(join(root, folder, path), "utf8")))
        findings.push(`${folder}/${path}: ${finding}`);
    }
  }
  expect(findings).toEqual([]);
});
