import { type KeyboardEvent, type ReactElement, type ReactNode, useRef } from "react";
import styles from "./RadioGroup.module.css";

export type RadioOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  preview?: ReactNode;
};

export type RadioGroupProps<T extends string = string> = {
  label: string;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  orientation?: "vertical" | "horizontal";
  className?: string;
};

export function RadioGroup<T extends string = string>({
  label,
  options,
  value,
  onChange,
  orientation = "vertical",
  className,
}: RadioGroupProps<T>): ReactElement {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const enabledOptions = options.filter((option) => !option.disabled);
  const checkedOption = options.find((option) => option.value === value && !option.disabled);
  const focusableValue = checkedOption?.value ?? enabledOptions[0]?.value;

  const moveFocusAndSelect = (currentValue: T, delta: 1 | -1) => {
    if (enabledOptions.length === 0) return;
    const currentIndex = enabledOptions.findIndex((option) => option.value === currentValue);
    const len = enabledOptions.length;
    const nextIndex = currentIndex === -1 ? (delta === 1 ? 0 : len - 1) : (currentIndex + delta + len) % len;
    const next = enabledOptions[nextIndex];
    if (!next) return;
    buttonRefs.current[next.value]?.focus();
    if (next.value !== value) onChange(next.value);
  };

  const handleKeyDown = (option: RadioOption<T>, event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveFocusAndSelect(option.value, 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveFocusAndSelect(option.value, -1);
        break;
      case " ":
      case "Spacebar":
        event.preventDefault();
        if (!option.disabled && option.value !== value) {
          onChange(option.value);
        }
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-orientation={orientation}
      className={[styles.group, orientation === "horizontal" ? styles.horizontal : undefined, className]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const tabIndex = option.value === focusableValue && !option.disabled ? 0 : -1;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[option.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={tabIndex}
            data-checked={checked ? "true" : "false"}
            className={styles.option}
            onClick={() => {
              if (!option.disabled && option.value !== value) onChange(option.value);
            }}
            onKeyDown={(event) => handleKeyDown(option, event)}
          >
            {option.preview && (
              <span className={styles.preview} aria-hidden="true">
                {option.preview}
              </span>
            )}
            <span className={styles.row}>
              <span className={styles.circle} aria-hidden="true">
                <span className={styles.dot} />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{option.label}</span>
                {option.description && <span className={styles.description}>{option.description}</span>}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
