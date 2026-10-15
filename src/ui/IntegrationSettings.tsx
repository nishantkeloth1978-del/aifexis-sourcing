"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { dateLocale } from "@/i18n/dict";
import { SCOPES, WEBHOOK_EVENTS, type IntegrationScreen } from "@/integrations/types";
import { createIntegrationAction, replayDeliveryAction, revokeIntegrationAction } from "../../app/configuration/actions";

/** Connected systems: a key per system (shown once), the events it receives, and the delivery log with replay. */
export default function IntegrationSettings({ locale, screen }: { locale: Locale; screen: IntegrationScreen }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [url, setUrl] = useState("");
  const [scopes, setScopes] = useState<string[]>(["requests:write", "requests:read"]);
  const [events, setEvents] = useState<string[]>(["request.accepted", "award.approved"]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ key: string; secret: string | null } | null>(null);
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const fmt = (iso: string) => new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setShown(null);
    const r = await createIntegrationAction({ name, scopes, webhookUrl: url.trim() || undefined, events: url.trim() ? events : [] }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(false);
    if (r.ok) { setShown({ key: r.key, secret: r.webhookSecret }); setName(""); setUrl(""); router.refresh(); } else setError(r.error);
  }
  async function act(p: Promise<{ ok: boolean; error?: string }>) { setError(null); const r = await p.catch(() => ({ ok: false, error: "That could not be saved. Try again." })); if (!r.ok) setError(r.error ?? null); router.refresh(); }
  return (
    <div className="card newform detail" style={{ maxWidth: 760 }}>
      <div className="row"><h3>{tx(locale, "Connected systems")}</h3></div>
      <div className="sub">{tx(locale, "Let another system send requests in and receive signed notifications. Each connection has its own key. A key is shown once and cannot be read again; revoke it and make a new one if it is lost.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}
      {shown && (
        <div className="alert" role="status">
          <p>{tx(locale, "Copy these now. They will not be shown again.")}</p>
          <p>{tx(locale, "Key")}: <code>{shown.key}</code></p>
          {shown.secret && <p>{tx(locale, "Webhook signing secret")}: <code>{shown.secret}</code></p>}
        </div>)}
      {screen.clients.length > 0 && (
        <table className="table"><thead><tr><th>{tx(locale, "Name")}</th><th>{tx(locale, "Key starts with")}</th><th>{tx(locale, "Webhook")}</th><th>{tx(locale, "Last used")}</th><th>{tx(locale, "Status")}</th><th /></tr></thead>
          <tbody>{screen.clients.map((c) => (
            <tr key={c.id}><td>{c.name}</td><td><code>aifx_{c.keyPrefix}</code></td>
              <td>{c.webhookUrl ? `${new URL(c.webhookUrl).host} (${c.webhookEvents.length})` : "-"}{c.pending ? ` · ${c.pending} ${tx(locale, "waiting")}` : ""}{c.dead ? ` · ${c.dead} ${tx(locale, "failed")}` : ""}</td>
              <td>{c.lastUsedAt ? fmt(c.lastUsedAt) : "-"}</td><td>{tx(locale, c.active ? "Active" : "Revoked")}</td>
              <td>{c.active && <button type="button" className="btn ghost" onClick={() => void act(revokeIntegrationAction(c.id))}>{tx(locale, "Revoke")}</button>}</td></tr>))}</tbody></table>)}
      <form onSubmit={create}>
        <label>{tx(locale, "Name of the system")}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
        <fieldset><legend>{tx(locale, "It may")}</legend>
          {SCOPES.map((s) => <label key={s} className="check"><input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(scopes, s, setScopes)} />{tx(locale, s === "requests:write" ? "Send requests" : s === "requests:read" ? "Read the state of its requests" : "Read awards")}</label>)}
        </fieldset>
        <label>{tx(locale, "Webhook address (optional, https)")}<input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://" inputMode="url" /></label>
        {url.trim() && <fieldset><legend>{tx(locale, "Send these events")}</legend>
          {WEBHOOK_EVENTS.map((ev) => <label key={ev} className="check"><input type="checkbox" checked={events.includes(ev)} onChange={() => toggle(events, ev, setEvents)} /><code>{ev}</code></label>)}
        </fieldset>}
        <div className="row"><button className="btn" disabled={busy || name.trim().length < 2}>{busy ? tx(locale, "Saving…") : tx(locale, "Create connection")}</button></div>
      </form>
      {screen.deliveries.length > 0 && (<>
        <h4>{tx(locale, "Recent deliveries")}</h4>
        <table className="table"><thead><tr><th>{tx(locale, "When")}</th><th>{tx(locale, "System")}</th><th>{tx(locale, "Event")}</th><th>{tx(locale, "Status")}</th><th /></tr></thead>
          <tbody>{screen.deliveries.map((d) => (
            <tr key={d.id}><td>{fmt(d.createdAt)}</td><td>{d.clientName}</td><td><code>{d.eventType}</code></td>
              <td>{tx(locale, d.state === "delivered" ? "Delivered" : d.state === "pending" ? "Waiting to retry" : "Failed")}{d.attempts ? ` · ${d.attempts}` : ""}{d.lastError ? ` · ${tx(locale, d.lastError)}` : ""}</td>
              <td>{d.state !== "pending" && <button type="button" className="btn ghost" onClick={() => void act(replayDeliveryAction(d.id))}>{tx(locale, "Send again")}</button>}</td></tr>))}</tbody></table></>)}
    </div>
  );
}
