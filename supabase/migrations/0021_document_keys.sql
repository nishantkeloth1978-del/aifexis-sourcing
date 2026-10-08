-- A supplier's attachment can be filed against a document the event asks for (a template document key).
alter table stored_object add column doc_key text check (doc_key is null or doc_key ~ '^[a-z0-9_]{1,80}$');
create index stored_object_doc_key on stored_object (tenant_id, event_id, supplier_id, doc_key) where doc_key is not null;
