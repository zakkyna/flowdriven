export const WINDOW_BACKGROUND = { light: "#ffffff", dark: "#212121" } as const;
export function windowBackground(dark: boolean): string {
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}
