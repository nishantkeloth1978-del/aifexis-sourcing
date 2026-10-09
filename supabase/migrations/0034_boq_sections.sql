-- Bill of quantities sections: a line carries the path of the section it sits in, for example "1 Civil > 1.1 Foundations".
alter table event_item add column section text check (section is null or length(section) <= 200);
