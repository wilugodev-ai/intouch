import {BadRequestException,Body,Controller,Delete,Get,Header,Headers,HttpCode,HttpException,Param,Post,Query,Req,ServiceUnavailableException} from '@nestjs/common';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WhatsAppStore} from './whatsapp-store';
import {WhatsAppProvider,MetaFailure} from './whatsapp-provider';
import {Database} from './database';
import {linkedContacts,requireContact} from './records';
import {validId} from './attachment-rules';
import {openToken,sealToken,signedMetaRequest,stateHash,validWebhook,webhookEvents} from './whatsapp-rules';
function page(value:unknown){if(value===undefined)return 0;if(typeof value!=='string'||!/^\d{1,6}$/.test(value))throw new BadRequestException('Invalid page');return Number(value);}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new BadRequestException('Check the required fields');return value.trim();}
function id(value:string){if(!validId(value))throw new BadRequestException('Invalid record');return value;}
@Controller('v1/whatsapp/:workspace')
export class WhatsAppController {
  constructor(private readonly store:WhatsAppStore,private readonly provider:WhatsAppProvider,private readonly db:Database){}
  @Get('configuration') @Header('Cache-Control','private, no-store')
  async configuration(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){
    const {client,role}=await this.store.access(workspace,auth);const {data,error}=await client.from('channel_connections').select('*').eq('workspace_id',workspace).eq('channel','WhatsApp').order('created_at').limit(100);this.db.check(error);
    const schema=await client.from('conversations').select('external_participant').limit(0);const schemaReady=!schema.error;const enabled=schemaReady&&await this.store.ready();return {enabled,schemaReady,role,connections:data||[],...(enabled?{appId:process.env.META_APP_ID,configId:process.env.META_WHATSAPP_CONFIG_ID,version:process.env.META_GRAPH_API_VERSION}:{})};
  }
  @Post('signup')
  async begin(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){
    const {client}=await this.store.access(workspace,auth,'owner');if(!await this.store.ready())throw new ServiceUnavailableException('WhatsApp connections are not available yet.');
    const state=randomBytes(32).toString('hex');await this.store.userRpc(client,'whatsapp_begin_signup',{target:workspace,nonce_hash:stateHash(state)});return {state,expiresIn:600};
  }
  @Post('connect')
  async connect(@Param('workspace') workspace:string,@Body() body:Record<string,unknown>,@Headers('authorization') auth?:string){
    const {client,user}=await this.store.access(workspace,auth,'owner');if(!await this.store.ready())throw new ServiceUnavailableException('WhatsApp connections are not available yet.');
    const state=text(body?.state,64),code=text(body?.code,10000),phone=text(body?.phoneId,30),waba=text(body?.wabaId,30),pin=typeof body?.pin==='string'?body.pin:'';
    if(!/^[0-9a-f]{64}$/.test(state)||!/^\d{5,30}$/.test(phone)||!/^\d{5,30}$/.test(waba)||(pin&&!/^\d{6}$/.test(pin)))throw new BadRequestException('Check the WhatsApp account and six-digit PIN.');
    await this.store.userRpc(client,'whatsapp_consume_signup',{target:workspace,nonce_hash:stateHash(state)});
    try{
      const token=await this.provider.exchange(code),account=await this.provider.validate(token,waba,phone);
      // Recheck ownership before changing provider subscriptions or storing credentials.
      await this.store.access(workspace,auth,'owner');
      const connection=await this.store.server('connect',{workspace,user:user.id,phone_id:phone,waba_id:waba,display_name:account.phone.verified_name||account.phone.display_phone_number||'WhatsApp',phone_number:account.phone.display_phone_number||'',provider_user_id:account.user,expires_at:account.expiresAt,encrypted_token:sealToken(token,this.store.key(),workspace,phone)});
      try{
        if(!account.registered){if(!pin)throw new BadRequestException('Create a six-digit WhatsApp PIN for this new number, then reconnect.');await this.provider.register(token,phone,pin);}
        await this.provider.subscribe(token,waba);
        return await this.store.server('activate',{workspace,user:user.id,connection:connection.id});
      }catch(error){await this.store.server('reauthorize',{workspace,connection:connection.id});throw error;}
    }catch(error){if(error instanceof MetaFailure)throw new HttpException('Meta could not complete the connection. Check your WhatsApp setup and start again.',error.code===190?401:502);throw error;}
  }
  @Delete('connections/:connection')
  async disconnect(@Param('workspace') workspace:string,@Param('connection') connection:string,@Headers('authorization') auth?:string){const {client}=await this.store.access(workspace,auth,'owner');await this.store.userRpc(client,'whatsapp_disconnect',{target:workspace,connection:id(connection)});return {disconnected:true};}
  @Get('conversations') @Header('Cache-Control','private, no-store')
  async conversations(@Param('workspace') workspace:string,@Query('contact') contact:string|undefined,@Query('page') value:unknown,@Headers('authorization') auth?:string){
    const {client}=await this.store.access(workspace,auth),n=page(value);if(contact!==undefined){id(contact);await requireContact(client,this.db,workspace,contact);}
    let query=client.from('conversations').select('*',{count:'exact'}).eq('workspace_id',workspace).not('external_participant','is',null);if(contact)query=query.eq('contact_id',contact);
    const {data,error,count}=await query.order('last_inbound_at',{ascending:false}).order('id').range(n*25,n*25+24);this.db.check(error);
    const contacts=await linkedContacts(client,this.db,workspace,(data||[]).map(row=>row.contact_id));return {rows:(data||[]).map(row=>({...row,contact:contacts[row.contact_id]||null,canReply:Boolean(row.last_inbound_at&&Date.parse(row.last_inbound_at)>Date.now()-86400000)})),total:count||0,page:n,pageSize:25};
  }
  @Get('conversations/:thread/messages') @Header('Cache-Control','private, no-store')
  async messages(@Param('workspace') workspace:string,@Param('thread') thread:string,@Query('page') value:unknown,@Headers('authorization') auth?:string){
    const {client}=await this.store.access(workspace,auth),n=page(value);const conversation=await client.from('conversations').select('*').eq('workspace_id',workspace).eq('id',id(thread)).maybeSingle();this.db.check(conversation.error);if(!conversation.data)throw new HttpException('Conversation not found',404);
    const {data,error,count}=await client.from('messages').select('*',{count:'exact'}).eq('workspace_id',workspace).eq('conversation_id',thread).order('created_at',{ascending:false}).order('id').range(n*50,n*50+49);this.db.check(error);return {rows:(data||[]).reverse(),total:count||0,page:n,pageSize:50,canReply:Boolean(conversation.data.last_inbound_at&&Date.parse(conversation.data.last_inbound_at)>Date.now()-86400000)};
  }
  @Post('conversations/:thread/messages')
  async send(@Param('workspace') workspace:string,@Param('thread') thread:string,@Body() body:Record<string,unknown>,@Headers('authorization') auth?:string){
    const {client}=await this.store.access(workspace,auth,'write');if(!await this.store.ready())throw new ServiceUnavailableException('WhatsApp is not available yet.');
    const request=id(text(body?.requestId,36)),content=text(body?.body,4096);id(thread);
    const prepared=await this.store.userRpc(client,'whatsapp_prepare_send',{target:workspace,thread,request_id:request,content});if(!prepared.created)return prepared.message;
    let providerId:string|undefined,status='unknown',errorCode:string|undefined;
    try{
      const credential=await this.store.server('credential',{workspace,connection:prepared.connection_id});if(!credential)throw new MetaFailure(190);
      await this.store.access(workspace,auth,'write');
      const token=openToken(credential.encrypted_token,this.store.key(),workspace,credential.phone_id);providerId=await this.provider.send(token,credential.phone_id,prepared.recipient,content);status='accepted';
    }catch(error){if(error instanceof MetaFailure){status=error.uncertain?'unknown':'failed';errorCode=String(error.code);if(error.code===190)await this.store.server('reauthorize',{workspace,connection:prepared.connection_id});}else if(error instanceof HttpException&&error.getStatus()===403){status='failed';errorCode='access_removed';}else{status='unknown';errorCode='connection_error';}}
    return this.store.server('finish_send',{workspace,request,provider_id:providerId,status,error_code:errorCode});
  }
}
type RawRequest={rawBody?:Buffer};
@Controller('v1/meta/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly store:WhatsAppStore){}
  @Get() @Header('Content-Type','text/plain; charset=utf-8') @Header('Cache-Control','no-store')
  verify(@Query('hub.mode') mode:unknown,@Query('hub.verify_token') token:unknown,@Query('hub.challenge') challenge:unknown){
    const expected=process.env.META_WEBHOOK_VERIFY_TOKEN||'';if(!expected)throw new ServiceUnavailableException('WhatsApp is not configured');
    if(mode!=='subscribe'||typeof token!=='string'||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected))||typeof challenge!=='string'||!/^\d{1,2000}$/.test(challenge))throw new HttpException('Verification failed',403);return challenge;
  }
  @Post() @HttpCode(200)
  async webhook(@Req() request:RawRequest,@Headers('x-hub-signature-256') signature:unknown,@Body() body:unknown){
    const secret=process.env.META_APP_SECRET||'';if(!secret)throw new ServiceUnavailableException('WhatsApp is not configured');
    if(!request.rawBody||!validWebhook(request.rawBody,signature,secret))throw new HttpException('Invalid webhook signature',401);
    let events;try{events=webhookEvents(body);}catch{throw new BadRequestException('Invalid WhatsApp event');}
    if(events.length)await this.store.server('inbound',{events});return {received:true};
  }
  @Post('deauthorize') @HttpCode(200)
  async deauthorize(@Body() body:{signed_request?:unknown}){let user;try{user=signedMetaRequest(body?.signed_request,process.env.META_APP_SECRET||'').user_id;}catch{throw new HttpException('Invalid Meta request',401);}await this.store.server('revoke',{user_id:user});return {received:true};}
  @Post('delete') @HttpCode(200)
  async deletion(@Body() body:{signed_request?:unknown}){
    let user;try{user=signedMetaRequest(body?.signed_request,process.env.META_APP_SECRET||'').user_id;}catch{throw new HttpException('Invalid Meta request',401);}
    const origin=process.env.META_PUBLIC_API_ORIGIN||'';if(!/^https:\/\/[a-z0-9.-]+$/.test(origin))throw new ServiceUnavailableException('Deletion status is not available yet.');const result=await this.store.server('delete_request',{user_id:user});return {url:`${origin}/v1/meta/whatsapp/deletions/${result.id}`,confirmation_code:result.id};
  }
  @Get('deletions/:request') @Header('Cache-Control','no-store')
  async deletionStatus(@Param('request') request:string){const result=await this.store.server('deletion_status',{id:id(request)});if(!result)throw new HttpException('Request not found',404);return {confirmation_code:result.id,status:result.status==='completed'?'completed':'pending',message:result.status==='completed'?'Your request has been processed.':'Your request has been received and WhatsApp access has been disconnected. Data removal is pending review.'};}
}