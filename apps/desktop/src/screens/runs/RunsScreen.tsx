import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function RunsScreen(): ReactElement {
  return <Page screen="runs" ready title="Runs" description="Every run of every flow, newest first." />;
}
