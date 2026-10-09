"use client";
import { useState, useTransition } from "react";
import { THEMES, type ThemeKey } from "./themes";
import { setThemeAction } from "../../app/settings/actions";

export default function ThemePicker({ current, labels }: { current: ThemeKey; labels: Record<string, string> }) {
  const [sel, setSel] = useState<ThemeKey>(current);
  const [pending, start] = useTransition();
  function pick(k: ThemeKey) {
    setSel(k);
    document.documentElement.dataset.theme = k;
    start(async () => { await setThemeAction(k); });
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }} role="radiogroup" aria-label={labels.title}>
      {THEMES.map((t) => (
        <button key={t.key} type="button" role="radio" aria-checked={sel === t.key} onClick={() => pick(t.key)} disabled={pending}
          style={{ textAlign: "start", padding: 12, borderRadius: 12, border: sel === t.key ? "2px solid var(--accent)" : "1px solid var(--line-strong)", background: "var(--card)", color: "var(--text)", cursor: "pointer" }}>
          <div style={{ display: "flex", height: 44, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", marginBottom: 8 }}>
            <span style={{ flex: 2, background: t.swatch[0] }} /><span style={{ flex: 1, background: t.swatch[1] }} /><span style={{ flex: 2, background: t.swatch[2] }} />
          </div>
          <b>{labels[t.key] ?? t.label}</b>{sel === t.key && <span className="pill" style={{ marginInlineStart: 8 }}>{labels.active}</span>}
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{labels[t.key + "_note"] ?? t.note}</div>
        </button>
      ))}
    </div>
  );
}
