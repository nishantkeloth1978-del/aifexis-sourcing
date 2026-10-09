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
