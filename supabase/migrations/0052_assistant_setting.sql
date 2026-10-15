-- Which models the in-app assistant may use, chosen by each company's administrator on the Configuration screen.
-- Holds only choices (mode, provider, model names). API keys are never stored here: they live in the server environment.
create table assistant_setting (
  tenant_id     uuid primary key references tenant(id),
  mode          text not null default 'free_first' check (mode in ('free_first','claude_only')),
  free_provider text not null default 'auto' check (free_provider in ('auto','groq','openrouter','gemini','custom')),
  free_model    text not null default '' check (length(free_model) <= 100),
  claude_model  text not null default '' check (length(claude_model) <= 100),
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
alter table assistant_setting enable row level security; alter table assistant_setting force row level security;
create policy tenant_isolation on assistant_setting using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update on assistant_setting to app_runtime;

select close_api_grants();
