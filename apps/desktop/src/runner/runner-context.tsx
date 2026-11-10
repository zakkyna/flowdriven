import {
  isRunnerError,
  type OperationInput,
  type OperationName,
  type OperationOutput,
  operations,
  type RunnerClient,
  RunnerError,
} from "@flowdriven/contracts";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const Context = createContext<RunnerClient | null>(null);
export function RunnerProvider({
  client,
  children,
}: {
  client: RunnerClient;
  children: ReactNode;
}): ReactElement {
  return <Context.Provider value={client}>{children}</Context.Provider>;
}
export function useRunnerClient(): RunnerClient {
  const client = useContext(Context);
  if (!client) throw new Error("RunnerProvider is missing");
  return client;
}
function asRunnerError(error: unknown): RunnerError {
  return isRunnerError(error)
    ? error
    : new RunnerError("unavailable", error instanceof Error ? error.message : "Unknown error");
}
export function useRunnerQuery<N extends OperationName>(
  name: N,
  input: OperationInput<N>,
  options?: { skip?: boolean },
): {
  data: OperationOutput<N> | undefined;
  error: RunnerError | undefined;
  loading: boolean;
  reload: () => void;
} {
  const client = useRunnerClient();
  const key = JSON.stringify(input);
  const skip = options?.skip ?? false;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: OperationOutput<N>;
    error?: RunnerError;
    loading: boolean;
    revision?: number;
  }>({ key: "", loading: true });
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.topics.some((topic) => (operations[name].reads as readonly string[]).includes(topic)))
          reload();
      }),
    [client, name, reload],
  );
  useEffect(() => {
    if (skip) return;
    let active = true;
    const queryKey = `${name}:${key}`;
    setResult((old) => (old.key === queryKey ? old : { key: queryKey, loading: true }));
    client.call(name, JSON.parse(key) as OperationInput<N>).then(
      (data) => {
        if (active) setResult({ key: queryKey, data, loading: false, revision });
      },
      (error: unknown) => {
        if (active) setResult({ key: queryKey, error: asRunnerError(error), loading: false, revision });
      },
    );
    return () => {
      active = false;
    };
  }, [client, name, key, skip, revision]);
  if (skip) return { data: undefined, error: undefined, loading: false, reload };
  if (result.key !== `${name}:${key}`) return { data: undefined, error: undefined, loading: true, reload };
  return { data: result.data, error: result.error, loading: result.loading, reload };
}
export function useRunnerAction(): <N extends OperationName>(
  name: N,
  input: OperationInput<N>,
) => Promise<{ ok: true; data: OperationOutput<N> } | { ok: false; error: RunnerError }> {
  const client = useRunnerClient();
  return useCallback(
    async <N extends OperationName>(name: N, input: OperationInput<N>) => {
      try {
        return { ok: true as const, data: await client.call(name, input) };
      } catch (error) {
        return { ok: false as const, error: asRunnerError(error) };
      }
    },
    [client],
  );
}
