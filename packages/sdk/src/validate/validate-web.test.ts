import { expect, test } from "vitest";
import { parseManifest } from "../format/parse.ts";
import { askStep, flow, sched, step, userStep } from "../test-data/flows.ts";
import { upworkJobReview } from "../test-data/upwork.ts";
import { validateManifest } from "./validate.ts";

const web = (extra: Record<string, unknown> = {}) => ({
  id: "page",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: ["https://example.com/"],
  ...extra,
});
const issues = (req: Record<string, unknown>) => validateManifest(flow({ requirements: [req] }));
const pairs = (req: Record<string, unknown>) => issues(req).map(({ code, path }) => `${code}@${path}`);

test("the spec's Upwork flow still validates with no error", () => {
  const result = parseManifest(upworkJobReview);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  expect(validateManifest(result.manifest).filter((issue) => issue.severity === "error")).toEqual([]);
});
test("a template that cannot be parsed is an error at its own index", () => {
  expect(pairs(web({ url_patterns: ["https://example.com/", "http://example.com/"] }))).toEqual([
    "web_template_invalid@requirements.0.url_patterns.1",
  ]);
});
test("a template whose host is not in domains is an error, and one whose host is listed passes", () => {
  expect(pairs(web({ domains: ["other.example"] }))).toEqual([
    "web_template_host@requirements.0.url_patterns.0",
  ]);
  expect(pairs(web({ domains: ["other.example", "example.com"] }))).toEqual([]);
  expect(pairs(web({ domains: [] }))).toEqual(["web_template_host@requirements.0.url_patterns.0"]);
});
test("session own without a template is an error, with an empty list too; session managed without one is not", () => {
  for (const url_patterns of [undefined, []]) {
    expect(pairs(web({ url_patterns }))).toEqual(["web_template_missing@requirements.0"]);
    expect(pairs(web({ session: "managed", url_patterns }))).toEqual([]);
    expect(pairs(web({ session: "none", url_patterns }))).toEqual([]);
    expect(pairs(web({ mode: "act", url_patterns }))).toEqual([]);
  }
  for (const extra of [{ session: "managed" }, { session: "none" }, { mode: "act" }]) {
    expect(pairs(web({ ...extra, url_patterns: ["invalid"] }))).toEqual([]);
  }
});
test("nine templates are an error at requirements.0.url_patterns and eight are not", () => {
  expect(pairs(web({ url_patterns: Array(9).fill("https://example.com/") }))).toEqual([
    "web_template_count@requirements.0.url_patterns",
  ]);
  expect(pairs(web({ url_patterns: Array(8).fill("https://example.com/") }))).toEqual([]);
});
test("nine domains are an error at requirements.0.domains, and a domain with upper case, a port or an IP address is an error at its own index", () => {
  expect(pairs(web({ domains: Array(9).fill("example.com") }))).toEqual([
    "web_domain_count@requirements.0.domains",
  ]);
  expect(pairs(web({ domains: ["example.com", "Example.com", "example.com:443", "10.0.0.1"] }))).toEqual([
    "web_domain_invalid@requirements.0.domains.1",
    "web_domain_invalid@requirements.0.domains.2",
    "web_domain_invalid@requirements.0.domains.3",
  ]);
  expect(pairs(web({ session: "managed", domains: ["Example.com"] }))).toEqual([
    "web_domain_invalid@requirements.0.domains.0",
  ]);
});
test("the code and path of each issue are exactly these", () => {
  const cases = [
    [web({ url_patterns: ["invalid"] }), "web_template_invalid", "requirements.0.url_patterns.0"],
    [web({ domains: ["other.example"] }), "web_template_host", "requirements.0.url_patterns.0"],
    [web({ url_patterns: [] }), "web_template_missing", "requirements.0"],
    [
      web({ url_patterns: Array(9).fill("https://example.com/") }),
      "web_template_count",
      "requirements.0.url_patterns",
    ],
    [web({ domains: Array(9).fill("example.com") }), "web_domain_count", "requirements.0.domains"],
    [web({ domains: ["Example.com", "example.com"] }), "web_domain_invalid", "requirements.0.domains.0"],
  ] as const;
  for (const [req, code, path] of cases) {
    expect(issues(req)).toEqual([{ code, path, severity: "error", message: code.replaceAll("_", " ") }]);
  }
});
test("web checks do not change the unattended rule: a read requirement before an ask is fine, an act requirement before an ask still fails with unattended_prefix", () => {
  const steps = [step("read", { uses: ["page"] }), askStep("ask"), userStep("end")];
  expect(validateManifest(sched(steps, [web()])).map((issue) => issue.code)).not.toContain(
    "unattended_prefix",
  );
  expect(validateManifest(sched(steps, [web({ mode: "act" })])).map((issue) => issue.code)).toContain(
    "unattended_prefix",
  );
});
