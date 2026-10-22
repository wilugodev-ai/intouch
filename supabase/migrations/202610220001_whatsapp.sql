-- WhatsApp data remains workspace scoped. Provider tokens are encrypted by the API.
alter table public.channel_connections drop constraint channel_connections_status_check;
alter table public.channel_connections add constraint channel_connections_status_check check(status in ('connected','connecting','reauthorize','disconnected'));
alter table public.channel_connections add column waba_id text;
alter table public.channel_connections add column phone_number text;
alter table public.channel_connections add column connected_by uuid references auth.users on delete set null;
alter table public.conversations add column external_participant text;
alter table public.conversations add column last_inbound_at timestamptz;
create unique index whatsapp_participant on public.conversations(connection_id,external_participant) where external_participant is not null;
alter table public.messages add column kind text not null default 'text';
alter table public.messages add column delivery_status text not null default 'received';
alter table public.messages add column request_key uuid;
alter table public.messages add column actor_id uuid references auth.users on delete set null;
alter table public.messages add column error_code text;
create unique index whatsapp_send_request on public.messages(workspace_id,request_key) where request_key is not null;
create index whatsapp_thread_order on public.messages(conversation_id,created_at,id);
create table private.whatsapp_credentials (
  connection_id uuid primary key references public.channel_connections on delete cascade,
  encrypted_token text not null check(length(encrypted_token) between 30 and 20000),
  provider_user_id text not null, expires_at timestamptz, updated_at timestamptz not null default now()
);
create table private.whatsapp_account_links (connection_id uuid not null references public.channel_connections on delete cascade,provider_user_id text not null,primary key(connection_id,provider_user_id));
create table private.whatsapp_signup (
  state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.whatsapp_receipts (
  phone_id text not null,message_id text not null,status text not null check(status in ('sent','delivered','read','failed')),
  occurred_at timestamptz not null,error_code text,primary key(phone_id,message_id,status)
);
create table private.whatsapp_deletions (
  id uuid primary key default gen_random_uuid(),provider_user_id text not null,created_at timestamptz not null default now(),status text not null default 'pending',connection_ids uuid[] not null default '{}'
);
alter table private.whatsapp_credentials enable row level security;
alter table private.whatsapp_account_links enable row level security;
alter table private.whatsapp_signup enable row level security;
alter table private.whatsapp_receipts enable row level security;
alter table private.whatsapp_deletions enable row level security;
revoke all on private.whatsapp_credentials,private.whatsapp_account_links,private.whatsapp_signup,private.whatsapp_receipts,private.whatsapp_deletions from public,anon,authenticated;

create function public.whatsapp_begin_signup(target uuid,nonce_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(target) then raise exception 'Only workspace owners can connect WhatsApp' using errcode='42501';end if;
  delete from private.whatsapp_signup where expires_at<now() or (workspace_id=target and user_id=auth.uid());
  insert into private.whatsapp_signup(state_hash,workspace_id,user_id) values(nonce_hash,target,auth.uid());return true;
end $$;
create function public.whatsapp_consume_signup(target uuid,nonce_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare consumed text;
begin
  if not private.is_owner(target) then raise exception 'Only workspace owners can connect WhatsApp' using errcode='42501';end if;
  delete from private.whatsapp_signup where state_hash=nonce_hash and workspace_id=target and user_id=auth.uid() and expires_at>now() returning state_hash into consumed;
  if consumed is null then raise exception 'Connection attempt expired or was already used' using errcode='23514';end if;return true;
end $$;
create function public.whatsapp_disconnect(target uuid,connection uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(target) then raise exception 'Only workspace owners can disconnect WhatsApp' using errcode='42501';end if;
  update public.channel_connections set status='disconnected' where workspace_id=target and id=connection and channel='WhatsApp';
  if not found then raise exception 'Connection not found' using errcode='23514';end if;
  delete from private.whatsapp_credentials where connection_id=connection;return true;
end $$;
create function public.whatsapp_prepare_send(target uuid,thread uuid,request_id uuid,content text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations;connection public.channel_connections;m public.messages;was_created boolean=false;
begin
  if not private.can_write(target) then raise exception 'Your role cannot send messages' using errcode='42501';end if;
  if content is null or length(trim(content)) not between 1 and 4096 or request_id is null then raise exception 'Invalid message' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(target::text||request_id::text,0));
  select * into m from public.messages where workspace_id=target and request_key=request_id;
  if found then
    if m.conversation_id<>thread or m.body<>trim(content) or m.actor_id<>auth.uid() then raise exception 'Message request does not match' using errcode='23514';end if;
    return jsonb_build_object('created',false,'message',to_jsonb(m));
  end if;
  select * into c from public.conversations where workspace_id=target and id=thread;
  if not found then raise exception 'Conversation not found' using errcode='23514';end if;
  select * into connection from public.channel_connections where id=c.connection_id and workspace_id=target and channel='WhatsApp' and status='connected';
  if not found then raise exception 'Reconnect WhatsApp before sending' using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended(connection.id::text,3));
  if (select count(*) from public.messages msg join public.conversations conv on conv.id=msg.conversation_id where conv.connection_id=connection.id and msg.direction='outbound' and msg.created_at>now()-interval '1 minute')>=30 or (select count(*) from public.messages msg join public.conversations conv on conv.id=msg.conversation_id where conv.connection_id=connection.id and msg.direction='outbound' and msg.created_at>now()-interval '1 day')>=500 then raise exception 'Message limit reached' using errcode='23514';end if;
  if c.external_participant is null or c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' then raise exception 'The customer must message you again before you can send a text reply' using errcode='23514';end if;
  insert into public.messages(workspace_id,conversation_id,provider_message_id,direction,body,request_key,actor_id,delivery_status)
    values(target,thread,'pending:'||request_id::text,'outbound',trim(content),request_id,auth.uid(),'sending') returning * into m;
  return jsonb_build_object('created',true,'message',to_jsonb(m),'phone_id',connection.external_account_id,'recipient',c.external_participant,'connection_id',connection.id);
end $$;
revoke all on function public.whatsapp_begin_signup(uuid,text),public.whatsapp_consume_signup(uuid,text),public.whatsapp_disconnect(uuid,uuid),public.whatsapp_prepare_send(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.whatsapp_begin_signup(uuid,text),public.whatsapp_consume_signup(uuid,text),public.whatsapp_disconnect(uuid,uuid),public.whatsapp_prepare_send(uuid,uuid,uuid,text) to authenticated;

create function private.whatsapp_apply_receipt(phone text,provider_id text) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages;r record;selected_status text;
begin
  select msg.* into m from public.messages msg join public.conversations c on c.id=msg.conversation_id join public.channel_connections cc on cc.id=c.connection_id
    where cc.channel='WhatsApp' and cc.external_account_id=phone and msg.provider_message_id=provider_id and msg.direction='outbound' for update of msg;
  if not found then return;end if;
  selected_status=m.delivery_status;
  for r in select * from private.whatsapp_receipts where phone_id=phone and message_id=provider_id order by occurred_at loop
    if selected_status='read' then continue;end if;
    if r.status='read' or (r.status='delivered' and selected_status<>'read') or (r.status='sent' and selected_status not in ('delivered','read','failed')) or (r.status='failed' and selected_status not in ('delivered','read')) then selected_status=r.status;end if;
  end loop;
  update public.messages set delivery_status=selected_status,error_code=(select error_code from private.whatsapp_receipts where phone_id=phone and message_id=provider_id and status='failed') where id=m.id;
end $$;
revoke all on function private.whatsapp_apply_receipt(text,text) from public,anon,authenticated;

create function public.whatsapp_server(action text,payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cc public.channel_connections;c public.conversations;m public.messages;cred private.whatsapp_credentials;
  customer uuid;matches integer;event jsonb;party text;received timestamptz;request_id uuid;result_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server authorization required' using errcode='42501';end if;
  if jsonb_typeof(payload)<>'object' then raise exception 'Invalid server request' using errcode='23514';end if;
  case action
  when 'health' then return '{"ready":true}'::jsonb;
  when 'connect' then
    if not exists(select 1 from public.workspace_members where workspace_id=(payload->>'workspace')::uuid and user_id=(payload->>'user')::uuid and role='owner') then raise exception 'Owner access was removed' using errcode='42501';end if;
    if payload->>'phone_id' !~ '^[0-9]{5,30}$' or payload->>'waba_id' !~ '^[0-9]{5,30}$' then raise exception 'Invalid account' using errcode='23514';end if;
    perform pg_advisory_xact_lock(hashtextextended(payload->>'phone_id',1));
    select * into cc from public.channel_connections where channel='WhatsApp' and external_account_id=payload->>'phone_id' for update;
    if found and cc.workspace_id<>(payload->>'workspace')::uuid then raise exception 'This number is already linked to another workspace' using errcode='23505';end if;
    if cc.id is null then
      insert into public.channel_connections(workspace_id,channel,external_account_id,display_name,status,waba_id,phone_number,connected_by)
        values((payload->>'workspace')::uuid,'WhatsApp',payload->>'phone_id',left(payload->>'display_name',300),'connecting',payload->>'waba_id',payload->>'phone_number',(payload->>'user')::uuid) returning * into cc;
    else
      update public.channel_connections set display_name=left(payload->>'display_name',300),status='connecting',waba_id=payload->>'waba_id',phone_number=payload->>'phone_number',connected_by=(payload->>'user')::uuid where id=cc.id returning * into cc;
    end if;
    insert into private.whatsapp_credentials(connection_id,encrypted_token,provider_user_id,expires_at) values(cc.id,payload->>'encrypted_token',payload->>'provider_user_id',nullif(payload->>'expires_at','')::timestamptz)
      on conflict(connection_id) do update set encrypted_token=excluded.encrypted_token,provider_user_id=excluded.provider_user_id,expires_at=excluded.expires_at,updated_at=now();
    insert into private.whatsapp_account_links(connection_id,provider_user_id) values(cc.id,payload->>'provider_user_id') on conflict do nothing;
    return to_jsonb(cc);
  when 'activate' then
    if not exists(select 1 from public.workspace_members where workspace_id=(payload->>'workspace')::uuid and user_id=(payload->>'user')::uuid and role='owner') then raise exception 'Owner access was removed' using errcode='42501';end if;
    update public.channel_connections set status='connected' where id=(payload->>'connection')::uuid and workspace_id=(payload->>'workspace')::uuid and channel='WhatsApp' and status='connecting' returning * into cc;
    if cc.id is null then raise exception 'Connection is not ready' using errcode='23514';end if;return to_jsonb(cc);
  when 'credential' then
    select * into cc from public.channel_connections where id=(payload->>'connection')::uuid and workspace_id=(payload->>'workspace')::uuid and channel='WhatsApp' and status='connected';
    if not found then return null;end if;
    select * into cred from private.whatsapp_credentials where connection_id=cc.id;
    if not found or cred.expires_at<=now() then return null;end if;
    return jsonb_build_object('encrypted_token',cred.encrypted_token,'phone_id',cc.external_account_id,'waba_id',cc.waba_id);
  when 'reauthorize' then
    update public.channel_connections set status='reauthorize' where id=(payload->>'connection')::uuid and workspace_id=(payload->>'workspace')::uuid and channel='WhatsApp';
    delete from private.whatsapp_credentials where connection_id=(payload->>'connection')::uuid;return '{"updated":true}'::jsonb;
  when 'inbound' then
    if jsonb_typeof(payload->'events')<>'array' or jsonb_array_length(payload->'events')>1000 then raise exception 'Invalid events' using errcode='23514';end if;
    for event in select value from jsonb_array_elements(payload->'events') loop
      select * into cc from public.channel_connections where channel='WhatsApp' and external_account_id=event->>'phone_id' and waba_id=event->>'waba_id' and status in ('connected','connecting') and exists(select 1 from private.whatsapp_credentials where connection_id=public.channel_connections.id);
      if not found then continue;end if;
      if event->>'event'='status' then
        insert into private.whatsapp_receipts(phone_id,message_id,status,occurred_at,error_code) values(cc.external_account_id,event->>'id',event->>'status',(event->>'timestamp')::timestamptz,event->>'error_code') on conflict do nothing;
        perform private.whatsapp_apply_receipt(cc.external_account_id,event->>'id');continue;
      end if;
      party=event->>'from';if party !~ '^[0-9]{7,15}$' then raise exception 'Invalid sender' using errcode='23514';end if;
      perform pg_advisory_xact_lock(hashtextextended(cc.id::text||party,2));
      select * into c from public.conversations where connection_id=cc.id and external_participant=party;
      received=least((event->>'timestamp')::timestamptz,now());
      if c.id is null then
        select count(*),min(id::text)::uuid into matches,customer from public.contacts where workspace_id=cc.workspace_id and regexp_replace(phone,'[^0-9]','','g')=party;
        if matches<>1 then
          insert into public.contacts(workspace_id,name,phone,preferred_channel) values(cc.workspace_id,left(coalesce(nullif(event->>'name',''),'WhatsApp +'||party),300),'+'||party,'whatsapp') returning id into customer;
        end if;
        insert into public.conversations(workspace_id,contact_id,connection_id,external_participant,last_inbound_at) values(cc.workspace_id,customer,cc.id,party,received) returning * into c;
      else update public.conversations set last_inbound_at=greatest(last_inbound_at,received),status='Open' where id=c.id;end if;
      insert into public.messages(workspace_id,conversation_id,provider_message_id,direction,body,kind,created_at,delivery_status)
        values(cc.workspace_id,c.id,event->>'id','inbound',left(event->>'body',4096),event->>'kind',received,'received') on conflict(workspace_id,provider_message_id) do nothing;
    end loop;return '{"processed":true}'::jsonb;
  when 'finish_send' then
    select * into m from public.messages where workspace_id=(payload->>'workspace')::uuid and request_key=(payload->>'request')::uuid for update;
    if not found then raise exception 'Message not found' using errcode='23514';end if;
    if m.delivery_status<>'sending' then return to_jsonb(m);end if;
    update public.messages set provider_message_id=coalesce(payload->>'provider_id',provider_message_id),delivery_status=payload->>'status',error_code=payload->>'error_code' where id=m.id returning * into m;
    if payload->>'provider_id' is not null then
      select connection.* into cc from public.channel_connections connection join public.conversations conv on conv.connection_id=connection.id where conv.id=m.conversation_id;
      perform private.whatsapp_apply_receipt(cc.external_account_id,m.provider_message_id);
    end if;
    select * into m from public.messages where id=m.id;return to_jsonb(m);
  when 'revoke' then
    update public.channel_connections set status='reauthorize' where id in(select connection_id from private.whatsapp_credentials where provider_user_id=payload->>'user_id');
    delete from private.whatsapp_credentials where provider_user_id=payload->>'user_id';return '{"revoked":true}'::jsonb;
  when 'delete_request' then
    insert into private.whatsapp_deletions(provider_user_id,connection_ids) values(payload->>'user_id',coalesce((select array_agg(connection_id) from private.whatsapp_account_links where provider_user_id=payload->>'user_id'),'{}')) returning id into result_id;
    update public.channel_connections set status='disconnected' where id in(select connection_id from private.whatsapp_credentials where provider_user_id=payload->>'user_id');
    delete from private.whatsapp_credentials where provider_user_id=payload->>'user_id';
    return jsonb_build_object('id',result_id,'status','pending');
  when 'deletion_status' then
    select id into result_id from private.whatsapp_deletions where id=(payload->>'id')::uuid;
    if result_id is null then return null;end if;
    return (select jsonb_build_object('id',id,'status',status) from private.whatsapp_deletions where id=result_id);
  else raise exception 'Unknown server operation' using errcode='23514';
  end case;
end $$;
revoke all on function public.whatsapp_server(text,jsonb) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.whatsapp_server(text,jsonb) to service_role;end if;end $$;