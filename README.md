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

## More people
Publishing needs two people (the buyer who submits cannot be the approver). Create the second login in Supabase Authentication, then run `supabase/seed/add_member.sql` with their email. An administrator then assigns event roles on the event page.

## Vercel
Import the repository. Environment variables: `DATABASE_URL` (Supabase pooled string), `SIGNING_SECRET` (long random string for signed URLs). No other setup.

## Known simplifications
- Thresholds, weights, approval counts are the assumed values from the scenarios (decisions D-07 to D-22 are unconfirmed).
- No authentication yet; actors are passed in by the caller. Wiring Supabase Auth to `Actor` is the next step.
- Storage, search and AI paths are modelled as data-layer functions (`searchDerived`, `retrieveContext`, `signedUrl`), not connected to real services.
- Publication-approval threshold inconsistency (100,000 vs 250,000) is unresolved (D-19).
- The Supabase-specific behaviour (pooler, grants) is untested until you run the migrations there.

## Suppliers (stage: supplier onboarding)
Run `supabase/migrations/0006_suppliers_invites.sql` in the Supabase SQL Editor. Then: Suppliers page -> add a supplier; open a published event -> Suppliers card -> Invite -> copy the link (shown once) and send it to the supplier. The supplier opens the link, creates a password, and lands in `/supplier`.
Tip for pilots: in Supabase > Authentication > Sign In / Providers > Email, turn off "Confirm email" so suppliers are signed in straight after creating a password.

## Commercial stage
Run `supabase/migrations/0007_recommendation.sql` in the Supabase SQL Editor. Flow: close bidding -> open technical envelopes (witness) -> score -> approve technical -> open commercial envelopes (witness) -> ranking -> recommendation -> award approval.

## Configuration and clarifications
Run `supabase/migrations/0008_clarifications.sql` in the Supabase SQL Editor. Configuration needs no migration (it uses the existing `tenant_config` table).

## Documents
Run `supabase/migrations/0009_files.sql`. Files (up to 4 MB each) are stored in the database for now; moving them to Supabase Storage later only changes `src/files/service.ts`.

## Notifications and award pack
Run `supabase/migrations/0010_notifications.sql`. The award pack is at `/events/<id>/pack` (print or save as PDF).

## Power pack
Run `supabase/migrations/0011_templates.sql`. Adds event templates, supplier Excel price sheets, bid receipts with a fingerprint, and mandatory declarations (Configuration page).

## Automation and Arabic
Run `supabase/migrations/0012_automation.sql`. In Vercel set `CRON_SECRET` (any long random string). Optional for real e-mail: `RESEND_API_KEY` and `MAIL_FROM`; without them e-mails are only logged. Optional `APP_URL` for the link in e-mails.
`/api/cron/tick` (daily via `vercel.json`) auto-closes events past their closing time, sends one reminder per supplier 24 hours before closing, and sends queued e-mails. Hobby plans allow one run a day; call the URL more often from any scheduler with the header `Authorization: Bearer <CRON_SECRET>`.
Language switch (English / Arabic with right-to-left) is on the supplier portal and the staff header.

## Evaluation depth and handover
Run `supabase/migrations/0013_handover.sql`. Configuration now has per-criterion weights and "No disqualifies" on declarations. Integrations page: send an awarded event to SAP or Ariba in test mode (a reference is recorded, nothing is sent) and download the payload.

## Approval rules, reports, security
No migration. Configuration > Approval rules: events below an AED amount publish without a separate approver; value tiers set how many award approvals are needed. Events have an "Estimated value (AED)" field. Evaluations and Awards pages are live (Awards shows saving against the estimate). See `docs/SECURITY_REVIEW.md`.
If a page breaks after deploy because of the new Content-Security-Policy, tell me which page and what the browser console says.

## Arabic for staff screens
No migration. The language switch now also translates the events list, event workspace (details, team, items), progress stepper, task list, Evaluations, Awards and Notifications. Still English in staff screens: evaluation and commercial panels, configuration, suppliers, invitations, file panels, and server messages (errors, task text, notification text).

## Arabic everywhere
Every staff and supplier screen and the server messages are now translated (English text is the key: `tx(locale, "English")` in `src/i18n`). A test fails if a new message or label has no Arabic entry.

## Storage and screening pack
- Run `supabase/migrations/0014_storage.sql` in the Supabase SQL Editor.
- Files stay in the database until `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel. After that, new uploads go to a private Supabase Storage bucket (`STORAGE_BUCKET`, default `aifexis-files`). Existing files stay where they are and keep working.
- Every upload is screened (EICAR, executables, macros, scripts inside archives, PDF JavaScript). This is NOT a full antivirus.
- For real scanning set `MALWARE_SCAN_URL` (and optionally `MALWARE_SCAN_TOKEN`). The app POSTs the bytes and expects `{"clean":true|false}`. If the scanner fails, the upload is refused.
- The 4 MB limit stays.

## Lots and split awards
- Run `supabase/migrations/0015_lots.sql` in the Supabase SQL Editor (before using the new build).
- Lots are optional. Add them in a draft event (or fill the "Lot" column when importing items); once any lot exists, every item must be in a lot and every lot must have an item before the event can be submitted.
- Suppliers price a whole lot or none of it, and at least one lot. Technical evaluation and gates stay at event level; commercial ranking is per lot (qualified bidders who priced that lot).
- The recommendation picks one supplier per lot with one shared reason. After a send-back the buyer may revise it (RecordRecommendation is now also allowed from "recommended").
- Award approval is one decision on the whole set. Handover creates one document per winning supplier (a supplier who wins several lots gets one). The awards report sums the lots and shows a saving only when every lot is awarded.
- Events without lots behave exactly as before. Design notes: `docs/LOTS_DESIGN.md`.
- The external malware scanner is skipped: leave `MALWARE_SCAN_URL` and `MALWARE_SCAN_TOKEN` unset in Vercel.

## Production hardening pack
- Run `supabase/migrations/0016_hardening.sql` in the Supabase SQL Editor.
- Rate limiting is built in (sign-in, invitation links, bids, uploads, handover, exports, downloads). Limits and how to clear a lockout: `docs/RUNBOOK.md`.
- Two-step sign-in for staff: each person sets it up under Security (side menu). Set `REQUIRE_MFA=true` in Vercel only after everyone has done so. Suppliers are not affected.
- `docs/RUNBOOK.md` has the settings table, backup and restore drill, incident basics and a go-live checklist.
- `node scripts/loadtest.mjs <url>` runs a simple load test (see the header of the file).

## Supplier and item master pack
- Run `supabase/migrations/0017_masters.sql` in the Supabase SQL Editor.
- Suppliers: open a supplier to edit its profile (vendor code, country, category, phone, tax number, notes), block or unblock it, and see its event history (bids and wins). A blocked supplier cannot be invited to new events; existing invitations and bids are unaffected. Suppliers can be imported from Excel/CSV (template on the page); duplicates are skipped and reported.
- Items (side menu > Items): a catalogue of codes with description, unit and category. Add, edit, deactivate, or import from Excel/CSV (an existing code is updated).
- Events: the add-item form offers catalogue codes (typing a code fills description and unit). The items import accepts a Code column; with a code and no description or unit they are filled from the catalogue. Codes survive duplicate and template copies.
- Handover: the payload now carries `vendor.vendorCode` and each line's `materialCode` when held (schema stays `aifexis.award.v1`; both fields are optional).

## Industry templates (Stage 1)

Run in the Supabase SQL Editor, in order: `supabase/migrations/0018_templates.sql`, then `0019_template_seed.sql`.
Screens: `/setup` (industry, categories, locale, policies), `/templates` (library, enable), `/events/new` (event from a template), template inputs panel on the event, supplier questionnaire on the bid form.
Packs shipped: General RFI/RFQ/RFP, AV and security systems, Catering. Content lives in `src/templates/packs`; after changing it run `npx vite-node scripts/gen-template-seed.ts` to regenerate `0019`. Design notes: `docs/TEMPLATES_DESIGN.md`.

### Stage 2 packs
Run `supabase/migrations/0020_template_packs_2.sql` after 0019. Adds packs for construction, staffing, facilities, manufacturing, oil and gas, logistics, healthcare and IT (15 templates, 3 purchase categories). Stage 1 content (0019) stays frozen; new content goes in new generated files.

### Required documents
Run `supabase/migrations/0021_document_keys.sql`. Suppliers upload each requested document into its own slot; a bid cannot be submitted while a required document (or one required by company policy) has no file, and a plain attachment does not count.

### Versions, rollback, customisation, zero price
No new migration. `/templates` shows updates (what changed, adopt per template), configuration history with restore (a restore is a new version), and a Customise page per template (wording, mandatory/optional, remove, add a question, JSON download). Customisations apply to new events after "Apply". Optional template lines may be priced 0 ("included in another price"); every other line still needs a price above zero.

### Company templates, time zone, profile impact
Run `supabase/migrations/0022_company_templates.sql`. Admins can copy a platform template or import JSON on `/templates` ("Your own templates"); company templates (`CO_` keys) are private to the company, versioned and immutable, checked like platform ones, and used like any other template. Suppliers see the closing time in the company's time zone. After saving the company profile, the setup page shows newly recommended templates without changing what is enabled.

## Visual editor and Excel (templates)

`/templates/editor` (admin): edit a company template visually — tabs for Fields, Questions, Documents, Pricing and Evaluation; drag items (or use the up/down buttons) to reorder; **Check** shows every problem; **Save as new version** publishes a new immutable version. **Download as Excel** / **Upload Excel** round-trips the whole template through a workbook; uploads show a preview with sheet and row for each problem before anything is saved. Platform templates open as "Copy and edit" (saved under a new `CO_` key). No new migration.
