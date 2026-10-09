-- Standard line details on an event item. All optional. target_price is internal to the buying team and is never shown to suppliers.
alter table event_item
  add column specification text check (specification is null or length(specification) <= 1000),
  add column required_date date,
  add column material_group text check (material_group is null or length(material_group) <= 60),
  add column target_price numeric(18, 4) check (target_price is null or target_price >= 0);
