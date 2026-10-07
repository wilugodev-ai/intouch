-- Internal business workflows, independent of Meta or email providers.
alter table public.deals add column closed_at timestamptz;
update public.deals d set closed_at=now() from public.pipeline_stages s where s.workspace_id=d.workspace_id and s.name=d.stage and s.kind in ('won','lost');
create function private.deal_closed_date() returns trigger language plpgsql set search_path='' as $$
declare closed boolean;
begin
  select kind in ('won','lost') into closed from public.pipeline_stages where workspace_id=new.workspace_id and name=new.stage;
  if closed then new.closed_at=coalesce(new.closed_at,now()); else new.closed_at=null; end if;
  return new;
end $$;
create trigger deal_closed_date before insert or update on public.deals for each row execute function private.deal_closed_date();
create function private.sync_stage_kind() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind<>old.kind then update public.deals set stage=stage where workspace_id=new.workspace_id and stage=new.name;end if;return new;
end $$;
create trigger sync_stage_kind after update of kind on public.pipeline_stages for each row execute function private.sync_stage_kind();

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check(length(trim(name)) between 1 and 100),
  event text not null check(event in ('contact_created','deal_stage_changed')),
  stage text, task_title text not null check(length(trim(task_title)) between 1 and 300),
  due_days integer not null default 1 check(due_days between 0 and 365),
  assigned_to uuid, enabled boolean not null default true, created_at timestamptz not null default now(),
  foreign key(workspace_id,stage) references public.pipeline_stages(workspace_id,name) on update cascade on delete restrict,
  foreign key(workspace_id,assigned_to) references public.workspace_members(workspace_id,user_id) on delete set null(assigned_to),
  check((event='contact_created' and stage is null) or (event='deal_stage_changed' and stage is not null))
);
create trigger automation_assignee before insert or update on public.automation_rules for each row execute function private.check_assignee();
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  rule_id uuid references public.automation_rules on delete set null,rule_name text not null,
  source_id uuid not null,task_id uuid references public.tasks on delete set null,created_at timestamptz not null default now()
);
alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from anon,authenticated;
grant select on public.automation_runs to authenticated;
create policy automation_runs_read on public.automation_runs for select to authenticated using(private.is_member(workspace_id));
create index on public.automation_runs(workspace_id,created_at desc);
create function private.run_automations() returns trigger language plpgsql security definer set search_path='' as $$
declare rule public.automation_rules; task uuid; event_name text; contact uuid; assignee uuid;
begin
  if tg_table_name='contacts' then event_name='contact_created'; contact=new.id;
  else
    if new.stage=old.stage then return new; end if;
    -- Cascading stage renames are metadata edits, not sales transitions.
    if not exists(select 1 from public.pipeline_stages where workspace_id=new.workspace_id and name=old.stage) then return new; end if;
    event_name='deal_stage_changed'; contact=new.contact_id;
  end if;
  for rule in select * from public.automation_rules where workspace_id=new.workspace_id and enabled and event=event_name and (event_name='contact_created' or stage=to_jsonb(new)->>'stage') loop
    assignee=rule.assigned_to;
    if not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=assignee and role in ('owner','member')) then assignee=null; end if;
    insert into public.tasks(workspace_id,contact_id,title,due_date,assigned_to) values(new.workspace_id,contact,rule.task_title,current_date+rule.due_days,assignee) returning id into task;
    insert into public.automation_runs(workspace_id,rule_id,rule_name,source_id,task_id) values(new.workspace_id,rule.id,rule.name,new.id,task);
  end loop;
  return new;
end $$;
create trigger contact_automations after insert on public.contacts for each row execute function private.run_automations();
create trigger deal_automations after update of stage on public.deals for each row execute function private.run_automations();

create table public.appointments (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null check(length(trim(title)) between 1 and 300),contact_id uuid,assigned_to uuid,
  starts_at timestamptz not null,ends_at timestamptz not null,
  location text not null default '' check(length(location)<=300),notes text not null default '' check(length(notes)<=5000),
  status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled')),
  created_at timestamptz not null default now(),check(ends_at>starts_at and ends_at<=starts_at+interval '7 days'),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete restrict,
  foreign key(workspace_id,assigned_to) references public.workspace_members(workspace_id,user_id) on delete set null(assigned_to)
);
create trigger appointment_assignee before insert or update on public.appointments for each row execute function private.check_assignee();
create index on public.appointments(workspace_id,starts_at);
create function private.appointment_overlap() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.assigned_to is not null and new.status='scheduled' then
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text||new.assigned_to::text,1));
    if exists(select 1 from public.appointments where workspace_id=new.workspace_id and assigned_to=new.assigned_to and id<>new.id and status='scheduled' and starts_at<new.ends_at and ends_at>new.starts_at) then
      raise exception 'This teammate already has an appointment at that time' using errcode='23P01';
    end if;
  end if; return new;
end $$;
create trigger appointment_overlap before insert or update on public.appointments for each row execute function private.appointment_overlap();

create table public.tickets (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null check(length(trim(title)) between 1 and 300),contact_id uuid,assigned_to uuid,
  description text not null default '' check(length(description)<=5000),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  status text not null default 'open' check(status in ('open','in_progress','resolved')),
  due_date date,resolved_at timestamptz,created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete restrict,
  foreign key(workspace_id,assigned_to) references public.workspace_members(workspace_id,user_id) on delete set null(assigned_to)
);
create trigger ticket_assignee before insert or update on public.tickets for each row execute function private.check_assignee();
create function private.ticket_resolved() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='resolved' then new.resolved_at=coalesce(new.resolved_at,now()); else new.resolved_at=null; end if;return new;
end $$;
create trigger ticket_resolved before insert or update on public.tickets for each row execute function private.ticket_resolved();

create function private.valid_quote_items(items jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; total numeric=0;
begin
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 50 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object' or coalesce(jsonb_typeof(item->'description'),'')<>'string' or length(trim(item->>'description')) not between 1 and 300
      or coalesce(item->>'quantity','') !~ '^[0-9]+$' or (item->>'quantity')::numeric not between 1 and 10000
      or coalesce(item->>'unit_cents','') !~ '^[0-9]+$' or (item->>'unit_cents')::numeric not between 0 and 1000000000 then return false; end if;
    total=total+(item->>'quantity')::numeric*(item->>'unit_cents')::numeric;
  end loop;
  return total<=100000000000;
end $$;
create function private.quote_subtotal(items jsonb) returns bigint language sql immutable set search_path='' as $$
  select coalesce(sum((item->>'quantity')::bigint*(item->>'unit_cents')::bigint),0)::bigint from jsonb_array_elements(items) item;
$$;
create table public.quotes (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null check(length(trim(title)) between 1 and 300),contact_id uuid,
  items jsonb not null check(private.valid_quote_items(items)),tax_bps integer not null default 0 check(tax_bps between 0 and 10000),
  total_cents bigint not null default 0,valid_until date,notes text not null default '' check(length(notes)<=5000),
  status text not null default 'draft' check(status in ('draft','sent','accepted','declined')),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete restrict
);
create function private.quote_total() returns trigger language plpgsql set search_path='' as $$
begin
  if not private.valid_quote_items(new.items) then raise exception 'Invalid quote items' using errcode='23514'; end if;
  new.total_cents=round(private.quote_subtotal(new.items)*(1+new.tax_bps::numeric/10000));return new;
end $$;
create trigger quote_total before insert or update on public.quotes for each row execute function private.quote_total();

do $$ declare t text; perm text; begin
  foreach t in array array['automation_rules','appointments','tickets','quotes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_member(workspace_id))',t);
    perm=case when t='automation_rules' then 'private.is_owner' else 'private.can_write' end;
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check(%s(workspace_id))',t,perm);
    execute format('create policy tenant_update on public.%I for update to authenticated using(%s(workspace_id)) with check(%s(workspace_id))',t,perm,perm);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using(%s(workspace_id))',t,perm);
    execute format('create trigger immutable_workspace before update on public.%I for each row execute function private.keep_workspace()',t);
    execute format('create index on public.%I(workspace_id,created_at desc)',t);
  end loop;
end $$;
-- Clear assignments in all modules before downgrading a collaborator.
create function private.clear_collaborator_assignments() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role='viewer' and old.role<>'viewer' then
    update public.automation_rules set assigned_to=null where workspace_id=new.workspace_id and assigned_to=new.user_id;
    update public.appointments set assigned_to=null where workspace_id=new.workspace_id and assigned_to=new.user_id;
    update public.tickets set assigned_to=null where workspace_id=new.workspace_id and assigned_to=new.user_id;
  end if;return new;
end $$;
create trigger clear_collaborator_assignments before update of role on public.workspace_members for each row execute function private.clear_collaborator_assignments();

create function public.crm_reports(target uuid,date_from date,date_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_member(target) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  if date_from is null or date_to is null or date_to<date_from or date_to-date_from>3660 then raise exception 'Invalid date range' using errcode='23514';end if;
  select jsonb_build_object(
    'contacts',(select count(*) from public.contacts where workspace_id=target and created_at>=date_from::timestamptz and created_at<(date_to+1)::timestamptz),
    'won_value',(select coalesce(sum(d.value_cents),0) from public.deals d join public.pipeline_stages s on s.workspace_id=d.workspace_id and s.name=d.stage where d.workspace_id=target and s.kind='won' and d.closed_at>=date_from::timestamptz and d.closed_at<(date_to+1)::timestamptz),
    'won_count',(select count(*) from public.deals d join public.pipeline_stages s on s.workspace_id=d.workspace_id and s.name=d.stage where d.workspace_id=target and s.kind='won' and d.closed_at>=date_from::timestamptz and d.closed_at<(date_to+1)::timestamptz),
    'lost_count',(select count(*) from public.deals d join public.pipeline_stages s on s.workspace_id=d.workspace_id and s.name=d.stage where d.workspace_id=target and s.kind='lost' and d.closed_at>=date_from::timestamptz and d.closed_at<(date_to+1)::timestamptz),
    'overdue_tasks',(select count(*) from public.tasks where workspace_id=target and not done and due_date<current_date),
    'resolved_tickets',(select count(*) from public.tickets where workspace_id=target and resolved_at>=date_from::timestamptz and resolved_at<(date_to+1)::timestamptz),
    'pipeline',(select coalesce(jsonb_agg(x order by x.position,x.name),'[]') from (select s.name,s.kind,s.position,count(d.id) as count,coalesce(sum(d.value_cents),0) as value from public.pipeline_stages s left join public.deals d on d.workspace_id=s.workspace_id and d.stage=s.name where s.workspace_id=target group by s.name,s.kind,s.position) x),
    'team',(select coalesce(jsonb_agg(x),'[]') from (select u.email,m.role,(select count(*) from public.tasks t where t.workspace_id=target and t.assigned_to=m.user_id and not done) as open_tasks,(select count(*) from public.tasks t where t.workspace_id=target and t.assigned_to=m.user_id and not done and due_date<current_date) as overdue_tasks from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=target) x)
  ) into result;return result;
end $$;
revoke all on function public.crm_reports(uuid,date,date) from public;
grant execute on function public.crm_reports(uuid,date,date) to authenticated;
