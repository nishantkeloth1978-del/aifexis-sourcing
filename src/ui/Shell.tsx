import Nav from "./Nav";
import { getSession } from "@/lib/session";
import { signOut } from "../../app/login/actions";

export default async function Shell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const s = await getSession();
  const name = s ? (s.email.split("@")[0] ?? "") : "";
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><b>AIFEXIS</b><span>{s?.tenantName ?? "Sourcing"}</span></div>
        <Nav />
        <div className="user">
          <div className="avatar">{name.charAt(0).toUpperCase()}</div>
          <div>{name}<small>{s?.role}</small>
            <form action={signOut}><button className="signout" type="submit">Sign out</button></form>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top"><h1>{title}</h1>{action}</header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
