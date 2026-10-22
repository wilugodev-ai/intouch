import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export function stateHash(state:string){return createHash('sha256').update(state).digest('hex');}
export function tokenKey(value:string){const key=Buffer.from(value,'base64');if(key.length!==32||key.toString('base64')!==value)throw Error('Invalid WhatsApp encryption key');return key;}
export function sealToken(token:string,key:Buffer,workspace:string,phone:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`${workspace}/${phone}`));const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(part=>part.toString('base64url')).join('.');}
export function openToken(value:string,key:Buffer,workspace:string,phone:string){const parts=value.split('.').map(part=>Buffer.from(part,'base64url'));if(parts.length!==3||parts[0].length!==12||parts[1].length!==16)throw Error('Invalid credential');const cipher=createDecipheriv('aes-256-gcm',key,parts[0]);cipher.setAAD(Buffer.from(`${workspace}/${phone}`));cipher.setAuthTag(parts[1]);return Buffer.concat([cipher.update(parts[2]),cipher.final()]).toString('utf8');}
export function validWebhook(raw:Buffer,signature:unknown,secret:string){if(!secret||typeof signature!=='string'||!/^sha256=[0-9a-f]{64}$/i.test(signature))return false;const expected=createHmac('sha256',secret).update(raw).digest();return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));}
export function signedMetaRequest(input:unknown,secret:string){
  if(typeof input!=='string'||input.length>20000||!secret)throw Error('Invalid Meta request');const [signature,payload,...rest]=input.split('.');if(rest.length||!signature||!payload)throw Error('Invalid Meta request');
  const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',secret).update(payload).digest();if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('Invalid Meta request');
  const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(data.algorithm!=='HMAC-SHA256'||typeof data.user_id!=='string'||!/^\d{1,40}$/.test(data.user_id))throw Error('Invalid Meta request');
  if(data.issued_at!==undefined&&(!Number.isSafeInteger(data.issued_at)||data.issued_at>Date.now()/1000+300))throw Error('Invalid Meta request');return data as {user_id:string};
}
type Event={event:'message'|'status';phone_id:string;waba_id:string;id:string;timestamp:string;from?:string;name?:string;kind?:string;body?:string;status?:string;error_code?:string};
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function identifier(value:unknown){if(typeof value!=='string'||value.length<1||value.length>512)throw Error('Invalid event identifier');return value;}
function time(value:unknown){if(typeof value!=='string'||!/^\d{1,12}$/.test(value)||Number(value)<946684800||!Number.isFinite(new Date(Number(value)*1000).getTime()))throw Error('Invalid event timestamp');return new Date(Math.min(Number(value)*1000,Date.now())).toISOString();}
export function webhookEvents(input:unknown):Event[]{
  const data=record(input),events:Event[]=[];if(data.object!=='whatsapp_business_account')return events;
  for(const entryValue of array(data.entry)){const entry=record(entryValue);for(const changeValue of array(entry.changes)){const change=record(changeValue);if(change.field!=='messages')continue;const value=record(change.value),metadata=record(value.metadata);
    if(typeof entry.id!=='string'||!/^\d{5,30}$/.test(entry.id)||typeof metadata.phone_number_id!=='string'||!/^\d{5,30}$/.test(metadata.phone_number_id))throw Error('Invalid WhatsApp asset');
    const common={phone_id:metadata.phone_number_id,waba_id:entry.id};
    for(const item of array(value.messages)){const message=record(item);if(typeof message.from!=='string'||!/^\d{7,15}$/.test(message.from))throw Error('Invalid WhatsApp sender');const kind=typeof message.type==='string'?message.type:'unsupported';const profile=array(value.contacts).map(record).find(contact=>contact.wa_id===message.from);const name=record(profile?.profile).name;
      const text=record(message.text).body,body=kind==='text'&&typeof text==='string'?text:`[${kind.slice(0,40)} message; media preview is not available here]`;
      if(!body.length||body.length>4096)throw Error('Invalid WhatsApp message');events.push({...common,event:'message',id:identifier(message.id),timestamp:time(message.timestamp),from:message.from,name:typeof name==='string'?name.slice(0,300):'',kind:kind.slice(0,40),body});
    }
    for(const item of array(value.statuses)){const status=record(item);if(!['sent','delivered','read','failed'].includes(String(status.status)))continue;const error=record(array(status.errors)[0]);events.push({...common,event:'status',id:identifier(status.id),timestamp:time(status.timestamp),status:String(status.status),error_code:typeof error.code==='number'?String(error.code):undefined});}
    if(events.length>1000)throw Error('Too many WhatsApp events');
  }}return events;
}
