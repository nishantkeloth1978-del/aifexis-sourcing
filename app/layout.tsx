import "./globals.css";
import { getLocale } from "@/i18n/server";
import { dirOf } from "@/i18n/dict";

export const metadata = { title: "Aifexis Sourcing" };
export const viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>{children}</body>
    </html>
  );
}
