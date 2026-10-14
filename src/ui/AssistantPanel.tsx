"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";

interface Msg { role: "user" | "assistant"; content: string; looked?: string[]; error?: boolean }
const KEY = "aifexis.assistant.v1";

/** A very small, safe Markdown reader: paragraphs, bullet and numbered lists, **bold**, and links to this app only. No HTML is ever injected. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((\/[A-Za-z0-9\-_/?=&#.]*)\)/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}b${i++}`}>{m[1]}</strong>);
    else out.push(<Link key={`${key}l${i++}`} href={m[3]!}>{m[2]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return <>{blocks.map((b, bi) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ""), `${bi}-${li}`)}</li>)}</ul>;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), `${bi}-${li}`)}</li>)}</ol>;
    return <p key={bi}>{lines.map((l, li) => <span key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</span>)}</p>;
  })}</>;
}

function starters(path: string, locale: Locale): string[] {
  if (/^\/events\/[0-9a-f-]{36}/i.test(path)) return [tx(locale, "Why can't I submit this event?"), tx(locale, "What happens after I publish?"), tx(locale, "How do suppliers bid?")];
  if (path === "/templates") return [tx(locale, "How do I enable a template?"), tx(locale, "What is the default template?")];
  return [tx(locale, "Which events close this week?"), tx(locale, "How do I create an event from a template?"), tx(locale, "How do lots work?")];
}

export default function AssistantPanel({ locale }: { locale: Locale }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);

  // The conversation survives moving between pages in this browser tab (and nothing else: it is not kept after the tab closes).
  useEffect(() => { try { const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { open?: boolean; msgs?: Msg[] } | null; if (s) { setOpen(!!s.open); setMsgs(Array.isArray(s.msgs) ? s.msgs.slice(-16) : []); } } catch { /* storage may be unavailable */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ open, msgs: msgs.slice(-16) })); } catch { /* ignore */ } }, [open, msgs]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [msgs, busy, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => () => abort.current?.abort(), []);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next); setText(""); setBusy(true);
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      // Only real answers go back to the server as history, never error notes.
      const history = next.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, content: m.content }));
      while (history.length && history[0]!.role !== "user") history.shift();
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, path }), signal: ctrl.signal });
      const out = (await res.json()) as { ok: boolean; reply?: string; looked?: string[]; error?: string };
      setMsgs([...next, out.ok && out.reply ? { role: "assistant", content: out.reply, looked: out.looked } : { role: "assistant", content: tx(locale, out.error ?? "The assistant could not answer right now. Try again in a moment."), error: true }]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsgs([...next, { role: "assistant", content: tx(locale, "The assistant could not answer right now. Try again in a moment."), error: true }]);
    } finally { setBusy(false); }
  }

  return (<>
    <button type="button" className="askbtn" aria-expanded={open} aria-controls="assistant-panel" onClick={() => setOpen((o) => !o)}>✦ {tx(locale, "Ask Aifexis")}</button>
    {open && <aside id="assistant-panel" className="asst" role="complementary" aria-label={tx(locale, "Aifexis assistant")} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <header className="asst-h">
        <div><b>{tx(locale, "Aifexis assistant")}</b><small>{tx(locale, "Answers from the tool's guides and your own events")}</small></div>
        <span className="asst-hb">
          {msgs.length > 0 && <button type="button" className="asst-link" onClick={() => { abort.current?.abort(); setMsgs([]); setBusy(false); }}>{tx(locale, "New chat")}</button>}
          <button type="button" className="asst-x" aria-label={tx(locale, "Close assistant")} onClick={() => setOpen(false)}>×</button>
        </span>
      </header>
      <div className="asst-msgs" aria-live="polite">
        {msgs.length === 0 && <div className="asst-empty">
          <p>{tx(locale, "Ask me how something works, or about your own events. I can only read; I never change anything.")}</p>
          <div className="asst-chips">{starters(path, locale).map((s) => <button key={s} type="button" className="asst-chip" onClick={() => send(s)}>{s}</button>)}</div>
        </div>}
        {msgs.map((m, i) => <div key={i} className={`asst-m ${m.role === "user" ? "u" : "a"}${m.error ? " err" : ""}`}>
          {m.role === "user" ? m.content : <Rich text={m.content} />}
          {m.looked && m.looked.length > 0 && <div className="asst-src">{tx(locale, "Looked at your events")}</div>}
        </div>)}
        {busy && <div className="asst-m a asst-typing" role="status"><span className="sr-only">{tx(locale, "Thinking…")}</span><i /><i /><i /></div>}
        <div ref={end} />
      </div>
      <form className="asst-in" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} rows={2} maxLength={2000} value={text} aria-label={tx(locale, "Your question")} placeholder={tx(locale, "Ask anything about the tool…")}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>{tx(locale, "Send")}</button>
      </form>
      <div className="asst-foot">{tx(locale, "AI can make mistakes. It only sees what your login can see. Never type passwords or keys.")}</div>
    </aside>}
  </>);
}
