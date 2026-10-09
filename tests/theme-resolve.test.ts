import { describe, it, expect } from "vitest";
import { resolveTheme, isTheme } from "@/ui/themes";
describe("resolveTheme", () => {
  it("prefers the user's cookie, then env, then clean", () => {
    expect(resolveTheme("dark", "navy")).toBe("dark");
    expect(resolveTheme(undefined, "navy")).toBe("navy");
    expect(resolveTheme("bogus", "nope")).toBe("clean");
    expect(resolveTheme(undefined, undefined)).toBe("clean");
    expect(isTheme("teal")).toBe(true);
  });
});
