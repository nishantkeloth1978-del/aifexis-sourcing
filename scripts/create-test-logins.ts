// TEST SYSTEMS ONLY. Creates a Supabase login for every staff member who has none, and sets ONE shared password for all of them.
//   npx tsx scripts/create-test-logins.ts            show who would be created or updated (changes nothing)
//   npx tsx scripts/create-test-logins.ts --apply    do it (asks you to type YES first)
//   add --include-admins to include administrators (skipped by default), --suppliers to include supplier contacts
// You type everything hidden, here, on your own computer: the Supabase service key, the database address and the password.
// Nothing is written to disk or printed. Never use a shared password on a live system.
import { Client } from "pg";
import { ask, closeAsk } from "./lib/ask";
import { sslFor } from "../src/lib/dbssl";

const apply = process.argv.includes("--apply"), admins = process.argv.includes("--include-admins"), suppliers = process.argv.includes("--suppliers");

async function main() {
  const env = process.env;
  const base = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || (await ask("Supabase project URL (https://xxxx.supabase.co): "))).replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY || (await ask("Supabase service role key (typing is hidden): ", true));
  const dbUrl = env.DATABASE_URL || (await ask("Database connection string (typing is hidden): ", true));
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) { console.error("That is not a Supabase project address."); closeAsk(); return; }
  let password = "";
  if (apply) {
    password = env.TEST_LOGIN_PASSWORD || (await ask("Shared password, 8 or more characters (typing is hidden): ", true));
    const again = env.TEST_LOGIN_PASSWORD || (await ask("Type it again: ", true));
    if (password.length < 8 || password !== again) { console.error("The passwords differ or are shorter than 8 characters."); closeAsk(); return; }
  }
  const db = new Client({ connectionString: dbUrl, ssl: sslFor(dbUrl).options });
  await db.connect();
  const roles = ["member", ...(admins ? ["admin"] : [])];
  const people = (await db.query(
    `select distinct lower(u.email) as email, u.id, u.auth_user_id
       from app_user u
      where u.email not like '%@autopilot.invalid'
        and (exists (select 1 from membership m where m.user_id = u.id and m.disabled_at is null and m.role = any($1))
             ${suppliers ? "or exists (select 1 from supplier_user su where su.user_id = u.id)" : ""})
      order by 1`, [roles])).rows as { email: string; id: string; auth_user_id: string | null }[];
  console.log(`${people.length} login(s) in scope (${roles.join(", ")}${suppliers ? ", suppliers" : ""}).`);
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const existing = new Map<string, string>();
  for (let page = 1; ; page++) {
    const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
    if (!r.ok) { console.error(`Supabase refused the key (${r.status}).`); await db.end(); closeAsk(); return; }
    const j = (await r.json()) as { users?: { id: string; email?: string }[] };
    for (const u of j.users ?? []) if (u.email) existing.set(u.email.toLowerCase(), u.id);
    if ((j.users ?? []).length < 200) break;
  }
  for (const p of people) console.log(`${existing.has(p.email) ? "UPDATE password " : "CREATE login    "} ${p.email}`);
  if (!apply) { console.log("\nNothing changed. Add --apply to do this."); await db.end(); closeAsk(); return; }
  if ((await ask(`\nType YES to create or update ${people.length} login(s) with the shared password: `)) !== "YES") { console.log("Stopped."); await db.end(); closeAsk(); return; }
  closeAsk();
  let done = 0, failed = 0;
  for (const p of people) {
    try {
      let id = existing.get(p.email);
      if (id) {
        const r = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ password, email_confirm: true }) });
        if (!r.ok) throw new Error(`update ${r.status}`);
      } else {
        const r = await fetch(`${base}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: p.email, password, email_confirm: true }) });
        if (!r.ok) throw new Error(`create ${r.status}`);
        id = ((await r.json()) as { id: string }).id;
      }
      if (p.auth_user_id !== id) await db.query(`update app_user set auth_user_id = $2 where id = $1 and (auth_user_id is null or auth_user_id <> $2)`, [p.id, id]);
      done++;
    } catch (e) { failed++; console.error(`FAILED ${p.email}: ${e instanceof Error ? e.message : e}`); }
  }
  await db.end();
  console.log(`Done: ${done} login(s) ready, ${failed} failed. Sign in at the site with the email and the shared password.`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
