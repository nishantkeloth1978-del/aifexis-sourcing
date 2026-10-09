import { describe, expect, it } from "vitest";
import { MAX_LINES } from "@/events/service";
import { MAX_LOTS } from "@/lots/service";
import { MAX_BID_FILES, MAX_BYTES } from "@/files/service";
import { MAX_CATALOG_IMPORT } from "@/catalog/service";
import { MAX_SUPPLIER_IMPORT } from "@/suppliers/master";
import { MAX_SHEET_ROWS } from "@/templates/sheet";
import { readFileSync } from "node:fs";

describe("published limits", () => {
  it("match docs/LIMITS.md", () => {
    const doc = readFileSync("docs/LIMITS.md", "utf8");
    expect(doc).toContain(`| Lines per event | ${MAX_LINES} |`);
    expect(doc).toContain(`| Lots per event | ${MAX_LOTS} |`);
    expect(doc).toContain(`| File upload size | ${MAX_BYTES / 1024 / 1024} MB |`);
    expect(doc).toContain(`| Files per supplier bid | ${MAX_BID_FILES} |`);
    expect(doc).toContain(`| Catalogue import | ${MAX_CATALOG_IMPORT.toLocaleString("en-US")} items per file |`);
    expect(doc).toContain(`| Supplier import | ${MAX_SUPPLIER_IMPORT} per file |`);
    expect(doc).toContain(`| Template workbook rows | ${MAX_SHEET_ROWS} per sheet |`);
  });
});
