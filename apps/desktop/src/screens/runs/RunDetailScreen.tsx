import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function RunDetailScreen(_props: { runId: string }): ReactElement {
  return <Page screen="run" ready title="Run" />;
}
