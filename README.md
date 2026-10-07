# Aifexis Sourcing: Stage 0 foundation

What this is: the technical core of the design (schema, tenant isolation, central authorization service, calculation engine) with automated tests. There are no product screens yet.

## What the tests prove (85 tests)
- `tests/engine.test.ts`: calculation engine, vectors TV1 to TV10 from `tests/fixtures/calc_test_vectors_v0_1.json`, plus property tests (exact decimals, round half up once per block, INCOMPLETE reason codes).
- `tests/db.test.ts`: tenant isolation by RLS, transaction-local tenant setting under pooled connections (1,000 interleaved requests), immutability triggers, derived-class trigger, separation of duties.
- `tests/authz.test.ts`: access checks A1 to A20 (envelope visibility, search/export/AI retrieval/signed URL, concurrency and idempotency, break-glass), mutation checks (removing a rule makes a test fail), full lifecycle run.

## Run locally
Needs Node 20+ and a local PostgreSQL 16 where you can create databases.

    npm install
    ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
    npm run typecheck
    npm run dev    # http://localhost:3000, health at /api/health

The test setup creates and drops a database called `aifexis_test` from `supabase/migrations`.

## Supabase
1. Create the project, then apply `supabase/migrations/0001_core_schema.sql` and `0002_rls_and_roles.sql` in order (SQL editor or `supabase db push`).
2. The migrations create role `app_runtime` (nologin). The application connects with your database user and runs each request as
   `begin; set local role app_runtime; select set_config('app.tenant_id', '<uuid>', true); ... commit;` (see `src/authz/tenant.ts`).
   The connecting user must be allowed to `set role app_runtime`: run `grant app_runtime to postgres;` (or your chosen login role).
3. Use the pooled connection string (transaction mode is fine because tenant setting is transaction-local).

## Login (Supabase Auth)
1. Apply `supabase/migrations/0003_auth_link.sql` (SQL editor).
2. In Supabase: Authentication > Users > Add user (email and password, tick Auto Confirm User).
3. Edit and run `supabase/seed/bootstrap_first_tenant.sql` once. It creates your tenant and an admin membership for your email.
4. Vercel environment variables: `NEXT_PUBLIC_SUPABASE_URL` (Project Settings > API > Project URL) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon / publishable key; it is designed to be public). Redeploy.
5. Open the site. You are sent to /login. After signing in, the sidebar shows your tenant, name and role.
Tenant and role come only from our own tables (`resolve_login`), never from the browser.

## Vercel
Import the repository. Environment variables: `DATABASE_URL` (Supabase pooled string), `SIGNING_SECRET` (long random string for signed URLs). No other setup.

## Known simplifications
- Thresholds, weights, approval counts are the assumed values from the scenarios (decisions D-07 to D-22 are unconfirmed).
- No authentication yet; actors are passed in by the caller. Wiring Supabase Auth to `Actor` is the next step.
- Storage, search and AI paths are modelled as data-layer functions (`searchDerived`, `retrieveContext`, `signedUrl`), not connected to real services.
- Publication-approval threshold inconsistency (100,000 vs 250,000) is unresolved (D-19).
- The Supabase-specific behaviour (pooler, grants) is untested until you run the migrations there.
