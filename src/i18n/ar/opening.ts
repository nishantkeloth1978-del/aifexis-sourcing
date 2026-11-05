/** Arabic for flexible envelope opening: witnessed, buyer alone, automatic; one or two envelopes; rules by value. */
export const AR_OPENING: Record<string, string> = {
  "Opening of envelopes": "فتح المظاريف", "(who opens the sealed bids)": "(من يفتح العروض المختومة)", "Default way to open": "طريقة الفتح الافتراضية",
  "Witnessed: a different person confirms": "بحضور شاهد: شخص آخر يؤكد", "Buyer alone: the buyer opens, the audit log records it": "المشتري وحده: يفتح المشتري ويسجّل سجل التدقيق ذلك",
  "Automatic: opens by itself when bidding closes": "تلقائي: يفتح بنفسه عند إغلاق تقديم العروض", "Envelopes": "المظاريف",
  "Two: technical first, prices after the technical result is approved": "مظروفان: الفني أولاً ثم الأسعار بعد اعتماد النتيجة الفنية",
  "One: technical and price open together and price decides": "مظروف واحد: يفتح الفني والسعر معاً ويحسم السعر",
  "Rules by event value: from this value upwards, use this way to open instead of the default.": "قواعد حسب قيمة الحدث: من هذه القيمة فما فوق تُستخدم هذه الطريقة بدلاً من الافتراضية.",
  "From value (AED)": "من قيمة (درهم)", "Opening rule {n} from value": "قاعدة الفتح {n} من القيمة", "Opening rule {n} mode": "طريقة قاعدة الفتح {n}",
  "Witnessed": "بحضور شاهد", "Buyer alone": "المشتري وحده", "Automatic": "تلقائي", "Add opening rule": "إضافة قاعدة فتح",
  "Open all envelopes": "فتح جميع المظاريف",
  "Bidding is closed. Opening all envelopes needs a witness who is on this event.": "أُغلق تقديم العروض. فتح جميع المظاريف يحتاج إلى شاهد ضمن هذا الحدث.",
  "Bidding is closed. The buyer can open all envelopes. The audit log records who did it.": "أُغلق تقديم العروض. يمكن للمشتري فتح جميع المظاريف ويسجّل سجل التدقيق من فعل ذلك.",
  "Bidding is closed. The buyer can open the technical envelopes. The audit log records who did it.": "أُغلق تقديم العروض. يمكن للمشتري فتح المظاريف الفنية ويسجّل سجل التدقيق من فعل ذلك.",
  "Bidding is closed. Envelopes open automatically. If they have not opened, there may be no bids yet.": "أُغلق تقديم العروض. تُفتح المظاريف تلقائياً. إن لم تُفتح فقد لا توجد عروض بعد.",
  "Bids are sealed until the event is closed and the envelopes are opened.": "العروض مختومة حتى يُغلق الحدث وتُفتح المظاريف.",
  "The commercial envelopes open automatically. If they have not opened yet, you can open them now.": "تُفتح المظاريف التجارية تلقائياً. إن لم تُفتح بعد فيمكنك فتحها الآن.",
  "Opening the commercial envelopes reveals the prices of qualified bidders only. The audit log records who opened them.": "فتح المظاريف التجارية يكشف أسعار المتأهلين فقط. ويسجّل سجل التدقيق من فتحها.",
  "This event opens its envelopes a different way. Reload the page.": "يفتح هذا الحدث مظاريفه بطريقة مختلفة. أعد تحميل الصفحة.",
  "No bids were received.": "لم تُستلم أي عروض.",
  "Every bidder failed a mandatory declaration, so there is nobody to compare.": "أخفق كل مقدّم عرض في إقرار إلزامي فلا يوجد من تُجرى المقارنة معه.",
  "Choose how envelopes are opened.": "اختر طريقة فتح المظاريف.", "Choose one or two envelopes.": "اختر مظروفاً واحداً أو اثنين.",
  "Use at most 4 opening rules by value.": "استخدم 4 قواعد فتح حسب القيمة كحد أقصى.", "Each opening rule needs a mode.": "تحتاج كل قاعدة فتح إلى طريقة.",
  "Each opening rule needs a whole amount of AED, 0 or more.": "تحتاج كل قاعدة فتح إلى مبلغ صحيح بالدرهم، 0 أو أكثر.",
  "Opening rule amounts must be different.": "يجب أن تكون مبالغ قواعد الفتح مختلفة.",
  "Envelopes opened automatically, as the company's opening setting says.": "فُتحت المظاريف تلقائياً وفق إعداد الفتح في الشركة.",
  "You cannot be your own witness.": "لا يمكنك أن تكون شاهداً على نفسك.",
  "You do not have the required role on this event.": "ليس لديك الدور المطلوب في هذا الحدث.",
};
export const AR_BIDTABS: Record<string, string> = {
  "Parts of your bid": "أجزاء عرضك", "Technical": "الفني", "Commercial": "التجاري", "All done": "اكتمل", "{n} of {m} done": "اكتمل {n} من {m}",
  "All parts of your bid are opened together. Evaluators compare prices among bidders who pass the mandatory declarations.": "تُفتح جميع أجزاء عرضك معاً. يقارن المقيّمون الأسعار بين مقدّمي العروض الذين اجتازوا الإقرارات الإلزامية.",
  "Technical envelope. Evaluators read this part first. Do not put prices here.": "المظروف الفني. يقرأ المقيّمون هذا الجزء أولاً. لا تضع أسعاراً هنا.",
  "Sealed envelope. Your prices stay hidden until the technical result is approved, and only qualified bidders are opened.": "مظروف مختوم. تبقى أسعارك مخفية حتى تُعتمد النتيجة الفنية، ولا تُفتح إلا عروض المتأهلين.",
};
export const AR_LAYOUT: Record<string, string> = {
  "Untitled event": "حدث بلا عنوان", "Closes": "يغلق", "Suppliers invited": "الموردون المدعوون", "Bids received": "العروض المستلمة", "Until closing": "حتى الإغلاق", "{n} days": "{n} يوم",
  "Commercial and award": "التجاري والترسية", "Back": "رجوع", "Next: Commercial": "التالي: التجاري", "Needs your action": "يحتاج إلى إجراء منك",
};
