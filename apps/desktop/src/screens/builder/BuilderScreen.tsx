import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function BuilderScreen(_props: { flowId?: string }): ReactElement {
  return <Page screen="builder" ready title="Builder" />;
}
