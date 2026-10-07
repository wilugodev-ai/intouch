-- An opt-in must not silently follow a changed email address or phone number.
alter table public.contact_consent_events drop constraint contact_consent_events_source_check;
alter table public.contact_consent_events add constraint contact_consent_events_source_check check(source in ('reviewed_registration','staff_withdrawal','contact_details_changed'));
create function private.consent_destination_change() returns trigger language plpgsql security definer set search_path='' as $$
declare email_changed boolean;phone_changed boolean;
begin
  email_changed=lower(trim(new.email))<>lower(trim(old.email));
  phone_changed=regexp_replace(new.phone,'[^0-9]','','g')<>regexp_replace(old.phone,'[^0-9]','','g');
  if email_changed then new.marketing_email=false;end if;
  if phone_changed then new.marketing_whatsapp=false;end if;
  if (email_changed and old.marketing_email) or (phone_changed and old.marketing_whatsapp) then
    insert into public.contact_consent_events(workspace_id,contact_id,source,actor_id,marketing_email,marketing_whatsapp,notice)
    values(old.workspace_id,old.id,'contact_details_changed',auth.uid(),new.marketing_email,new.marketing_whatsapp,jsonb_build_object('action','Consent cleared for changed contact destinations.'));
  end if;
  return new;
end $$;
create trigger consent_destination_change before update on public.contacts for each row execute function private.consent_destination_change();

create or replace function public.review_registration(target uuid,submission uuid,existing_contact uuid default null,identity_verified boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
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
  -- Apply the newly reviewed choices after any destination-change revocation.
  update public.contacts set marketing_email=s.marketing_email,marketing_whatsapp=s.marketing_whatsapp where id=result and workspace_id=target;
  insert into public.contact_consent_events(workspace_id,contact_id,submission_id,source,actor_id,marketing_email,marketing_whatsapp,notice)
  values(target,result,s.id,'reviewed_registration',auth.uid(),s.marketing_email,s.marketing_whatsapp,s.consent_notice||jsonb_build_object('submitted_at',s.created_at,'existing_identity_verified',existing_contact is not null and identity_verified));
  update public.registration_submissions set status='accepted',contact_id=result,reviewed_by=auth.uid(),reviewed_at=now() where id=s.id;
  return result;
end $$;
