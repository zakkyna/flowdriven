import { createFixtureRunnerClient } from "@flowdriven/fixtures/v1";
import { type ReactElement, useMemo } from "react";
import { LegacyApp } from "./legacy/LegacyApp";
import {
  RunnerProvider as LegacyRunnerProvider,
  useHasRunnerProvider as useHasLegacyRunnerProvider,
} from "./legacy/runner-context";

export function App(): ReactElement {
  const hasLegacyProvider = useHasLegacyRunnerProvider();
  const fallbackClient = useMemo(
    () => (hasLegacyProvider ? null : createFixtureRunnerClient()),
    [hasLegacyProvider],
  );
  if (fallbackClient) {
    return (
      <LegacyRunnerProvider client={fallbackClient}>
        <LegacyApp />
      </LegacyRunnerProvider>
    );
  }
  return <LegacyApp />;
}
