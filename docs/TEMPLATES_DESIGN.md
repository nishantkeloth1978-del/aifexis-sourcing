# Industry templates: design (Stage 1)

Spec: Aifexis_Industry_Sourcing_Template_Requirements.md. Decisions for Stage 1:

- **Tenant = company.** One sourcing profile per tenant. Overrides carry a scope string (`company` or `dept:<name>`); multi-company tenants come later without a data change.
- **Master content is data.** Packs live in `src/templates/packs/*.ts` (typed, validated in tests) and are written to SQL by `scripts/gen-template-seed.ts` into `supabase/migrations/0019_template_seed.sql`. Published versions are immutable (trigger). A test fails if the TS content and the SQL seed differ.
- **One engine** (`src/templates/`): types, restricted expression grammar (`expr.ts`), layered resolver with provenance and hash (`resolve.ts`), validator (`validate.ts`), schedule builder (`schedule.ts`) and evaluation maths (`evaluation.ts`).
- **Layers:** base < template < company overrides (add/update/remove by stable key) < event values. Locked policy rules (`company_policy`) constrain every layer: an override cannot remove or weaken a locked item.
- **Pricing models reduce to the existing line engine.** A template declares input groups (a site, a role, a lane) and line formulas (`headcount * days`). The schedule builder turns buyer inputs into event items (UNIT_PRICE or LUMP_SUM), so supplier pricing, lots, ranking, award and handover are unchanged. Missing inputs make the schedule *incomplete*; an incomplete event cannot be submitted.
- **Questionnaire.** Supplier fields and questions from the event snapshot are rendered in the bid form and saved as a `form_response` item (class D6). Yes/No qualification questions feed the existing declarations (gates); template criteria feed technical scoring. Weights, thresholds and approvers are never taken from a template.
- **Snapshots.** An event keeps `template_key`, `template_version`, `config_version` and the effective configuration. The snapshot is frozen when the event is submitted for publication.
- **Activation** is one transaction guarded by an idempotency key and an expected version; the previous active version stays until the new one commits.
- **Capabilities.** Templates declare `requires`. The deployed set is `DEPLOYED_CAPABILITIES`; a template needing more (auction, public publishing) cannot be enabled and the library says why.

Not in Stage 1 (later stages): other 8 packs, visual editor, JSON/Excel template import, AI proposals, version adoption diff UI, existing-company migration preview, required-document enforcement per document key, line-level "No bid" reasons.
