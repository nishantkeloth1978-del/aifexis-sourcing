-- Autonomous sourcing: an AI first draft of a sourcing event for every new request (opt-in per company, needs autonomy level 2).
-- The draft is a proposal on the request page; a buyer still reviews it and creates the draft event, and publication still needs approval.
alter table autonomy_policy add column auto_draft boolean not null default false;
select close_api_grants();
