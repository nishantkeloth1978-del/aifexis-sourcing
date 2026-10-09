"use client";
import { useId, useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";

/** A small "?" that reveals a short explanation. Works with keyboard and touch; the text is announced to screen readers. */
export default function HelpTip({ locale, text }: { locale: Locale; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="helptip">
      <button type="button" className="helpbtn" aria-expanded={open} aria-controls={id} aria-label={tx(locale, "Help")} onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>?</button>
      {open && <span id={id} role="note" className="helptext">{tx(locale, text)}</span>}
    </span>
  );
}
