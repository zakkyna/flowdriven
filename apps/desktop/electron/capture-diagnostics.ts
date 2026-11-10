type ConsoleError = { screen: string; message: string };

export function formatNotReady(screen: string, url: string, body: string): string {
  return `screen ${screen} never became ready; URL: ${url}; body: ${body.slice(0, 300).replace(/[\r\n]+/g, " ")}`;
}

export function recordConsoleError(
  errors: ConsoleError[],
  screen: string,
  event: { level: string; message: string },
): void {
  if (event.level === "error") errors.push({ screen, message: event.message });
}

export function formatConsoleErrors(errors: ConsoleError[]): string[] {
  return errors.map(({ screen, message }) => `screen ${screen} console error: ${message}`);
}
