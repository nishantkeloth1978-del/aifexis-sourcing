import { createElement } from "react";
// @ts-expect-error no types needed for the server renderer
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { remaining, shortLeft, urgency } from "@/lib/clock";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/" }));

describe("live clock", () => {
  it("colour steps", () => {
    expect(urgency(3 * 864e5)).toBe("ok");
    expect(urgency(86_400_000)).toBe("ok");
    expect(urgency(86_399_000)).toBe("warn");
    expect(urgency(3_600_000)).toBe("warn");
    expect(urgency(3_599_000)).toBe("bad");
    expect(urgency(1)).toBe("bad");
    expect(urgency(0)).toBe("done");
    expect(urgency(-5)).toBe("done");
  });
  it("compact text", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(shortLeft(remaining("2026-10-13T02:00:00Z", now, 0))).toBe("3 d 2 h");
    expect(shortLeft(remaining("2026-10-10T05:04:03Z", now, 0))).toBe("05:04:03");
    expect(shortLeft(remaining("2026-10-09T00:00:00Z", now, 0))).toBe("");
  });
  it("renders on the server without a time, so the browser can fill it in without a mismatch", async () => {
    const LiveClock = (await import("@/ui/LiveClock")).default;
    const iso = new Date(Date.now() + 3600e3 * 50).toISOString();
    const mini = renderToString(createElement(LiveClock, { closesAt: iso }));
    const badge = renderToString(createElement(LiveClock, { closesAt: iso, variant: "badge", timeZone: "Asia/Dubai" }));
    expect(mini).toContain("clk mini"); expect(mini).not.toMatch(/\d\d:\d\d:\d\d/);
    expect(badge).toContain("Time left"); expect(badge).toContain("Closes");
  });
});
