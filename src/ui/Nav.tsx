"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { group: string; links: { href: string; label: string }[] }[] = [
  { group: "Sourcing", links: [
    { href: "/", label: "Events" },
    { href: "/evaluations", label: "Evaluations" },
    { href: "/awards", label: "Awards" },
  ] },
  { group: "Master data", links: [
    { href: "/suppliers", label: "Suppliers" },
    { href: "/items", label: "Items" },
  ] },
  { group: "Admin", links: [
    { href: "/configuration", label: "Configuration" },
    { href: "/integrations", label: "Integrations" },
  ] },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((g) => (
        <div key={g.group}>
          <div className="group">{g.group}</div>
          {g.links.map((l) => (
            <Link key={l.href} href={l.href} prefetch aria-current={path === l.href ? "page" : undefined}>
              <i className="dot" /> {l.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
