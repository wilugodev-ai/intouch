import {BadRequestException,HttpException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {Database} from './database';
import {validId} from './attachment-rules';
import {tokenKey} from './whatsapp-rules';
@Injectable()
export class WhatsAppStore {
  constructor(private readonly db:Database){}
  key(){try{return tokenKey(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY||'');}catch{throw new ServiceUnavailableException('WhatsApp is not available yet.');}}
  configured(){return Boolean(/^https:\/\/[a-z0-9.-]+$/.test(process.env.META_PUBLIC_API_ORIGIN||'')&&/^\d{5,30}$/.test(process.env.META_APP_ID||'')&&/^\d{5,30}$/.test(process.env.META_WHATSAPP_CONFIG_ID||'')&&/^v\d{2,3}\.\d+$/.test(process.env.META_GRAPH_API_VERSION||'')&&process.env.META_APP_SECRET&&process.env.META_WEBHOOK_VERIFY_TOKEN&&process.env.SUPABASE_WHATSAPP_SECRET_KEY&&process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY);}
  private service(){
    const key=process.env.SUPABASE_WHATSAPP_SECRET_KEY||'',url=process.env.SUPABASE_URL;
    let role='';try{role=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role;}catch{}
    if(!url||(!key.startsWith('sb_secret_')&&role!=='service_role'))throw new ServiceUnavailableException('WhatsApp is not available yet.');
    return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  }
  async server(action:string,payload:Record<string,unknown>={}){
    const {data,error}=await this.service().rpc('whatsapp_server',{action,payload});
    if(error){if(error.code==='23505')throw new HttpException('This WhatsApp number is already connected to another workspace.',409);if(error.code==='42501')throw new HttpException('WhatsApp access was removed. Sign in again.',403);throw new ServiceUnavailableException('WhatsApp could not save this operation. Please try again.');}return data;
  }
  async ready(){if(!this.configured())return false;try{this.key();return (await this.server('health'))?.ready===true;}catch{return false;}}
  async access(workspace:string,auth?:string,level:'read'|'write'|'owner'='read'){
    if(!validId(workspace))throw new BadRequestException('Invalid workspace');
    const {client,user}=await this.db.authenticated(auth);const result=await client.from('workspace_members').select('role').eq('workspace_id',workspace).eq('user_id',user.id).maybeSingle();this.db.check(result.error);
    if(!result.data)throw new HttpException('Workspace not found',404);
    if((level==='owner'&&result.data.role!=='owner')||(level==='write'&&result.data.role==='viewer'))throw new HttpException('Your workspace role does not allow this WhatsApp action.',403);
    return {client,user,role:result.data.role};
  }
  async userRpc(client:SupabaseClient,name:string,args:Record<string,unknown>){const {data,error}=await client.rpc(name,args);if(error){if(error.code==='42501')throw new HttpException('Your workspace role does not allow this WhatsApp action.',403);if(error.code==='23514'&&error.message==='Message limit reached')throw new HttpException('WhatsApp message limit reached. Please try again later.',429);if(error.code==='23514')throw new BadRequestException(name==='whatsapp_prepare_send'?'This reply could not be prepared. Check the conversation and the 24-hour reply window.':'The connection attempt expired or was already used. Start again.');this.db.check(error);}return data;}
}