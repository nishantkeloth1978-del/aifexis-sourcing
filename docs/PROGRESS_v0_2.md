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
- Deferred to M3: reply-by-email, AI draft answers, translation with original, response-time report, scope-change to amendment automation.
- The old clarifications service and UI files remain in the repo but are unused.
