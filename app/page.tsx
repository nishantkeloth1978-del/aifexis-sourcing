import Shell from "@/ui/Shell";
import { DEMO_EVENTS } from "@/demo/events";
import EventList from "@/ui/EventList";

export default function Home() {
  const awarded = DEMO_EVENTS.filter((e) => e.status === "Awarded").length;
  return (
    <Shell title="Events" action={<button className="btn">+ New event</button>}>
      <section className="kpis">
        <div className="kpi"><small>Total events</small><strong>{DEMO_EVENTS.length}</strong><em>{awarded} awarded</em></div>
        <div className="kpi"><small>Pipeline value</small><strong>AED 2,823,700.00</strong></div>
        <div className="kpi green"><small>Total savings</small><strong>AED 68,520.00</strong></div>
        <div className="kpi orange"><small>Awaiting action</small><strong>2</strong><em>approvals and evaluations</em></div>
      </section>
      <EventList events={DEMO_EVENTS} />
      <p className="note">Demo data. Real events appear here once login and the database queries are connected.</p>
    </Shell>
  );
}
