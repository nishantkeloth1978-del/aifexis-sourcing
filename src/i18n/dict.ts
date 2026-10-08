export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];
export const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");
/** Western digits in Arabic dates so figures match the rest of the page. */
export const dateLocale = (l: Locale) => (l === "ar" ? "ar-AE-u-nu-latn" : "en-GB");

const en = {
  signOut: "Sign out", language: "العربية", notifications: "Notifications",
  navSourcing: "Sourcing", navEvents: "Events", navEvaluations: "Evaluations", navAwards: "Awards", navMaster: "Master data", navSuppliers: "Suppliers", navItems: "Items",
  navAdmin: "Admin", navConfiguration: "Configuration", navIntegrations: "Integrations",
  yourInvitations: "Your invitations", noInvitations: "No open invitations right now.", closes: "Closes {d}", noClosing: "No closing date", openBid: "Open bid",
  awardedYou: "Awarded to you.", awardedOther: "Awarded to another bidder.", closedForBids: "Closed for bids.",
  updates: "Updates", markAllRead: "Mark all read ({n})", nothingYet: "Nothing yet.",
  backInvitations: "← Your invitations", technicalResponse: "1. Technical response",
  techPlaceholder: "Describe your offer: scope, compliance with the specification, delivery, warranty...",
  prices: "Prices", mandatory: "Mandatory declarations", downloadSheet: "Download price sheet", uploadSheet: "Upload filled sheet",
  total: "Total", enterEvery: "Enter every price", submitBid: "Submit bid", submitRevision: "Submit revision", submitting: "Submitting...",
  revisionSubmitted: "Revision {n} submitted, total {t}. You can revise it until the closing time.", viewReceipt: "View receipt",
  yes: "Yes", no: "No", item: "Item", qty: "Qty", unit: "Unit", price: "Price", lumpSum: "lump sum",
  pricesLoaded: "{n} prices loaded from the sheet. Check them, then submit.",
  bidReceipt: "Bid receipt", supplier: "Supplier", revision: "Revision", submitted: "Submitted", fingerprint: "Fingerprint",
  pricesSubmitted: "Prices submitted", declarations: "Declarations", unitPrice: "Unit price", back: "← Back to your bid", print: "Print or save as PDF",
  receiptNote: "The fingerprint identifies exactly what was submitted. Keep this receipt for your records. Revising your bid before the closing time creates a new revision and a new receipt.",
};
export type Key = keyof typeof en;

const ar: Record<Key, string> = {
  signOut: "تسجيل الخروج", language: "English", notifications: "الإشعارات",
  navSourcing: "المشتريات", navEvents: "الفعاليات", navEvaluations: "التقييمات", navAwards: "الترسيات", navMaster: "البيانات الرئيسية", navSuppliers: "الموردون", navItems: "الأصناف",
  navAdmin: "الإدارة", navConfiguration: "الإعدادات", navIntegrations: "التكامل",
  yourInvitations: "دعواتك", noInvitations: "لا توجد دعوات مفتوحة حالياً.", closes: "تُغلق في {d}", noClosing: "بدون تاريخ إغلاق", openBid: "فتح العرض",
  awardedYou: "تمت الترسية عليك.", awardedOther: "تمت الترسية على مورد آخر.", closedForBids: "أُغلق باب العروض.",
  updates: "التحديثات", markAllRead: "تحديد الكل كمقروء ({n})", nothingYet: "لا شيء حتى الآن.",
  backInvitations: "→ دعواتك", technicalResponse: "١. العرض الفني",
  techPlaceholder: "صف عرضك: النطاق، الالتزام بالمواصفات، التسليم، الضمان...",
  prices: "الأسعار", mandatory: "الإقرارات الإلزامية", downloadSheet: "تنزيل ورقة الأسعار", uploadSheet: "رفع الورقة المعبأة",
  total: "الإجمالي", enterEvery: "أدخل جميع الأسعار", submitBid: "تقديم العرض", submitRevision: "تقديم نسخة معدلة", submitting: "جارٍ التقديم...",
  revisionSubmitted: "تم تقديم النسخة {n}، الإجمالي {t}. يمكنك تعديلها حتى موعد الإغلاق.", viewReceipt: "عرض الإيصال",
  yes: "نعم", no: "لا", item: "البند", qty: "الكمية", unit: "الوحدة", price: "السعر", lumpSum: "مبلغ مقطوع",
  pricesLoaded: "تم تحميل {n} من الأسعار من الورقة. راجعها ثم قدّم العرض.",
  bidReceipt: "إيصال العرض", supplier: "المورد", revision: "النسخة", submitted: "تاريخ التقديم", fingerprint: "البصمة",
  pricesSubmitted: "الأسعار المقدمة", declarations: "الإقرارات", unitPrice: "سعر الوحدة", back: "→ العودة إلى عرضك", print: "طباعة أو حفظ بصيغة PDF",
  receiptNote: "تحدد البصمة بدقة ما تم تقديمه. احتفظ بهذا الإيصال في سجلاتك. تعديل عرضك قبل موعد الإغلاق ينشئ نسخة جديدة وإيصالاً جديداً.",
};
const DICT: Record<Locale, Record<Key, string>> = { en, ar };

/** Looks up a phrase and fills {placeholders}. Falls back to English, never throws. */
export function t(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  const s = DICT[locale]?.[key] ?? en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}
