import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHmac,randomBytes} from 'node:crypto';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('reflect-metadata');
const {Module,HttpException,ServiceUnavailableException}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {WhatsAppController,WhatsAppWebhookController}=require('./dist/whatsapp'),{WhatsAppStore}=require('./dist/whatsapp-store'),{WhatsAppProvider,MetaFailure}=require('./dist/whatsapp-provider'),{Database}=require('./dist/database');
const {openToken,tokenKey}=require('./dist/whatsapp-rules');

test('WhatsApp HTTP verifies raw webhooks, owner signup, one-use state, send idempotency and uncertain delivery',async()=>{
  const previous={};for(const key of ['META_APP_SECRET','META_WEBHOOK_VERIFY_TOKEN','META_PUBLIC_API_ORIGIN'])previous[key]=process.env[key];
  process.env.META_APP_SECRET='http-test-app-secret';process.env.META_WEBHOOK_VERIFY_TOKEN='verify-test-token';process.env.META_PUBLIC_API_ORIGIN='https://api.example.com';
  const workspace='11111111-1111-4111-8111-111111111111',thread='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333';
  const key=tokenKey(randomBytes(32).toString('base64'));let saved,credential,providerCalls=0,exchanges=0,uncertain=false,persistFail=false,webhookCount=0;const attempts=new Set(),messages=new Map();
  const store={ready:async()=>true,key:()=>key,access:async(target,authorization,level='read')=>{if(!authorization)throw new HttpException('Sign in',401);if(target!==workspace||authorization==='Bearer outsider')throw new HttpException('Not found',404);if(authorization==='Bearer viewer'&&level!=='read')throw new HttpException('Denied',403);if(authorization==='Bearer member'&&level==='owner')throw new HttpException('Denied',403);return {user:{id:'owner-user'},client:{},role:authorization==='Bearer viewer'?'viewer':'owner'};},
    userRpc:async(_client,name,args)=>{if(name==='whatsapp_begin_signup'){attempts.add(args.nonce_hash);return true;}if(name==='whatsapp_consume_signup'){if(!attempts.delete(args.nonce_hash))throw new HttpException('Expired state',400);return true;}if(name==='whatsapp_prepare_send'){const existing=messages.get(args.request_id);if(existing)return {created:false,message:existing};const message={id:args.request_id,body:args.content,delivery_status:'sending'};messages.set(args.request_id,message);return {created:true,message,connection_id:connection,recipient:'15551234567'};}return true;},
    server:async(action,payload)=>{if(action==='connect'){saved=payload;credential={encrypted_token:payload.encrypted_token,phone_id:payload.phone_id};return {id:connection,status:'connecting'};}if(action==='activate')return {id:connection,status:'connected'};if(action==='credential')return credential;if(action==='finish_send'){const value={...messages.get(payload.request),delivery_status:payload.status};messages.set(payload.request,value);return value;}if(action==='inbound'){if(persistFail)throw new ServiceUnavailableException('Storage unavailable');webhookCount+=payload.events.length;return {processed:true};}if(action==='delete_request')return {id:connection,status:'pending'};return {updated:true};}};
  const provider={exchange:async()=>{exchanges++;return 'private-meta-token';},validate:async(_token,waba,phone)=>{if(waba!=='654321'||phone!=='123456')throw new HttpException('Not authorized',403);return {registered:true,phone:{verified_name:'Business',display_phone_number:'+15551112222'},user:'777777',expiresAt:null};},register:async()=>{},subscribe:async()=>{},send:async()=>{providerCalls++;if(uncertain)throw new MetaFailure(0,true);return 'wamid.outgoing';}};
  class TestModule{}Module({controllers:[WhatsAppController,WhatsAppWebhookController],providers:[{provide:WhatsAppStore,useValue:store},{provide:WhatsAppProvider,useValue:provider},{provide:Database,useValue:{check:()=>{}}}]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false,rawBody:true});app.useBodyParser('json',{limit:'1mb'});await app.listen(0,'127.0.0.1');const origin=await app.getUrl(),base=`/v1/whatsapp/${workspace}`;
  async function post(path,data,role='owner',headers={}){return fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${role}`} : {}),...headers},body:JSON.stringify(data)});}
  try{
    assert.equal((await post(base+'/signup',{},'viewer')).status,403);assert.equal((await post(base+'/signup',{},'member')).status,403);assert.equal((await post(base+'/signup',{},null)).status,401);
    let response=await post(base+'/signup',{});assert.equal(response.status,201);const {state}=await response.json();const connect={state,code:'one-time-code',phoneId:'123456',wabaId:'654321'};response=await post(base+'/connect',connect);assert.equal(response.status,201);assert.equal((await response.json()).status,'connected');assert.equal(exchanges,1);assert.ok(!JSON.stringify(saved).includes('private-meta-token'));assert.equal(openToken(saved.encrypted_token,key,workspace,'123456'),'private-meta-token');assert.throws(()=>openToken(saved.encrypted_token,key,'other-workspace','123456'));
    assert.equal((await post(base+'/connect',connect)).status,400);assert.equal(exchanges,1);
    const raw={object:'whatsapp_business_account',entry:[{id:'654321',changes:[{field:'messages',value:{metadata:{phone_number_id:'123456'},messages:[{id:'wamid.inbound',from:'15551234567',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Hello'}}]}}]}]};const signature='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(JSON.stringify(raw)).digest('hex');
    assert.equal((await post('/v1/meta/whatsapp',raw,null)).status,401);assert.equal(webhookCount,0);assert.equal((await post('/v1/meta/whatsapp',raw,null,{'x-hub-signature-256':signature})).status,200);assert.equal(webhookCount,1);
    persistFail=true;assert.equal((await post('/v1/meta/whatsapp',raw,null,{'x-hub-signature-256':signature})).status,503);persistFail=false;
    const verify=await fetch(origin+'/v1/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=12345');assert.equal(verify.status,200);assert.equal(await verify.text(),'12345');
    assert.equal((await fetch(origin+'/v1/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')).status,403);
    const requestId='44444444-4444-4444-8444-444444444444';assert.equal((await post(`${base}/conversations/${thread}/messages`,{requestId,body:'Reply'},'viewer')).status,403);assert.equal(providerCalls,0);
    response=await post(`${base}/conversations/${thread}/messages`,{requestId,body:'Reply'});assert.equal((await response.json()).delivery_status,'accepted');await post(`${base}/conversations/${thread}/messages`,{requestId,body:'Reply'});assert.equal(providerCalls,1);
    uncertain=true;const request2='55555555-5555-4555-8555-555555555555';response=await post(`${base}/conversations/${thread}/messages`,{requestId:request2,body:'Another reply'});assert.equal((await response.json()).delivery_status,'unknown');await post(`${base}/conversations/${thread}/messages`,{requestId:request2,body:'Another reply'});assert.equal(providerCalls,2);
    const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:'777777'})).toString('base64url'),signed=createHmac('sha256',process.env.META_APP_SECRET).update(payload).digest('base64url')+'.'+payload;
    const deauth=await fetch(origin+'/v1/meta/whatsapp/deauthorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({signed_request:signed})});assert.equal(deauth.status,200);
    response=await post('/v1/meta/whatsapp/delete',{signed_request:signed},null);assert.equal(response.status,200);assert.equal((await response.json()).confirmation_code,connection);
  }finally{await app.close();for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

test('Meta Graph provider validates the authorized app, scopes and phone before sending',async()=>{
  const previous=Object.fromEntries(['META_APP_ID','META_APP_SECRET','META_GRAPH_API_VERSION'].map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
  process.env.META_APP_ID='123456';process.env.META_APP_SECRET='provider-test-secret';process.env.META_GRAPH_API_VERSION='v25.0';
  const provider=new WhatsAppProvider(),calls=[];let appId='123456',scopes=['whatsapp_business_management','whatsapp_business_messaging'],authorizedPhone='111111',failure=0;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://graph.facebook.com');assert.ok(url.pathname.startsWith('/v25.0/'));calls.push({url,options});
    if(url.pathname.endsWith('/oauth/access_token')){assert.equal(url.searchParams.get('client_secret'),'provider-test-secret');assert.equal(url.searchParams.get('code'),'private-code');return Response.json({access_token:'private-token'});}
    assert.equal(url.searchParams.get('appsecret_proof'),createHmac('sha256','provider-test-secret').update(options.headers.Authorization.slice(7)).digest('hex'));
    if(url.pathname.endsWith('/debug_token'))return Response.json({data:{is_valid:true,app_id:appId,user_id:'777777',scopes,expires_at:2000000000}});
    if(url.pathname.endsWith('/phone_numbers'))return Response.json({data:[{id:authorizedPhone,display_phone_number:'+15551112222',verified_name:'Business'}],...(url.searchParams.has('after')?{}:{paging:{next:'https://untrusted.example/ignored',cursors:{after:'next-page'}}})});
    if(url.pathname.endsWith('/messages')){if(failure===1)throw Error('Network failure with potentially private content');if(failure===2)return Response.json({error:{code:190,message:'private-provider-detail'}},{status:401});const body=JSON.parse(options.body);assert.deepEqual(body,{messaging_product:'whatsapp',recipient_type:'individual',to:'15551234567',type:'text',text:{preview_url:false,body:'Hello'}});return Response.json({messages:[{id:'wamid.provider'}]});}
    if(url.pathname.endsWith('/register')){assert.deepEqual(JSON.parse(options.body),{messaging_product:'whatsapp',pin:'123456'});return Response.json({success:true});}
    if(url.pathname.endsWith('/subscribed_apps'))return Response.json({success:true});
    return Response.json({id:'123456',status:'CONNECTED'});
  };
  try{
    assert.equal(await provider.exchange('private-code'),'private-token');
    await assert.rejects(provider.validate('private-token','654321','123456'),/not authorized/);authorizedPhone='123456';
    const account=await provider.validate('private-token','654321','123456');assert.equal(account.registered,true);assert.equal(account.user,'777777');
    appId='999999';await assert.rejects(provider.validate('private-token','654321','123456'),/required WhatsApp access/);appId='123456';scopes=['whatsapp_business_management'];await assert.rejects(provider.validate('private-token','654321','123456'),/required WhatsApp access/);scopes.push('whatsapp_business_messaging');
    await provider.register('private-token','123456','123456');await provider.subscribe('private-token','654321');assert.equal(await provider.send('private-token','123456','15551234567','Hello'),'wamid.provider');
    failure=1;await assert.rejects(provider.send('private-token','123456','15551234567','Hello'),error=>error instanceof MetaFailure&&error.uncertain&&!error.message.includes('private'));failure=2;await assert.rejects(provider.send('private-token','123456','15551234567','Hello'),error=>error instanceof MetaFailure&&error.code===190&&!error.uncertain&&!error.message.includes('private'));
    assert.ok(calls.some(call=>call.url.searchParams.get('after')==='next-page'));
  }finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
