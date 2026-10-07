import {BadRequestException,Body,Controller,Delete,Get,Headers,HttpException,Param,Patch,Post,Query} from '@nestjs/common';
import {Database} from './database';

const resources:Record<string,{table:string;fields:string[]}>={
  automations:{table:'automation_rules',fields:['name','event','stage','task_title','due_days','assigned_to','enabled']},
  appointments:{table:'appointments',fields:['title','contact_id','assigned_to','starts_at','ends_at','location','notes','status']},
  tickets:{table:'tickets',fields:['title','contact_id','assigned_to','description','priority','status','due_date']},
  quotes:{table:'quotes',fields:['title','contact_id','items','tax_bps','valid_until','notes','status']},
};
function uuid(value:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Invalid ID');return value;}
function resource(value:string){if(!Object.hasOwn(resources,value))throw new BadRequestException('Unknown resource');return resources[value];}
function date(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function payload(kind:string,input:unknown){
  const config=resource(kind);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Expected an object');
  const body=input as Record<string,unknown>;
  if(!Object.keys(body).length||Object.keys(body).some(k=>!config.fields.includes(k)))throw new BadRequestException('Unsupported field');
  for(const [key,value] of Object.entries(body)){
    if(['assigned_to','contact_id'].includes(key)){if(value!==null)uuid(String(value));}
    else if(['due_date','valid_until'].includes(key)){if(value!==null&&!date(value))throw new BadRequestException('Choose a valid date');}
    else if(['starts_at','ends_at'].includes(key)){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new BadRequestException('Choose a valid appointment time');}
    else if(key==='enabled'){if(typeof value!=='boolean')throw new BadRequestException('Invalid enabled state');}
    else if(key==='due_days'||key==='tax_bps'){if(!Number.isInteger(value)||Number(value)<0||Number(value)>(key==='due_days'?365:10000))throw new BadRequestException('Invalid number');}
    else if(key==='items'){
      if(!Array.isArray(value)||value.length<1||value.length>50||value.some(i=>!i||typeof i.description!=='string'||!i.description.trim()||i.description.length>300||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>10000||!Number.isInteger(i.unit_cents)||i.unit_cents<0||i.unit_cents>1000000000))throw new BadRequestException('Check the quote descriptions, quantities, and prices');
    }
    else if(key==='stage'&&value===null)continue;
    else if(typeof value!=='string'||value.length>(['notes','description'].includes(key)?5000:300)||(['name','title','task_title'].includes(key)&&!value.trim()))throw new BadRequestException('Invalid text field');
  }
  const allowedStatus=kind==='quotes'?['draft','sent','accepted','declined']:kind==='tickets'?['open','in_progress','resolved']:['scheduled','completed','cancelled'];
  if(body.status&&!allowedStatus.includes(String(body.status)))throw new BadRequestException('Invalid status');
  if(body.priority&&!['low','normal','high','urgent'].includes(String(body.priority)))throw new BadRequestException('Invalid priority');
  if(body.event&&!['contact_created','deal_stage_changed'].includes(String(body.event)))throw new BadRequestException('Invalid automation event');
  return Object.fromEntries(Object.entries(body).map(([k,v])=>[k,typeof v==='string'?v.trim():v]));
}

@Controller('v1')
export class BusinessController {
  constructor(private readonly db:Database){}
  @Get('business/:workspace/reports') async reports(@Param('workspace') workspace:string,@Query('from') from:string,@Query('to') to:string,@Headers('authorization') auth?:string){
    if(!date(from)||!date(to))throw new BadRequestException('Choose a valid report date range');
    const client=await this.db.client(auth);const {data,error}=await client.rpc('crm_reports',{target:uuid(workspace),date_from:from,date_to:to});this.db.check(error);return data;
  }
  @Get('business/:workspace/runs') async runs(@Param('workspace') workspace:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from('automation_runs').select('id,rule_name,created_at,task_id').eq('workspace_id',uuid(workspace)).order('created_at',{ascending:false}).limit(50);this.db.check(error);return data;
  }
  @Get('business/:workspace/:resource') async list(@Param('workspace') workspace:string,@Param('resource') kind:string,@Query('page') page='0',@Headers('authorization') auth?:string){
    const config=resource(kind);const n=Number(page);if(!Number.isInteger(n)||n<0||n>100000)throw new BadRequestException('Invalid page');
    const client=await this.db.client(auth);const {data,error,count}=await client.from(config.table).select('*',{count:'exact'}).eq('workspace_id',uuid(workspace)).order('created_at',{ascending:false}).order('id').range(n*50,n*50+49);this.db.check(error);return {rows:data,total:count,page:n};
  }
  @Post('business/:workspace/:resource') async create(@Param('workspace') workspace:string,@Param('resource') kind:string,@Body() body:unknown,@Headers('authorization') auth?:string){
    const clean=payload(kind,body);const client=await this.db.client(auth);const {data,error}=await client.from(resource(kind).table).insert({...clean,workspace_id:uuid(workspace)}).select().single();this.db.check(error);return data;
  }
  @Patch('business/:workspace/:resource/:id') async update(@Param('workspace') workspace:string,@Param('resource') kind:string,@Param('id') id:string,@Body() body:unknown,@Headers('authorization') auth?:string){
    const clean=payload(kind,body);const client=await this.db.client(auth);const {data,error}=await client.from(resource(kind).table).update(clean).eq('workspace_id',uuid(workspace)).eq('id',uuid(id)).select().maybeSingle();this.db.check(error);if(!data)throw new HttpException('Record not found or not editable',404);return data;
  }
  @Delete('business/:workspace/:resource/:id') async remove(@Param('workspace') workspace:string,@Param('resource') kind:string,@Param('id') id:string,@Headers('authorization') auth?:string){
    const client=await this.db.client(auth);const {data,error}=await client.from(resource(kind).table).delete().eq('workspace_id',uuid(workspace)).eq('id',uuid(id)).select('id');this.db.check(error);if(!data?.length)throw new HttpException('Record not found or not editable',404);return {deleted:true};
  }
}
