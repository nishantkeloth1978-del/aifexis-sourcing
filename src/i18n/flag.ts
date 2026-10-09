/**
 * Arabic is switched off unless NEXT_PUBLIC_ENABLE_ARABIC=true. While off: no language switch, every page renders in English,
 * and the Arabic text fields of the template tools are hidden (the stored Arabic copy simply mirrors the English, so nothing
 * is lost or invalid and Arabic can be switched on later by changing this one setting).
 */
export const ARABIC_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ARABIC === "true";
