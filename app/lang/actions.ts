"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setLang(form: FormData) {
  const lang = form.get("lang") === "ar" ? "ar" : "en";
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
