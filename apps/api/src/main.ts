import 'reflect-metadata';
import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpException, Injectable, Module, Param, Patch, Post, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createClient } from '@supabase/supabase-js';

function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid record ID');
  return value;
}
const fields: Record<string, string[]> = { contacts: ['name', 'email', 'phone', 'company', 'status'], deals: ['title', 'contact_id', 'value_cents', 'stage'], tasks: ['title', 'contact_id', 'due_date', 'done'] };
function payload(table: string, input: unknown, partial = false) {
  if (!fields[table]) throw new BadRequestException('Unknown resource');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Expected an object');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(k => !fields[table].includes(k))) throw new BadRequestException('Unsupported field');
  if (!partial && !body[table === 'contacts' ? 'name' : 'title']) throw new BadRequestException('A name or title is required');
  for (const [key, value] of Object.entries(body)) {
    if (key === 'value_cents') { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100000000000) throw new BadRequestException('Invalid deal value'); }
    else if (key === 'done') { if (typeof value !== 'boolean') throw new BadRequestException('Invalid completion state'); }
    else if (key === 'contact_id') { if (value !== null) uuid(String(value)); }
    else if (key === 'due_date') { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new BadRequestException('Invalid date'); }
    else if (typeof value !== 'string' || value.length > 300 || (['name', 'title'].includes(key) && !value.trim())) throw new BadRequestException('Invalid text field');
  }
  if (body.status && !['Lead', 'Customer', 'Inactive'].includes(String(body.status))) throw new BadRequestException('Invalid contact status');
  if (body.stage && !['New', 'Qualified', 'Proposal', 'Won', 'Lost'].includes(String(body.stage))) throw new BadRequestException('Invalid deal stage');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) throw new BadRequestException('Invalid email address');
  return Object.fromEntries(Object.entries(body).map(([k,v]) => [k, typeof v === 'string' ? v.trim() : v]));
}
@Injectable()
class Database {
  async client(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new ServiceUnavailableException('Configure the InTouch Supabase project first');
    const client = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new UnauthorizedException('Your session has expired');
    return client;
  }
  check(error: { code?: string } | null) {
    if (error) throw new HttpException(error.code === '42501' ? 'You do not have access to this workspace' : 'The operation failed. Check the record fields and workspace.', error.code === '42501' ? 403 : 400);
  }
}
@Controller('v1')
class CrmController {
  constructor(private readonly db: Database) {}
  @Get('health') health() { return { status: 'ok', service: 'intouch-api', databaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) }; }
  @Get('workspaces') async workspaces(@Headers('authorization') auth?: string) {
    const client = await this.db.client(auth);
    const { data, error } = await client.from('workspaces').select('*').order('created_at'); this.db.check(error); return data;
  }
  @Post('workspaces') async createWorkspace(@Body() body: {name?: unknown}, @Headers('authorization') auth?: string) {
    if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) throw new BadRequestException('Workspace name is required (100 characters maximum)');
    const client = await this.db.client(auth);
    const { data, error } = await client.rpc('create_workspace', { workspace_name: body.name.trim() }); this.db.check(error); return data;
  }
  @Get('workspaces/:workspace/state') async state(@Param('workspace') workspace: string, @Headers('authorization') auth?: string) {
    uuid(workspace); const client = await this.db.client(auth);
    const membership = await client.from('workspaces').select('id').eq('id', workspace).maybeSingle();
    this.db.check(membership.error); if (!membership.data) throw new HttpException('Workspace not found', 404);
    const tables = ['contacts', 'deals', 'tasks', 'conversations', 'messages', 'channel_connections'] as const;
    const results = await Promise.all(tables.map(table => client.from(table).select('*').eq('workspace_id', workspace).order('created_at', {ascending: false}).limit(1000)));
    results.forEach(result => this.db.check(result.error));
    return Object.fromEntries(tables.map((table, i) => [table, results[i].data]));
  }
  @Post('workspaces/:workspace/:table') async create(@Param('workspace') workspace: string, @Param('table') table: string, @Body() body: unknown, @Headers('authorization') auth?: string) {
    const clean = payload(table, body); const client = await this.db.client(auth);
    const { data, error } = await client.from(table).insert({...clean, workspace_id: uuid(workspace)}).select().single(); this.db.check(error); return data;
  }
  @Patch('workspaces/:workspace/:table/:id') async update(@Param('workspace') workspace: string, @Param('table') table: string, @Param('id') id: string, @Body() body: unknown, @Headers('authorization') auth?: string) {
    const clean = payload(table, body, true); const client = await this.db.client(auth);
    const { data, error } = await client.from(table).update(clean).eq('workspace_id', uuid(workspace)).eq('id', uuid(id)).select().maybeSingle(); this.db.check(error);
    if (!data) throw new HttpException('Record not found', 404); return data;
  }
  @Delete('workspaces/:workspace/:table/:id') async remove(@Param('workspace') workspace: string, @Param('table') table: string, @Param('id') id: string, @Headers('authorization') auth?: string) {
    if (!fields[table]) throw new BadRequestException('Unknown resource'); const client = await this.db.client(auth);
    const { data, error } = await client.from(table).delete().eq('workspace_id', uuid(workspace)).eq('id', uuid(id)).select('id'); this.db.check(error);
    if (!data?.length) throw new HttpException('Record not found', 404); return { deleted: true };
  }
}
@Module({ controllers: [CrmController], providers: [Database] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://127.0.0.1:3100', methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  await app.listen(Number(process.env.PORT || 4100), '127.0.0.1');
}
void bootstrap();
