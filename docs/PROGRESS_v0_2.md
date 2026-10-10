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
