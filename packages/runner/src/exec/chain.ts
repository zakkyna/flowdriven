export type Chain = {
  enqueue<T>(key: string, task: () => Promise<T>, fallback: () => T): Promise<T>;
  pending(key: string): boolean;
  stop(): void;
};
export function createChain(): Chain {
  const tails = new Map<string, Promise<unknown>>();
  let stopped = false;
  return {
    pending: (key) => tails.has(key),
    enqueue<T>(key: string, task: () => Promise<T>, fallback: () => T): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(async () => {
        if (stopped) return fallback();
        try {
          return await task();
        } catch {
          return fallback();
        }
      });
      tails.set(key, result);
      void result.then(() => {
        if (tails.get(key) === result) tails.delete(key);
      });
      return result;
    },
    stop() {
      stopped = true;
    },
  };
}
