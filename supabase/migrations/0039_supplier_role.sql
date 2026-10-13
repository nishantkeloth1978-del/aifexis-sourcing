-- Hardening: a second, much narrower database role for the supplier-facing deployment.
-- The supplier portal can run with DB_RUNTIME_ROLE=app_supplier. Then a flaw in a supplier-facing page cannot read
-- evaluation scores, approvals, configuration, templates or the audit trail, because the database itself refuses.
-- Row-level security still applies on top: every policy keys on the tenant setting, as for app_runtime.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_supplier') then create role app_supplier nologin; end if;
end $$;
grant usage on schema public to app_supplier;

-- Read: what a supplier's pages show.
grant select on
  tenant, event_item, event_lot, event_round, invitation, supplier_org, supplier_user, company_profile,
  quote_extension, bid_feedback, bid_revision, bid_item, stored_object, stored_blob, clarification,
  message_thread, message, message_file, message_receipt, message_translation, notification
  to app_supplier;
-- Only the columns needed to find who to notify, nothing else about staff.
grant select (id, email) on app_user to app_supplier;
grant select (tenant_id, id, user_id) on membership to app_supplier;
grant select (tenant_id, event_id, membership_id, event_role) on event_member to app_supplier;
grant select (tenant_id, event_id, supplier_id) on qualified_bidder to app_supplier;

-- Write: only a supplier's own work.
grant insert, update on bid_revision, bid_item, message_thread, message_receipt, notification to app_supplier;
grant insert on stored_object, stored_blob, message, message_file, message_translation, clarification, audit_event, email_outbox, outbox to app_supplier;
grant delete on stored_object, stored_blob to app_supplier;
grant update on stored_object to app_supplier;

-- The only thing a supplier may learn from the recommendation is whether they themselves won: no ranking, no note, no other supplier.
create or replace function supplier_outcome(p_event uuid, p_supplier uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when r.supplier_id = p_supplier then 'won' else 'lost' end
    from recommendation r join sourcing_event e on e.tenant_id = r.tenant_id and e.id = r.event_id
   where r.tenant_id = current_tenant() and r.event_id = p_event and e.state = 'awarded'
     and exists (select 1 from bid_revision b where b.tenant_id = r.tenant_id and b.event_id = r.event_id and b.supplier_id = p_supplier)
   order by r.created_at desc limit 1;
$$;
grant execute on function supplier_outcome(uuid, uuid) to app_runtime, app_supplier;

-- The event row without the buyer's budget, approval settings and frozen evaluation configuration.
grant select (tenant_id, id, title, state, state_version, current_version, closes_at, envelope1_opened_at, envelope2_opened_at, required_award_approvals, ref, owner_dept, currency, created_at,
              template_key, template_version, template_inputs, template_effective, round_no, deleted_at, quote_validity_days, cancel_reason, cancelled_at, question_deadline, last_answer_date)
  on sourcing_event to app_supplier;

-- The mandatory yes/no declarations every bidder answers: the one piece of the evaluation configuration a bid form needs.
create or replace function event_base_gates(p_event uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.config_snapshot -> 'evaluation' -> 'gates' from sourcing_event e where e.tenant_id = current_tenant() and e.id = p_event and e.config_snapshot is not null),
    (select c.model -> 'evaluation' -> 'gates' from tenant_config c where c.tenant_id = current_tenant()
       and not exists (select 1 from sourcing_event e where e.tenant_id = current_tenant() and e.id = p_event and e.config_snapshot is not null)
     order by c.version desc limit 1),
    '[]'::jsonb);
$$;
grant execute on function event_base_gates(uuid) to app_runtime, app_supplier;
