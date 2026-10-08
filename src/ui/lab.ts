import type { Locale } from "@/i18n/dict";
export const lab = (l: { en: string; ar: string }, locale: Locale) => (locale === "ar" && l.ar ? l.ar : l.en);
