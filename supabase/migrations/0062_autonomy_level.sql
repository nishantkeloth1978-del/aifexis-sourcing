-- Autonomous sourcing, phase 7: one autonomy level per company.
-- 0 Off: no automatic steps and no AI proposals. 1 Rules only: reminders, extension, nudges, bid-check rules. 2 Assisted: level 1 plus AI proposals.
-- Both approval gates stay with people at every level. Default 2 reproduces today's behaviour (AI still needs the company's own key).
alter table autonomy_policy add column level int not null default 2 check (level between 0 and 2);
select close_api_grants();
