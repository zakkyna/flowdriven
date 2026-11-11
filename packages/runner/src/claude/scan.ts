import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { REQUIRED_FLAGS } from "./args.ts";
import { childEnv } from "./env.ts";
import { runCapture } from "./run-capture.ts";
import { visible } from "./text.ts";
export type ClaudeScan = {
  detected: boolean;
  path?: string;
  version?: string;
  missingFlags: string[];
  configFolder: boolean;
  login: "logged_in" | "logged_out" | "unknown";
  authMethod?: string;
  scannedAt: string;
};
function folder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function executable(path: string): boolean {
  try {
    const s = statSync(path);
    return s.isFile() && (s.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
export function findClaude(options: {
  explicit?: string;
  pathEnv?: string;
  home?: string;
}): string | undefined {
  if (options.explicit !== undefined) return executable(options.explicit) ? options.explicit : undefined;
  const home = options.home && isAbsolute(options.home) ? options.home : undefined;
  const dirs = [
    ...(options.pathEnv ?? "").split(":").filter(isAbsolute),
    ...(home ? [join(home, ".local/bin")] : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(home ? [".claude/local", ".npm-global/bin", ".bun/bin"].map((d) => join(home, d)) : []),
  ];
  return dirs.map((d) => join(d, "claude")).find(executable);
}
export async function scanClaude(options: {
  explicit?: string;
  env: Record<string, string | undefined>;
  now: () => Date;
  timeoutMs?: number;
}): Promise<ClaudeScan> {
  const scannedAt = options.now().toISOString();
  const result: ClaudeScan = {
    detected: false,
    missingFlags: [],
    configFolder: false,
    login: "unknown",
    scannedAt,
  };
  try {
    const path = findClaude({
      explicit: options.explicit,
      pathEnv: options.env.PATH,
      home: options.env.HOME,
    });
    if (!path) return result;
    result.detected = true;
    result.path = path;
    result.configFolder =
      !!options.env.HOME && isAbsolute(options.env.HOME) && folder(join(options.env.HOME, ".claude"));
    const capture = (args: string[]) =>
      runCapture(path, args, {
        env: childEnv(options.env),
        timeoutMs: options.timeoutMs ?? 10_000,
        maxBytes: 262_144,
      });
    const [version, help, auth] = await Promise.all([
      capture(["--version"]),
      capture(["--help"]),
      capture(["auth", "status", "--json"]),
    ]);
    const ok = (value: typeof version) => value.code === 0 && !value.timedOut && !value.truncated;
    const foundVersion = ok(version) ? /^(\d+\.\d+\.\d+)/.exec(version.stdout)?.[1] : undefined;
    if (foundVersion) result.version = foundVersion;
    result.missingFlags = ok(help)
      ? REQUIRED_FLAGS.filter(
          (flag) => !new RegExp(`(?:^|[^a-zA-Z0-9-])${flag}(?![a-zA-Z0-9-])`).test(help.stdout),
        )
      : [...REQUIRED_FLAGS];
    if (ok(auth)) {
      try {
        const data: unknown = JSON.parse(auth.stdout);
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const obj = data as Record<string, unknown>;
          if (obj.loggedIn === true) result.login = "logged_in";
          else if (obj.loggedIn === false) result.login = "logged_out";
          if (typeof obj.authMethod === "string") result.authMethod = visible(obj.authMethod, 40);
        }
      } catch {
        /* Invalid output leaves login unknown. */
      }
    }
  } catch {
    result.missingFlags = result.detected ? [...REQUIRED_FLAGS] : [];
  }
  return result;
}
