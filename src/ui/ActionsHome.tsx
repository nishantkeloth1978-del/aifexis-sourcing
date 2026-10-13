import Link from "next/link";
import type { Action, MyActions } from "@/dashboard/service";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";

function Line({ a, locale }: { a: Action; locale: Locale }) {
  const params = a.params ? Object.fromEntries(Object.entries(a.params).map(([k, v]) => [k, tx(locale, v)])) : undefined;
  return (
    <li><Link className="act" href={a.href}>
      <span><b>{a.ref}</b> <span className="sub">{a.title}</span><div>{tx(locale, a.text, params)}</div></span>
      {a.urgent && <span className="pill warn">{tx(locale, "Now")}</span>}
    </Link></li>
  );
}

function Block({ title, rows, empty, locale, max = 6 }: { title: string; rows: Action[]; empty: string; locale: Locale; max?: number }) {
  return (
    <div className="card detail">
      <div className="row"><h3>{tx(locale, title)}</h3><span className="pill">{rows.length}</span></div>
      {rows.length === 0 ? <div className="empty">{tx(locale, empty)}</div> : <ul>{rows.slice(0, max).map((a, i) => <Line key={i} a={a} locale={locale} />)}</ul>}
      {rows.length > max && <div className="sub">{tx(locale, "and {n} more", { n: rows.length - max })}</div>}
    </div>
  );
}

/** The home page's "My actions": what needs me now, what I am waiting on others for, and what closes soon. */
export default function ActionsHome({ actions, locale }: { actions: MyActions; locale: Locale }) {
  const { now, waiting, soon } = actions;
  if (now.length + waiting.length + soon.length === 0) return <div className="card detail" style={{ marginBottom: 18 }}><h3>{tx(locale, "You are all caught up")}</h3><div className="sub">{tx(locale, "Nothing needs your action right now.")}</div></div>;
  return (
    <section className="actions-home" aria-label={tx(locale, "My actions")}>
      <Block title="Needs you now" rows={now} empty="Nothing needs your action right now." locale={locale} max={8} />
      <div className="actions-cols">
        <Block title="Waiting on others" rows={waiting} empty="You are not waiting on anyone." locale={locale} />
        <Block title="Closing in the next 7 days" rows={soon} empty="No event of yours closes this week." locale={locale} />
      </div>
    </section>
  );
}
