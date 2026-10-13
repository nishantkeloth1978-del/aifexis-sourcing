import { describe, expect, it } from "vitest";
import { aalOk, mfaRequired, needsStepUp, recentSecondFactor, safeNext } from "@/lib/assurance";

const ON = { REQUIRE_MFA: "true" }, OFF = {};
const now = 1_800_000_000_000;
const amr = (method: string, agoSec: number) => [{ method: "password", timestamp: now / 1000 - 5000 }, { method, timestamp: now / 1000 - agoSec }];

describe("second-factor assurance", () => {
  it("when MFA is required, only aal2 passes; when it is not, everything passes", () => {
    expect(mfaRequired(ON)).toBe(true);
    expect(aalOk("aal1", ON)).toBe(false);
    expect(aalOk(undefined, ON)).toBe(false);
    expect(aalOk("aal2", ON)).toBe(true);
    expect(aalOk("aal1", OFF)).toBe(true);
    expect(mfaRequired({ REQUIRE_MFA: "false" })).toBe(false);
  });
  it("a fresh second factor is one confirmed in the last 10 minutes", () => {
    expect(recentSecondFactor(amr("totp", 120), now)).toBe(true);
    expect(recentSecondFactor(amr("totp", 601), now)).toBe(false);
    expect(recentSecondFactor(amr("password", 1), now)).toBe(false);
    expect(recentSecondFactor(undefined, now)).toBe(false);
    expect(recentSecondFactor([{ method: "totp", timestamp: now / 1000 + 3600 }], now)).toBe(false);   // a time in the future is not trusted
  });
  it("step-up is asked only when MFA is required and the factor is old", () => {
    expect(needsStepUp(amr("totp", 900), ON, now)).toBe(true);
    expect(needsStepUp(amr("totp", 30), ON, now)).toBe(false);
    expect(needsStepUp(amr("totp", 900), OFF, now)).toBe(false);
  });
  it("only paths on this site are accepted as a place to return to", () => {
    expect(safeNext("/events/123e4567-e89b-12d3-a456-426614174000")).toBe("/events/123e4567-e89b-12d3-a456-426614174000");
    expect(safeNext("/users")).toBe("/users");
    for (const bad of ["https://evil.test", "//evil.test", "javascript:alert(1)", "/\\evil", "", null, undefined, 5]) expect(safeNext(bad)).toBe("/");
  });
});
