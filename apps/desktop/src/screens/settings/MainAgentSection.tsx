import type { Agent, Settings } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { RadioGroup } from "../../ui/RadioGroup";
import { useToast } from "../../ui/Toast";
import styles from "./MainAgentSection.module.css";

export function MainAgentSection({
  settings: settingsProp,
  agents: agentsProp,
}: {
  settings?: Settings;
  agents?: readonly Agent[];
}): ReactElement {
  const { t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const settingsQuery = useRunnerQuery("settings.get", {}, { skip: settingsProp !== undefined });
  const agentsQuery = useRunnerQuery("agents.list", {}, { skip: agentsProp !== undefined });
  const settings = settingsProp ?? settingsQuery.data;
  const agents = agentsProp ?? agentsQuery.data ?? [];

  const [selectedAgent, setSelectedAgent] = useState<string>(settings?.mainAgent?.agent ?? "");
  const [busyFallback, setBusyFallback] = useState<boolean>(settings?.busyFallback ?? false);
  const mainRequestIdRef = useRef(0);
  const busyRequestIdRef = useRef(0);
  const busyLabelId = useId();

  useEffect(() => {
    if (settings !== undefined) setSelectedAgent(settings.mainAgent?.agent ?? "");
  }, [settings]);

  useEffect(() => {
    if (settings !== undefined) setBusyFallback(settings.busyFallback);
  }, [settings]);

  const handleSelectAgent = async (nextAgentId: string) => {
    const agent = agents.find((item) => item.id === nextAgentId);
    if (agent?.state !== "ready") return;

    const prev = selectedAgent;
    const saveFailedMessage = t("settings.saveFailed");
    setSelectedAgent(agent.id);
    const requestId = ++mainRequestIdRef.current;

    let model = agent.defaultModel;
    if (!model) {
      const modelsResult = await action("agents.models", { agentId: agent.id });
      if (mainRequestIdRef.current !== requestId) return;
      if (!modelsResult.ok) {
        setSelectedAgent(prev);
        toast(saveFailedMessage);
        return;
      }
      model = modelsResult.data.find((item) => item.isDefault)?.id ?? modelsResult.data[0]?.id;
    }

    if (!model) {
      if (mainRequestIdRef.current === requestId) {
        setSelectedAgent(prev);
        toast(saveFailedMessage);
      }
      return;
    }

    const result = await action("settings.update", { patch: { mainAgent: { agent: agent.id, model } } });
    if (mainRequestIdRef.current !== requestId) return;
    if (!result.ok) {
      setSelectedAgent(prev);
      toast(saveFailedMessage);
      return;
    }
    toast(t("settings.mainAgentName", { name: agent.name }));
  };

  const handleToggleBusy = () => {
    const prev = busyFallback;
    const next = !busyFallback;
    const saveFailedMessage = t("settings.saveFailed");
    setBusyFallback(next);
    const requestId = ++busyRequestIdRef.current;

    void action("settings.update", { patch: { busyFallback: next } }).then((result) => {
      if (busyRequestIdRef.current !== requestId) return;
      if (!result.ok) {
        setBusyFallback(prev);
        toast(saveFailedMessage);
      }
    });
  };

  const options = agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    disabled: agent.state !== "ready",
    description: agent.state !== "ready" ? t("settings.agentSetupFirst") : undefined,
  }));

  const readyAgents = agents.filter((agent) => agent.state === "ready");
  const mainReady = readyAgents.find((agent) => agent.id === selectedAgent) ?? readyAgents[0];
  const otherReady = mainReady ? readyAgents.find((agent) => agent.id !== mainReady.id) : undefined;
  const showBusyToggle = readyAgents.length >= 2 && mainReady !== undefined && otherReady !== undefined;

  return (
    <>
      <RadioGroup
        label={t("settings.mainAgent")}
        options={options}
        value={selectedAgent}
        onChange={(next) => void handleSelectAgent(next)}
      />
      <p className={styles.note}>{t("settings.mainAgentHelp")}</p>
      {showBusyToggle && (
        <div className={styles.row}>
          <span id={busyLabelId} className={styles.label}>
            {t("settings.busyFallback", { main: mainReady.name, other: otherReady.name })}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={busyFallback}
            aria-labelledby={busyLabelId}
            data-checked={busyFallback ? "true" : "false"}
            className={styles.switch}
            disabled={!settings}
            onClick={handleToggleBusy}
          >
            <span className={styles.track} aria-hidden="true">
              <span className={styles.thumb} />
            </span>
            <span className={styles.state}>{busyFallback ? t("status.on") : t("status.off")}</span>
          </button>
        </div>
      )}
    </>
  );
}
