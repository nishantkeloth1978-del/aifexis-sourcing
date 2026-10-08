-- Files can now live in private object storage as well as in the database.
-- Existing files stay where they are ('db'); new files go to storage when a storage key is configured.
alter table stored_blob alter column content drop not null;
alter table stored_blob add column storage text not null default 'db' check (storage in ('db', 'supabase'));
alter table stored_blob add column storage_key text;
alter table stored_blob add column scan text not null default 'unscanned' check (scan in ('unscanned', 'screened', 'clean'));
alter table stored_blob add constraint stored_blob_where check ((storage = 'db' and content is not null) or (storage = 'supabase' and storage_key is not null));
