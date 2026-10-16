-- Autonomous sourcing, level 3 "Autopilot": below a value limit, requests become events, are published, bid on, evaluated and awarded with no person approving.
-- Every step is done by one of three labelled Autopilot identities (buyer, approver, witness) so the existing audit trail and separation-of-duties checks stay in force.
-- Anything unusual (too few suppliers or bids, a flag, a close result) stops the event for a person to take over.
alter table autonomy_policy drop constraint if exists autonomy_policy_level_check;
alter table autonomy_policy add constraint autonomy_policy_level_check check (level between 0 and 3);
alter table autonomy_policy add column autopilot_max_value numeric(15,2) not null default 0 check (autopilot_max_value >= 0);   -- AED; 0 means nothing qualifies
alter table autonomy_policy add column autopilot_min_suppliers int not null default 3 check (autopilot_min_suppliers between 1 and 50);
alter table autonomy_policy add column autopilot_min_bids int not null default 2 check (autopilot_min_bids between 1 and 50);
alter table autonomy_policy add column autopilot_bid_days int not null default 7 check (autopilot_bid_days between 1 and 60);
alter table sourcing_event add column autopilot boolean not null default false;
alter table sourcing_event add column autopilot_hold text check (autopilot_hold is null or length(autopilot_hold) <= 500);
alter table purchase_request add column autopilot_skip text check (autopilot_skip is null or length(autopilot_skip) <= 500);   -- why Autopilot left this request to a person
select close_api_grants();
