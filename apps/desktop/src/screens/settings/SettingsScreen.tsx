import type { ReactElement } from "react";
import { Page } from "../../ui/Page";
export function SettingsScreen(): ReactElement {
  return (
    <Page
      screen="settings"
      ready
      title="Settings"
      description="Choose the brain, the fallback order and the monthly API-key budget."
    />
  );
}
