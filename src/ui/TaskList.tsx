import Link from "next/link";
import type { Task } from "@/dashboard/service";
import { t, type Locale } from "@/i18n/dict";

export default function TaskList({ tasks, locale = "en" }: { tasks: Task[]; locale?: Locale }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card detail" style={{ marginBottom: 18 }}>
      <div className="row"><h3>{t(locale, "needsAction")}</h3><span className="sub">{tasks.length}</span></div>
      <ul className="team">
        {tasks.slice(0, 8).map((k, i) => (
          <li key={i}><span><Link className="sublink" href={`/events/${k.eventId}`}>{k.ref}</Link> <span className="sub">{k.title}</span><div>{k.text}</div></span>
            {k.urgent && <span className="pill warn">{t(locale, "nowTag")}</span>}</li>
        ))}
      </ul>
      {tasks.length > 8 && <div className="sub">{t(locale, "andMore", { n: tasks.length - 8 })}</div>}
    </div>
  );
}
