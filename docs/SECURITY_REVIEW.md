# Aifexis Sourcing: security review v0.1 (self-review, not an external audit)

## In place
- Tenant isolation: Postgres row-level security on every business table, forced; the app runs each request as `app_runtime` with the tenant set per transaction. Tested with 1,000 interleaved requests from two tenants.
- Central authorization for bid data (envelope sealing, data classes D1 to D19), separation of duties enforced in the database and in the service.
- Bids are immutable (database triggers); the audit trail is immutable.
- Supplier invitation tokens are stored only as a hash; links expire after 14 days.
- Files: type checked by extension and file signature, 4 MB limit, downloads only through an authorised route.
- CSV exports guard against formula injection.
- Scheduled endpoint requires `CRON_SECRET` (constant-time comparison); without it the endpoint does not exist.
- Security headers on every response: CSP, frame denial, nosniff, referrer policy, permissions policy, HSTS.
- `/api/health` returns no secrets; reports database reachability.

## Known gaps (to close before real tenders)
1. Files live in the database. Move to private object storage with signed URLs and malware scanning.
2. No rate limiting on sign-in or invitation links beyond Supabase's own limits. Add edge rate limiting.
3. No multi-factor authentication for staff. Enable it in Supabase Auth.
4. Backups: rely on Supabase plan backups. Confirm point-in-time recovery and test a restore.
5. Dependencies: `npm audit` reports postcss (build-time, via Next.js) and uuid (via exceljs; the vulnerable code path is not used). Update Next.js and exceljs when fixes ship.
6. The CSP allows inline scripts and styles because Next.js needs them; moving to nonces is a later hardening step.
7. No independent penetration test or load test yet.
8. Staff screens are not yet translated to Arabic.
