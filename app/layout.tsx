import "./globals.css";
import "./theme.css";
import "./themes.css";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/dict";
import { tx } from "@/i18n/tx";
import { cookies } from "next/headers";
import { resolveTheme } from "@/ui/themes";


export const metadata = { title: "Aifexis Sourcing" };
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const THEME = resolveTheme((await cookies()).get("theme")?.value, process.env.NEXT_PUBLIC_THEME);
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={THEME}>
      <body><a className="skip" href="#main">{tx(locale, "Skip to main content")}</a>{children}</body>
    </html>
  );
}
