# Aifexis Sourcing: operations runbook v0.1

## Settings (Vercel > Settings > Environment Variables)
| Name | Purpose |
|---|---|
| DATABASE_URL | Supabase connection string (pooler). Never share it. |
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase Auth. |
| CRON_SECRET | Protects the scheduled endpoint. |
| RESEND_API_KEY | Email (optional). |
| SUPABASE_SERVICE_ROLE_KEY | Private file storage (optional). |
| REQUIRE_MFA | Set to `true` to force two-step sign-in for all staff. Suppliers are not affected. |

## Two-step sign-in (staff)
1. Supabase > Authentication > Multi-Factor: confirm TOTP is enabled.
2. Every staff member opens **Security** (bottom of the side menu) and sets up an authenticator app.
3. Only when everyone has done it, set `REQUIRE_MFA=true` in Vercel and redeploy. Anyone without it is sent to the setup page.
4. Lost phone: in Supabase > Authentication > Users, open the user and remove their factor; they set it up again.
5. Keep at least two admins with it set up, so one lost phone never locks out the tenant.

## Rate limits (built in, no setup)
Sign-in: 20 per 10 min per address and 8 per 10 min per email. Invitation pages: 30 per 10 min per address. Bids 30/min, uploads 20/min, handover 30/min, exports 30/min, downloads 120/min per person. Counters are in the `rate_limit` table (old rows clean themselves). To clear someone who is locked out: `delete from rate_limit where bucket like 'login:email:name@company.com';` in the SQL Editor.
For volumetric attacks add Vercel Firewall rules (Vercel > Firewall); that sits in front of this and costs the app nothing.

## Backups and restore drill (do this once before the first real tender, then every quarter)
1. Supabase > Project Settings > Add-ons: confirm **Point in Time Recovery** is on (needs a paid plan). Without it you only have the daily backup.
2. Supabase > Database > Backups: note the latest backup time. That is the most you can lose.
3. Drill: create a scratch Supabase project, then restore the latest backup into it (Backups > Restore to a new project, or `pg_dump` the live database and `psql` it into the scratch one).
4. In the scratch project check: `select count(*) from sourcing_event;` and `select count(*) from bid_revision;` match the live numbers (within the backup gap), and sign in to a copy of the app pointed at it.
5. Write the date, the time it took and any problem in the log below. Delete the scratch project.
Targets until you decide otherwise: lose at most 24 hours (daily backup) or minutes (PITR); restore within 4 hours.

| Date | Who | Backup used | Minutes to restore | Result |
|---|---|---|---|---|

## Incident basics
- **Site down**: open `/api/health`. `db: down` means check Supabase status and the DATABASE_URL; otherwise check the last Vercel deployment and roll back (Vercel > Deployments > Promote the previous one).
- **Suspected leaked secret**: rotate it at its source (Supabase, Resend), update Vercel, redeploy. For a leaked DATABASE_URL rotate the database password first.
- **Wrong award or bad data**: bids, recommendations and the audit trail are immutable by design. Correct by a send-back and a new recommendation, never by editing rows.
- **Deploy broke a page**: Vercel > Deployments > Promote the previous deployment. Database migrations are additive; they do not need to be undone.

## Before go-live checklist
- [ ] PITR on and restore drill done
- [ ] TOTP set up for every staff user, `REQUIRE_MFA=true`
- [ ] Two or more admins per tenant
- [ ] `npm audit` reviewed after the last dependency update
- [ ] Load test run against production hours (`node scripts/loadtest.mjs <url>`), p95 under 1000 ms
- [ ] Penetration test booked (external)
- [ ] `MALWARE_SCAN_URL` unset or pointing at a working scanner
