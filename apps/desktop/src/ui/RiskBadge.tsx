import type { RiskLabel } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { StatusBadge } from "./StatusBadge";
export function RiskBadge({ risk }: { risk: RiskLabel }): ReactElement {
  return <StatusBadge domain="risk" value={risk} />;
}
