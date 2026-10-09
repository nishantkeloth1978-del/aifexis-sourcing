import { cookies } from "next/headers";
import type { Locale } from "./dict";
import { ARABIC_ENABLED } from "./flag";

export async function getLocale(): Promise<Locale> {
  return ARABIC_ENABLED && (await cookies()).get("lang")?.value === "ar" ? "ar" : "en";
}
