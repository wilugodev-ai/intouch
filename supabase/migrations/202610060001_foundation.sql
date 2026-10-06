-- Run on a separate InTouch Supabase project. No service-role key is needed by the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on public.workspace_members(user_id);

create function private.is_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members where workspace_id = target and user_id = (select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;

create function public.create_workspace(workspace_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.workspaces(name) values (trim(workspace_name)) returning id into new_id;
  insert into public.workspace_members(workspace_id,user_id,role) values(new_id,auth.uid(),'owner');
  return new_id;
end;
$$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

create table public.contacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check(length(trim(name)) between 1 and 300), email text not null default '' check(length(email)<=300),
  phone text not null default '' check(length(phone)<=300), company text not null default '' check(length(company)<=300),
  status text not null default 'Lead' check(status in ('Lead','Customer','Inactive')),
  created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table public.deals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  contact_id uuid, title text not null check(length(trim(title)) between 1 and 300),
  value_cents bigint not null default 0 check(value_cents between 0 and 100000000000),
  stage text not null default 'New' check(stage in ('New','Qualified','Proposal','Won','Lost')),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete restrict
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  contact_id uuid, title text not null check(length(trim(title)) between 1 and 300),
  due_date date not null default current_date, done boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete restrict
);
create table public.channel_connections (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  channel text not null check(channel in ('WhatsApp','Facebook','Instagram')),
  external_account_id text not null, display_name text not null,
  status text not null check(status in ('connected','reauthorize','disconnected')),
  created_at timestamptz not null default now(), unique(channel,external_account_id), unique(workspace_id,id)
);
-- Credential ciphertext belongs in the private schema, never this public metadata table.
create table public.conversations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  contact_id uuid not null, connection_id uuid not null,
  status text not null default 'Open' check(status in ('Open','Resolved')),
  created_at timestamptz not null default now(), unique(workspace_id,id),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id),
  foreign key(workspace_id,connection_id) references public.channel_connections(workspace_id,id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  conversation_id uuid not null, provider_message_id text not null,
  direction text not null check(direction in ('inbound','outbound')), body text not null,
  created_at timestamptz not null default now(), unique(workspace_id,provider_message_id),
  foreign key(workspace_id,conversation_id) references public.conversations(workspace_id,id)
);
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.workspaces,public.workspace_members from anon,authenticated;
grant select on public.workspaces,public.workspace_members to authenticated;
create policy workspace_read on public.workspaces for select to authenticated using(private.is_member(id));
create policy membership_read on public.workspace_members for select to authenticated using(private.is_member(workspace_id));

do $$ declare t text; begin
  foreach t in array array['contacts','deals','tasks','channel_connections','conversations','messages'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_member(workspace_id))',t);
    execute format('create index on public.%I(workspace_id)',t);
    if t in ('contacts','deals','tasks') then
      execute format('grant insert,update,delete on public.%I to authenticated',t);
      execute format('create policy tenant_insert on public.%I for insert to authenticated with check(private.is_member(workspace_id))',t);
      execute format('create policy tenant_update on public.%I for update to authenticated using(private.is_member(workspace_id)) with check(private.is_member(workspace_id))',t);
      execute format('create policy tenant_delete on public.%I for delete to authenticated using(private.is_member(workspace_id))',t);
    end if;
  end loop;
end $$;

-- Even members of two businesses cannot move records between those businesses.
create function private.keep_workspace() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then raise exception 'Workspace cannot be changed' using errcode='42501'; end if;
  return new;
end $$;
create trigger contacts_workspace before update on public.contacts for each row execute function private.keep_workspace();
create trigger deals_workspace before update on public.deals for each row execute function private.keep_workspace();
create trigger tasks_workspace before update on public.tasks for each row execute function private.keep_workspace();
