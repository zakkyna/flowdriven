export async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("time limit exceeded");
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("time limit exceeded"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
