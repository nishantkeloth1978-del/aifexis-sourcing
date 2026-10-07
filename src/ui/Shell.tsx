import Nav from "./Nav";

export default function Shell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><b>AIFEXIS</b><span>Sourcing</span></div>
        <Nav />
        <div className="user"><div className="avatar">N</div><div>Nishant<small>admin</small></div></div>
      </aside>
      <div className="main">
        <header className="top"><h1>{title}</h1>{action}</header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
