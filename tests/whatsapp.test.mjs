import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sealToken,openToken,tokenKey,validWebhook,signedMetaRequest,webhookEvents,stateHash} from '../apps/api/src/whatsapp-rules.ts';

test('WhatsApp tokens bind to their workspace and phone; signatures require exact raw bytes',()=>{
  const key=tokenKey(randomBytes(32).toString('base64')),token='server-only-access-token',sealed=sealToken(token,key,'workspace-a','123456');
  assert.equal(openToken(sealed,key,'workspace-a','123456'),token);assert.ok(!sealed.includes(token));
  for(const [workspace,phone] of [['workspace-b','123456'],['workspace-a','987654']])assert.throws(()=>openToken(sealed,key,workspace,phone));
  assert.throws(()=>openToken(sealed.slice(0,-5)+'abcde',key,'workspace-a','123456'));assert.throws(()=>tokenKey('short'));
  const raw=Buffer.from('{"message":"hello"}'),secret='app-secret-for-signatures',signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
  assert.ok(validWebhook(raw,signature,secret));assert.equal(validWebhook(Buffer.from('{ "message":"hello"}'),signature,secret),false);assert.equal(validWebhook(raw,undefined,secret),false);assert.equal(validWebhook(raw,signature,''),false);
  const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:'123456',issued_at:Math.floor(Date.now()/1000)})).toString('base64url');const signed=createHmac('sha256',secret).update(payload).digest('base64url')+'.'+payload;
  assert.equal(signedMetaRequest(signed,secret).user_id,'123456');assert.throws(()=>signedMetaRequest(signed,'another-secret'));assert.equal(stateHash('ticket').length,64);
});

test('WhatsApp webhook normalization processes every event and ignores caller-supplied workspaces',()=>{
  const timestamp=String(Math.floor(Date.now()/1000));const value={metadata:{phone_number_id:'123456'},workspace:'attacker-choice',contacts:[{wa_id:'15551234567',profile:{name:'Customer'}}],messages:[{id:'wamid.one',from:'15551234567',type:'text',text:{body:'Hello'},timestamp},{id:'wamid.two',from:'15551234567',type:'image',timestamp}],statuses:[{id:'wamid.outbound',status:'delivered',timestamp}]};
  const events=webhookEvents({object:'whatsapp_business_account',entry:[{id:'654321',changes:[{field:'messages',value}]}]});assert.equal(events.length,3);assert.equal(events[0].body,'Hello');assert.equal(events[0].name,'Customer');assert.equal(events[1].kind,'image');assert.equal(events[2].status,'delivered');assert.equal(events[0].workspace,undefined);
  assert.throws(()=>webhookEvents({object:'whatsapp_business_account',entry:[{id:'bad',changes:[{field:'messages',value}]}]}));
  assert.throws(()=>webhookEvents({object:'whatsapp_business_account',entry:[{id:'654321',changes:[{field:'messages',value:{...value,messages:[{...value.messages[0],timestamp:'not-a-time'}]}}]}]}));
  assert.deepEqual(webhookEvents({object:'unknown'}),[]);
});

test('WhatsApp database isolates account connections, private credentials, inbound messages and outbound requests',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
    const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,directory),'utf8'));
    const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';await db.query('insert into auth.users(id) values($1),($2),($3)',[a,b,viewer]);
    async function asUser(user,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:user})]);await db.exec('set role '+role);}
    await asUser(a);const wa=(await db.query("select public.create_workspace('WhatsApp A') id")).rows[0].id;await asUser(b);const wb=(await db.query("select public.create_workspace('WhatsApp B') id")).rows[0].id;
    await db.exec('reset role');await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",[wa,viewer]);
    await asUser(a);const hash=stateHash('one-use-ticket');await db.query('select public.whatsapp_begin_signup($1,$2)',[wa,hash]);await asUser(b);await assert.rejects(db.query('select public.whatsapp_consume_signup($1,$2)',[wa,hash]),/Only workspace owners/);await asUser(a);await db.query('select public.whatsapp_consume_signup($1,$2)',[wa,hash]);await assert.rejects(db.query('select public.whatsapp_consume_signup($1,$2)',[wa,hash]),/expired or was already used/);
    await assert.rejects(db.query("select public.whatsapp_server('health')"),/permission denied/);await assert.rejects(db.query('select * from private.whatsapp_credentials'),/permission denied/);
    async function server(action,payload={}){await asUser(null,'service_role');return (await db.query('select public.whatsapp_server($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
    const credential='encrypted-token-with-more-than-thirty-characters';const connection=await server('connect',{workspace:wa,user:a,phone_id:'123456',waba_id:'654321',display_name:'Business A',phone_number:'+15551112222',provider_user_id:'777777',encrypted_token:credential});assert.equal(connection.status,'connecting');
    await server('activate',{workspace:wa,user:a,connection:connection.id});
    await assert.rejects(server('connect',{workspace:wb,user:b,phone_id:'123456',waba_id:'654321',display_name:'Steal A',provider_user_id:'888888',encrypted_token:credential}),/already linked/);
    const connB=await server('connect',{workspace:wb,user:b,phone_id:'222222',waba_id:'333333',display_name:'Business B',provider_user_id:'888888',encrypted_token:credential});await server('activate',{workspace:wb,user:b,connection:connB.id});
    const timestamp=new Date().toISOString(),inbound={event:'message',phone_id:'123456',waba_id:'654321',id:'wamid.inbound-a',timestamp,from:'15551234567',name:'Customer A',kind:'text',body:'Hello A',workspace:wb};
    await server('inbound',{events:[inbound,inbound,{...inbound,phone_id:'222222',waba_id:'333333',id:'wamid.inbound-b',body:'Hello B'},{...inbound,phone_id:'999999',id:'unknown-phone'}]});
    await asUser(a);const conversations=(await db.query('select * from public.conversations')).rows;assert.equal(conversations.length,1);const conversation=conversations[0];assert.equal(conversation.workspace_id,wa);assert.equal((await db.query('select * from public.messages')).rows.length,1);assert.equal((await db.query('select marketing_whatsapp from public.contacts')).rows[0].marketing_whatsapp,false);
    await asUser(b);assert.equal((await db.query('select * from public.messages')).rows[0].body,'Hello B');await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,'44444444-4444-4444-8444-444444444444','Cross business']),/role cannot send/);
    await asUser(viewer);await assert.rejects(db.query('select public.whatsapp_begin_signup($1,$2)',[wa,stateHash('viewer')]),/Only workspace owners/);await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,'44444444-4444-4444-8444-444444444444','Viewer reply']),/role cannot send/);
    await asUser(a);const request='44444444-4444-4444-8444-444444444444';let prepared=(await db.query('select public.whatsapp_prepare_send($1,$2,$3,$4) result',[wa,conversation.id,request,'Authorized reply'])).rows[0].result;assert.equal(prepared.created,true);prepared=(await db.query('select public.whatsapp_prepare_send($1,$2,$3,$4) result',[wa,conversation.id,request,'Authorized reply'])).rows[0].result;assert.equal(prepared.created,false);await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,request,'Changed retry']),/does not match/);
    await server('inbound',{events:[{event:'status',phone_id:'123456',waba_id:'654321',id:'wamid.outbound',status:'read',timestamp}]});const sent=await server('finish_send',{workspace:wa,request,provider_id:'wamid.outbound',status:'accepted'});assert.equal(sent.delivery_status,'read');await server('inbound',{events:[{event:'status',phone_id:'123456',waba_id:'654321',id:'wamid.outbound',status:'sent',timestamp}]});
    await asUser(a);assert.equal((await db.query("select delivery_status from public.messages where direction='outbound'")).rows[0].delivery_status,'read');
    await db.exec('reset role');
    await db.query("insert into public.messages(workspace_id,conversation_id,provider_message_id,direction,body) select $1,$2,'rate:'||n,'outbound','Quota verification' from generate_series(1,29) n",[wa,conversation.id]);await asUser(a);
    await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,'66666666-6666-4666-8666-666666666666','Burst limited']),/Message limit reached/);
    await db.exec('reset role');await db.query("update public.messages set created_at=now()-interval '2 minutes' where direction='outbound'");await db.query("insert into public.messages(workspace_id,conversation_id,provider_message_id,direction,body,created_at) select $1,$2,'rate:'||n,'outbound','Quota verification',now()-interval '2 minutes' from generate_series(30,499) n",[wa,conversation.id]);await asUser(a);
    await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,'66666666-6666-4666-8666-666666666666','Daily limited']),/Message limit reached/);
    await db.exec('reset role');await db.query("delete from public.messages where body='Quota verification'");
    await db.exec('reset role');await db.query("update public.conversations set last_inbound_at=now()-interval '25 hours' where id=$1",[conversation.id]);await asUser(a);await assert.rejects(db.query('select public.whatsapp_prepare_send($1,$2,$3,$4)',[wa,conversation.id,'55555555-5555-4555-8555-555555555555','Expired window']),/must message you again/);
    const deletion=await server('delete_request',{user_id:'777777'});assert.equal(deletion.status,'pending');assert.equal(await server('credential',{workspace:wa,connection:connection.id}),null);assert.equal((await server('deletion_status',{id:deletion.id})).status,'pending');await asUser(a);assert.equal((await db.query('select status from public.channel_connections')).rows[0].status,'disconnected');
  }finally{await db.close();}
});