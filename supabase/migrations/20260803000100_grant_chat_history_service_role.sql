begin;

grant select, insert, update, delete
  on table public.chat_sessions
  to service_role;

grant select, insert, delete
  on table public.chat_messages
  to service_role;

commit;
