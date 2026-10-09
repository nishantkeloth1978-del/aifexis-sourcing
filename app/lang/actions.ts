"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ARABIC_ENABLED } from "@/i18n/flag";

export async function setLang(form: FormData) {
  const lang = ARABIC_ENABLED && form.get("lang") === "ar" ? "ar" : "en";
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
