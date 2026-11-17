import { expect, test } from "vitest";
import { parseConnectors } from "./connector-scan.ts";

test("the scan keeps destructive true from a tool's annotation and leaves it out otherwise", () => {
  const result = parseConnectors({
    mcpServers: [
      {
        name: "Gmail",
        status: "connected",
        scope: "claudeai",
        config: { type: "claudeai-proxy", url: "https://example.test", id: "mcpsrv_test" },
        tools: [
          { name: "a", annotations: { destructive: true, readOnly: true } },
          { name: "b", annotations: { destructive: false } },
          { name: "c", annotations: { destructive: "true" } },
          { name: "d" },
        ],
      },
    ],
  });
  expect(result.at(0)?.tools).toEqual([
    { name: "a", readOnly: true, destructive: true },
    { name: "b", readOnly: false },
    { name: "c", readOnly: false },
    { name: "d", readOnly: false },
  ]);
});
