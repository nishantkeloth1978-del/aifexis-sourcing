# Aifexis Sourcing: security review v0.2 (self-review, not an external audit)

Builds on v0.1. Changes since then:

## Closed
- Files: moved to private object storage (Supabase Storage) when the service key is set; built-in upload screening (executables, macros, EICAR, scripts in archives, PDF JavaScript). External antivirus is deferred (see Backlog_Malware_Scanner_v0_1).
- Rate limiting: sign-in (per address and per email), invitation pages, bids, uploads, handover, exports and downloads. Postgres-backed, works across serverless instances, fails open if the database errors. Tested.
- Multi-factor authentication: authenticator-app (TOTP) for staff, enforced by `REQUIRE_MFA=true` after everyone has enrolled.
- Backups: runbook with a restore drill and a go-live checklist (`docs/RUNBOOK.md`). The drill itself still has to be performed and logged by the operator.
- Staff screens are translated to Arabic.

## Still open
1. Point-in-time recovery and the first restore drill: operator action in Supabase.
2. Edge/volumetric protection: add Vercel Firewall rules; the app-level limiter does not replace this.
3. Dependencies: `npm audit` shows postcss (build-time, via Next.js) and uuid (via exceljs; vulnerable path unused). Update when fixes ship.
4. CSP allows inline scripts and styles (Next.js); move to nonces later.
5. No independent penetration test. Load-test script exists (`scripts/loadtest.mjs`) but has not been run at scale.
6. Real malware scanning is deferred.
7. MFA recovery codes are not offered by Supabase TOTP: keep two admins enrolled.
