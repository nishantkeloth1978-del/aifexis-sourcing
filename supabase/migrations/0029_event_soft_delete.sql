-- Deleting a draft event hides it everywhere for the application but keeps the row, because the audit trail refers to it and cannot change.
alter table sourcing_event add column deleted_at timestamptz, add column deleted_by uuid;
drop policy tenant_isolation on sourcing_event;
create policy tenant_isolation on sourcing_event
  using (tenant_id = current_tenant() and deleted_at is null)
  with check (tenant_id = current_tenant());

-- The application cannot update a row into a state its own read policy hides, so the delete goes through this function.
-- It checks the tenant and the draft state itself, and only ever sets the two delete columns.
create function soft_delete_draft_event(p_event uuid, p_member uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sourcing_event set deleted_at = now(), deleted_by = p_member
   where id = p_event and tenant_id = current_tenant() and state = 'draft' and deleted_at is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function soft_delete_draft_event(uuid, uuid) from public;
grant execute on function soft_delete_draft_event(uuid, uuid) to app_runtime;
