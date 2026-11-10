import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function InboxScreen(_props: { approvalId?: string }): ReactElement {
  return (
    <Page
      screen="inbox"
      ready
      title="Inbox"
      description="Decisions waiting for you. Nothing risky happens until you approve it."
    />
  );
}
