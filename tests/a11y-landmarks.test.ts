import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });

describe("page landmarks", () => {
  it("every page shell that wraps a sign-in style card or supplier portal exposes a main landmark the skip link can reach", () => {
    for (const f of walk("app")) {
      const s = readFileSync(f, "utf8");
      if (s.includes('className="loginwrap"')) expect(s, f).toMatch(/className="loginwrap" role="main" id="main"/);
      if (s.includes('className="supmain"')) expect(s, f).toMatch(/className="supmain" id="main"/);
    }
  });
  it("modal backdrops are hidden from assistive technology", () => {
    expect(readFileSync("src/ui/RolesPanel.tsx", "utf8")).toMatch(/className="drawerback" aria-hidden="true"/);
  });
});
