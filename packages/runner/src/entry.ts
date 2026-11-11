export function silenceSqliteWarning(): () => void {
  const original = process.emitWarning;
  const wrapper = ((...args: unknown[]) => {
    const [warning, options] = args;
    const type =
      typeof options === "string"
        ? options
        : typeof options === "object" && options !== null && "type" in options
          ? options.type
          : undefined;
    const message = typeof warning === "string" ? warning : warning instanceof Error ? warning.message : "";
    if (type === "ExperimentalWarning" && message.startsWith("SQLite is an experimental feature")) return;
    return Reflect.apply(original, process, args);
  }) as typeof process.emitWarning;
  process.emitWarning = wrapper;
  return () => {
    process.emitWarning = original;
  };
}
