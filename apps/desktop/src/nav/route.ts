import { useEffect, useState } from "react";

export type Route =
  | { screen: "chat"; chatId?: string }
  | { screen: "flows" }
  | { screen: "flow"; flowId: string }
  | { screen: "activity" }
  | { screen: "activity_run"; runId: string }
  | { screen: "skills" }
  | { screen: "welcome" }
  | { screen: "builder"; flowId?: string; isNew?: true }
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
        screen === "chat" ||
        screen === "flows" ||
        screen === "activity" ||
        screen === "skills" ||
        screen === "welcome" ||
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
      if (screen === "chat") return { screen: "chat", chatId: id };
      if (screen === "flows") return { screen: "flow", flowId: id };
      if (screen === "activity") return { screen: "activity_run", runId: id };
      if (screen === "builder" && id === "new") return { screen: "builder", isNew: true };
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
    case "chat":
      return `#/chat${route.chatId ? `/${encodeURIComponent(route.chatId)}` : ""}`;
    case "flow":
      return `#/flows/${encodeURIComponent(route.flowId)}`;
    case "activity_run":
      return `#/activity/${encodeURIComponent(route.runId)}`;
    case "run":
      return `#/runs/${encodeURIComponent(route.runId)}`;
    case "builder":
      if (route.isNew) return "#/builder/new";
      return `#/builder${route.flowId ? `/${encodeURIComponent(route.flowId)}` : ""}`;
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
