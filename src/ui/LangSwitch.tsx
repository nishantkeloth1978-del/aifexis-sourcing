import { setLang } from "../../app/lang/actions";
import { t, type Locale } from "@/i18n/dict";
import { ARABIC_ENABLED } from "@/i18n/flag";

export default function LangSwitch({ locale }: { locale: Locale }) {
  if (!ARABIC_ENABLED) return null;
  return <form action={setLang} style={{ display: "inline" }}><input type="hidden" name="lang" value={locale === "ar" ? "en" : "ar"} /><button className="signout" type="submit" lang={locale === "ar" ? "en" : "ar"}>{t(locale, "language")}</button></form>;
}
