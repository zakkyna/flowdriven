import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function ReadinessScreen(_props: { flowId?: string }): ReactElement {
  return (
    <Page
      screen="readiness"
      ready
      title="Readiness"
      description="Everything a flow needs, checked before every run."
    />
  );
}
