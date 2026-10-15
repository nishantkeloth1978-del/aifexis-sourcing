-- Assistant, per-company model choices and API keys entered on the Configuration screen.
-- Keys are stored ENCRYPTED (AES-256-GCM, bound to the company and provider); only the last four characters are kept in the clear, for display.
create table assistant_key (
  tenant_id  uuid not null references tenant(id),
  provider   text not null check (provider in ('groq','openrouter','gemini','claude')),
  ciphertext text not null,
  last4      text not null check (length(last4) <= 4),
  added_by   text not null default '',
  added_at   timestamptz not null default now(),
  primary key (tenant_id, provider)
);
alter table assistant_key enable row level security; alter table assistant_key force row level security;
create policy tenant_isolation on assistant_key using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
grant select, insert, update, delete on assistant_key to app_runtime;

-- Per-provider model names, the order free providers are tried in, and where Claude's key comes from.
alter table assistant_setting add column free_order    text[] not null default '{}' check (free_order <@ array['groq','openrouter','gemini']);
alter table assistant_setting add column free_models   jsonb  not null default '{}';
alter table assistant_setting add column claude_source text   not null default 'company' check (claude_source in ('company','server'));
-- Carry over a single provider/model chosen with the earlier version of the screen.
update assistant_setting set free_order = array[free_provider] where free_provider in ('groq','openrouter','gemini');
update assistant_setting set free_models = jsonb_build_object(free_provider, free_model) where free_provider in ('groq','openrouter','gemini') and free_model <> '';

select close_api_grants();
