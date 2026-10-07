create function private.valid_birthday(m integer,d integer,y integer) returns boolean language plpgsql stable set search_path='' as $$
begin
  if m is null and d is null and y is null then return true;end if;
  if m is null or d is null or (y is not null and (y<1900 or y>extract(year from current_date))) then return false;end if;
  perform make_date(coalesce(y,2000),m,d);return y is null or make_date(y,m,d)<=current_date;
exception when datetime_field_overflow then return false;
end $$;
alter table public.contacts add column birth_month integer;
alter table public.contacts add column birth_day integer;
alter table public.contacts add column birth_year integer;
alter table public.contacts add constraint valid_contact_birthday check(private.valid_birthday(birth_month,birth_day,birth_year));
alter table public.contacts add column preferred_channel text not null default 'none' check(preferred_channel in ('none','email','phone','whatsapp'));
alter table public.contacts add column marketing_email boolean not null default false;
alter table public.contacts add column marketing_whatsapp boolean not null default false;
-- Consent is changed only through the reviewed intake and withdrawal functions.
revoke insert,update on public.contacts from authenticated;
grant insert(workspace_id,name,email,phone,company,status,tags,website,assigned_to,birth_month,birth_day,birth_year,preferred_channel) on public.contacts to authenticated;
grant update(workspace_id,name,email,phone,company,status,tags,website,assigned_to,birth_month,birth_day,birth_year,preferred_channel) on public.contacts to authenticated;

create table public.registration_forms(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null unique references public.workspaces on delete cascade,
  token uuid not null unique default gen_random_uuid(),enabled boolean not null default false,
  title text not null default 'Customer registration' check(length(trim(title)) between 1 and 120),
  description text not null default 'Share your details so we can stay in touch.' check(length(description)<=2000),
  privacy_url text not null default '' check(length(privacy_url)<=500 and (privacy_url='' or privacy_url ~ '^https?://')),
  revision integer not null default 1,created_at timestamptz not null default now(),unique(workspace_id,id)
);
alter table public.registration_forms enable row level security;
revoke all on public.registration_forms from anon,authenticated;
grant select on public.registration_forms to authenticated;
grant insert(workspace_id,title,description,privacy_url,enabled),update(title,description,privacy_url,enabled,token) on public.registration_forms to authenticated;
create policy forms_read on public.registration_forms for select to authenticated using(private.is_owner(workspace_id));
create policy forms_insert on public.registration_forms for insert to authenticated with check(private.is_owner(workspace_id));
create policy forms_update on public.registration_forms for update to authenticated using(private.is_owner(workspace_id)) with check(private.is_owner(workspace_id));
create function private.form_revision() returns trigger language plpgsql set search_path='' as $$
begin new.revision=old.revision+1;return new;end $$;
create trigger form_revision before update on public.registration_forms for each row execute function private.form_revision();

create table public.registration_submissions(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,form_id uuid not null,
  request_id uuid not null,form_revision integer not null,
  name text not null check(length(trim(name)) between 1 and 300),email text not null default '' check(length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone text not null default '' check(phone='' or phone ~ '^\+[1-9][0-9]{6,14}$'),company text not null default '' check(length(company)<=300),
  birth_month integer,birth_day integer,birth_year integer,
  preferred_channel text not null default 'none' check(preferred_channel in ('none','email','phone','whatsapp')),
  marketing_email boolean not null default false,marketing_whatsapp boolean not null default false,
  consent_notice jsonb not null,status text not null default 'pending' check(status in ('pending','accepted','dismissed')),
  contact_id uuid,reviewed_by uuid references auth.users on delete set null,reviewed_at timestamptz,created_at timestamptz not null default now(),
  foreign key(workspace_id,form_id) references public.registration_forms(workspace_id,id) on delete cascade,
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete set null(contact_id),
  unique(form_id,request_id),check(email<>'' or phone<>''),check(private.valid_birthday(birth_month,birth_day,birth_year)),
  check((not marketing_email or email<>'') and (not marketing_whatsapp or phone<>'')),
  check((preferred_channel<>'email' or email<>'') and (preferred_channel not in ('phone','whatsapp') or phone<>''))
);
alter table public.registration_submissions enable row level security;
revoke all on public.registration_submissions from anon,authenticated;
grant select on public.registration_submissions to authenticated;
create policy submissions_read on public.registration_submissions for select to authenticated using(private.can_write(workspace_id));
create index on public.registration_submissions(workspace_id,status,created_at desc);
create index on public.registration_submissions(form_id,created_at);

create table public.contact_consent_events(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces on delete cascade,contact_id uuid not null,
  submission_id uuid unique references public.registration_submissions on delete set null,
  source text not null check(source in ('reviewed_registration','staff_withdrawal')),actor_id uuid references auth.users on delete set null,
  marketing_email boolean not null,marketing_whatsapp boolean not null,notice jsonb not null,created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references public.contacts(workspace_id,id) on delete cascade
);
alter table public.contact_consent_events enable row level security;
revoke all on public.contact_consent_events from anon,authenticated;
grant select on public.contact_consent_events to authenticated;
create policy consent_read on public.contact_consent_events for select to authenticated using(private.is_member(workspace_id));
create index on public.contact_consent_events(workspace_id,contact_id,created_at desc);

create function private.registration_notice(business_name text,privacy_url text) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version',1,'business',business_name,'privacy_url',privacy_url,
    'data','Your information will be shared with '||business_name||' to manage your customer record. Birthday and marketing choices are optional. Contact this business to request corrections or withdraw consent.',
    'email','I agree to receive promotional emails from '||business_name||'.',
    'whatsapp','I agree to receive promotional WhatsApp messages from '||business_name||'.');
$$;
create function public.public_registration_form(form_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('business',w.name,'title',f.title,'description',f.description,'revision',f.revision,'notice',private.registration_notice(w.name,f.privacy_url))
  from public.registration_forms f join public.workspaces w on w.id=f.workspace_id where f.token=form_token and f.enabled;
$$;
create function public.submit_registration(form_token uuid,request_key uuid,form_version integer,fields jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f public.registration_forms; business_name text;
begin
  select * into f from public.registration_forms where token=form_token and enabled for update;
  if f.id is null then raise exception 'Form unavailable' using errcode='P0002';end if;
  -- Retry-safe without revealing whether an email address is already a customer.
  if exists(select 1 from public.registration_submissions where form_id=f.id and request_id=request_key) then return;end if;
  if form_version is distinct from f.revision then raise exception 'Form changed. Reload before submitting.' using errcode='40001';end if;
  if (select count(*) from public.registration_submissions where form_id=f.id and created_at>now()-interval '24 hours')>=100 then raise exception 'Form submission limit reached. Please try later.' using errcode='54000';end if;
  if jsonb_typeof(fields) is distinct from 'object' or length(fields::text)>10000
    or exists(select 1 from jsonb_object_keys(fields) k where k not in ('name','email','phone','company','birth_month','birth_day','birth_year','preferred_channel','marketing_email','marketing_whatsapp','acknowledged'))
    or fields->'acknowledged' is distinct from 'true'::jsonb then raise exception 'Invalid registration' using errcode='23514';end if;
  if (fields ? 'marketing_email' and jsonb_typeof(fields->'marketing_email') is distinct from 'boolean')
    or (fields ? 'marketing_whatsapp' and jsonb_typeof(fields->'marketing_whatsapp') is distinct from 'boolean') then
    raise exception 'Invalid marketing choices' using errcode='23514';end if;
  if (fields ? 'marketing_email' and jsonb_typeof(fields->'marketing_email') is distinct from 'boolean')
    or (fields ? 'marketing_whatsapp' and jsonb_typeof(fields->'marketing_whatsapp') is distinct from 'boolean') then
    raise exception 'Invalid marketing choices' using errcode='23514';end if;
  select name into business_name from public.workspaces where id=f.workspace_id;
  insert into public.registration_submissions(workspace_id,form_id,request_id,form_revision,name,email,phone,company,birth_month,birth_day,birth_year,preferred_channel,marketing_email,marketing_whatsapp,consent_notice)
  values(f.workspace_id,f.id,request_key,f.revision,trim(fields->>'name'),lower(trim(coalesce(fields->>'email',''))),trim(coalesce(fields->>'phone','')),trim(coalesce(fields->>'company','')),
    (fields->>'birth_month')::integer,(fields->>'birth_day')::integer,(fields->>'birth_year')::integer,coalesce(fields->>'preferred_channel','none'),
    coalesce((fields->>'marketing_email')::boolean,false),coalesce((fields->>'marketing_whatsapp')::boolean,false),private.registration_notice(business_name,f.privacy_url));
end $$;
revoke all on function public.public_registration_form(uuid),public.submit_registration(uuid,uuid,integer,jsonb) from public;
grant execute on function public.public_registration_form(uuid),public.submit_registration(uuid,uuid,integer,jsonb) to anon,authenticated;

create function private.same_customer(c public.contacts,s public.registration_submissions) returns boolean language sql immutable set search_path='' as $$
  select (s.email<>'' and lower(trim(c.email))=s.email) or (s.phone<>'' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(s.phone,'[^0-9]','','g'));
$$;
create function public.registration_matches(target uuid,submission uuid) returns table(id uuid,name text,email text,phone text) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_write(target) then raise exception 'Access denied' using errcode='42501';end if;
  return query select c.id,c.name,c.email,c.phone from public.contacts c join public.registration_submissions s on s.id=submission and s.workspace_id=c.workspace_id
    where c.workspace_id=target and private.same_customer(c,s) order by c.created_at limit 20;
end $$;
create function public.review_registration(target uuid,submission uuid,existing_contact uuid default null,identity_verified boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.registration_submissions; result uuid;
begin
  if not private.can_write(target) then raise exception 'Access denied' using errcode='42501';end if;
  -- Serialize intake reviews within a workspace to prevent double creation.
  perform pg_advisory_xact_lock(hashtextextended(target::text,0));
  select * into s from public.registration_submissions where id=submission and workspace_id=target for update;
  if s.id is null or s.status='dismissed' then raise exception 'Submission unavailable' using errcode='P0002';end if;
  if s.status='accepted' then return s.contact_id;end if;
  if existing_contact is not null then
    if identity_verified is distinct from true then raise exception 'Verify the customer identity before updating an existing contact' using errcode='23514';end if;
    perform 1 from public.contacts where id=existing_contact and workspace_id=target and private.same_customer(contacts,s) for update;
    if not found then raise exception 'Choose a matching contact from this workspace' using errcode='23514';end if;
    update public.contacts set name=s.name,email=coalesce(nullif(s.email,''),email),phone=coalesce(nullif(s.phone,''),phone),company=coalesce(nullif(s.company,''),company),
      birth_month=coalesce(s.birth_month,birth_month),birth_day=coalesce(s.birth_day,birth_day),birth_year=case when s.birth_month is null then birth_year else s.birth_year end,
      preferred_channel=s.preferred_channel,marketing_email=s.marketing_email,marketing_whatsapp=s.marketing_whatsapp
      where id=existing_contact and workspace_id=target returning id into result;
  else
    if exists(select 1 from public.contacts where workspace_id=target and private.same_customer(contacts,s)) then raise exception 'A matching contact exists. Verify the customer before applying an update.' using errcode='23505';end if;
    insert into public.contacts(workspace_id,name,email,phone,company,birth_month,birth_day,birth_year,preferred_channel,marketing_email,marketing_whatsapp)
    values(target,s.name,s.email,s.phone,s.company,s.birth_month,s.birth_day,s.birth_year,s.preferred_channel,s.marketing_email,s.marketing_whatsapp) returning id into result;
  end if;
  insert into public.contact_consent_events(workspace_id,contact_id,submission_id,source,actor_id,marketing_email,marketing_whatsapp,notice)
  values(target,result,s.id,'reviewed_registration',auth.uid(),s.marketing_email,s.marketing_whatsapp,s.consent_notice||jsonb_build_object('submitted_at',s.created_at,'existing_identity_verified',existing_contact is not null and identity_verified));
  update public.registration_submissions set status='accepted',contact_id=result,reviewed_by=auth.uid(),reviewed_at=now() where id=s.id;
  return result;
end $$;
create function public.dismiss_registration(target uuid,submission uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.can_write(target) then raise exception 'Access denied' using errcode='42501';end if;
  update public.registration_submissions set status='dismissed',reviewed_by=auth.uid(),reviewed_at=now() where workspace_id=target and id=submission and status='pending';
  if not found then raise exception 'Submission unavailable' using errcode='P0002';end if;
end $$;
create function public.withdraw_contact_marketing(target uuid,customer uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.can_write(target) then raise exception 'Access denied' using errcode='42501';end if;
  update public.contacts set marketing_email=false,marketing_whatsapp=false where workspace_id=target and id=customer;
  if not found then raise exception 'Contact unavailable' using errcode='P0002';end if;
  insert into public.contact_consent_events(workspace_id,contact_id,source,actor_id,marketing_email,marketing_whatsapp,notice)
  values(target,customer,'staff_withdrawal',auth.uid(),false,false,jsonb_build_object('action','All marketing consent withdrawn by a teammate.'));
end $$;
revoke all on function public.registration_matches(uuid,uuid),public.review_registration(uuid,uuid,uuid,boolean),public.dismiss_registration(uuid,uuid),public.withdraw_contact_marketing(uuid,uuid) from public;
grant execute on function public.registration_matches(uuid,uuid),public.review_registration(uuid,uuid,uuid,boolean),public.dismiss_registration(uuid,uuid),public.withdraw_contact_marketing(uuid,uuid) to authenticated;
