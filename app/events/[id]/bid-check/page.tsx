import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tx } from "@/i18n/tx";
import { getLocale } from "@/i18n/server";
import Shell from "@/ui/Shell";
import BidCheckPanel from "@/ui/BidCheckPanel";
import { getSession } from "@/lib/session";
import { getPool } from "@/lib/db";
import { bidCheckScreen } from "@/bids/bidcheck";

export const metadata = { title: "Bid check | Aifexis Sourcing" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/no-access");
  const { id } = await params;
  const screen = await bidCheckScreen(getPool(), s, id);
  if (!screen) notFound();
  const locale = await getLocale();
  return (
    <Shell title={tx(locale, "Bid check")} action={<Link className="btn ghost" href={`/events/${id}`}>{tx(locale, "Back to the event")}</Link>}>
      <BidCheckPanel locale={locale} eventId={id} screen={screen} />
    </Shell>
  );
}
