-- How many questions one person may ask the assistant per day, set by the company's administrator on the Configuration screen (was a server setting).
alter table assistant_setting add column daily_limit int not null default 100 check (daily_limit between 1 and 5000);

select close_api_grants();
