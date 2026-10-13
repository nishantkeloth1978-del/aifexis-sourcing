# Go-live checklist (before the first live tender)

Tick every line and keep the evidence (screenshot or query result). Items marked * need a person with access to the Supabase project and the Vercel project.

## 1. Database and access
- [ ]* Run `supabase/audit/grants_audit.sql` in the SQL Editor. Query 1 returns no rows, query 2 returns no definer functions, queries 3 and 5 return no rows, query 4 shows only tables you know have no tenant data.
- [ ]* Migrations 0001 to 0042 are applied in order (the last one run is shown in the Supabase migration history or by checking that table `bid_draft` exists).
- [ ]* `DATABASE_SSL_CA` is set in Vercel to the Supabase certificate authority (Project Settings > Database > SSL), and `/api/health` shows `"dbTls": "ca"`.
- [ ]* The `DATABASE_URL` login is not the project owner. For the supplier site it is the narrow `supplier_login` in role `app_supplier` (see the supplier portal runbook).
- [ ]* Data API: in Project Settings > API, schema `public` is not exposed, or you have confirmed query 1 above is empty.

## 2. Sign-in
- [ ]* Supabase Auth: "Confirm email" is ON, sign-ups are not open to the public except through invitation links, password minimum is 8 or more.
- [ ]* `REQUIRE_MFA=true` in Vercel and every administrator, buyer and approver has enrolled a second factor.
- [ ]* Session lifetime is set to your policy (Authentication > Sessions).
- [ ]* No test accounts exist. Run `supabase/seed/test_staff_users_remove.sql` and the supplier test removal if either seed was ever applied.

## 3. Secrets and settings in Vercel
- [ ]* `SIGNING_SECRET` is a random string of 24 or more characters (the site refuses to serve signed document links without it).
- [ ]* `MESSAGES_INBOUND_SECRET` is set and the mail provider sends it as header `x-inbound-secret` or as the password of basic authentication. It is not in the URL.
- [ ]* `RESEND_API_KEY` and `MAIL_FROM` are set; `/api/health` shows `"mail": "configured"`.
- [ ]* `PLATFORM_ADMIN_EMAILS` lists only the platform owners.
- [ ]* `ANTHROPIC_API_KEY` is set only if AI drafting and translation are wanted.
- [ ]* Region: the Vercel region and the Supabase region match your data-residency promise. `vercel.json` requests `bom1`; that alone does not make the whole system UAE-resident.

## 4. Files and recovery
- [ ] Malware scanner: `MALWARE_SCAN_URL` points to a real scanner, or the customer has accepted in writing that uploads are only type- and signature-checked.
- [ ]* Backups: point-in-time recovery is on for the database; file bytes are backed up separately (the Release 2 storage backup job). A restore has been rehearsed once and the time recorded.

## 5. Dependencies and tests
- [ ] CI is green on the commit being released (typecheck, all tests against PostgreSQL, `npm audit --audit-level=high`, build).
- [ ] One walk-through on staging with two organisations and these roles: administrator, buyer, technical evaluator, commercial evaluator, publication approver, award approver, witness, auditor, an unassigned member, a supplier. Record who could see what.

## 6. Customer facts to state plainly
- Sealed envelopes are enforced by authorisation and an audit trail, not by encryption that a database operator cannot undo.
- An independent penetration test has or has not been done (date, tester).
