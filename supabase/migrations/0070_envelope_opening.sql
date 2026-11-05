-- Flexible envelope opening: a witness is no longer the only way. Automatic openings have no person, so opened_by may be empty,
-- and every opening records the mode it was done under (witnessed, buyer or automatic).
alter table opening_record alter column opened_by drop not null;
alter table opening_record add column if not exists opened_mode text check (opened_mode in ('witnessed', 'buyer', 'automatic'));

select close_api_grants();
