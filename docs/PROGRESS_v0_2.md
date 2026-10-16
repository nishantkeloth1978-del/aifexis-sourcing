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

## Release 2, part 2: scale and safety hardening (October 2026)
No migration. 448 tests pass, build clean.
- **Server-side pagination.** The Events list is paged in SQL (search box and status filter via a GET form, pager with page counts) with the same visibility rules; CSV export covers up to 5000 events.
- **Fail-closed rate limiter.** Login, invite, join, security actions, inbound mail and platform actions now deny when the limiter store is unavailable, instead of allowing.
- **Nonce-based CSP.** Middleware issues a per-request nonce with `'strict-dynamic'`; the static CSP header was removed. Checked in a real browser against a production build.
- **Accessibility.** The roles side panel traps and restores focus. Arabic keys added.
- **Runbook.** `docs/BACKUP_AND_RESTORE.md`: database, Storage files, restore drill.
- Remaining in Release 2: bid comparison and supplier workspace, malware scanning (scanner choice needed).

## Release 2, part 3: supplier workspace and bid comparison (October 2026)
No migration. 449 tests pass, build clean.
- **Supplier workspace.** The supplier home groups invitations into lanes: To bid, Submitted, Under evaluation, Results (counts shown, filter via `?lane=`). Each card shows submission status (no bid yet / revision number and time), a "needs your bid soon" warning within 24 hours of closing, and "Revise bid" once a bid exists. Arabic added.
- **Bid comparison.** In "Price by line" the lowest amount on each line is highlighted and every other bidder shows its percentage above the lowest.
- Remaining in Release 2: malware scanning (scanner choice needed), full accessibility audit.

## Release 2, part 4: accessibility pass (October 2026)
No migration. 451 tests pass, build clean.
- Audit method: eslint jsx-a11y over every component (only a few findings), then axe-core in a real browser against a production build on the public pages (sign-in in English and Arabic, status).
- Fixed: sign-in, MFA, invite, join and no-access pages and the supplier portal had no main landmark, so the "Skip to main content" link had no target; the status page likewise. The roles panel backdrop is hidden from screen readers. axe now reports zero violations on those pages.
- Kept on purpose: autofocus on the sign-in, MFA code and new-event title fields.
- Test: `tests/a11y-landmarks.test.ts`.
- Not covered: signed-in pages need an authenticated axe run on staging (add to the Release 1 walk-through), and a manual screen-reader pass (NVDA/VoiceOver) before go-live.
- Remaining in Release 2: malware scanning (scanner choice needed).

## Release 3, part 1: AI review assistant with evidence (October 2026)
No migration. 456 tests pass, build clean.
- **What it does.** In technical evaluation, an assigned evaluator can click "Suggest findings with AI" on one bidder. The assistant reads only that bidder's written technical response (and form answers) and returns, per criterion, an assessment (appears to meet / partly / appears not to meet / no evidence found), a one-line summary and word-for-word quotes.
- **Evidence rule.** Every quote is checked against the response text; quotes that are not found are removed and the count is shown. A "meets" or "partly" claim with no verified quote is shown as "No evidence found". The assistant never scores, ranks or recommends; the evaluator reads the quotes and enters scores.
- **Controls.** Off by default; a company turns it on in Configuration ("Let evaluators ask an AI assistant for suggested findings"). Needs `ANTHROPIC_API_KEY` in Vercel (same key as templates and messaging; optional `AI_MODEL`). Only evaluators who can already read the response can use it: not before the technical envelope is open, not for a recused evaluator, not for the buyer. Anonymous evaluation is respected (the model sees the alias). Bid text is passed as untrusted data with an instruction to ignore instructions inside it. Rate-limited (12 per minute per user). Each use writes an audit line (bidder, text hash, model, counts) without storing the response or the suggestions.
- **Not included yet.** PDF/Word attachment reading (no document text extraction yet), extraction of prices from quotes, commercial-side AI, a "no external AI" platform-wide switch beyond this per-company setting.
- Tests: `tests/ai-assist.test.ts`. Arabic added.

## AI status line (October 2026)
**Run migration 0046_ai_status.sql** in the Supabase SQL Editor. 460 tests pass, build clean.
- Configuration page (administrators) now starts with an **AI status** line: Not set up / Key set / Working / Needs attention, the time of the last successful call, and, after a failure, a plain instruction (key rejected: replace it in Vercel and redeploy; limit reached; service unreachable; wrong model name).
- **Test now** sends one tiny request so a new or rotated key can be checked at once (administrators only, 5 per minute).
- Every real AI call (template drafting, message drafts and translation, AI review suggestions) updates one platform row via `ai_status_record()`. It holds only timestamps, counters and a reason code: no key, no prompts, no content. Table has no direct grants; access is through two definer functions given to the runtime role.
- Key care routine (Console workspace with a spend limit, Production-only Sensitive variable, 90-day rotation, delete old key last) is described in the chat of 14 Oct; add it to `docs/RUNBOOK.md` when convenient.
- Tests: `tests/ai-status.test.ts`.

## Template hover preview (October 2026)
No migration. 462 tests pass, build clean.
- Hovering (or keyboard-focusing, or tapping) a template name now opens a read-only card listing what the template contains: the event details a buyer fills in, the questions suppliers answer (qualification, scored or information; technical or commercial envelope; required or optional), the documents requested (file types, expiry date), the price lines (quantity x unit price or lump sum, optional lines) and the evaluation mode and criteria. Header chips give the type, version, number of envelopes and counts.
- Shown on the **Templates** library and in the **New event** template chooser. Content loads on first hover and is kept for the visit. Escape closes it; on a phone it opens as a bottom panel; Arabic mirrors the layout and shows the Arabic labels.
- Scores weights and the pass mark are not part of a template (they come from company configuration), so the card says so.
- Tests: `tests/template-preview.test.ts`.
- **Fix (14 Oct):** the card was cut off by the cards below it on the Templates page. It is now drawn on the page itself (portal, fixed position), placed below or above the name depending on room, limited to the visible height, kept inside the screen, and scrolls inside. Checked in a real browser at desktop, Arabic (right-to-left), phone and short-window sizes, including over overlapping cards.

## Release 2, part 5: malware scanning (October 2026)
**Run migration 0047_service_status.sql.** 472 tests pass, build clean.
- **Scanner service** (`scanner/`): a small Node wrapper around ClamAV (clamd INSTREAM) with bearer-token authentication (token of 32+ characters or it refuses to start), size limit, health endpoint, no files stored. `docker-compose.yml` runs ClamAV, the wrapper and Caddy (automatic HTTPS) on one small server. Answer contract `{"clean": true|false}` is unchanged, so any other scanner or a vendor adapter can be used instead.
- **App side:** a configured scanner that is down, slow, refuses the token or answers oddly blocks the upload (fail closed); an infected file is blocked with its own message. Built-in screening still runs first (programs, macros, scripts, PDF actions, test virus).
- **Configuration page:** new **Upload scanner** line (Built-in only / Set up / Working / Needs attention, last successful scan, plain fix) and a **Test now** button that sends the standard test virus (must be flagged) and a harmless file (must pass), so green means it detects, not merely answers.
- `docs/MALWARE_SCANNER.md`: set-up (about 30 minutes), monthly patching, 90-day token rotation, emergency fallback.
- Not done: a re-scan of files uploaded before a scanner was configured (they carry `scan = screened`); can be added as an admin job.
- Tests: `tests/scanner.test.ts` (including a fake clamd, the service over HTTP and end to end with the app).

## Freight lane tender (October 2026)
**Run migration 0048_freight_lanes.sql.** 482 tests pass, build clean. Details in `docs/FREIGHT_LANES.md`.
- **Template:** the freight template (LOG_FREIGHT_RFQ) is now a lane tender, published as **version 3**. Companies upgrade when they choose (Templates > check for updates); events already created keep their version.
- **Buyer:** lists lanes (origin, destination, codes, container, Incoterm, cargo, containers per year, maximum transit days) on screen or by **Import from Excel** (download an import sheet, fill it, import; rows are added, nothing is saved until Save inputs). Each lane becomes its own lot (up to 200 lanes), so lanes are ranked and awarded one by one.
- **Supplier:** prices every lane in one table on screen (ocean freight, fuel surcharge, origin and destination port charges, documents and other, with the all-in price and annual cost calculating as they type) and states transit days, sailings per week, free days and rate validity per lane. They can leave lanes empty (no bid), clear a lane, or **download the lane sheet, fill it in Excel and upload it**; the same checks apply to both. Drafts and the receipt code cover the lane answers.
- **Buyer comparison:** lanes side by side with every qualified carrier, lowest price per lane, transit against the buyer's limit, a lane-terms table, and award scenarios (everything to one carrier, lane by lane, saving from splitting) with buttons that pre-select the recommendation per lane.
- **Also:** table headings now meet colour-contrast (all tables in the app); `PriceGroup` gained `grid`, `asLot`, `answers`, `limit`, `nameFrom` and `PriceLine` gained `zeroOk`, so other templates can use lane-style pricing later.
- Tests: `tests/freight-lanes.test.ts` (template, answers, comparison, Excel round trip both ways, database flow from template to comparison). Looked at in a real browser (supplier table, buyer comparison, axe).
- Not done: a "same price for all lanes" fill; per-lane documents.

## In-app assistant (stage 1 and read-only data)
Side panel on every staff page: answers from built-in guides and two read-only lookups (events list, event readiness). Per-person limits, per-company log (migration 0049), English and Arabic text. See docs/ASSISTANT.md. Not built: supplier side, actions, streaming, log review screen.

- Assistant stage 3: draft-only actions with Confirm (create, edit draft, copy, add item), migration 0050 `assistant_action`, and streamed replies. See docs/ASSISTANT.md.
- Assistant free-model chain: how-to questions go to a free OpenAI-compatible model (Groq by default) with no company data; Claude handles data questions, changes and any fallback. Migration 0051 adds assistant_message.provider.
- Assistant models on the Configuration screen: mode, free provider (Groq, OpenRouter, Gemini, server default), model names, Test buttons; keys stay in Vercel. Migration 0052. The log now says why the free model did not answer.
- Assistant keys and models per company on the Configuration screen: encrypted write-only API keys, provider order, model names, Test buttons, usage counts. Migrations 0053 and 0054 (daily limit). All AI settings now live in the app; nothing AI-related in Vercel; keys are encrypted with SIGNING_SECRET.
- Autonomous sourcing phases 0 and 1: per-company automation policy on the Configuration screen (migration 0055): multi-day supplier reminders, one capped deadline extension, approver reminders, pause switch, record of automatic actions. Builds on the existing scheduled run; see docs/AUTOMATION.md.
- Internal clock for automation: an always-on worker (scripts/worker.ts, Dockerfile.worker) runs the automatic steps every minute, with a per-company lease so it can share the work with the daily scheduler; last run shown on the Automation screen (migration 0056).
- Backup clock: while people use the app, a page view runs the automatic steps for their company if the last run was over a minute ago (migration 0057).

## Phase 2 - Request intake (done)
Migration 0058, `src/requests/*`, `/requests` pages, `request.create` permission, Arabic strings, tests (548 passing). See docs/REQUESTS.md.

## Phase 3 - Integration layer v1 (done)
Migration 0059 (integration_client, integration_idempotency, webhook_delivery, `integration_lookup`), permission `integration.manage` (administrator only), `src/integrations/*`, `/api/v1/requests` (POST, GET), `/api/v1/events/{ref}/award`, signed webhooks with retry/log/replay delivered on the automation clock, CSV import and export of requests, Connected systems panel on Configuration. See docs/API_v1.md.
Simplifications: fixed CSV template (no column-mapping screen yet); webhooks are thin events plus a pull for the award; no per-client IP allow-list; no SFTP/email intake; award layout is `aifexis.award.v1` (ERP-neutral, no target field).

## Phase 4 - Agent harness and event drafter (done)
Migration 0060 (`agent_run`, `autonomy_policy.agent_daily_limit`, `sourcing_event.drafted_by_agent`), `src/agents/*`, "Draft with AI" on the request page with an editable review, per-company daily cap on the Automation panel, Arabic strings, tests (agents.test.ts incl. injection fixture). See docs/AGENTS.md.

## Phase 5 - Bid check and bid reader (done, v1)
Migration 0061 (`bid_check`, `bid_check_terms_cache`), `src/agents/reader.ts`, `src/bids/bidcheck.ts`, page `/events/{id}/bid-check`, fixed rules, reader with quote verification, buyer-confirmed clarification messages from fixed sentences, labelled set (10 cases) with scoring and `scripts/eval-reader.ts`, injection and isolation tests. Auto-clarification and attachment reading deferred. See docs/BID_READER.md.

## Phase 6 - Recommender and award gate (done, v1)
No migration. `src/agents/recommender.ts`, a **Draft the reason with AI** button on the commercial panel, Arabic strings, tests (recommender.test.ts, 7). The buyer picks the supplier(s) as before; the agent drafts the reason from stored scoring only. Figures given to the model are built in code (scores, prices, gaps, savings against the event estimate when it is in the same currency); any number in the answer that is not among them is refused, the chosen supplier must be named, links/markup are refused, one retry, then the buyer writes it by hand. Risk flags (single bidder, close result, price far below the rest, chosen supplier not top-ranked, no estimate) are raised by code, not the model. The draft only fills the text box: the buyer edits and records the recommendation (existing `RecordRecommendation`, 10-character minimum), so gate 2 is unchanged: award approval by value-based tiers (`required_award_approvals`), separation of duties, and the existing `award.approved` webhook / `GET /api/v1/events/{ref}/award` as handover. Run stored in `agent_run` (agent recommender, subject event), audit `agent.recommender_proposed`.
Not yet: a separate stored "AI-assisted" marker on the recommendation shown to approvers; savings against last price paid.

## Phase 7 - Autonomy level and monitoring (done, v1)
Migration 0062 (`autonomy_policy.level` 0-2, default 2). One level per company, set on the Automation panel: 0 Off (no timed steps, no AI proposals), 1 Rules only (reminders, extension, approver reminders, bid-check rules), 2 Assisted (plus drafter, reader, recommender). Enforced in `runAgent` (AG_OFF) and in the timed steps (`automationOn`). Both approval gates stay with people at every level; no level 3 (open decision D1). New **Automation monitor** panel on Configuration (last 30 days): awarded events, median days from first activity to award, average workflow steps per awarded event, automatic actions, AI runs by agent (failed/accepted/discarded), requests waiting, open bid checks, failed and pending webhooks. Tests: autonomy_level.test.ts.
Simplifications: level is per company, not per category or value band; email intake not built (defer); the monitor reads the audit log and agent runs live (no trend charts).

## Phase 8 - SAP purchase order mapping (done, v1)
Migration 0063 (`erp_mapping`: company code, purchasing organisation and group, plant, document type, unit map). First connector is SAP because the system already has an SAP handover target (decision D2 was not answered; change if another system comes first). `src/handover/sap.ts` turns an approved award into an SAP purchase order in the S/4HANA purchase order field names (JSON) or a flat CSV; every missing piece (vendor number, unit, approval date, mapping) is a named error, never a guess; missing material numbers and long text are warnings. Delivery: buyer/admin downloads from the award handover list (SAP order JSON/CSV), and API clients with `awards:read` use `GET /api/v1/events/{ref}/award?format=sap-po`. Settings: "SAP purchase order mapping" panel on Configuration (config.manage). CSV cells starting with = + - @ are neutralised. Tests: sap.test.ts (7).
Not yet: pushing the order into SAP directly (the customer's middleware or iPaaS picks up the JSON/CSV), Ariba, SFTP drop, per-category plant, payment terms/incoterms, goods-receipt feedback.

## Hardening (done)
`/api/health` now reports `schema: current | behind | unknown` and, when behind, `missingMigrations` (found through pg_catalog, so it also works for the narrow supplier login). `src/lib/schema.ts` holds one probe per migration; add a line with each new migration. Go-live checklist section 5b covers phases 1 to 8. The two flaky tests seen after migrations were run did not repeat in six further full runs (609 passing); they ran right after a database restart and a concurrent build, so treat as environment noise unless seen in CI.

## Phase 8b - Ariba purchase order (done, v1)
Migration 0064 (`ariba_mapping`: buyer Ariba Network ID and name, optional ship-to name, test mode, unit map). `src/handover/ariba.ts` turns an approved award into a cXML 1.2 OrderRequest, one file per winning supplier (order ID is event reference plus the supplier's vendor number, max 50 characters; the file is marked deploymentMode test until the company clears "test"). Every missing piece (mapping, vendor number or Network ID, unit, approval date) is a named error; all text is XML-escaped. Item classification is sent as NotAvailable: confirm with the company's Ariba administrator that their realm accepts this. Delivery: download from the award handover list (target Ariba), or `GET /api/v1/events/{ref}/award?format=ariba-cxml`. Panel "Ariba purchase order mapping" on Configuration. Tests: ariba.test.ts (6). Not yet: posting the file to the Ariba Network, order confirmations and invoices coming back.

## ERPNext test bridge (done)
`scripts/erpnext-bridge.ts` (push / pull / run, `--dry`), mapping in `src/bridge/erpnext.ts`, guide `docs/ERPNEXT_TEST.md`. Runs on the user's computer against a local ERPNext; hidden prompts for both keys. Material Request -> request (idempotent by Material Request name; item codes carried as `[CODE]` before the line description because event lines have no item code) and award -> draft Purchase Order linked to the Material Request (idempotent by Order Confirmation No). Tests: erpnext-bridge.test.ts (mapping) plus a smoke run against a mock ERPNext/Aifexis.

## Auto event and bridge watch mode (done)
Migration 0065 (`integration_client.auto_event`). A connection can be set to create a draft event as soon as an API request arrives (owner of the connection becomes the event's buyer; event stays a draft, publication approval unchanged; audit `integration.event_auto_created`). Bridge `watch` mode polls ERPNext on a timer. Tests: autoevent.test.ts (3).
