import {HttpException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {createHmac} from 'node:crypto';
export class MetaFailure extends Error {constructor(public readonly code:number,public readonly uncertain=false){super('WhatsApp could not complete this request.');}}
@Injectable()
export class WhatsAppProvider {
  private get version(){const value=process.env.META_GRAPH_API_VERSION||'';if(!/^v\d{2,3}\.\d+$/.test(value))throw new ServiceUnavailableException('WhatsApp is not available yet.');return value;}
  private get secret(){return process.env.META_APP_SECRET||'';}
  async graph(path:string,token:string,method='GET',body?:unknown){
    if(!/^\/[a-zA-Z0-9_/?=&%.,-]+$/.test(path))throw new Error('Invalid Graph path');
    const url=new URL(`https://graph.facebook.com/${this.version}${path}`);url.searchParams.set('appsecret_proof',createHmac('sha256',this.secret).update(token).digest('hex'));
    let response:Response;try{response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});}catch{throw new MetaFailure(0,true);}
    let data:Record<string,unknown>;try{data=await response.json();}catch{throw new MetaFailure(0,true);}
    if(!response.ok||data.error){const error=data.error as {code?:number}|undefined;throw new MetaFailure(error?.code||response.status,response.status>=500||response.status===429);}return data;
  }
  async exchange(code:string){
    const url=new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);url.searchParams.set('client_id',process.env.META_APP_ID||'');url.searchParams.set('client_secret',this.secret);url.searchParams.set('code',code);
    // Never log this request URL: Meta's exchange uses sensitive query parameters.
    let response:Response;try{response=await fetch(url,{signal:AbortSignal.timeout(20000)});}catch{throw new MetaFailure(0,true);}
    let data:{access_token?:string;error?:{code?:number}};try{data=await response.json();}catch{throw new MetaFailure(0,true);}
    if(!response.ok||!data.access_token)throw new MetaFailure(data.error?.code||response.status);return data.access_token;
  }
  async validate(token:string,waba:string,phone:string){
    const result=await this.graph(`/debug_token?input_token=${encodeURIComponent(token)}`,`${process.env.META_APP_ID}|${this.secret}`),debug=result.data as {app_id?:string;is_valid?:boolean;user_id?:string;expires_at?:number;scopes?:string[]};
    if(!debug?.is_valid||String(debug.app_id)!==process.env.META_APP_ID||!/^\d{1,40}$/.test(debug.user_id||'')||!['whatsapp_business_management','whatsapp_business_messaging'].every(scope=>debug.scopes?.includes(scope)))throw new HttpException('Meta did not authorize the required WhatsApp access.',403);
    let next=`/${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,matched:{id:string;display_phone_number?:string;verified_name?:string}|undefined;
    for(let page=0;page<20;page++){
      const response=await this.graph(next,token),rows=response.data as {id:string;display_phone_number?:string;verified_name?:string}[];matched=rows?.find(row=>row.id===phone);if(matched)break;
      const paging=response.paging as {cursors?:{after?:string};next?:string};if(!paging?.next||!paging.cursors?.after)break;next=`/${waba}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100&after=${encodeURIComponent(paging.cursors.after)}`;
    }
    if(!matched)throw new HttpException('This phone number was not authorized for the selected WhatsApp account.',403);
    const details=await this.graph(`/${phone}?fields=id,status,is_on_biz_app`,token);
    return {phone:matched,registered:details.status==='CONNECTED'||details.is_on_biz_app===true,user:debug.user_id!,expiresAt:debug.expires_at?new Date(debug.expires_at*1000).toISOString():null};
  }
  async register(token:string,phone:string,pin:string){await this.graph(`/${phone}/register`,token,'POST',{messaging_product:'whatsapp',pin});}
  async subscribe(token:string,waba:string){await this.graph(`/${waba}/subscribed_apps`,token,'POST');}
  async send(token:string,phone:string,recipient:string,body:string){const response=await this.graph(`/${phone}/messages`,token,'POST',{messaging_product:'whatsapp',recipient_type:'individual',to:recipient,type:'text',text:{preview_url:false,body}});const messages=response.messages as {id?:string}[];if(!messages?.[0]?.id)throw new MetaFailure(0,true);return messages[0].id;}
}