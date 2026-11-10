import { expect, test } from "vitest";
import { parseRoute, type Route, routeToHash } from "./route";

test("#/builder/new is the new-flow state and round-trips", () => {
  expect(parseRoute("#/builder/new")).toEqual({ screen: "builder", isNew: true });
  expect(routeToHash({ screen: "builder", isNew: true })).toBe("#/builder/new");
  expect(parseRoute(routeToHash({ screen: "builder", isNew: true }))).toEqual({
    screen: "builder",
    isNew: true,
  });
  expect(parseRoute("#/builder/new/extra")).toEqual({ screen: "not_found", hash: "#/builder/new/extra" });
  expect(parseRoute("#/readiness/new")).toEqual({ screen: "readiness", flowId: "new" });
});

test("parses every screen", () => {
  expect(parseRoute("")).toEqual({ screen: "builder" });
  expect(parseRoute("#/")).toEqual({ screen: "builder" });
  expect(parseRoute("#/builder/dev.example.figma-to-flutter")).toEqual({
    screen: "builder",
    flowId: "dev.example.figma-to-flutter",
  });
  expect(parseRoute("#/inbox/ap-0011")).toEqual({ screen: "inbox", approvalId: "ap-0011" });
  expect(parseRoute("#/runs")).toEqual({ screen: "runs" });
  expect(parseRoute("#/runs/run-0006")).toEqual({ screen: "run", runId: "run-0006" });
  expect(parseRoute("#/readiness/dev.example.social-posts")).toEqual({
    screen: "readiness",
    flowId: "dev.example.social-posts",
  });
  expect(parseRoute("#/harnesses")).toEqual({ screen: "harnesses" });
  expect(parseRoute("#/settings")).toEqual({ screen: "settings" });
  expect(parseRoute("#/settings/extra")).toEqual({ screen: "not_found", hash: "#/settings/extra" });
  expect(parseRoute("#/runs/a%20b")).toEqual({ screen: "run", runId: "a b" });
});
test("round-trips", () => {
  const routes: Route[] = [
    { screen: "builder", flowId: "x.y" },
    { screen: "inbox" },
    { screen: "run", runId: "run-0006" },
    { screen: "settings" },
  ];
  for (const r of routes) expect(parseRoute(routeToHash(r))).toEqual(r);
});
