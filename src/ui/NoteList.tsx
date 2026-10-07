"use client";
import Link from "next/link";
import { useState } from "react";
import type { Note } from "@/notifications/service";
import { markAllReadAction } from "../../app/notifications/actions";

export default function NoteList({ notes, linkBase }: { notes: Note[]; linkBase: string }) {
  const [allRead, setAllRead] = useState(false);
  const unread = allRead ? 0 : notes.filter((n) => n.unread).length;
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  return (
    <div className="card detail">
      <div className="row"><h3>Updates</h3>{unread > 0 && <button type="button" className="btn ghost" onClick={() => { setAllRead(true); markAllReadAction(); }}>Mark all read ({unread})</button>}</div>
      {notes.length === 0 && <div className="sub">Nothing yet.</div>}
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
