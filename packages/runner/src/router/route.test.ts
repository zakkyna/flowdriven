import { FlowManifest, Requirement } from "@flowdriven/sdk";
import { describe, expect, test } from "vitest";
import { upworkJobReview } from "../../../sdk/src/test-data/upwork.ts";
import {
  capabilityHosts,
  capabilitySentence,
  DROP,
  needsAllow,
  routeAll,
  routeRequirement,
  UNOFFICIAL_SENTENCE,
  unattendedProviderErrors,
} from "./route.ts";
import type { Routed } from "./types.ts";

const facts = { hooks: true, chrome: true };
const req = (value: unknown) => Requirement.parse(value);
const web = (extra: object = {}) =>
  req({
    id: "web",
    type: "web",
    mode: "read",
    session: "own",
    url_patterns: ["https://example.com/"],
    ...extra,
  });
const manifest = (steps: unknown[], requirements: unknown[], triggers: unknown[] = []) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    steps,
    requirements,
    triggers,
  });
const worker = (id: string, uses: string[]) => ({ id, do: "worker", instructions: "Read", uses });
const ask = (when?: string) => ({
  id: "ask",
  do: "ask",
  ask: { question: "Choose", choose_from: "items" },
  ...(when === undefined ? {} : { when }),
});

describe("capability router", () => {
  test("a path inside the project is the official file-tools route and can run while away; ~/x, /x and ../x are dropped", () => {
    expect(routeRequirement(req({ id: "p", type: "path", ref: "src" }), facts)).toEqual({
      routed: true,
      requirementId: "p",
      type: "path",
      provider: "claude-code-files",
      providerName: "Claude Code file tools",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "official",
      away: true,
    });
    for (const ref of ["~/x", "/x", "../x"])
      expect(routeRequirement(req({ id: "p", type: "path", ref }), facts)).toEqual({
        routed: false,
        requirementId: "p",
        type: "path",
        noun: "A folder outside the project",
        reason: DROP.notYet,
      });
  });
  test("a read, own-browser web requirement is the unofficial Chrome route with the spec's sentence and can run while away", () => {
    expect(routeRequirement(web(), facts)).toEqual({
      routed: true,
      requirementId: "web",
      type: "web",
      provider: "claude-in-chrome",
      providerName: "Claude in Chrome inside Claude Code",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "unofficial",
      labelSentence: UNOFFICIAL_SENTENCE,
      away: true,
    });
    expect(UNOFFICIAL_SENTENCE).toBe(
      "This uses your personal browser. Every site you are logged into is reachable from it.",
    );
  });
  test("R11: without hooks the web route is dropped with `This needs a harness that can check each call.`, without Chrome with `This Claude Code cannot use Chrome.`, and with neither the hook reason comes first", () => {
    for (const [hooks, chrome, reason] of [
      [false, false, DROP.noHooks],
      [false, true, DROP.noHooks],
      [true, false, DROP.noChrome],
    ] as const)
      expect(routeRequirement(web(), { hooks, chrome })).toMatchObject({ routed: false, reason });
    expect(DROP.noHooks).toBe("This needs a harness that can check each call.");
    expect(DROP.noChrome).toBe("This Claude Code cannot use Chrome.");
    expect(routeRequirement(web(), facts)).toMatchObject({ routed: true });
  });
  test("every other type and every other web shape is dropped with `FlowDriven cannot provide this yet.` and its noun phrase", () => {
    const cases: [{ type: string; [key: string]: unknown }, string][] = [
      [{ type: "skill" }, "A skill"],
      [{ type: "plugin", tools: ["x"] }, "A plugin"],
      [{ type: "mcp_server", tools: ["x"] }, "A connector"],
      [{ type: "cli_tool" }, "A command-line tool"],
      [{ type: "gui_app" }, "A desktop app"],
      [{ type: "account" }, "An account"],
      [{ type: "browser_session" }, "A browser session"],
      [{ type: "desktop", mode: "read" }, "Control of this Mac"],
      [{ type: "trigger" }, "A trigger"],
      [{ type: "web", mode: "act", session: "own" }, "Web access of this kind"],
      [{ type: "web", mode: "read", session: "managed" }, "Web access of this kind"],
      [{ type: "web", mode: "read", session: "none" }, "Web access of this kind"],
    ];
    for (const [value, noun] of cases)
      expect(routeRequirement(req({ id: "r", ...value }), facts)).toEqual({
        routed: false,
        requirementId: "r",
        type: value.type,
        noun,
        reason: "FlowDriven cannot provide this yet.",
      });
  });
  test("harness requirements are not routed, and routeAll keeps the manifest order", () => {
    const items = [web(), req({ id: "h", type: "harness" }), req({ id: "p", type: "path" })];
    const harness = items.at(1);
    if (!harness) throw new Error("Missing harness");
    expect(routeRequirement(harness, facts)).toBeUndefined();
    expect(routeAll(items, facts).map((r) => r.requirementId)).toEqual(["web", "p"]);
  });
  test("needsAllow is true when any step, in a loop too, uses a requirement that is not path or harness, and false when such a requirement is declared but unused", () => {
    const requirements = [web(), { id: "p", type: "path" }, { id: "h", type: "harness" }];
    expect(needsAllow(manifest([worker("one", ["p", "h"])], requirements))).toBe(false);
    expect(needsAllow(manifest([worker("one", ["web"])], requirements))).toBe(true);
    expect(
      needsAllow(
        manifest(
          [{ id: "loop", for_each: "items", as: "item", steps: [worker("inner", ["web"])] }],
          requirements,
        ),
      ),
    ).toBe(true);
  });
  test("capabilitySentence for the spec's Upwork requirement is `Reads pages on www.upwork.com in your own Chrome, at most 3 per run and 10 a day.`; with eight templates on eight hosts every host is in the sentence, in order, and a repeated host appears once", () => {
    const job = FlowManifest.parse(upworkJobReview).requirements.find((r) => r.id === "jobs_web");
    expect(job && capabilitySentence(job)).toBe(
      "Reads pages on www.upwork.com in your own Chrome, at most 3 per run and 10 a day.",
    );
    const hosts = Array.from({ length: 8 }, (_, i) => `host${i}.example.com`);
    const r = web({
      url_patterns: [...hosts.map((host) => `https://${host}/`), "https://host0.example.com/a"],
    });
    expect(capabilityHosts(r)).toEqual(hosts);
    expect(capabilitySentence(r)).toBe(
      `Reads pages on ${hosts.join(", ")} in your own Chrome, at most 3 per run and 10 a day.`,
    );
  });
  test("capabilitySentence uses the hosts of the templates, not the domains field, and a hostile folder with control and bidi characters is shown cleaned", () => {
    expect(
      capabilitySentence(
        web({ domains: ["wrong.example"], url_patterns: ["bad", "https://right.example/"] }),
      ),
    ).toContain("on right.example in");
    expect(
      capabilitySentence(req({ id: "p", type: "path", ref: `a${String.fromCodePoint(10, 0x202e)}b` })),
    ).toBe("Reads files in a<U+000A><U+202E>b.");
  });
  test("capabilitySentence for a read_write path says it reads and writes, and a read path says it reads", () => {
    expect(capabilitySentence(req({ id: "p", type: "path", access: "read_write" }))).toBe(
      "Reads and writes files in the project folder.",
    );
    expect(capabilitySentence(req({ id: "p", type: "path", ref: "src", access: "read" }))).toBe(
      "Reads files in src.",
    );
  });
  test("the provider half of R4: a made-up route labelled not enforced before the first ask is reported with its path; after the ask, or with a manual trigger only, it is not; an ask with a `when` does not end the prefix; a routed hook route is not reported", () => {
    const requirements = [web(), { id: "p", type: "path" }];
    const route: Routed = {
      routed: true,
      requirementId: "web",
      type: "web",
      provider: "claude-in-chrome",
      providerName: "Test",
      enforcedBy: "not enforced",
      label: "unofficial",
      away: false,
    };
    const steps = [
      worker("first", ["web", "p"]),
      { id: "loop", for_each: "items", as: "item", steps: [worker("nested", ["web"])] },
      ask("condition"),
      worker("next", ["web"]),
      ask(),
      worker("after", ["web"]),
    ];
    const m = manifest(steps, requirements, [{ kind: "schedule", every: "1h" }]);
    expect(
      unattendedProviderErrors(m, [route, ...routeAll([req({ id: "p", type: "path" })], facts)]),
    ).toEqual([
      { path: "steps.0", requirementId: "web" },
      { path: "steps.1.steps.0", requirementId: "web" },
      { path: "steps.3", requirementId: "web" },
    ]);
    expect(unattendedProviderErrors(manifest(steps, requirements, [{ kind: "manual" }]), [route])).toEqual(
      [],
    );
    expect(unattendedProviderErrors(m, routeAll(m.requirements, facts))).toEqual([]);
  });
});
