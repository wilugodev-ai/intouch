import {BadRequestException,Body,Controller,Get,Headers,HttpException,Ip,Param,Patch,Post,Query,ServiceUnavailableException} from '@nestjs/common';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {Database} from './database';

function id(value:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Invalid ID');return value;}
function input(value:unknown,max:number,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new BadRequestException('Check the form fields');return value.trim();}
export function birthday(body:Record<string,unknown>){
  const m=body.birth_month??null,d=body.birth_day??null,y=body.birth_year??null;
  if(m===null&&d===null&&y===null)return;
  if(!Number.isInteger(m)||!Number.isInteger(d)||(y!==null&&(!Number.isInteger(y)||Number(y)<1900||Number(y)>new Date().getUTCFullYear())))throw new BadRequestException('Enter a valid birthday month and day; year is optional');
  const date=new Date(Date.UTC(Number(y??2000),Number(m)-1,Number(d)));
  if(date.getUTCMonth()+1!==m||date.getUTCDate()!==d||(y!==null&&date.getTime()>Date.now()))throw new BadRequestException('Enter a valid birthday');
}
@Controller('v1')
export class RegistrationController {
  constructor(private readonly db:Database){}
  // This is a local guard; the database also enforces a per-form rolling quota,
  // including calls made directly with the public Supabase key.
  private readonly requests=new Map<string,{count:number;until:number}>();
  private publicClient(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw new ServiceUnavailableException('Registration is not configured');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
  @Get('public/registration/:token') async publicForm(@Param('token') token:string){
    const {data,error}=await this.publicClient().rpc('public_registration_form',{form_token:id(token)});if(error||!data)throw new HttpException('This registration form is unavailable.',404);return data;
  }
  @Post('public/registration/:token') async submit(@Param('token') token:string,@Body() body:Record<string,unknown>,@Ip() ip:string){
    id(token);if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Check the form fields');
    if(body.website)return {received:true}; // Honeypot, never stored.
    const now=Date.now();for(const [key,value] of this.requests)if(value.until<now)this.requests.delete(key);
    const key=ip||'unknown';const counter=this.requests.get(key)||{count:0,until:now+3600000};
    if(counter.count>=30||this.requests.size>10000)throw new HttpException('Too many submissions. Please try again later.',429);counter.count++;this.requests.set(key,counter);
    const fields=body.fields as Record<string,unknown>;if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new BadRequestException('Check the form fields');
    const name=input(fields.name,300,true),email=input(fields.email??'',254).toLowerCase(),phone=input(fields.phone??'',16),company=input(fields.company??'',300);
    if((!email&&!phone)||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||(phone&&!/^\+[1-9][0-9]{6,14}$/.test(phone)))throw new BadRequestException('Enter an email or a phone number including its country code, such as +15551234567');
    birthday(fields);
    if(!['none','email','phone','whatsapp'].includes(String(fields.preferred_channel))||fields.acknowledged!==true||typeof fields.marketing_email!=='boolean'||typeof fields.marketing_whatsapp!=='boolean'||!Number.isInteger(body.revision))throw new BadRequestException('Check your preferences and acknowledge the data notice');
    if((fields.marketing_email||fields.preferred_channel==='email')&&!email)throw new BadRequestException('Add an email for your email preference');
    if((fields.marketing_whatsapp||['phone','whatsapp'].includes(String(fields.preferred_channel)))&&!phone)throw new BadRequestException('Add a phone number for your phone or WhatsApp preference');
    const {error}=await this.publicClient().rpc('submit_registration',{form_token:token,request_key:id(String(body.request_id)),form_version:body.revision,fields:{name,email,phone,company,birth_month:fields.birth_month??null,birth_day:fields.birth_day??null,birth_year:fields.birth_year??null,preferred_channel:fields.preferred_channel,marketing_email:fields.marketing_email,marketing_whatsapp:fields.marketing_whatsapp,acknowledged:true}});
    if(error){if(error.code==='54000')throw new HttpException('This form has reached its submission limit. Please contact the business.',429);if(error.code==='40001')throw new HttpException('The form changed. Reload this page before submitting.',409);if(error.code==='P0002')throw new HttpException('This registration form is unavailable.',404);throw new BadRequestException('Check the form fields and try again');}
    return {received:true};
  }
  @Get('registration/:workspace/form') async settings(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const {data,error}=await client.from('registration_forms').select('*').eq('workspace_id',id(workspace)).maybeSingle();this.db.check(error);return data?{...data,link:this.link(data.token)}:null;}
  private link(token:string){return `${process.env.WEB_ORIGIN||'http://127.0.0.1:3100'}/register/${token}`;}
  @Post('registration/:workspace/form') async save(@Param('workspace') workspace:string,@Body() body:Record<string,unknown>,@Headers('authorization') auth?:string){
    if(!body||typeof body.enabled!=='boolean')throw new BadRequestException('Choose whether to enable the form');
    const values={title:input(body.title,120,true),description:input(body.description??'',2000),privacy_url:input(body.privacy_url??'',500),enabled:body.enabled};
    if(values.privacy_url){try{if(!['http:','https:'].includes(new URL(values.privacy_url).protocol))throw Error();}catch{throw new BadRequestException('Enter an http or https privacy policy URL');}}
    const client=await this.db.client(auth),target=id(workspace);const found=await client.from('registration_forms').select('id').eq('workspace_id',target).maybeSingle();this.db.check(found.error);
    const result=found.data?await client.from('registration_forms').update(values).eq('workspace_id',target).select().single():await client.from('registration_forms').insert({...values,workspace_id:target}).select().single();this.db.check(result.error);return {...result.data,link:this.link(result.data!.token)};
  }
  @Post('registration/:workspace/rotate') async rotate(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const {data,error}=await client.from('registration_forms').update({token:randomUUID()}).eq('workspace_id',id(workspace)).select().single();this.db.check(error);return {...data,link:this.link(data!.token)};}
  @Get('registration/:workspace/submissions') async submissions(@Param('workspace') workspace:string,@Query('page') page='0',@Query('status') status='pending',@Headers('authorization') auth?:string){
    const n=Number(page);if(!Number.isInteger(n)||n<0||n>100000||!['pending','accepted','dismissed'].includes(status))throw new BadRequestException('Invalid page or status');const client=await this.db.client(auth);const {data,error,count}=await client.from('registration_submissions').select('*',{count:'exact'}).eq('workspace_id',id(workspace)).eq('status',status).order('created_at',{ascending:false}).order('id').range(n*25,n*25+24);this.db.check(error);return {rows:data,total:count};
  }
  @Get('registration/:workspace/matches/:submission') async matches(@Param('workspace') workspace:string,@Param('submission') submission:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const {data,error}=await client.rpc('registration_matches',{target:id(workspace),submission:id(submission)});this.db.check(error);return data;}
  @Post('registration/:workspace/review/:submission') async review(@Param('workspace') workspace:string,@Param('submission') submission:string,@Body() body:{existing_contact?:string;identity_verified?:boolean},@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.rpc('review_registration',{target:id(workspace),submission:id(submission),existing_contact:body?.existing_contact?id(body.existing_contact):null,identity_verified:body?.identity_verified===true});
    if(error?.code==='23505')throw new BadRequestException('A matching contact exists. Verify the customer, then choose the matching contact.');this.db.check(error);return {contact_id:data};
  }
  @Post('registration/:workspace/dismiss/:submission') async dismiss(@Param('workspace') workspace:string,@Param('submission') submission:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const {error}=await client.rpc('dismiss_registration',{target:id(workspace),submission:id(submission)});this.db.check(error);return {dismissed:true};}
  @Get('registration/:workspace/consent/:contact') async consent(@Param('workspace') workspace:string,@Param('contact') contact:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const results=await Promise.all([client.from('contacts').select('marketing_email,marketing_whatsapp').eq('workspace_id',id(workspace)).eq('id',id(contact)).single(),client.from('contact_consent_events').select('*').eq('workspace_id',workspace).eq('contact_id',contact).order('created_at',{ascending:false}).limit(50)]);results.forEach(r=>this.db.check(r.error));return {current:results[0].data,events:results[1].data};}
  @Patch('registration/:workspace/consent/:contact') async withdraw(@Param('workspace') workspace:string,@Param('contact') contact:string,@Headers('authorization') auth?:string){const client=await this.db.client(auth);const {error}=await client.rpc('withdraw_contact_marketing',{target:id(workspace),customer:id(contact)});this.db.check(error);return {withdrawn:true};}
}
