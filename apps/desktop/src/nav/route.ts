import { useEffect, useState } from "react";

export type Route =
  | { screen: "builder"; flowId?: string }
  | { screen: "inbox"; approvalId?: string }
  | { screen: "runs" }
  | { screen: "run"; runId: string }
  | { screen: "readiness"; flowId?: string }
  | { screen: "harnesses" }
  | { screen: "settings" }
  | { screen: "not_found"; hash: string };
export function parseRoute(hash: string): Route {
  if (hash === "" || hash === "#/") return { screen: "builder" };
  if (!hash.startsWith("#/")) return { screen: "not_found", hash };
  try {
    const parts = hash.slice(2).split("/").map(decodeURIComponent);
    const [screen, id] = parts;
    if (parts.length === 1) {
      if (
        screen === "builder" ||
        screen === "inbox" ||
        screen === "runs" ||
        screen === "readiness" ||
        screen === "harnesses" ||
        screen === "settings"
      )
        return { screen };
    }
    if (parts.length === 2 && id) {
      if (screen === "builder" || screen === "readiness") return { screen, flowId: id };
      if (screen === "inbox") return { screen, approvalId: id };
      if (screen === "runs") return { screen: "run", runId: id };
    }
  } catch {
    /* Invalid encoding is an unknown route. */
  }
  return { screen: "not_found", hash };
}
export function routeToHash(route: Route): string {
  switch (route.screen) {
    case "not_found":
      return route.hash;
    case "run":
      return `#/runs/${encodeURIComponent(route.runId)}`;
    case "builder":
    case "readiness":
      return `#/${route.screen}${route.flowId ? `/${encodeURIComponent(route.flowId)}` : ""}`;
    case "inbox":
      return `#/inbox${route.approvalId ? `/${encodeURIComponent(route.approvalId)}` : ""}`;
    default:
      return `#/${route.screen}`;
  }
}
export function useRoute(): [Route, (next: Route) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return [
    parseRoute(hash),
    (next) => {
      const value = routeToHash(next);
      window.location.hash = value;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      setHash(value);
    },
  ];
}
