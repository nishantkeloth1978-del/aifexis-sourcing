-- Clarifications: a supplier asks (private to the buyer); the buyer answers that supplier, or shares the answer with every invited supplier.
alter table clarification
  add column kind text not null default 'question' check (kind in ('question', 'answer')),
  add column parent_id uuid,
  add column question_text text,          -- on a shared answer: the question, without the asker's name
  add column author_membership_id uuid;
