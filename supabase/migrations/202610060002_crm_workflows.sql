-- Extend existing workspaces without replacing customer records.
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check(role in ('owner','member','viewer'));
create function private.is_owner(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_members where workspace_id=target and user_id=auth.uid() and role='owner');
$$;
create function private.can_write(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_members where workspace_id=target and user_id=auth.uid() and role in ('owner','member'));
$$;
revoke all on function private.is_owner(uuid),private.can_write(uuid) from public;
grant execute on function private.is_owner(uuid),private.can_write(uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['contacts','deals','tasks'] loop
    execute format('drop policy tenant_insert on public.%I',t);
    execute format('drop policy tenant_update on public.%I',t);
    execute format('drop policy tenant_delete on public.%I',t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check(private.can_write(workspace_id))',t);
    execute format('create policy tenant_update on public.%I for update to authenticated using(private.can_write(workspace_id)) with check(private.can_write(workspace_id))',t);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using(private.can_write(workspace_id))',t);
  end loop;
end $$;

create function private.valid_tags(tags text[]) returns boolean language sql immutable set search_path='' as $$
  select cardinality(tags)<=20 and not exists(select 1 from unnest(tags) tag where tag is null or length(trim(tag)) not between 1 and 40);
$$;
alter table public.contacts add column tags text[] not null default '{}' check(private.valid_tags(tags));
alter table public.contacts add column website text not null default '' check(length(website)<=300 and (website='' or website ~ '^https?://'));
alter table public.contacts add column assigned_to uuid;
alter table public.tasks add column assigned_to uuid;
alter table public.contacts add foreign key(workspace_id,assigned_to) references public.workspace_members(workspace_id,user_id) on delete set null (assigned_to);
alter table public.tasks add foreign key(workspace_id,assigned_to) references public.workspace_members(workspace_id,user_id) on delete set null (assigned_to);
create function private.check_assignee() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.assigned_to is not null and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.assigned_to and role in ('owner','member')) then
    raise exception 'Choose an active collaborator from this workspace' using errcode='23514';
  end if; return new;
end $$;
create trigger contacts_assignee before insert or update on public.contacts for each row execute function private.check_assignee();
create trigger tasks_assignee before insert or update on public.tasks for each row execute function private.check_assignee();

create table public.pipeline_stages(
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check(length(trim(name)) between 1 and 50),
  position integer not null check(position between 0 and 1000),
  kind text not null default 'open' check(kind in ('open','won','lost')),
  created_at timestamptz not null default now(), primary key(workspace_id,name)
);
create function private.seed_stages() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.pipeline_stages(workspace_id,name,position,kind) values(new.id,'New',0,'open'),(new.id,'Qualified',1,'open'),(new.id,'Proposal',2,'open'),(new.id,'Won',3,'won'),(new.id,'Lost',4,'lost');
  return new;
end $$;
insert into public.pipeline_stages(workspace_id,name,position,kind)
select w.id,s.name,s.position,s.kind from public.workspaces w cross join (values('New',0,'open'),('Qualified',1,'open'),('Proposal',2,'open'),('Won',3,'won'),('Lost',4,'lost')) as s(name,position,kind);
create trigger workspace_stages after insert on public.workspaces for each row execute function private.seed_stages();
alter table public.deals drop constraint deals_stage_check;
alter table public.deals alter column stage drop default;
alter table public.deals add constraint deal_workspace_stage foreign key(workspace_id,stage) references public.pipeline_stages(workspace_id,name) on update cascade on delete restrict;
create function private.default_stage() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.stage is null then select name into new.stage from public.pipeline_stages where workspace_id=new.workspace_id order by (kind='open') desc,position,name limit 1; end if;
  return new;
end $$;
create trigger deal_default_stage before insert on public.deals for each row execute function private.default_stage();
create trigger stage_workspace before update on public.pipeline_stages for each row execute function private.keep_workspace();
alter table public.pipeline_stages enable row level security;
revoke all on public.pipeline_stages from anon,authenticated;
grant select,insert,update,delete on public.pipeline_stages to authenticated;
create policy stages_read on public.pipeline_stages for select to authenticated using(private.is_member(workspace_id));
create policy stages_create on public.pipeline_stages for insert to authenticated with check(private.is_owner(workspace_id));
create policy stages_update on public.pipeline_stages for update to authenticated using(private.is_owner(workspace_id)) with check(private.is_owner(workspace_id));
create policy stages_delete on public.pipeline_stages for delete to authenticated using(private.is_owner(workspace_id));
create function private.keep_last_stage() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspaces where id=old.workspace_id for update;
  if found and (select count(*) from public.pipeline_stages where workspace_id=old.workspace_id)<=1 then
    raise exception 'Keep at least one pipeline stage' using errcode='23514';
  end if;
  return old;
end $$;
create trigger stage_minimum before delete on public.pipeline_stages for each row execute function private.keep_last_stage();

create table public.contact_notes(
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade,
  contact_id uuid not null, author_id uuid default auth.uid() references auth.users on delete set null,
  kind text not null default 'note' check(kind in ('note','call','meeting')),
  body text not null check(length(trim(body)) between 1 and 5000), created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete cascade
);
alter table public.contact_notes enable row level security;
revoke all on public.contact_notes from anon,authenticated;
grant select,delete on public.contact_notes to authenticated;
grant insert(workspace_id,contact_id,body,kind) on public.contact_notes to authenticated;
grant update(body,kind) on public.contact_notes to authenticated;
create policy notes_read on public.contact_notes for select to authenticated using(private.is_member(workspace_id));
create policy notes_create on public.contact_notes for insert to authenticated with check(private.can_write(workspace_id) and author_id=auth.uid());
create policy notes_update on public.contact_notes for update to authenticated using(private.can_write(workspace_id) and (author_id=auth.uid() or private.is_owner(workspace_id))) with check(private.can_write(workspace_id));
create policy notes_delete on public.contact_notes for delete to authenticated using(private.can_write(workspace_id) and (author_id=auth.uid() or private.is_owner(workspace_id)));
create index on public.contact_notes(workspace_id,contact_id,created_at desc);

create table public.activities(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  contact_id uuid, actor_id uuid references auth.users on delete set null,
  entity text not null,entity_id uuid not null,action text not null,summary text not null,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete cascade
);
alter table public.activities enable row level security;
revoke all on public.activities from anon,authenticated;
grant select on public.activities to authenticated;
create policy activities_read on public.activities for select to authenticated using(private.is_member(workspace_id));
create index on public.activities(workspace_id,contact_id,created_at desc);
create function private.record_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; contact uuid; label text;
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  if tg_op='DELETE' then r=to_jsonb(old); else r=to_jsonb(new); end if;
  if not exists(select 1 from public.workspaces where id=(r->>'workspace_id')::uuid) then return coalesce(new,old); end if;
  if tg_table_name='contacts' then
    if tg_op='DELETE' then return old; end if;
    contact=(r->>'id')::uuid; label='Contact';
  else contact=(r->>'contact_id')::uuid; label=case tg_table_name when 'deals' then 'Deal' when 'tasks' then 'Follow-up' else initcap(r->>'kind') end; end if;
  if contact is not null and not exists(select 1 from public.contacts where id=contact and workspace_id=(r->>'workspace_id')::uuid) then return coalesce(new,old); end if;
  insert into public.activities(workspace_id,contact_id,actor_id,entity,entity_id,action,summary)
  values((r->>'workspace_id')::uuid,contact,auth.uid(),tg_table_name,(r->>'id')::uuid,lower(tg_op),label||' '||case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end||case when tg_table_name in ('deals','tasks') then ': '||(r->>'title') else '' end);
  return coalesce(new,old);
end $$;
create trigger contacts_activity after insert or update on public.contacts for each row execute function private.record_activity();
create trigger deals_activity after insert or update or delete on public.deals for each row execute function private.record_activity();
create trigger tasks_activity after insert or update or delete on public.tasks for each row execute function private.record_activity();
create trigger notes_activity after insert or update or delete on public.contact_notes for each row execute function private.record_activity();

create table public.workspace_invites(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null,role text not null check(role in ('member','viewer')), token_hash text not null unique,
  expires_at timestamptz not null, accepted_at timestamptz,created_at timestamptz not null default now(),unique(workspace_id,email)
);
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from anon,authenticated;
grant select(id,workspace_id,email,role,expires_at,accepted_at,created_at),delete on public.workspace_invites to authenticated;
create policy invites_read on public.workspace_invites for select to authenticated using(private.is_owner(workspace_id));
create policy invites_delete on public.workspace_invites for delete to authenticated using(private.is_owner(workspace_id));
create function public.list_members(target uuid) returns table(user_id uuid,email text,role text) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(target) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  return query select m.user_id,u.email::text,m.role from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=target order by m.created_at;
end $$;
create function public.invite_member(target uuid,invite_email text,invite_role text,invite_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not private.is_owner(target) then raise exception 'Only owners can invite' using errcode='42501'; end if;
  if invite_role not in ('member','viewer') or invite_hash !~ '^[0-9a-f]{64}$' or length(invite_email)>254 or invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid invitation' using errcode='23514'; end if;
  insert into public.workspace_invites(workspace_id,email,role,token_hash,expires_at) values(target,lower(trim(invite_email)),invite_role,invite_hash,now()+interval '7 days')
  on conflict(workspace_id,email) do update set role=excluded.role,token_hash=excluded.token_hash,expires_at=excluded.expires_at,accepted_at=null,created_at=now() returning id into result;
  return result;
end $$;
create function public.accept_invite(invite_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.workspace_invites; recipient text;
begin
  select lower(email) into recipient from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into invitation from public.workspace_invites where token_hash=invite_hash for update;
  if recipient is null or invitation.id is null or invitation.email<>recipient or invitation.expires_at<now() or invitation.accepted_at is not null then raise exception 'Invalid, expired, or wrong-email invitation' using errcode='42501'; end if;
  insert into public.workspace_members(workspace_id,user_id,role) values(invitation.workspace_id,auth.uid(),invitation.role) on conflict do nothing;
  update public.workspace_invites set accepted_at=now() where id=invitation.id;
  return invitation.workspace_id;
end $$;
create function public.manage_member(target uuid,member_id uuid,new_role text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(target) then raise exception 'Only owners can manage the team' using errcode='42501'; end if;
  perform 1 from public.workspace_members where workspace_id=target and user_id=member_id and role<>'owner' for update;
  if not found then raise exception 'Owner membership cannot be changed here' using errcode='42501'; end if;
  if new_role is null then delete from public.workspace_members where workspace_id=target and user_id=member_id;
  elsif new_role in ('member','viewer') then
    if new_role='viewer' then
      update public.contacts set assigned_to=null where workspace_id=target and assigned_to=member_id;
      update public.tasks set assigned_to=null where workspace_id=target and assigned_to=member_id;
    end if;
    update public.workspace_members set role=new_role where workspace_id=target and user_id=member_id;
  else raise exception 'Invalid role' using errcode='23514'; end if;
end $$;
revoke all on function public.list_members(uuid),public.invite_member(uuid,text,text,text),public.accept_invite(text),public.manage_member(uuid,uuid,text) from public;
grant execute on function public.list_members(uuid),public.invite_member(uuid,text,text,text),public.accept_invite(text),public.manage_member(uuid,uuid,text) to authenticated;

create table public.contact_imports(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  content_hash text not null,inserted integer not null,skipped integer not null,created_at timestamptz not null default now(),unique(workspace_id,content_hash)
);
alter table public.contact_imports enable row level security;
revoke all on public.contact_imports from anon,authenticated;
grant select on public.contact_imports to authenticated;
create policy imports_read on public.contact_imports for select to authenticated using(private.is_member(workspace_id));
create function public.import_contacts(target uuid,content_hash text,records jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; previous public.contact_imports; added integer=0; skipped integer=0;
begin
  if not private.can_write(target) then raise exception 'Workspace write access required' using errcode='42501'; end if;
  if content_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(records)<>'array' or jsonb_array_length(records)>500 then raise exception 'Invalid import' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target::text,0));
  select * into previous from public.contact_imports i where i.workspace_id=target and i.content_hash=import_contacts.content_hash;
  if found then return jsonb_build_object('inserted',previous.inserted,'skipped',previous.skipped,'replayed',true); end if;
  for r in select value from jsonb_array_elements(records) loop
    if coalesce(r->>'email','')<>'' and exists(select 1 from public.contacts where workspace_id=target and lower(trim(email))=lower(trim(r->>'email'))) then skipped=skipped+1;
    else
      insert into public.contacts(workspace_id,name,email,phone,company,status,tags) values(target,r->>'name',coalesce(r->>'email',''),coalesce(r->>'phone',''),coalesce(r->>'company',''),coalesce(r->>'status','Lead'),array(select jsonb_array_elements_text(coalesce(r->'tags','[]'::jsonb))));
      added=added+1;
    end if;
  end loop;
  insert into public.contact_imports(workspace_id,content_hash,inserted,skipped) values(target,content_hash,added,skipped);
  return jsonb_build_object('inserted',added,'skipped',skipped,'replayed',false);
end $$;
revoke all on function public.import_contacts(uuid,text,jsonb) from public;
grant execute on function public.import_contacts(uuid,text,jsonb) to authenticated;
create function public.preview_contact_import(target uuid,emails text[]) returns table(email text) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_write(target) then raise exception 'Workspace write access required' using errcode='42501'; end if;
  return query select distinct lower(trim(c.email)) from public.contacts c where c.workspace_id=target and lower(trim(c.email))=any(emails);
end $$;
revoke all on function public.preview_contact_import(uuid,text[]) from public;
grant execute on function public.preview_contact_import(uuid,text[]) to authenticated;
