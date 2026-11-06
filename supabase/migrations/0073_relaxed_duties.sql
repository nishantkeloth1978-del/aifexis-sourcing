-- Optional relaxed separation of duties. When the company turns it on (Configuration), an administrator may give one person several roles on an event.
-- The application sets app.relaxed_duties for that one assignment; without it the assignment rules are unchanged.
create or replace function check_event_member_duties() returns trigger language plpgsql as $$
declare conflict_roles text[];
begin
  if current_setting('app.relaxed_duties', true) = 'on' then return new; end if;
  conflict_roles := case new.event_role
    when 'tech_evaluator' then array['comm_evaluator', 'buyer', 'witness', 'tech_approver', 'award_approver', 'publication_approver']
    when 'comm_evaluator' then array['tech_evaluator', 'buyer', 'witness', 'tech_approver', 'award_approver', 'publication_approver']
    when 'buyer' then array['tech_approver', 'award_approver', 'publication_approver', 'witness', 'tech_evaluator', 'comm_evaluator']
    when 'witness' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'tech_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'award_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    when 'publication_approver' then array['buyer', 'tech_evaluator', 'comm_evaluator']
    else array[]::text[]
  end;
  if exists (
    select 1 from event_member em
    where em.tenant_id = new.tenant_id and em.event_id = new.event_id
      and em.membership_id = new.membership_id and em.event_role = any (conflict_roles)
  ) then
    raise exception 'separation of duties: % conflicts with an existing role of the same member on this event', new.event_role;
  end if;
  return new;
end $$;

select close_api_grants();
