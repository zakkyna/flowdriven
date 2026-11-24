import type { RiskLabel } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { StatusBadge } from "./StatusBadge";
export function RiskBadge({ risk }: { risk: RiskLabel }): ReactElement {
  return <StatusBadge domain="risk" value={risk} />;
}
