import type { Agent, AgentId } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { Button } from "../../ui/Button";
import { StatusBadge } from "../../ui/StatusBadge";
import { useToast } from "../../ui/Toast";
import styles from "./AgentsSection.module.css";

const INSTALLED_STATES = new Set(["ready", "needs_login", "waiting_login"]);

export function AgentsSection({ agents: agentsProp }: { agents?: readonly Agent[] }): ReactElement {
  const { t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const agentsQuery = useRunnerQuery("agents.list", {}, { skip: agentsProp !== undefined });
  const agents = agentsProp ?? agentsQuery.data ?? [];
  const [busyId, setBusyId] = useState<AgentId | null>(null);
  const [scanning, setScanning] = useState(false);

  const handleSetUp = (agentId: AgentId) => {
    setBusyId(agentId);
    void action("agents.setUp", { agentId }).then((result) => {
      setBusyId((current) => (current === agentId ? null : current));
      if (!result.ok) toast(t("settings.saveFailed"));
    });
  };

  const handleSignIn = (agentId: AgentId) => {
    setBusyId(agentId);
    void action("agents.signIn", { agentId }).then((result) => {
      setBusyId((current) => (current === agentId ? null : current));
      if (!result.ok) toast(t("settings.saveFailed"));
    });
  };

  const handleRescan = () => {
    setScanning(true);
    void action("agents.rescan", {}).then((result) => {
      setScanning(false);
      if (!result.ok) {
        toast(t("settings.saveFailed"));
        return;
      }
      if (result.data.found.length === 0) {
        toast(t("welcome.nothingNewFound"));
        return;
      }
      const installed = result.data.agents.filter((agent) => INSTALLED_STATES.has(agent.state)).length;
      toast(t("welcome.scanComplete", { n: installed }));
    });
  };

  return (
    <>
      <ul className={styles.list}>
        {agents.map((agent) => (
          <li key={agent.id} className={styles.row}>
            <div className={styles.info}>
              <span className={styles.name}>{agent.name}</span>
              <StatusBadge kind="agent" code={agent.state} />
            </div>
            <div className={styles.action}>
              {agent.state === "not_installed" && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busyId === agent.id}
                  onClick={() => handleSetUp(agent.id)}
                >
                  {t("common.setUp")}
                </Button>
              )}
              {agent.state === "needs_login" && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busyId === agent.id}
                  onClick={() => handleSignIn(agent.id)}
                >
                  {t("settings.signIn")}
                </Button>
              )}
              {agent.state === "installing" && (
                <span className={styles.progress}>{t("welcome.installing")}</span>
              )}
              {agent.state === "waiting_login" && (
                <span className={styles.progress}>{t("common.waitingForSignInProgress")}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="secondary" size="small" disabled={scanning} onClick={handleRescan}>
          {t("settings.scanAgain")}
        </Button>
      </div>
    </>
  );
}
