"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { saveTemplateAction } from "../../app/events/[id]/actions";

export default function SaveTemplate({ eventId, defaultName, locale = "en" }: { eventId: string; defaultName: string; locale?: Locale }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setState("saving");
    const r = await saveTemplateAction(eventId, name).catch(() => ({ ok: false, error: "That could not be saved. Try again." }));
    if (!r.ok) { setState("idle"); setError(r.error ?? "That is not allowed."); return; }
    setState("saved"); setOpen(false);
  }
  if (!open) return <button type="button" className="btn ghost" onClick={() => { setState("idle"); setOpen(true); }}>{state === "saved" ? tx(locale, "Template saved") : tx(locale, "Save as template")}</button>;
  return (
    <form onSubmit={save} className="actions" style={{ margin: 0 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label={tx(locale, "Template name")} maxLength={120} autoFocus />
      <button className="btn" type="submit" disabled={state === "saving"}>{state === "saving" ? tx(locale, "Saving...") : tx(locale, "Save")}</button>
      <button className="btn ghost" type="button" onClick={() => setOpen(false)}>{tx(locale, "Cancel")}</button>
      {error && <span className="sub" role="alert" style={{ color: "#b42318" }}>{tx(locale, error)}</span>}
    </form>
  );
}
