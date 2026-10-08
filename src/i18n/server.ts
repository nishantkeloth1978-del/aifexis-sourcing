import { cookies } from "next/headers";
import type { Locale } from "./dict";

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get("lang")?.value === "ar" ? "ar" : "en";
}
