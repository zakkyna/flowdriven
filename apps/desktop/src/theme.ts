export function themeFromSearch(search: string): "light" | "dark" | null {
  const value = new URLSearchParams(search).get("theme");
  return value === "light" || value === "dark" ? value : null;
}
export function applyTheme(search: string, root: HTMLElement): void {
  const theme = themeFromSearch(search);
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}
