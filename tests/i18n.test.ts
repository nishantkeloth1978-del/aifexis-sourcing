import { describe, expect, it } from "vitest";
import { dirOf, t, type Key } from "@/i18n/dict";

describe("i18n", () => {
  it("fills placeholders and sets direction", () => {
    expect(t("en", "closes", { d: "1 Jan" })).toBe("Closes 1 Jan");
    expect(t("ar", "closes", { d: "1 Jan" })).toContain("1 Jan");
    expect(dirOf("ar")).toBe("rtl"); expect(dirOf("en")).toBe("ltr");
  });
  it("Arabic keeps every placeholder the English text has", () => {
    const keys = ["closes", "markAllRead", "revisionSubmitted", "pricesLoaded"] as Key[];
    for (const k of keys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(t("ar", k, { d: "{d}", n: "{n}", t: "{t}" }))).toBe(ph(t("en", k, { d: "{d}", n: "{n}", t: "{t}" })));
    }
  });
});
