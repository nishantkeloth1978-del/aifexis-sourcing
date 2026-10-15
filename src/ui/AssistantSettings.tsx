"use client";
import { useState } from "react";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import type { ProviderStatus, Settings } from "@/assistant/models";
import { saveAssistantSettingsAction, testAssistantModelAction } from "../../app/configuration/actions";

/** Which models the assistant may use. Choices only: API keys are set in the server environment (Vercel), never typed here. */
export default function AssistantSettings({ locale, initial, providers, claudeKey, claudeDefault }: { locale: Locale; initial: Settings; providers: ProviderStatus[]; claudeKey: boolean; claudeDefault: string }) {
  const [s, setS] = useState<Settings>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<Settings>) => { setS((c) => ({ ...c, ...patch })); setState("idle"); setError(null); };
  const chosen = s.freeProvider === "auto" ? providers.find((p) => p.keySet) : providers.find((p) => p.id === s.freeProvider);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setState("saving"); setError(null);
    const r = await saveAssistantSettingsAction(s).catch(() => ({ ok: false as const, error: "That could not be saved. Try again." }));
    if (r.ok) setState("saved"); else { setState("idle"); setError(r.error); }
  }
  async function run(which: "free" | "claude") {
    setBusy(which); setTest((t) => ({ ...t, [which]: "" }));
    const r = await testAssistantModelAction(which).catch(() => ({ ok: false, message: "The provider could not be reached or did not answer." }));
    setBusy(null); setTest((t) => ({ ...t, [which]: tx(locale, r.message) }));
  }

  return (
    <form className="card newform detail" onSubmit={save} style={{ maxWidth: 720 }}>
      <div className="row"><h3>{tx(locale, "Assistant models")}</h3></div>
      <div className="sub">{tx(locale, "Choose which AI models the in-app assistant may use. API keys are never entered here: they are set in the server environment (Vercel), and this screen only shows whether each one is set.")}</div>
      {error && <div className="alert" role="alert">{tx(locale, error)}</div>}

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
        <legend><b>{tx(locale, "How the assistant picks a model")}</b></legend>
        <label className="check"><input type="radio" name="mode" checked={s.mode === "free_first"} onChange={() => set({ mode: "free_first" })} /> {tx(locale, "Free model first for how-to questions, Claude for everything else")}</label>
        <label className="check"><input type="radio" name="mode" checked={s.mode === "claude_only"} onChange={() => set({ mode: "claude_only" })} /> {tx(locale, "Claude only")}</label>
        <div className="sub">{tx(locale, "A free model only ever receives the question and the product guides, never your events, suppliers, prices or company name. Questions about your own data and every change always go to Claude.")}</div>
      </fieldset>

      {s.mode === "free_first" && <>
        <div className="two">
          <label>{tx(locale, "Free model provider")}
            <select value={s.freeProvider} onChange={(e) => set({ freeProvider: e.target.value as Settings["freeProvider"] })}>
              <option value="auto">{tx(locale, "Automatic (first provider that has a key)")}</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.id === "custom" ? tx(locale, p.label) : p.label}{p.keySet ? "" : ` (${tx(locale, "no key")})`}</option>)}
            </select>
          </label>
          <label>{tx(locale, "Free model name")}
            <input value={s.freeModel} maxLength={100} placeholder={chosen?.defaultModel || tx(locale, "Provider default")} onChange={(e) => set({ freeModel: e.target.value })} />
          </label>
        </div>
        <div className="sub" role="status">
          {chosen ? (chosen.keySet ? tx(locale, "Key found for {p}.", { p: chosen.id === "custom" ? tx(locale, chosen.label) : chosen.label }) : tx(locale, "No key is set for {p}. Add {k} in Vercel and redeploy.", { p: chosen.label, k: chosen.keyVar })) : tx(locale, "No free provider has a key yet. Add GROQ_API_KEY (or OPENROUTER_API_KEY, GEMINI_API_KEY) in Vercel and redeploy.")}
          {chosen && <> {tx(locale, chosen.note)}</>}
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn ghost" disabled={busy !== null || !chosen?.keySet} onClick={() => run("free")}>{busy === "free" ? tx(locale, "Testing...") : tx(locale, "Test free model")}</button>
          {test.free && <span className="sub" aria-live="polite">{test.free}</span>}
        </div>
      </>}

      <label style={{ display: "block", marginTop: 12 }}>{tx(locale, "Claude model name")}
        <input value={s.claudeModel} maxLength={100} placeholder={claudeDefault} onChange={(e) => set({ claudeModel: e.target.value })} />
      </label>
      <div className="sub">{claudeKey ? tx(locale, "The Claude key is set.") : tx(locale, "No Claude key is set. Add ANTHROPIC_API_KEY in Vercel and redeploy.")} {tx(locale, "Leave a name empty to use the default.")}</div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn ghost" disabled={busy !== null || !claudeKey} onClick={() => run("claude")}>{busy === "claude" ? tx(locale, "Testing...") : tx(locale, "Test Claude")}</button>
        {test.claude && <span className="sub" aria-live="polite">{test.claude}</span>}
      </div>

      <div className="actions"><button className="btn" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? tx(locale, "Saving...") : state === "saved" ? tx(locale, "Saved") : tx(locale, "Save assistant models")}</button></div>
    </form>
  );
}
