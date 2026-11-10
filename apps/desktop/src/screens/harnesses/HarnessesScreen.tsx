import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function HarnessesScreen(): ReactElement {
  return (
    <Page
      screen="harnesses"
      ready
      title="Harnesses"
      description="AI agents found on this Mac. FlowDriven hands them steps to do as workers."
    />
  );
}
