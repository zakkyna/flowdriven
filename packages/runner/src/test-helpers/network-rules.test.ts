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
