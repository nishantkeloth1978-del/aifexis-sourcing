# Running the supplier portal as a separate site (optional hardening)

The same code can run as two Vercel projects: the buyer site and a supplier site. Nothing changes until you set these.

## 1. Database (once, Supabase SQL Editor)
Run migration `0039_supplier_role.sql`. It creates the narrow role `app_supplier`. Then create a login for it. Choose the password yourself and keep it only in Vercel and your password manager:

    create role supplier_login login password '<choose-a-strong-password>' in role app_supplier;
    grant app_supplier to postgres;   -- only if your admin login must switch to it for tests

Use the pooler connection string with the user `supplier_login.<project-ref>` for the supplier site.

## 2. Supplier site (a second Vercel project from the same repository)
Environment variables for that project:
- `PORTAL=supplier`
- `DB_RUNTIME_ROLE=app_supplier`
- `DATABASE_URL` = the connection string for `supplier_login`
- the same Supabase URL and anon key as the buyer site
- `NEXT_PUBLIC_*` values as on the buyer site
Do not set the service-role key, `CRON_SECRET`, `ANTHROPIC_API_KEY` for staff tools you do not need there, or any buyer-only secrets. (Translation of messages needs `ANTHROPIC_API_KEY` if you want it on the supplier site.)
Give it its own domain, for example `suppliers.yourdomain.com`.

## 3. Buyer site
Set `PORTAL=buyer`. The supplier pages and invitation links then answer 404 there. Update the invitation e-mail links to use the supplier domain (`APP_URL` for the supplier project).

## 4. Check
- `https://suppliers.<domain>/events` must answer 404; `https://<buyer-domain>/supplier` must answer 404.
- A supplier signs in on the supplier site, opens an event and submits a bid.
