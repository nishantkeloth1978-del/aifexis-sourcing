import "./globals.css";
import "./theme.css";
import "./themes.css";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/dict";

const THEMES = ["clean", "navy", "compact", "dark", "teal"];
const THEME = THEMES.includes(process.env.NEXT_PUBLIC_THEME ?? "") ? process.env.NEXT_PUBLIC_THEME : "clean";

export const metadata = { title: "Aifexis Sourcing" };
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={THEME}>
      <body>{children}</body>
    </html>
  );
}
