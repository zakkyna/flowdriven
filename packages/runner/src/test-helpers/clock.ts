export function createClock(instant: string, zone = "UTC") {
  let time = new Date(instant).getTime();
  return {
    zone,
    now: () => new Date(time),
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

export function createIdGenerator(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}-${String(next).padStart(12, "0")}`;
  };
}
