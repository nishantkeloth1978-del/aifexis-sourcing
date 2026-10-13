# Implementation progress (end of unattended run)

## Delivered in this run (all tested; 311 tests pass, production build OK)

| Block | What | Migration |
|---|---|---|
| R2.2 | Evaluator conflict declarations, moderation gap, score-change reasons and approval (company setting) | 0030 |
| R2.3 | Evaluation assumptions (freight, duty, warranty, % uplift) in the commercial comparison; recommendation blocked until complete | 0031 |
| R2.1 | Event workspace: next-step card and checklist, tabs, autosave, inline line edit, bulk delete, activity feed, shortcuts | none |
| R3 (part) | Import quality: SAP-style headers, detail columns, heading rows, unmapped-column report, append/merge/replace; CSV export of lines | none |
| R3 (part) | Quote validity with per-supplier extensions; feedback to unsuccessful bidders | 0032 |
| R3 (part) | Event record export (JSON) | none |
| R4 (safe) | Published limits document with a test that keeps it true; public status page | none |

## Not done (honest list)

- Volume-tier pricing, bundles, alternate offers in the ranking (alternates planned as information only).
- Hierarchical BOQ with sub-totals, anonymous evaluation, evaluator reassignment, approval simulation, policy-approval step for company templates.
- Synchronised closing clock / local time display, supplier recovery check, carry-forward of prices in a final round.
- Larger uploads (needs object storage), five more templates (25 to 30), refresh-from-template with diff.
- Mobile and accessibility pass, contextual help.
- R4 items that need your input: SAP / ME5A sample file, scanner choice (ClamAV or vendor API), production hardening accounts.

## To apply

Run migrations 0026 to 0032 (those not yet run) in the Supabase SQL editor, adopt template v2 in Templates, and set ANTHROPIC_API_KEY in Vercel.

## Blocks A–D (October 2026)

Migrations to run, in order: 0033 (cancel and reassign), 0034 (BOQ sections), 0035 (template approval), 0036 (five more templates).

- Block A: event cancellation after submission, evaluator reassignment, anonymous evaluation, closing clock with server-time sync.
- Block B: hierarchical BOQ with sub-totals, volume price breaks, bundle discounts, alternate offers shown in the ranking.
- Block C: refresh-from-template with a diff, approval simulation on the Approvers page, optional second-administrator approval for company templates, five more templates (25 to 30).
- Block D: bidder "Check my submission" against the receipt code, final-round price carry-forward with "was X" markers, help tips, skip link, touch-size and small-screen styles.

Tests: 346 passing. Type-check and production build clean.

## Event messaging, releases M1+M2 (October 2026)
362 tests pass, production build OK. Migration **0037_messages.sql** (run it in the Supabase SQL Editor).

- Three lanes in each event: Q&A board (anonymised publication with editable preview), one private thread per supplier, one-way notices with acknowledgement counts.
- Phase rules: open, closed (buyer-started clarification requests with a dated response deadline, max 60 days), awarded, cancelled.
- Question deadline and last-answer date; questions anchored to a line; confidential questions with a reason (buyer can reclassify).
- Assignment with due time, internal notes, duplicate merge, equal-treatment guard (advisory, reason stored).
- Attachments (up to 3 files, 4 MB, stored in the database), hash-chained immutable messages, read/acknowledgement receipts, auditor reads logged.
- Evaluators see the published board and notices only. Polling every 20 seconds. Email alerts only. Existing clarifications migrate into board threads.
- Arabic strings are my own translation and need native review.
- M3 followed (below).
- The old clarifications service and UI files remain in the repo but are unused.

## Event messaging, release M3 (October 2026)
373 tests pass, production build OK. Migration **0038_messages_m3.sql** (run it after 0037).

- **Reply by e-mail:** notification e-mails for a buyer message carry the message text and a Reply-To address `reply+<token>@<MESSAGES_REPLY_DOMAIN>`. The mail provider posts each reply to `/api/messages/inbound` (secret in `MESSAGES_INBOUND_SECRET`, sent as header `x-inbound-secret` or `?key=`). Quoted history and signatures are stripped; the sender must match the supplier user; duplicates within 15 minutes are ignored; a reply the rules refuse (for example after the deadline) is bounced back by e-mail. Accepts the Postmark inbound JSON and a plain `{to, from, text, attachments}` shape. Supplier replies only; the buyer replies in the app.
- **AI draft answer:** "Suggest a draft answer" on a board question. Built from event lines and earlier published answers, never names a bidder, saves nothing. Needs `ANTHROPIC_API_KEY` (already used by template drafting).
- **Translation with the original:** a Translate button appears under text in the other script (Arabic/English). The original stays on screen; translations are cached. Visibility follows the same rules as reading the message.
- **Response-time report:** "Response times" tab for the buyer team and auditor: typical time to answer, longest wait, overdue, answered after the last answer date, threads waiting for the buyer, clarification requests open/overdue, notice acknowledgement rate.
- **Scope change:** publishing an answer marked "changes the requirement" also posts an amendment notice (bidders must acknowledge), linked to the question and audited. Closing time is not moved automatically.
- Setup: add `MESSAGES_REPLY_DOMAIN` and `MESSAGES_INBOUND_SECRET` in Vercel, point the provider's inbound webhook at `https://<site>/api/messages/inbound?key=<secret>`. Without them the feature is simply off.
- Still open: malware scanner, native Arabic review, Release 4 items.

## Live clock on open events (October 2026)
376 tests pass, production build OK. No migration.
- A live "time left" for every open (published) event: large badge on the buyer event page and on the supplier bid page, compact countdown in the buyer event list and the supplier invitation list.
- Colour steps: green over 24 hours, amber under 24 hours, red and pulsing under 1 hour (still for reduced-motion), grey "Closed" at zero. The page refreshes itself when the clock reaches zero.
- One shared, server-synchronised clock for all countdowns on a page (one sync every 5 minutes, one tick a second). The server alone decides when bidding closes.

## Block A: supplier portal hardening (October 2026)
Migration **0039_supplier_role.sql**. Runbook: `docs/OPERATIONS_RUNBOOK_SUPPLIER_PORTAL.md`.
- New database role `app_supplier`: reads and writes only what a supplier's pages need. Column-limited access to the event row (no budget, approval settings or frozen evaluation configuration), staff identity limited to id and e-mail, no access to scores, approvals, templates, configuration, audit trail or catalogue. The recommendation is reduced to "did I win" through a narrow function.
- `DB_RUNTIME_ROLE=app_supplier` makes a deployment run entirely under that role. Tests run every supplier action (bids, files, messages, reply-by-email, translation, listings) under it, and prove it is refused on 25+ buyer-side tables and on writes to buyer data.
- `PORTAL=supplier|buyer` splits one codebase into two sites: the supplier site answers 404 for every buyer page; the buyer site answers 404 for supplier pages and invitation links. Extra response headers on the supplier site (no caching, no indexing, same-origin opener).
- `NEXT_PUBLIC_SUPPLIER_URL` and `SUPPLIER_APP_URL` point invitation links and supplier e-mails at the supplier site.
- Not done: independent penetration test (still recommended before a full launch).

## Block B: organisation onboarding and user management (October 2026)
Migration **0040_users_onboarding.sql**. 396 tests pass, production build OK.
- **Platform console** (`/platform`): visible only to people whose verified e-mail is in the deployment variable `PLATFORM_ADMIN_EMAILS` (comma separated; set in Vercel only). Create an organisation with its first administrator (a join link is shown once), re-invite an administrator, suspend or reactivate an organisation. Platform owners see counts only, never events or bids.
- **Users page** (`/users`, administrators only): invite by e-mail (link also shown once to copy), pending invitations with cancel, change role, job title and department, switch a person off or on. The organisation always keeps one administrator; nobody can switch off themselves. Switched-off people and suspended organisations cannot sign in; history stays in the record.
- **Join link** (`/join/<token>`): create account or sign in; the e-mail must match the invitation; links expire after 14 days and work once. Only a hash of the token is stored.
- The supplier site (`PORTAL=supplier`) answers 404 for `/join`, `/users`, `/platform`. The `app_supplier` role cannot read invitations or run platform functions.
- **First organisation**: set `PLATFORM_ADMIN_EMAILS` in Vercel, redeploy, sign in with that e-mail, open `/platform`.

## Release 1, part 1: security and correctness (October 2026)
Source: the 13 October review and `Aifexis Enhancement Plan`. Migrations **0041_close_api_grants.sql**, **0042_bid_draft.sql**. 414 tests pass, build OK.
- **R1-0 Grants audit:** `supabase/audit/grants_audit.sql` (read-only, five queries) for the live Supabase project.
- **R1-4 Database boundary (SEC-04/05/06):** migration 0041 revokes every privilege of `anon` and `authenticated` on tables, sequences and functions in `public` (and in default privileges), closes the four definer functions that PUBLIC could run, and turns on row level security for `reply_token`. Tests imitate Supabase's default grants and prove nothing is left. TLS: set `DATABASE_SSL_CA` (PEM text from Supabase) to verify the certificate; `/api/health` reports `dbTls` (`ca`, `system` or `unverified`). Default stays unverified until you set it, so nothing breaks on deploy.
- **R1-5 Small hardening:** inbound mail no longer accepts the secret in the URL (header `x-inbound-secret` or basic-auth password), 25 MB cap before parsing; production refuses to sign document links without a `SIGNING_SECRET` of 24+ characters; test seed scripts carry a "never in production" banner; `docs/GO_LIVE_CHECKLIST.md`.
- **R1-6 Dependencies:** Vitest 5, Vite 7, PostCSS and uuid overrides; `npm audit` reports 0 findings.
- **R1-7 Correctness:** supplier bid totals now follow price-break edits (shared `lineAmount`, with a test); lot rankings state that evaluation assumptions are not applied to lots; supplier **drafts** saved on the server 1.5 s after each change, restored on the next visit, removed on submit, with "Draft saved at" and "Discard draft"; the Users page says plainly when e-mail is not set up and nothing was sent; `/api/health` shows `mail`.
- **R1-8 Test harness:** tests stop with one clear message when PostgreSQL is missing (`SKIP_DB_TESTS=1` to override); GitHub Actions workflow runs typecheck, all tests against PostgreSQL, audit and build on every push.
- **Next (part 2):** R1-1 one permission layer with draft ownership and configurable roles (Block C), R1-2 step-up and MFA guard, R1-3 two-person decisions.

## Release 1, part 2: permissions, step-up and two-person decisions (October 2026)

Migrations to run in order: **0043** (grant sweep, if not yet run), **0044** (organisation roles), **0045** (decision requests). Each ends with `select close_api_grants();`.

- **One permission layer (R1-1, SEC-01, Block C).** Every service checks `can(who, permission)` from `src/access/permissions.ts`. Administrators edit what the built-in roles may do and create their own roles on the new **Roles and permissions** screen; a custom role is based on member or integration admin, which decides data-class access. User and role management stay administrator-only and cannot be granted. Role changes are audited. Event roles (buyer, evaluators, approvers, witness, auditor) and sealed-envelope rules are unchanged.
- **Draft visibility changed.** A member sees only events they created or sit on, and edits only their own drafts, unless their role has "See every event" / "Edit any draft". Target prices and budgets are hidden from technical evaluators and witnesses. Check this default when you review the roles of the pilot organisation.
- **MFA guard and step-up (R1-2, SEC-03).** With `REQUIRE_MFA=true` every page and action requires an assurance-level-2 session. Opening envelopes, confirming a witness or approver request, cancelling an event, starting a final round, awarding, role assignment and platform actions need a second factor confirmed in the last 10 minutes; the person is sent to `/mfa` and returned to where they were.
- **Two-person decisions (R1-3, SEC-02, F-06).** Opening the technical or commercial envelopes, cancelling an event, starting a final round and reopening for an amendment now need the named witness or award approver to sign in and confirm. Flow: the buyer chooses the person and clicks "Ask ... to confirm" (a `decision_request`, valid for 24 hours); the other person sees it under **Confirmations** and confirms or declines with step-up; the buyer then runs the step. The confirmation is enforced inside the authorization core: it is bound to the event, its exact state version, the command and a hash of the content (witness, cancellation wording, final-round shortlist and closing time), is used once, and cannot be given by the requester. Knowing a witness's ID is no longer sufficient. Routine publication, technical and award approvals are unchanged.
- **Deferred.** Per-organisation overrides of the event-role access matrix; the approver simulator beyond the person check; invitations still start with the base role and an administrator then assigns a custom role.
- **Tests.** 440 pass (new: permissions 13, assurance 4, decisions 6). Existing tests use `tests/helpers/confirmed.ts`, which performs the request and confirmation the way two people do.

Gate to leave Release 1 still open: CI green on the merged branch, grants audit reviewed, staging walk-through with two organisations and several roles (including a witness confirming on a second device).

## Parked: reply-by-email (October 2026)
Deferred by the owner; revisit later. Already done: `MESSAGES_INBOUND_SECRET` set in Vercel; MX record `reply.aifexis.com` -> `inbound.postmarkapp.com` (priority 10) added in Vercel DNS and verified. Still to do when resumed: set `MESSAGES_REPLY_DOMAIN=reply.aifexis.com` in Vercel, create a Postmark Server and its inbound webhook `https://inbound:<secret>@<buyer-site>/api/messages/inbound`, redeploy, test with a supplier reply. Alternative providers (Mailgun, SendGrid) need a small form adapter. Until then suppliers reply inside the app.

## Roles screen redesign (October 2026)
Roles and permissions now shows one card per role (permission count, people, areas) with a side panel to edit. Changes are made in the panel and saved once ("Save changes"), instead of saving each tick. "New role" opens the same panel with name, description and "Behaves like". Delete is in the panel for custom roles without people. Escape closes the panel; works in Arabic (RTL). No migration.

## Release 2, part 1: My actions home and event workspace (October 2026)
No migration. 444 tests pass, build clean.
- **My actions** replaces the old task box on the Events home: *Needs you now* (existing event tasks, plus confirmations asked of you, plus "X confirmed, you can go ahead" for your own requests), *Waiting on others* (your open confirmation requests; events waiting for publication approval, technical evaluation or award approval), and *Closing in the next 7 days* (events you buy or request). Each line links to where the work is; confirmations go to the Confirmations inbox. An empty state says you are all caught up.
- **Menu badge:** Confirmations shows how many requests are waiting for you.
- **Event workspace:** the Next step card now has a "Go there" button that opens the tab where the step is done (overview, items, team, documents, evaluation), and when the step belongs to someone else it names them ("Waiting for: ...") or says nobody is assigned to that role yet.
- Tests: `tests/actions-home.test.ts`. Arabic added.
- Next in Release 2: server-side pagination, bid comparison and supplier workspace, malware scanning, nonce CSP, fail-closed rate limiter, storage backup runbook, accessibility pass.
