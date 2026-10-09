-- Platform catalogue is shared, read-only reference data. If row level security was switched on for these
-- tables (Supabase can do this automatically for new tables), give the app role an explicit read policy.
do $$ declare t text; begin
  foreach t in array array['industry', 'purchase_category', 'industry_pack', 'template_definition'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = t and n.nspname = 'public' and c.relrowsecurity) then
      execute format('drop policy if exists catalogue_read on %I', t);
      execute format('create policy catalogue_read on %I for select to app_runtime using (true)', t);
    end if;
    execute format('grant select on %I to app_runtime', t);
  end loop;
end $$;
