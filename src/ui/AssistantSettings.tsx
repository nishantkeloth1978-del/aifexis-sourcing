"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { dateLocale } from "@/i18n/dict";
import type { Card, FreeId, Screen, Settings } from "@/assistant/models";
import { removeAssistantKeyAction, saveAssistantKeyAction, saveAssistantSettingsAction, testAssistantModelAction } from "../../app/configuration/actions";

const FREE: FreeId[] = ["groq", "openrouter", "gemini"];

/**
 * Which models the assistant may use, and their API keys. Keys are write-only: a saved key is encrypted on the server and only its last four
 * characters are ever shown again. Typing a key here never puts it in the page, the address or the logs.
 */
export default function AssistantSettings({ locale, screen }: { locale: Locale; screen: Screen }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(screen.settings);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(locale), { dateStyle: "medium", timeZone: "UTC" });
  const order: FreeId[] = [...s.order, ...FREE.filter((i) => !s.order.includes(i))];
  const set = (patch: Partial<Settings>) => { setS((c) => ({ ...c, ...patch })); setState("idle"); setError(null); };
  const setModel = (id: keyof Settings["models"], v: string) => set({ models: { ...s.models, [id]: v } });
  const move = (id: FreeId, pos: number) => { const rest = order.filter((x) => x !== id); rest.splice(pos, 0, id); set({ order: rest }); };

  async function save(e: React.FormEvent) {
    e.preventDefault(); setState("saving"); setError(null);
    const r = await saveAssistantSettingsAction({ ...s, order }).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (r.ok) { setState("saved"); router.refresh(); } else { setState("idle"); setError(r.error); }
  }

  return (
    <form className="card newform detail" onSubmit={save} style={{ maxWidth: 760 }}>
      <div className="row"><h3>{tx(locale, "Assistant models")}</h3></div>
      <div className="sub">{tx(locale, "Choose which AI models the in-app assistant may use, and enter the API key for each. Changes apply to this company only.")}</div>
      <div className="sub" role="note" style={{ margin: "10px 0" }}><b>{tx(locale, "Keys are write-only.")}</b> {tx(locale, "A key is encrypted before it is stored and is never shown again, only its last four characters. Only administrators can add, replace or remove keys, and every change is recorded in the audit log. Paste a key only here, never into a chat.")}</div>
      {!screen.encryption && <div className="alert" role="alert">{tx(locale, "Keys cannot be stored: the server has no signing secret set. Contact whoever runs the server.")}</div>}
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
        <legend><b>{tx(locale, "How the assistant picks a model")}</b></legend>
        <label className="check"><input type="radio" name="mode" checked={s.mode === "free_first"} onChange={() => set({ mode: "free_first" })} /> {tx(locale, "Free model first for how-to questions, Claude for everything else")}</label>
        <label className="check"><input type="radio" name="mode" checked={s.mode === "claude_only"} onChange={() => set({ mode: "claude_only" })} /> {tx(locale, "Claude only")}</label>
        <div className="sub">{tx(locale, "A free model only ever receives the question and the product guides, never your events, suppliers, prices or company name. Questions about your own data and every change always go to Claude.")}</div>
      </fieldset>

      {s.mode === "free_first" && <>
        <b style={{ display: "block", marginTop: 14 }}>{tx(locale, "Free model providers")}</b>
        <div className="sub">{tx(locale, "The provider in position 1 is tried first. If it fails or hands a question up, the next one with a key is tried, then Claude.")}</div>
        {order.map((id, i) => { const c = screen.cards.find((x) => x.id === id)!; return (
          <ProviderCard key={id} locale={locale} card={c} model={s.models[id] ?? ""} onModel={(v) => setModel(id, v)} encryption={screen.encryption} when={when} onChanged={() => router.refresh()}
            extra={<label>{tx(locale, "Order")}<select value={i} onChange={(e) => move(id, Number(e.target.value))}>{order.map((_, k) => <option key={k} value={k}>{k === 0 ? tx(locale, "1 · Use first") : String(k + 1)}</option>)}</select></label>} />); })}
      </>}

      <b style={{ display: "block", marginTop: 14 }}>{tx(locale, "Claude (Anthropic)")}</b>
      <ProviderCard locale={locale} card={screen.cards.find((x) => x.id === "claude")!} model={s.models.claude ?? ""} onModel={(v) => setModel("claude", v)} encryption={screen.encryption} when={when} onChanged={() => router.refresh()}
        extra={<label>{tx(locale, "Questions per person per day")}<input type="number" min={1} max={5000} value={s.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} /></label>} />
      <div className="sub">{tx(locale, "Nothing about the AI features is set on the server: this key and model are used for the assistant and for drafting templates, message replies and translation, and evaluator suggestions.")}</div>

      <b style={{ display: "block", marginTop: 14 }}>{tx(locale, "This month")}</b>
      <div className="two">
        <div><b style={{ fontSize: 22 }}>{screen.usage.free}</b> <span className="sub">{tx(locale, "answered by free models")}</span></div>
        <div><b style={{ fontSize: 22 }}>{screen.usage.claude}</b> <span className="sub">{tx(locale, "answered by Claude")}</span> · <b>{screen.usage.handedUp}</b> <span className="sub">{tx(locale, "handed up to Claude")}</span></div>
      </div>

      <div className="actions">
        <button className="btn" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? tx(locale, "Saving...") : state === "saved" ? tx(locale, "Saved") : tx(locale, "Save assistant models")}</button>
        {screen.updatedAt && <span className="sub">{tx(locale, "Last changed {d}.", { d: when(screen.updatedAt) })}</span>}
      </div>
    </form>
  );
}

function ProviderCard({ locale, card, model, onModel, extra, encryption, when, onChanged }: { locale: Locale; card: Card; model: string; onModel: (v: string) => void; extra: React.ReactNode; encryption: boolean; when: (iso: string) => string; onChanged: () => void }) {
  const [entering, setEntering] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ good: boolean; text: string } | null>(null);
  const label = card.id === "claude" ? "Claude" : card.label;

  async function save() {
    setBusy("save"); setMsg(null);
    const r = await saveAssistantKeyAction(card.id, key).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    setBusy(null);
    if (r.ok) { setKey(""); setEntering(false); onChanged(); } else setMsg({ good: false, text: tx(locale, r.error) });
  }
  async function remove() {
    if (!window.confirm(tx(locale, "Remove this key? The assistant stops using it."))) return;
    setBusy("remove"); setMsg(null);
    await removeAssistantKeyAction(card.id).catch(() => undefined);
    setBusy(null); onChanged();
  }
  async function test() {
    setBusy("test"); setMsg(null);
    const r = await testAssistantModelAction(card.id).catch(() => ({ ok: false, message: "The provider could not be reached or did not answer." }));
    setBusy(null); setMsg({ good: r.ok, text: tx(locale, r.message) });
  }

  return (
    <div className="card" style={{ margin: "10px 0", padding: "12px 14px" }}>
      <div className="row"><span><b>{label}</b> <span className="sub">{card.hasKey ? tx(locale, "Key set") : tx(locale, "No key")}</span></span><span className="sub">{tx(locale, card.note)}</span></div>
      <div className="two">
        <label>{tx(locale, "Model name")}<input value={model} maxLength={100} placeholder={card.defaultModel} onChange={(e) => onModel(e.target.value)} /></label>
        {extra}
      </div>
      {!entering && <div className="actions" style={{ marginTop: 6 }}>
        {card.hasKey && <span className="sub"><code>••••••••{card.last4}</code>{card.addedAt && <> · {tx(locale, "added {d}", { d: when(card.addedAt) })}</>}</span>}
        <button type="button" className="btn ghost" disabled={busy !== null || !encryption} onClick={() => { setEntering(true); setMsg(null); }}>{card.hasKey ? tx(locale, "Replace key") : tx(locale, "Add key")}</button>
        {card.hasKey && <button type="button" className="btn ghost" disabled={busy !== null} onClick={remove}>{tx(locale, "Remove")}</button>}
        <button type="button" className="btn ghost" disabled={busy !== null || !card.hasKey} onClick={test}>{busy === "test" ? tx(locale, "Testing...") : tx(locale, "Test")}</button>
        {msg && <span className="sub" role="status" aria-live="polite" style={{ color: msg.good ? "#157a3e" : "#a52a1e" }}>{msg.good ? "✓ " : "✗ "}{msg.text}</span>}
      </div>}
      {entering && <div className="actions" style={{ marginTop: 6 }}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={tx(locale, "API key")} placeholder={tx(locale, "Paste the key here")} value={key} onChange={(e) => setKey(e.target.value)} style={{ maxWidth: 340 }} />
        <button type="button" className="btn" disabled={busy !== null || key.trim().length < 8} onClick={save}>{busy === "save" ? tx(locale, "Saving...") : tx(locale, "Save key")}</button>
        <button type="button" className="btn ghost" onClick={() => { setEntering(false); setKey(""); setMsg(null); }}>{tx(locale, "Cancel")}</button>
        {msg && <span className="sub" role="alert" style={{ color: "#a52a1e" }}>{msg.text}</span>}
      </div>}
    </div>
  );
}
