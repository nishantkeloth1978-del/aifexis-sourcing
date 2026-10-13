import { describe, expect, it } from "vitest";
import { runtimeRole } from "@/authz";
import { gate, portalOf, staffLanding } from "@/lib/portal";

describe("separate portals", () => {
  it("the default serves everything", () => {
    expect(portalOf({})).toBe("both"); expect(portalOf({ PORTAL: "nonsense" })).toBe("both");
    for (const p of ["/", "/events/1", "/supplier", "/api/export/events"]) expect(gate(p, "both")).toEqual({ kind: "allow" });
  });
  it("the supplier site serves only supplier pages and what they use", () => {
    expect(gate("/", "supplier")).toEqual({ kind: "redirect", to: "/supplier" });
    for (const p of ["/supplier", "/supplier/events/abc", "/login", "/invite/token", "/no-access", "/api/time", "/api/files/1", "/api/messages/files/1", "/api/messages/inbound", "/api/supplier/events/1/price-sheet", "/api/health"])
      expect(gate(p, "supplier"), p).toEqual({ kind: "allow" });
    for (const p of ["/events/abc", "/approvers", "/configuration", "/templates", "/suppliers", "/api/export/events", "/api/cron/tick", "/settings", "/setup", "/supplierx", "/api/handover/1", "/awards", "/evaluations"])
      expect(gate(p, "supplier"), p).toEqual({ kind: "notfound" });
  });
  it("the buyer site hides the supplier pages", () => {
    for (const p of ["/supplier", "/supplier/events/1", "/invite/x", "/api/supplier/events/1/price-sheet"]) expect(gate(p, "buyer"), p).toEqual({ kind: "notfound" });
    for (const p of ["/", "/events/1", "/login", "/api/messages/files/1", "/api/cron/tick"]) expect(gate(p, "buyer"), p).toEqual({ kind: "allow" });
  });
  it("staff on the supplier site go to a dead end, not round in a circle", () => {
    expect(staffLanding("supplier")).toBe("/no-access"); expect(staffLanding("buyer")).toBe("/"); expect(staffLanding("both")).toBe("/");
  });
  it("the database role comes only from a known value", () => {
    expect(runtimeRole({})).toBe("app_runtime"); expect(runtimeRole({ DB_RUNTIME_ROLE: "app_supplier" })).toBe("app_supplier");
    expect(runtimeRole({ DB_RUNTIME_ROLE: "postgres; drop table x" })).toBe("app_runtime");
  });
});
