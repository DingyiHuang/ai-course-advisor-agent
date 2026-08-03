begin;

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now(),
  constraint chat_sessions_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz(3) not null default now(),
  constraint chat_messages_role_allowed
    check (role in ('user', 'assistant', 'system')),
  constraint chat_messages_sources_is_array
    check (jsonb_typeof(sources) = 'array'),
  constraint chat_messages_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create index chat_messages_session_created_id_idx
  on public.chat_messages (session_id, created_at, id);

create function public.update_chat_session_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.chat_sessions
  set updated_at = greatest(updated_at, new.created_at)
  where id = new.session_id;

  return new;
end;
$$;

create trigger chat_messages_update_session_timestamp
after insert on public.chat_messages
for each row
execute function public.update_chat_session_timestamp();

revoke all on function public.update_chat_session_timestamp() from public;
revoke all on function public.update_chat_session_timestamp()
  from anon, authenticated;

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

comment on table public.chat_sessions is
  'Server-only conversation sessions; RLS is enabled with no public policies.';

comment on table public.chat_messages is
  'Server-only conversation messages; RLS is enabled with no public policies.';

commit;
