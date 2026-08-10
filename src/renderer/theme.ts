import type { AccentId, AppearanceMode } from "../shared/contracts";

export const accentColors: Record<AccentId, string> = {
  mint: "#9be7c4",
  blue: "#8db4ff",
  violet: "#d8a5ff",
  amber: "#f4bf7a",
  rose: "#ff9d9d",
  cyan: "#7de2e7",
};

export const accentLabels: Record<AccentId, string> = {
  mint: "Mint",
  blue: "Blue",
  violet: "Violet",
  amber: "Amber",
  rose: "Rose",
  cyan: "Cyan",
};

export const themeLabels: Record<AppearanceMode, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

export const resolveTheme = (mode: AppearanceMode): "dark" | "light" => {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

export const applyTheme = (mode: AppearanceMode, accent: AccentId): void => {
  const root = document.documentElement;
  root.dataset.themePreference = mode;
  root.dataset.theme = resolveTheme(mode);
  root.dataset.accent = accent;
  root.style.colorScheme = resolveTheme(mode);
};
