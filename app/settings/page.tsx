import Shell from "@/ui/Shell";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import { cookies } from "next/headers";
import { resolveTheme, THEMES } from "@/ui/themes";
import ThemePicker from "@/ui/ThemePicker";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Settings | Aifexis Sourcing" };

export default async function SettingsPage() {
  if (!(await getSession())) redirect("/login");
  const locale = await getLocale();
  const current = resolveTheme((await cookies()).get("theme")?.value, process.env.NEXT_PUBLIC_THEME);
  const labels: Record<string, string> = { title: tx(locale, "Theme"), active: tx(locale, "Selected") };
  for (const t of THEMES) { labels[t.key] = tx(locale, t.label); labels[t.key + "_note"] = tx(locale, t.note); }
  return (
    <Shell title={tx(locale, "Settings")}>
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>{tx(locale, "Appearance")}</h2>
        <p style={{ color: "var(--muted)" }}>{tx(locale, "Choose how Aifexis looks for you. The change applies at once on this browser.")}</p>
        <ThemePicker current={current} labels={labels} />
      </section>
    </Shell>
  );
}
