-- Suppliers need to know whether their technical and price parts are sealed apart (two envelopes) or opened together (one),
-- so the bid form can show tabs or sections. Only this one setting is shown to them; the frozen evaluation configuration stays hidden.
alter table sourcing_event add column if not exists envelope_mode text not null default 'two' check (envelope_mode in ('two', 'single'));
update sourcing_event set envelope_mode = 'single' where config_snapshot -> 'evaluation' -> 'opening' ->> 'envelopes' = 'single';

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_supplier') then
    grant select (envelope_mode) on sourcing_event to app_supplier;
  end if;
end $$;

select close_api_grants();
