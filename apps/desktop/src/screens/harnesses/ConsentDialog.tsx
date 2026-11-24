import type { HarnessCard } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { Dialog } from "../../ui/Dialog";
import { Icon } from "../../ui/icons";
import { vendorWarning } from "./HarnessCardView";
import styles from "./Harnesses.module.css";

export function ConsentDialog({
  card,
  busy,
  onConfirm,
  onCancel,
}: {
  card: HarnessCard;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <Dialog
      title={`Let FlowDriven run ${card.name}?`}
      confirmLabel="Give consent"
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        {card.name} is labelled {card.risk}.
      </p>
      {card.consentText && <p>{card.consentText}</p>}
      {card.vendorProhibited && (
        <p className={styles.warning}>
          <Icon name="alert" />
          {vendorWarning}
        </p>
      )}
      <p>You can revoke this at any time on this card.</p>
    </Dialog>
  );
}
