import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AppLink } from "./AppLink";

test("only plain primary clicks without a target are handled", () => {
  window.location.hash = "#/builder";
  const view = render(<AppLink to={{ screen: "settings" }}>Settings</AppLink>);
  const link = screen.getByRole("link");
  let handled = false;
  const preventNavigation = (event: Event) => {
    handled = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", preventNavigation);
  for (const options of [
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
  ]) {
    fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true, ...options }));
    expect(handled).toBe(false);
  }
  view.rerender(
    <AppLink to={{ screen: "settings" }} target="_blank">
      Settings
    </AppLink>,
  );
  fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(handled).toBe(false);
  view.rerender(<AppLink to={{ screen: "settings" }}>Settings</AppLink>);
  const plain = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(link, plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(window.location.hash).toBe("#/settings");
  document.removeEventListener("click", preventNavigation);
});
