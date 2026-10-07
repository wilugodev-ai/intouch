import { Injectable, UnauthorizedException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
@Injectable()
export class Database {
  async client(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!url||!key)throw new ServiceUnavailableException('Supabase is not configured');
    const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.getUser(authorization.slice(7));
    if(error||!data.user)throw new UnauthorizedException('Your session has expired');
    return client;
  }
  check(error:{code?:string;message?:string}|null) {
    if(!error)return;
    const messages:Record<string,string>={
      '42501':'You do not have permission for this action, or this invitation does not match your verified email.',
      '23P01':'This teammate already has an appointment at that time. Choose another time or teammate.',
      '23503':'This record is still in use, or the linked record belongs to another workspace.',
      '23505':'A record with this name already exists.',
      '23514':'Check the fields, selected collaborator, and allowed values.',
    };
    throw new HttpException(messages[error.code||'']||'The operation failed. Check the record fields and workspace.',error.code==='42501'?403:400);
  }
}
