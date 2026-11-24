import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { RadioGroup } from "./RadioGroup";

afterEach(() => {
  cleanup();
});

function LanguageRadioHarness({ onSpy }: { onSpy: (value: string) => void }): ReactElement {
  const [value, setValue] = useState("en");
  return (
    <RadioGroup
      label="Language"
      options={[
        { value: "en", label: "English" },
        { value: "id", label: "Bahasa Indonesia" },
      ]}
      value={value}
      onChange={(next) => {
        onSpy(next);
        setValue(next);
      }}
    />
  );
}

test("TC-UI-20 A radio group uses radio roles", () => {
  const spy = vi.fn();
  render(<LanguageRadioHarness onSpy={spy} />);

  const group = screen.getByRole("radiogroup", { name: "Language" });
  expect(group).toBeTruthy();
  const radios = screen.getAllByRole("radio");
  expect(radios).toHaveLength(2);

  const enRadio = screen.getByRole("radio", { name: "English" });
  const idRadio = screen.getByRole("radio", { name: "Bahasa Indonesia" });

  expect(enRadio.getAttribute("aria-checked")).toBe("true");
  expect(idRadio.getAttribute("aria-checked")).toBe("false");
  expect(enRadio.tabIndex).toBe(0);
  expect(idRadio.tabIndex).toBe(-1);

  enRadio.focus();
  fireEvent.keyDown(enRadio, { key: "ArrowDown" });
  expect(document.activeElement).toBe(idRadio);
  expect(enRadio.getAttribute("aria-checked")).toBe("false");
  expect(idRadio.getAttribute("aria-checked")).toBe("true");
  expect(enRadio.tabIndex).toBe(-1);
  expect(idRadio.tabIndex).toBe(0);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith("id");

  fireEvent.keyDown(idRadio, { key: "ArrowUp" });
  expect(document.activeElement).toBe(enRadio);
  expect(enRadio.getAttribute("aria-checked")).toBe("true");
  expect(idRadio.getAttribute("aria-checked")).toBe("false");
  expect(enRadio.tabIndex).toBe(0);
  expect(idRadio.tabIndex).toBe(-1);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy).toHaveBeenLastCalledWith("en");

  fireEvent.keyDown(enRadio, { key: " " });
  expect(spy).toHaveBeenCalledTimes(2);

  idRadio.focus();
  fireEvent.keyDown(idRadio, { key: " " });
  expect(spy).toHaveBeenCalledTimes(3);
  expect(spy).toHaveBeenLastCalledWith("id");
  expect(idRadio.getAttribute("aria-checked")).toBe("true");
  expect(idRadio.tabIndex).toBe(0);
});
