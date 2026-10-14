import type { PriceGroup, PriceInput, TemplateSeed } from "../types";
import { l } from "./common";
import { ask, buyer, doc, input, line, pack, supplier, yesno } from "./build";
import { enrich } from "./standard";

/**
 * Release 6: the freight template becomes a lane tender, the way freight is bought in practice.
 * The buyer lists lanes (origin, destination, container, yearly volume, maximum transit). The supplier quotes each lane as a
 * price per container split into components, and states transit, sailings, free days and validity for the lane.
 * Every lane is its own lot, so lanes can be compared and awarded one by one or all to a single carrier.
 * Published as version 3 of LOG_FREIGHT_RFQ by migration 0048. Existing events keep the version they were created from.
 */
const ans = (key: string, en: string, ar: string, type: PriceInput["type"], required = false): PriceInput => ({ key, label: l(en, ar), type, ...(required ? { required: true } : {}) });

export const LANE_GROUP: PriceGroup = {
  key: "lane", label: l("Lanes", "المسارات"), repeat: true, grid: true, asLot: true, nameFrom: ["origin", "destination"],
  inputs: [
    input("origin", ["Origin port", "ميناء المنشأ"], "text", true, undefined, "Khalifa Port"),
    input("origin_code", ["Origin code", "رمز المنشأ"], "text", false, undefined, "AEKHL"),
    input("destination", ["Destination port", "ميناء الوجهة"], "text", true, undefined, "Nhava Sheva (Mumbai)"),
    input("dest_code", ["Destination code", "رمز الوجهة"], "text", false, undefined, "INNSA"),
    input("container", ["Container", "الحاوية"], "text", true, "40' HC"),
    input("incoterm", ["Incoterm", "شرط التسليم"], "text", false, undefined, "CIF"),
    input("cargo", ["Cargo", "البضاعة"], "text", false, undefined, "Polyethylene bags, palletised"),
    input("volume", ["Containers per year", "الحاويات سنويًا"], "integer", true, undefined, "320"),
    input("max_transit", ["Max transit (days)", "أقصى مدة عبور (أيام)"], "integer", false, undefined, "10"),
  ],
  answers: [
    ans("transit_days", "Transit offered (days)", "مدة العبور المعروضة (أيام)", "integer", true),
    ans("sailings_week", "Sailings per week", "الرحلات أسبوعيًا", "integer"),
    ans("free_days", "Free days (detention)", "الأيام المجانية (التأخير)", "integer"),
    ans("valid_until", "Rate valid until", "الأسعار سارية حتى", "date"),
  ],
  limit: { max: "max_transit", answer: "transit_days" },
};

export const FREIGHT_LANES = pack("LOGISTICS_PACK", [
  { key: "LOG_FREIGHT_RFQ", type: "RFQ", category: "FREIGHT", title: ["Freight lanes RFQ", "طلب عرض سعر مسارات شحن"],
    summary: ["Lane-by-lane freight tender: price per container split into freight, surcharges and port charges, with transit, sailings and free days for each lane.", "مناقصة شحن لكل مسار: سعر الحاوية موزع على الشحن والرسوم الإضافية ورسوم الموانئ، مع مدة العبور والرحلات والأيام المجانية لكل مسار."],
    model: "freight",
    fields: [
      buyer("contract_period", "general", ["Contract period", "مدة العقد"], "text", true),
      buyer("rate_validity", "commercial", ["Rates must be valid until", "يجب أن تكون الأسعار سارية حتى"], "date", false),
      supplier("surcharge_basis", "commercial", ["How are fuel and other surcharges reviewed? (for example monthly index)", "كيف تُراجَع رسوم الوقود والرسوم الإضافية؟ (مثلًا بمؤشر شهري)"], "text", false, { envelope: "commercial" }),
      supplier("detention_terms", "service", ["Detention and demurrage terms after the free days", "شروط رسوم التأخير والأرضيات بعد الأيام المجانية"], "text", false, { envelope: "commercial" }),
    ],
    questions: [
      yesno("own_or_slot", ["Do you operate the vessels yourself (not only through slots on another carrier)?", "هل تشغلون السفن بأنفسكم (وليس فقط عبر حجز مساحات لدى ناقل آخر)؟"], "info"),
      ask("equipment", ["Describe equipment availability and how you protect space in peak season.", "صفوا توفر المعدات وكيف تضمنون المساحة في موسم الذروة."]),
    ],
    documents: [doc("insurance", ["Cargo insurance cover", "تغطية تأمين البضائع"], ["Shows the cover for goods in transit.", "تبين التغطية للبضائع أثناء النقل."]), doc("service_schedule", ["Service schedule or sailing calendar", "جدول الخدمة أو تقويم الرحلات"], ["Shows the sailings behind the weekly frequency you quote.", "يبين الرحلات التي تقوم عليها الوتيرة الأسبوعية المعروضة."])],
    groups: [LANE_GROUP],
    lines: [
      line("ocean_freight", ["Ocean freight: {name}", "الشحن البحري: {name}"], "volume", "CONTAINER", "UNIT_PRICE", { group: "lane" }),
      line("baf", ["Fuel surcharge (BAF): {name}", "رسوم الوقود (BAF): {name}"], "volume", "CONTAINER", "UNIT_PRICE", { group: "lane", zeroOk: true }),
      line("origin_thc", ["Origin port charges: {name}", "رسوم ميناء المنشأ: {name}"], "volume", "CONTAINER", "UNIT_PRICE", { group: "lane", zeroOk: true }),
      line("dest_thc", ["Destination port charges: {name}", "رسوم ميناء الوجهة: {name}"], "volume", "CONTAINER", "UNIT_PRICE", { group: "lane", zeroOk: true }),
      line("docs_other", ["Documents and other charges: {name}", "المستندات ورسوم أخرى: {name}"], "volume", "CONTAINER", "UNIT_PRICE", { group: "lane", zeroOk: true }),
    ] },
]);

/** Version 3 of the freight template: the market-standard content of version 2 plus the lane tender above. */
export const FREIGHT_V3: TemplateSeed[] = FREIGHT_LANES.map((t) => enrich(t)).map((t) => ({ ...t, content: { ...t.content, fields: t.content.fields.filter((f) => f.key !== "delivery_location") }, version: 3, changeNote: "Lane tender: lanes with price components, transit, sailings, free days and validity per lane; each lane is awarded on its own" }));

