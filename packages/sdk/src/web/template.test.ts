import { expect, test } from "vitest";
import {
  describeTemplate,
  isValidHost,
  matchTemplate,
  parseTemplate,
  TEMPLATE_REASON,
  webRates,
} from "./template.ts";

function template(source: string) {
  const result = parseTemplate(source);
  if (!result.ok) throw new Error(result.reason);
  return result.template;
}
const example = "https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}";

test("the spec's example parses, describes itself with capture names only and matches an id of 18 to 24 characters", () => {
  const t = template(example);
  expect(describeTemplate(t)).toBe("https://www.upwork.com/jobs/~{id}");
  const id = "a".repeat(20);
  expect(matchTemplate(t, `https://www.upwork.com/jobs/~${id}`)).toEqual({ id });
  for (const value of ["a".repeat(17), "a".repeat(25), "A".repeat(20), "-".repeat(20)])
    expect(matchTemplate(t, `https://www.upwork.com/jobs/~${value}`)).toBeUndefined();
});
test("a template without captures is valid and matches only its own address", () => {
  const t = template("https://example.com/");
  expect(matchTemplate(t, "https://example.com/")).toEqual({});
  for (const address of ["https://example.com", "https://example.com/a"])
    expect(matchTemplate(t, address)).toBeUndefined();
});
test("R2: a capture value `~abc/../x`, an encoded dot, a query, an empty query, a fragment, an empty fragment, a percent sign, `%7e`, and a second host after @ never match", () => {
  const cases = [
    [example, "https://www.upwork.com/jobs/~abc/../x"],
    ["https://example.com/p/{n:[a-z]{1,5}}", "https://example.com/p/%2e"],
    ...[
      "https://example.com/?x=1",
      "https://example.com/?",
      "https://example.com/#x",
      "https://example.com/#",
      "https://example.com/%",
      "https://example.com/%7e",
      "https://example.com@evil.com/",
    ].map((a) => ["https://example.com/", a]),
  ];
  for (const [source, address] of cases) {
    if (source === undefined || address === undefined) throw new Error("bad test case");
    expect(matchTemplate(template(source), address), address).toBeUndefined();
  }
});
test("an address must be its own href: an upper-case host, a default port, an address with a tab or newline inside, and `https://example.com:443/` do not match", () => {
  const t = template("https://example.com/");
  for (const a of [
    "https://EXAMPLE.com/",
    "https://example.com:443/",
    "https://example.com:0443/",
    "https://exam\tple.com/",
    "https://exam\nple.com/",
  ])
    expect(matchTemplate(t, a)).toBeUndefined();
});
test("every bad template is refused with the reason in its row", () => {
  const rows: [string, keyof typeof TEMPLATE_REASON][] = [
    ["http://a.com/", "scheme"],
    ["https://a.com/{bad}/a?b", "path"],
    ["https://a.com/{bad}//b", "segment"],
    ...[
      "https://A.com/",
      "https://localhost/",
      "https://a.b.localhost/",
      "https://10.0.0.1/",
      "https://a.com:8080/",
      "https://u@a.com/",
      "https://{x:[a-z]{1,2}}.com/",
    ].map((s): [string, "host"] => [s, "host"]),
    ...[
      "https://a.com",
      "https://a.com/a?b",
      "https://a.com/a#b",
      "https://a.com/%41",
      "https://a.com/a\\b",
      "https://a.com/a}",
    ].map((s): [string, "path"] => [s, "path"]),
    ...["https://a.com//b", "https://a.com/./b", "https://a.com/../b"].map((s): [string, "segment"] => [
      s,
      "segment",
    ]),
    ["https://a.com/{x:[a-z]{1,3}", "capture"],
    ["https://a.com/{x:a-z{1,3}}", "capture"],
    ["https://a.com/{Id:[a-z]{1,2}}", "name"],
    ["https://a.com/{x:[a-z]{1,2}}{x:[0-9]{1,2}}", "name"],
    ...["", "z-a", "a-Z"].map((s): [string, "class"] => [`https://a.com/{x:[${s}]{1,2}}`, "class"]),
    ...["0,3", "3,2", "129"].map((s): [string, "repeat"] => [`https://a.com/{x:[a-z]{${s}}}`, "repeat"]),
    [`https://a.com/${Array.from({ length: 9 }, (_, i) => `{x${i}:[a]{1}}`).join("")}`, "count"],
    [`https://a.com/${"a".repeat(287)}`, "long"],
    [`https://A.com/${"a".repeat(287)}`, "long"],
  ];
  for (const [source, reason] of rows)
    expect(parseTemplate(source), source).toEqual({ ok: false, reason: TEMPLATE_REASON[reason] });
});
test("the class grammar: single characters, ranges, a leading or trailing dash, and underscore", () => {
  for (const set of ["a-z0-9_-", "-a-z", "abc", "0-9"])
    expect(parseTemplate(`https://a.com/{x:[${set}]{1,5}}`).ok).toBe(true);
  expect(parseTemplate("https://a.com/{x:[a-z-0]{1,5}} ".trim())).toEqual({
    ok: false,
    reason: TEMPLATE_REASON.class,
  });
});
test("{n} and {m,n} both repeat; two captures in a row and a capture followed by a literal that its class also holds still match by backtracking", () => {
  expect(matchTemplate(template("https://a.com/{a:[a-z]{1,3}}{b:[a-z]{1,3}}"), "https://a.com/abcd")).toEqual(
    { a: "abc", b: "d" },
  );
  expect(matchTemplate(template("https://a.com/{a:[a-z]{1,5}}x"), "https://a.com/abx")).toEqual({ a: "ab" });
  expect(matchTemplate(template("https://a.com/{a:[a-z]{2}}"), "https://a.com/ab")).toEqual({ a: "ab" });
});
test("a hostile address of 600 characters matches in a blink and one of 601 is refused", () => {
  const t = template(`https://a.com/${Array.from({ length: 8 }, (_, i) => `{x${i}:[a]{1,128}}`).join("")}b`);
  const address = `https://a.com/${"a".repeat(586)}`;
  expect(address).toHaveLength(600);
  expect(matchTemplate(t, address)).toBeUndefined();
  expect(matchTemplate(t, `${address}a`)).toBeUndefined();
});
test("isValidHost accepts `www.upwork.com` and refuses upper case, a port, an IP address, `localhost`, a trailing dot, an empty label and a 254 character host", () => {
  expect(isValidHost("www.upwork.com")).toBe(true);
  for (const host of [
    "A.com",
    "a.com:443",
    "10.0.0.1",
    "localhost",
    "a.com.",
    "a..com",
    `${"a".repeat(250)}.com`,
  ])
    expect(isValidHost(host), host).toBe(false);
});
test("webRates defaults to 3 per run and 10 per day, and keeps what the flow says, one field at a time", () => {
  expect(webRates({})).toEqual({ perRun: 3, perDay: 10 });
  expect(webRates({ rate: { per_run: 5 } })).toEqual({ perRun: 5, perDay: 10 });
  expect(webRates({ rate: { per_day: 7 } })).toEqual({ perRun: 3, perDay: 7 });
  expect(webRates({ rate: { per_run: 5, per_day: 7 } })).toEqual({ perRun: 5, perDay: 7 });
});
