"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isTheme } from "@/ui/themes";

export async function setThemeAction(theme: string): Promise<{ ok: boolean }> {
  if (!isTheme(theme)) return { ok: false };
  (await cookies()).set("theme", theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true };
}
