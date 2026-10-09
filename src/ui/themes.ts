export const THEMES = [
  { key: "clean", label: "Clean", note: "Light and soft (default)", swatch: ["#f7f8fa", "#2563eb", "#ffffff"] },
  { key: "navy", label: "Navy", note: "Light with a deeper blue accent", swatch: ["#eef2f9", "#2b5cd9", "#ffffff"] },
  { key: "compact", label: "Compact", note: "Tighter spacing, more rows on screen", swatch: ["#f7f8fa", "#2563eb", "#ffffff"] },
  { key: "dark", label: "Dark", note: "Dark background, easy on the eyes", swatch: ["#0e1424", "#6b93ff", "#161e33"] },
  { key: "teal", label: "Teal", note: "Warm neutral with a teal accent", swatch: ["#f6f5f2", "#0f766e", "#ffffff"] },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];
export const isTheme = (v: unknown): v is ThemeKey => THEMES.some((t) => t.key === v);
export function resolveTheme(cookie: string | undefined, env: string | undefined): ThemeKey {
  if (isTheme(cookie)) return cookie;
  if (isTheme(env)) return env;
  return "clean";
}
