import Link from "next/link";
import type { Task } from "@/dashboard/service";

export default function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="card detail" style={{ marginBottom: 18 }}>
      <div className="row"><h3>Needs your action</h3><span className="sub">{tasks.length}</span></div>
      <ul className="team">
        {tasks.slice(0, 8).map((t, i) => (
          <li key={i}><span><Link className="sublink" href={`/events/${t.eventId}`}>{t.ref}</Link> <span className="sub">{t.title}</span><div>{t.text}</div></span>
            {t.urgent && <span className="pill warn">Now</span>}</li>
        ))}
      </ul>
      {tasks.length > 8 && <div className="sub">and {tasks.length - 8} more</div>}
    </div>
  );
}
