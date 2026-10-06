import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, BadRequestException, HttpException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Database } from './database';
import { parseContacts } from './imports';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function text(value:unknown,max:number) {if(typeof value!=='string'||!value.trim()||value.length>max)throw new BadRequestException('Invalid text field');return value.trim();}
function id(value:string){if(!/^[0-9a-f-]{36}$/i.test(value))throw new BadRequestException('Invalid ID');return value;}
@Controller('v1')
export class WorkflowsController {
  constructor(private readonly db:Database){}
  @Get('crm/:workspace/team') async team(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.rpc('list_members',{target:id(workspace)});this.db.check(error);return data;
  }
  @Patch('crm/:workspace/team/:user') async member(@Param('workspace') workspace:string,@Param('user') user:string,@Body() body:{role:unknown},@Headers('authorization') auth?:string){
    if(!body||![null,'member','viewer'].includes(body.role as string|null))throw new BadRequestException('Choose member, viewer, or remove');
    const client=await this.db.client(auth);const {error}=await client.rpc('manage_member',{target:id(workspace),member_id:id(user),new_role:body.role});this.db.check(error);return {updated:true};
  }
  @Get('crm/:workspace/invitations') async invitations(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from('workspace_invites').select('id,email,role,expires_at,accepted_at,created_at').eq('workspace_id',id(workspace)).order('created_at',{ascending:false});this.db.check(error);return data;
  }
  @Post('crm/:workspace/invitations') async invite(@Param('workspace') workspace:string,@Body() body:{email:unknown;role:unknown},@Headers('authorization') auth?:string){
    const email=text(body?.email,254).toLowerCase();if(!['member','viewer'].includes(String(body?.role)))throw new BadRequestException('Choose member or viewer');
    const token=randomBytes(32).toString('base64url');const client=await this.db.client(auth);
    const {data,error}=await client.rpc('invite_member',{target:id(workspace),invite_email:email,invite_role:body.role,invite_hash:hash(token)});this.db.check(error);
    return {id:data,link:`${process.env.WEB_ORIGIN||'http://127.0.0.1:3100'}/#invite=${token}`};
  }
  @Delete('crm/:workspace/invitations/:invite') async revoke(@Param('workspace') workspace:string,@Param('invite') invite:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from('workspace_invites').delete().eq('workspace_id',id(workspace)).eq('id',id(invite)).select('id');this.db.check(error);if(!data?.length)throw new HttpException('Invitation not found',404);return {deleted:true};
  }
  @Post('invitations/accept') async accept(@Body() body:{token:unknown},@Headers('authorization') auth?:string){
    const token=text(body?.token,100);if(!/^[\w-]{43}$/.test(token))throw new BadRequestException('Invalid invitation');
    const client=await this.db.client(auth);const {data,error}=await client.rpc('accept_invite',{invite_hash:hash(token)});this.db.check(error);return {workspace_id:data};
  }
  @Get('crm/:workspace/contacts/:contact/detail') async detail(@Param('workspace') workspace:string,@Param('contact') contact:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const found=await client.from('contacts').select('id').eq('workspace_id',id(workspace)).eq('id',id(contact)).maybeSingle();this.db.check(found.error);if(!found.data)throw new HttpException('Contact not found',404);
    const results=await Promise.all(['contact_notes','activities'].map(table=>client.from(table).select('*').eq('workspace_id',workspace).eq('contact_id',contact).order('created_at',{ascending:false}).limit(200)));
    results.forEach(r=>this.db.check(r.error));return {notes:results[0].data,activities:results[1].data};
  }
  @Post('crm/:workspace/contacts/:contact/notes') async note(@Param('workspace') workspace:string,@Param('contact') contact:string,@Body() body:{body:unknown;kind:unknown},@Headers('authorization') auth?:string){
    const content=text(body?.body,5000);if(!['note','call','meeting'].includes(String(body?.kind)))throw new BadRequestException('Invalid activity kind');
    const client=await this.db.client(auth);const {data,error}=await client.from('contact_notes').insert({workspace_id:id(workspace),contact_id:id(contact),body:content,kind:body.kind}).select().single();this.db.check(error);return data;
  }
  @Delete('crm/:workspace/notes/:note') async deleteNote(@Param('workspace') workspace:string,@Param('note') note:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from('contact_notes').delete().eq('workspace_id',id(workspace)).eq('id',id(note)).select('id');this.db.check(error);if(!data?.length)throw new HttpException('Note not found or not yours to delete',404);return {deleted:true};
  }
  @Post('crm/:workspace/stages') async stage(@Param('workspace') workspace:string,@Body() body:{name:unknown;kind:unknown;position:unknown},@Headers('authorization') auth?:string){
    const values=this.stageValues(body);const client=await this.db.client(auth);const {data,error}=await client.from('pipeline_stages').insert({...values,workspace_id:id(workspace)}).select().single();this.db.check(error);return data;
  }
  @Patch('crm/:workspace/stages/:name') async changeStage(@Param('workspace') workspace:string,@Param('name') name:string,@Body() body:{name:unknown;kind:unknown;position:unknown},@Headers('authorization') auth?:string){
    const values=this.stageValues(body);const client=await this.db.client(auth);const {data,error}=await client.from('pipeline_stages').update(values).eq('workspace_id',id(workspace)).eq('name',name).select().maybeSingle();this.db.check(error);if(!data)throw new HttpException('Stage not found or not editable',404);return data;
  }
  @Delete('crm/:workspace/stages/:name') async deleteStage(@Param('workspace') workspace:string,@Param('name') name:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from('pipeline_stages').delete().eq('workspace_id',id(workspace)).eq('name',name).select('name');this.db.check(error);if(!data?.length)throw new HttpException('Stage not found or not editable',404);return {deleted:true};
  }
  private stageValues(body:{name:unknown;kind:unknown;position:unknown}){
    const name=text(body?.name,50);if(!['open','won','lost'].includes(String(body?.kind))||!Number.isInteger(body?.position)||Number(body.position)<0||Number(body.position)>1000)throw new BadRequestException('Choose a stage type and position from 0 to 1000');return {name,kind:body.kind,position:body.position};
  }
  @Post('crm/:workspace/import') async importCsv(@Param('workspace') workspace:string,@Body() body:{csv:unknown;commit?:boolean},@Headers('authorization') auth?:string){
    const parsed=parseContacts(body?.csv);const client=await this.db.client(auth);
    const access=await client.from('workspaces').select('id').eq('id',id(workspace)).maybeSingle();this.db.check(access.error);if(!access.data)throw new HttpException('Workspace not found',404);
    if(body.commit===true){
      if(parsed.errors.length)throw new BadRequestException('Fix all row errors before importing');
      const {data,error}=await client.rpc('import_contacts',{target:workspace,content_hash:hash(String(body.csv)),records:parsed.rows});this.db.check(error);return {...data,fileDuplicates:parsed.duplicates};
    }
    const emails=parsed.rows.map(r=>String(r.email)).filter(Boolean);
    const existing=await client.rpc('preview_contact_import',{target:workspace,emails});this.db.check(existing.error);
    return {...parsed,existingEmails:existing.data?.map((r:{email:string})=>r.email)||[]};
  }
}
