import type { FlowDetail, FlowEdit, RunDetail, Step } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import styles from "./Builder.module.css";
import { StepRow } from "./StepRow";
export function StepList({
  flow,
  run,
  edit,
  onDelete,
}: {
  flow: FlowDetail;
  run?: RunDetail;
  edit: (edit: FlowEdit) => void;
  onDelete: (step: Step) => void;
}): ReactElement {
  return (
    <ol aria-label="Steps" className={styles.steps}>
      {flow.manifest.steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          index={index}
          count={flow.manifest.steps.length}
          status={flow.stepStatus[step.id] ?? "pending"}
          run={run?.steps.find((item) => item.stepId === step.id)}
          edit={edit}
          onDelete={onDelete}
        />
      ))}
    </ol>
  );
}
