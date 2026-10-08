"use client";
import Link from "next/link";
import { useState } from "react";
import { dateLocale, t, type Locale } from "@/i18n/dict";
import type { Note } from "@/notifications/service";
import { markAllReadAction } from "../../app/notifications/actions";

export default function NoteList({ notes, linkBase, locale = "en" }: { notes: Note[]; linkBase: string; locale?: Locale }) {
  const [allRead, setAllRead] = useState(false);
  const unread = allRead ? 0 : notes.filter((n) => n.unread).length;
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  return (
    <div className="card detail">
      <div className="row"><h3>{t(locale, "updates")}</h3>{unread > 0 && <button type="button" className="btn ghost" onClick={() => { setAllRead(true); markAllReadAction(); }}>{t(locale, "markAllRead", { n: unread })}</button>}</div>
      {notes.length === 0 && <div className="sub">{t(locale, "nothingYet")}</div>}
      <ul className="team">
        {notes.map((n) => (
          <li key={n.id} style={n.unread && !allRead ? { fontWeight: 700 } : undefined}>
            <span>{n.eventId ? <Link className="sublink" href={`${linkBase}/${n.eventId}`}>{n.message}</Link> : n.message}</span><span className="sub">{when(n.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
