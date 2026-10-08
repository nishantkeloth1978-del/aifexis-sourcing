/** Where file bytes live. 'db' keeps them in Postgres; 'supabase' puts them in a private Supabase Storage bucket (needs SUPABASE_SERVICE_ROLE_KEY). */
export type BackendName = "db" | "supabase";

export function backendName(env: NodeJS.ProcessEnv = process.env): BackendName {
  return env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "db";
}
const cfg = (env: NodeJS.ProcessEnv) => ({ base: `${env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/storage/v1`, key: env.SUPABASE_SERVICE_ROLE_KEY!, bucket: env.STORAGE_BUCKET || "aifexis-files" });
const enc = (k: string) => k.split("/").map(encodeURIComponent).join("/");

export async function putObject(key: string, bytes: Buffer, mime: string, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): Promise<void> {
  const c = cfg(env);
  const send = () => f(`${c.base}/object/${c.bucket}/${enc(key)}`, { method: "POST", headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, "Content-Type": mime, "x-upsert": "false" }, body: new Uint8Array(bytes) });
  let r = await send();
  if (r.status === 404 || r.status === 400) {                       // first use: create the private bucket, then try once more
    const mk = await f(`${c.base}/bucket`, { method: "POST", headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }) });
    if (mk.ok || mk.status === 409) r = await send();
  }
  if (!r.ok) throw new Error(`storage put failed: ${r.status}`);
}
export async function getObject(key: string, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): Promise<Buffer | null> {
  const c = cfg(env);
  const r = await f(`${c.base}/object/${c.bucket}/${enc(key)}`, { headers: { Authorization: `Bearer ${c.key}`, apikey: c.key } });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}
export async function deleteObjects(keys: string[], env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): Promise<void> {
  if (!keys.length) return;
  const c = cfg(env);
  await f(`${c.base}/object/${c.bucket}`, { method: "DELETE", headers: { Authorization: `Bearer ${c.key}`, apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: keys }) }).catch(() => undefined);
}
