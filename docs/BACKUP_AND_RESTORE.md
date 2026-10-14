# Backup and restore

What holds data: (1) the Supabase Postgres database (events, bids, audit, roles, and file bytes when `FILE_STORAGE=db`); (2) the private Supabase Storage bucket `aifexis-files` (override with `STORAGE_BUCKET`) when files are stored there. Code lives in Git; secrets live in Vercel.

## Database
- Supabase Pro: enable daily backups and Point-in-Time Recovery (Project settings > Database > Backups). Free plan has no PITR; use the manual dump below.
- Manual dump (PowerShell, from a machine with `pg_dump` 16): get the connection string from Supabase (Connect > Session pooler) and keep it only in your shell:
  `$env:PGPASSWORD = Read-Host "DB password"`
  `pg_dump -h <host> -p 5432 -U postgres -d postgres -Fc -f aifexis-$(Get-Date -f yyyyMMdd).dump`
- Store dumps encrypted, in a different place from the project (not in the repo). Keep 30 daily and 12 monthly.

## Files (Storage bucket)
- Supabase backups do NOT include Storage objects. Copy the bucket regularly: use `supabase storage cp -r ss:///aifexis-files ./files-backup --experimental` or an S3-compatible sync using the project's S3 credentials (Project settings > Storage).
- Object keys are referenced by the `file` table; a database restore without the matching objects leaves broken downloads, so back up both on the same schedule.
- With `FILE_STORAGE=db` the bytes are inside the database dump; nothing extra is needed.

## Restore drill (do quarterly, and before go-live)
1. Create a scratch Supabase project (never restore over production to test).
2. `pg_restore --no-owner -d <scratch-connection> aifexis-YYYYMMDD.dump`
3. Run `select close_api_grants();` and the grants audit queries; confirm roles `app_runtime` and `app_supplier` exist.
4. Upload the files backup into a bucket of the same name; point a preview deployment at the scratch project.
5. Check: sign in, open an event, download a document, `/api/health` returns ok, audit chain verifies.
6. Record date, backup used, time taken and problems in the operations log. Target: restore in under 4 hours, at most 24 hours of data lost (1 hour with PITR).

## Real incident
Stop writes first (set Vercel maintenance or pause the project), restore to a new project, verify as above, then switch `DATABASE_URL`, Supabase keys and `NEXT_PUBLIC_SUPABASE_URL` in Vercel and redeploy. Rotate secrets if exposure is suspected.
