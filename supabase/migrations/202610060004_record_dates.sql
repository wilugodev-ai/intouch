-- Derive lifecycle dates after the default stage is selected. Clients cannot
-- rewrite these dates by changing unrelated fields or supplying a timestamp.
create or replace function private.deal_closed_date() returns trigger language plpgsql set search_path='' as $$
declare closed boolean;
begin
  select kind in ('won','lost') into closed from public.pipeline_stages where workspace_id=new.workspace_id and name=new.stage;
  if closed then
    if tg_op='INSERT' then new.closed_at=now();else new.closed_at=coalesce(old.closed_at,now());end if;
  else new.closed_at=null;end if;
  return new;
end $$;
drop trigger deal_closed_date on public.deals;
create trigger z_deal_closed_date before insert or update on public.deals for each row execute function private.deal_closed_date();
create or replace function private.ticket_resolved() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='resolved' then
    if tg_op='INSERT' then new.resolved_at=now();else new.resolved_at=coalesce(old.resolved_at,now());end if;
  else new.resolved_at=null;end if;return new;
end $$;
