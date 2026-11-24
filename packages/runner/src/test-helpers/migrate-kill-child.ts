import { openSqliteStore } from "../sqlite-store.ts";

const path = process.argv[2];
if (!path) throw new Error("Missing database path.");
await openSqliteStore(path, {
  now: () => new Date("2026-11-21T03:00:00Z"),
  failAt: (step) => {
    if (step === "fill_flow_heads") process.kill(process.pid, "SIGKILL");
  },
});
