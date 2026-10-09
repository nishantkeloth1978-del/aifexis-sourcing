# Aifexis Sourcing: audit and implementation plan (v0.1)

Date: 9 October 2026. Basis: the 100-opportunity register and the industry template requirements (v1.0), checked against the code base (292 automated tests passing). The audited register is saved alongside this plan with Priority, Delivery status, Target release and Notes filled in for all 100 rows.

## 1. Audit result

| Status | Count | Meaning |
|---|---|---|
| Done | 18 | Built and covered by tests |
| Partial | 46 | Some of it exists; the gap is named in the Notes column |
| Not started | 23 | Nothing built |
| Deferred | 13 | Needs a module that does not exist (auctions, contracts, negotiation, supplier risk, award optimisation) |

The register is mostly a list of gaps in competitors. Aifexis already answers the structural ones: sealed envelopes enforced everywhere, no-bid versus zero, receipts, layered templates with versions, and one engine for events of every size. The weak area is not capability but the day-to-day feel and the evaluator controls that public and regulated buyers ask for first.

### Industry template requirements: remaining gaps

1. Five more seeded scenarios to reach the 30 that AC28 asks for (25 exist).
2. Approval-route simulation with sample values (FR12) and a policy-approval step before a company template goes active (FR08).
3. "Refresh from template" with a diff on an existing draft (FR09).
4. Alternatives, volume tiers and bundle offers in pricing (FR10, FR11).
5. Hierarchical BOQ for construction (FR10).
6. Arabic is built but switched off by choice.

## 2. Plan

Each release is a set of build blocks in the way we already work: I build and test, you deploy, with migrations run in the Supabase SQL Editor. Sizes are relative: S is about one block, M about two, L about three or more.

### R2: Usability and evaluation integrity (opportunities 1, 2, 9, 38, 41, 77, 83, 85, 89)

| Block | What | Size | Notes |
|---|---|---|---|
| R2.1 Event workspace | One page per event with stage, next action, tasks, documents, decisions and activity in one place; inline editing of lines; bulk add, delete and move to lot; keyboard shortcuts for add-line and save; autosave of event details with a visible save state | L | Largest competitor complaint, and the main demo impression |
| R2.2 Evaluator controls | Conflict-of-interest declaration before an evaluator sees any bid, with recusal; score moderation view that highlights differences above a set gap and records the reason; every score change stores old value, new value and reason, and a material change needs a second approver | L | Migration needed. Gap size and who approves are company policy, so they become settings |
| R2.3 Smarter comparison | Volume tiers, bundles and supplier alternatives as linked options; editable total-cost assumptions (freight, duty, currency, units) shown beside the ranking | L | Engine work with new test vectors. Never shows a recommendation while an assumption is missing |

Exit check: a first-time buyer creates, runs and awards an RFQ without opening a second page for help; an evaluator with a declared conflict cannot open that event's bids; every score change is traceable.

### R3: Supplier experience and imports (opportunities 3, 5 to 7, 16, 17, 21, 27, 31, 32, 35, 37, 42, 52, 64, 65, 70, 74, 84, 87, 92, 98, 99)

| Block | What | Size |
|---|---|---|
| R3.1 Import quality | Detect merged headers and nested BOQ; mapping preview that lists every unmapped or discarded column; merge or replace with a preview for items; line-level CSV export | M |
| R3.2 Supplier journey | Supplier feedback to unsuccessful bidders (approved, per criterion); quote validity tracking with extension requests; carry forward unchanged answers in a final round; synchronised clock and local time on the deadline; account recovery check | M |
| R3.3 Approval simulation and policy approval | Run sample events through approver routing and show gaps; a company template goes active only after the policy approver agrees | M |
| R3.4 Structure and access | Hierarchical BOQ for construction; anonymous evaluation option; evaluator reassignment with provenance; mobile approval and review screens; screen-reader pass on pricing grids; contextual help | L |
| R3.5 Uploads | Move files to Supabase Storage with a larger published limit (needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel) | S |
| R3.6 Template content | Five more scenarios; Refresh from template with diff; full event dossier export | M |

### R4: Integration and operations (opportunities 4, 15, 23, 45, 47, 50, 72, 73, 82)

| Block | What | Size | Depends on |
|---|---|---|---|
| R4.1 SAP or Ariba | PR import (ME5A columns first, then OData), award export, acknowledgement tracking, retry and reconciliation, monitoring page | L | Your sample export and a target system |
| R4.2 Operations | Published and tested limits; p95 measurement on a pilot fixture; status page; staged rollout with a customer-workflow regression suite | M | Production hosting settled |
| R4.3 Production hardening | Point-in-time recovery, restore drill, penetration test, Vercel Firewall, monitoring | M | Your decisions and accounts |
| R4.4 Malware scanning | ClamAV or a vendor API | S | Your choice |

### R5 and later

Report builder, supplier assistant, AI extraction of quotes, restrictive-wording and overlap checks, demand pooling, renewal planning, savings baselines, category presentations, extension framework, supplier merge, duplicate-request detection (opportunities 8, 20, 26, 30, 33, 36, 46, 48, 49, 51, 53 to 57, 71, 76, 80, 81, 86, 96, 100). These need design-partner input or usage data first.

### Deferred modules (13)

Auctions (43, 44), award optimisation (39, 42 partly), AI evaluation (40), supplier risk (59, 60), supplier capacity (93), negotiation (94), contracts (78, 79, 95), savings and spend (97), library folders (68). Each is a module of its own and should be chosen after a design partner states which one they would pay for.

## 3. Recommended order and why

1. R2 first. It fixes what a prospect sees in the first ten minutes and adds the controls public buyers require before they will consider a new system.
2. R3.1 and R3.5 can run alongside R2 as they touch different files.
3. R4.1 starts when you have a sample export. It does not need to wait for R3.
4. Do not start any deferred module before a design partner picks one.

## 4. Decisions needed from you

1. Approver policy for score changes (R2.2): who approves a material change, and what counts as material.
2. Gap that triggers moderation (R2.2): for example 20 points on a 100-point scale. Left as a company setting if you prefer.
3. Sample ME5A export and target SAP version (R4.1).
4. ClamAV or vendor API (R4.4).
5. Whether R2.1 may change the layout of the existing event page, or must keep it and add the workspace beside it.
6. Whether pricing and packaging (opportunity 20) is discussed with a design partner before launch.

## 5. Risks

- R2.1 touches the most-used screen. Mitigation: ship behind the existing event page URL and keep the tests that cover it.
- R2.3 changes comparison results. Mitigation: new test vectors first, and old events keep their stored runs.
- Several rows rely on public customer reviews, which are reports rather than confirmed limits. Treat the register as hypotheses to validate with a design partner.
