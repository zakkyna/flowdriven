import type { ReadinessItem, RequirementType } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "../../ui/Button";
import { RiskBadge } from "../../ui/RiskBadge";
import { Badge, StatusBadge } from "../../ui/StatusBadge";
import { FixGuide } from "./FixGuide";
import styles from "./Readiness.module.css";

const labels: Record<RequirementType, string> = {
  harness: "Harness",
  skill: "Skill",
  plugin: "Plugin",
  mcp_server: "MCP server",
  cli_tool: "CLI tool",
  gui_app: "App",
  account: "Account",
  browser_session: "Browser session",
  path: "Folder",
  web: "Website",
  desktop: "Computer",
  trigger: "Trigger",
};
export function ReadinessRow({
  item,
  onInstall,
  onCheck,
}: {
  item: ReadinessItem;
  onInstall: () => void;
  onCheck: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  return (
    <li aria-label={item.name} className={styles.row}>
      <div className={styles.rowHeader}>
        <div className={styles.content}>
          <div className={styles.labels}>
            <strong>{item.name}</strong>
            <span className={styles.muted}>{labels[item.type]}</span>
            {!item.required && <Badge tone="neutral">Optional</Badge>}
            {item.sensitive && (
              <Badge tone="neutral" icon="lock">
                Sensitive
              </Badge>
            )}
          </div>
          <p className={styles.muted}>{item.why}</p>
          <div className={styles.labels}>
            <span>Route: {item.route.via}</span>
            <RiskBadge risk={item.route.risk} />
            {item.route.note && <span className={styles.muted}>{item.route.note}</span>}
          </div>
          {item.enforcement && <p className={styles.muted}>Enforcement: {item.enforcement}</p>}
          {item.detail && <p className={styles.muted}>{item.detail}</p>}
          {item.installCommand && <p className={styles.mono}>{item.installCommand}</p>}
        </div>
        <StatusBadge domain="requirement" value={item.state} />
      </div>
      {item.state !== "ok" && (
        <>
          <div className={styles.actions}>
            {item.autoInstall === "yes" && <Button onClick={onInstall}>Install for me</Button>}
            <Button variant="text" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
              Show me how
            </Button>
          </div>
          {!item.required && <p className={styles.muted}>Optional. Steps that use it are skipped.</p>}
          {expanded && <FixGuide guide={item.guide} onCheck={onCheck} />}
        </>
      )}
    </li>
  );
}
