import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingMigrations, PROBES } from "@/lib/schema";
import { makePool } from "./helpers/db";

let pool: Pool;
beforeAll(() => { pool = makePool(); });
afterAll(async () => { await pool.end(); });

describe("schema probes", () => {
  it("finds nothing missing on a fully migrated database", async () => { expect(await missingMigrations(pool)).toEqual([]); });
  it("names the migrations whose tables or columns are absent", async () => {
    const probes = [...PROBES, { migration: "9998", what: "no_such_table" }, { migration: "9999", what: "autonomy_policy.no_such_column" }];
    expect(await missingMigrations(pool, probes)).toEqual(["9998", "9999"]);
  });
});
