export const CHILD_ENV_NAMES = ["HOME", "USER", "PATH", "TMPDIR", "LANG"] as const;
export function childEnv(source: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of CHILD_ENV_NAMES) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}
