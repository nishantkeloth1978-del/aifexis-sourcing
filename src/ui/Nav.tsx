"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Key, type Locale } from "@/i18n/dict";
import { tx } from "@/i18n/tx";

const ITEMS: { group: Key; links: { href: string; label: string }[] }[] = [
  { group: "navSourcing", links: [
    { href: "/", label: "navEvents" },
    { href: "/evaluations", label: "navEvaluations" },
    { href: "/awards", label: "navAwards" },
  ] },
  { group: "navMaster", links: [
    { href: "/suppliers", label: "navSuppliers" },
    { href: "/items", label: "navItems" },
  ] },
  { group: "navAdmin", links: [
    { href: "/setup", label: "Company setup" },
    { href: "/templates", label: "Templates" },
    { href: "/approvers", label: "Approvers" },
    { href: "/configuration", label: "navConfiguration" },
    { href: "/integrations", label: "navIntegrations" },
  ] },
];

export default function Nav({ locale = "en" }: { locale?: Locale }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((g) => (
        <div key={g.group}>
          <div className="group">{t(locale, g.group)}</div>
          {g.links.map((l) => (
            <Link key={l.href} href={l.href} prefetch aria-current={path === l.href ? "page" : undefined}>
              <i className="dot" /> {l.label.startsWith("nav") ? t(locale, l.label as Key) : tx(locale, l.label)}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
