import { setLang } from "../../app/lang/actions";
import { t, type Locale } from "@/i18n/dict";

export default function LangSwitch({ locale }: { locale: Locale }) {
  return <form action={setLang} style={{ display: "inline" }}><input type="hidden" name="lang" value={locale === "ar" ? "en" : "ar"} /><button className="signout" type="submit" lang={locale === "ar" ? "en" : "ar"}>{t(locale, "language")}</button></form>;
}
