import type { Settings } from "@flowdriven/contracts/v1";
import { type ReactElement, useState } from "react";
import { useRunnerAction } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { RiskBadge } from "../../ui/RiskBadge";
import styles from "./Settings.module.css";

export function FallbackSection({ settings }: { settings: Settings }): ReactElement {
  const action = useRunnerAction();
  const [error, setError] = useState("");
  const move = async (key: "subscriptionOrder" | "apiKeyOrder", index: number, offset: number) => {
    const order = settings.brain[key].filter((id) => settings.backends.some((backend) => backend.id === id));
    const item = order.splice(index, 1)[0];
    if (item === undefined) return;
    order.splice(index + offset, 0, item);
    const result = await action("settings.update", { patch: { brain: { [key]: order } } });
    setError(result.ok ? "" : result.error.message);
  };
  const list = (key: "subscriptionOrder" | "apiKeyOrder", title: string) => (
    <div>
      <h3>{title}</h3>
      <ol className={styles.order}>
        {settings.brain[key]
          .filter((id) => settings.backends.some((backend) => backend.id === id))
          .map((id, index, order) => {
            const backend = settings.backends.find((item) => item.id === id);
            if (!backend) return null;
            return (
              <li key={id}>
                <span className={styles.orderLine}>
                  <span>{backend.name}</span>{" "}
                  <span className={styles.risk}>
                    <RiskBadge risk={backend.risk} />
                  </span>{" "}
                  {backend.kind === "harness" &&
                    backend.consent !== "given" &&
                    backend.consent !== "not_needed" && <span>Needs consent before use.</span>}
                  <Button
                    variant="quiet"
                    icon="arrow-up"
                    aria-label={`Move ${backend.name} up`}
                    disabled={index === 0}
                    onClick={() => void move(key, index, -1)}
                  />
                  <Button
                    variant="quiet"
                    icon="arrow-down"
                    aria-label={`Move ${backend.name} down`}
                    disabled={index === order.length - 1}
                    onClick={() => void move(key, index, 1)}
                  />
                </span>
              </li>
            );
          })}
      </ol>
    </div>
  );
  return (
    <section className={styles.panel}>
      <h2>Fallback order</h2>
      <p>
        When the brain hits a quota or rate limit, FlowDriven moves down this list. API keys are used only
        while the monthly budget has room. If nothing is left, the run pauses and asks you.
      </p>
      {list("subscriptionOrder", "Subscription harnesses")}
      {list("apiKeyOrder", "API keys")}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
