import { FlowManifest, Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { capabilitySentence, DROP, routeAll, routeRequirement, unattendedProviderErrors } from "./route.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail = entry;
const req = (tools: string[]) =>
  Requirement.parse({ id: "gmail", type: "mcp_server", ref: gmail.ref, tools });
const fact = {
  name: gmail.name,
  url: gmail.url,
  status: "connected",
  tools: ["create_draft", "label_thread", "update_draft", "create_label", "untrash_thread"].map((name) => ({
    name,
    readOnly: false,
  })),
};
const facts = { hooks: true, chrome: false, connectors: [fact] };
test("a declared write tool routes when the scan lists it, and drops when the scan marks it destructive", () => {
  expect(routeRequirement(req(["create_draft"]), facts)).toMatchObject({ routed: true });
  expect(
    routeRequirement(req(["create_draft"]), {
      ...facts,
      connectors: [{ ...fact, tools: [{ name: "create_draft", readOnly: false, destructive: true }] }],
    }),
  ).toMatchObject({ routed: false, reason: DROP.connectorTool });
  expect(routeRequirement(req(["label_message"]), facts)).toMatchObject({
    routed: false,
    reason: DROP.connectorTool,
  });
});
test("update_draft, create_label and untrash_thread still drop the route with DROP.connectorTool", () => {
  for (const name of ["update_draft", "create_label", "untrash_thread"])
    expect(routeRequirement(req([name]), facts)).toMatchObject({ routed: false, reason: DROP.connectorTool });
});
test("every catalogued write tool whose name holds label, spam or trash is a label tool", () => {
  expect(gmail.write).toEqual(["create_draft", "label_thread", "label_message", "update_message_labels"]);
  expect(gmail.labelTools).toEqual(gmail.write?.filter((name) => /label|spam|trash/.test(name)));
});
test("the preview sentence names the write tools and the Trash and Spam rule", () => {
  expect(capabilitySentence(req(["search_threads", "label_thread", "create_draft", "delete_draft"]))).toBe(
    "Uses your Gmail through the Gmail connector in Claude Code. Reads with: search_threads. Changes with: label_thread, create_draft. Waits for your approval before each: delete_draft. Waits for your approval before a label change that moves mail to Trash or Spam.",
  );
  expect(capabilitySentence(req(["create_draft"]))).not.toContain("Trash or Spam");
});
test("R4: a flow with a schedule may label before its first ask", () => {
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.proof",
    name: "Proof",
    kind: "build",
    triggers: [{ kind: "schedule", every: "1h" }],
    requirements: [req(["label_thread"])],
    steps: [
      { id: "label", do: "worker", instructions: "Label", uses: ["gmail"] },
      { id: "ask", do: "ask", ask: { question: "Choose", choose_from: "items" } },
    ],
  });
  const routes = routeAll(manifest.requirements, facts);
  expect(routes).toMatchObject([{ routed: true }]);
  expect(unattendedProviderErrors(manifest, routes)).toEqual([]);
});
