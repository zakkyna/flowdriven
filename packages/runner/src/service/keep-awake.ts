export function createKeepAwake(o: {
  platform: string;
  spawn: (cmd: string, args: string[]) => { on(event: "error", f: () => void): void };
  onError: () => void;
}): ((pid: number) => void) | undefined {
  if (o.platform !== "darwin") return undefined;
  return (pid) => {
    try {
      o.spawn("/usr/bin/caffeinate", ["-i", "-w", String(pid)]).on("error", o.onError);
    } catch {
      o.onError();
    }
  };
}
