import type { AccentId, AppearanceMode, AppearanceSettings, AppSettings } from "./contracts";

export const DEFAULT_APPEARANCE: AppearanceSettings = { mode: "dark", accent: "mint" };

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: { ...DEFAULT_APPEARANCE },
};

export const APPEARANCE_MODES: AppearanceMode[] = ["dark", "light", "system"];
export const ACCENT_IDS: AccentId[] = ["mint", "blue", "violet", "amber", "rose", "cyan"];

export const isAppearanceMode = (value: unknown): value is AppearanceMode =>
  APPEARANCE_MODES.includes(value as AppearanceMode);

export const isAccentId = (value: unknown): value is AccentId =>
  ACCENT_IDS.includes(value as AccentId);

export const isAppearanceSettings = (value: unknown): value is AppearanceSettings => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isAppearanceMode(candidate.mode) && isAccentId(candidate.accent);
};

export const normalizeAppearance = (appearance: AppearanceSettings): AppearanceSettings => ({
  mode: isAppearanceMode(appearance.mode) ? appearance.mode : DEFAULT_APPEARANCE.mode,
  accent: isAccentId(appearance.accent) ? appearance.accent : DEFAULT_APPEARANCE.accent,
});

export const normalizeSettings = (settings: AppSettings | undefined): AppSettings => ({
  appearance: normalizeAppearance(settings?.appearance ?? DEFAULT_APPEARANCE),
});
