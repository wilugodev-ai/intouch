import {BadRequestException, Controller, Get, Headers, HttpException, Param, Query} from '@nestjs/common';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Database} from './database';

function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('Invalid record ID');
  return value;
}
function text(value: unknown, maximum = 150) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new BadRequestException('Invalid search or filter');
  return value.trim();
}
function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) throw new BadRequestException('Invalid page');
  return Number(value);
}
// Quoted PostgREST literals prevent search punctuation from changing the filter.
function literal(value: string) { return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"'; }
export function searchFilter(kind: string, search: string) {
  const pattern = literal('%' + search.replace(/[\\%_*]/g, '\\$&') + '%');
  if (kind !== 'contacts') return `title.ilike.${pattern}`;
  const columns = ['name', 'email', 'phone', 'company'];
  return [...columns.map(column => `${column}.ilike.${pattern}`), `tags.cs.${literal('{' + literal(search) + '}')}`].join(',');
}
export async function requireWorkspace(client: SupabaseClient, db: Database, workspace: string) {
  const {data, error} = await client.from('workspaces').select('id').eq('id', uuid(workspace)).maybeSingle();
  db.check(error);
  if (!data) throw new HttpException('Workspace not found', 404);
}
export async function requireContact(client: SupabaseClient, db: Database, workspace: string, contact: string) {
  const {data, error} = await client.from('contacts').select('*').eq('workspace_id', uuid(workspace)).eq('id', uuid(contact)).maybeSingle();
  db.check(error); if (!data) throw new HttpException('Customer not found or access is unavailable.', 404);
  return data;
}
export async function linkedContacts(client: SupabaseClient, db: Database, workspace: string, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const contacts: Record<string, {id: string; name: string}> = {};
  for (let offset = 0; offset < unique.length; offset += 100) {
    const {data, error} = await client.from('contacts').select('*').eq('workspace_id', workspace).in('id', unique.slice(offset, offset + 100));
    db.check(error);
    for (const contact of data || []) contacts[contact.id] = contact;
  }
  return contacts;
}
export async function workspaceSnapshot(client: SupabaseClient, db: Database, workspace: string) {
  const tables = ['contacts', 'deals', 'tasks', 'conversations', 'messages', 'channel_connections', 'pipeline_stages'] as const;
  const today = new Date().toISOString().slice(0, 10);
  const [results, members, report, counts] = await Promise.all([
    Promise.all(tables.map(async table => {
      if (table === 'pipeline_stages') {
        const stages = [];
        for (let offset = 0; ; offset += 100) {
          const result = await client.from(table).select('*').eq('workspace_id', workspace).order('position').order('name').range(offset, offset + 99);
          db.check(result.error); stages.push(...(result.data || []));
          if ((result.data || []).length < 100) break;
        }
        return {data: stages, error: null};
      }
      let query = client.from(table).select('*').eq('workspace_id', workspace);
      if (table === 'tasks') query = query.order('done').order('due_date');
      return query.order('created_at', {ascending: false}).order('id').limit(table === 'messages' ? 100 : 50);
    })),
    client.rpc('list_members', {target: workspace}),
    client.rpc('crm_reports', {target: workspace, date_from: today, date_to: today}),
    Promise.all([
      client.from('contacts').select('id', {count: 'exact', head: true}).eq('workspace_id', workspace),
      client.from('contacts').select('id', {count: 'exact', head: true}).eq('workspace_id', workspace).eq('status', 'Customer'),
      client.from('tasks').select('id', {count: 'exact', head: true}).eq('workspace_id', workspace).eq('done', false),
      client.from('conversations').select('id', {count: 'exact', head: true}).eq('workspace_id', workspace).eq('status', 'Open'),
    ]),
  ]);
  [...results, members, report, ...counts].forEach(result => db.check(result.error));
  const snapshot = Object.fromEntries(tables.map((table, index) => [table, results[index].data || []]));
  const related = await linkedContacts(client, db, workspace, [...snapshot.deals, ...snapshot.tasks, ...snapshot.conversations].map(row => row.contact_id));
  snapshot.contacts = [...new Map([...snapshot.contacts, ...Object.values(related)].map(contact => [contact.id, contact])).values()];
  return {...snapshot, members: members.data, summary: {contacts: counts[0].count || 0, customers: counts[1].count || 0, openTasks: counts[2].count || 0, openConversations: counts[3].count || 0, pipeline: report.data?.pipeline || []}};
}

@Controller('v1/workspaces/:workspace')
export class RecordsController {
  constructor(private readonly db: Database) {}
  @Get('snapshot') async snapshot(@Param('workspace') workspace: string, @Headers('authorization') auth?: string) {
    const client = await this.db.client(auth);
    await requireWorkspace(client, this.db, workspace);
    return workspaceSnapshot(client, this.db, workspace);
  }
  @Get('records/:kind') async list(@Param('workspace') workspace: string, @Param('kind') kind: string, @Query() params: Record<string, unknown>, @Headers('authorization') auth?: string) {
    if (!['contacts', 'deals', 'tasks'].includes(kind)) throw new BadRequestException('Unknown resource');
    if (Object.keys(params).some(key => !['page', 'pageSize', 'search', 'filter', 'stage', 'today', 'id', 'contact'].includes(key))) throw new BadRequestException('Unsupported filter');
    uuid(workspace);
    const page = integer(params.page, 0, 0, 1000000), pageSize = integer(params.pageSize, 25, 1, 100);
    const search = text(params.search), filter = text(params.filter), stage = text(params.stage, 50), id = text(params.id, 36);
    const contact = text(params.contact, 36);
    if (id) uuid(id);
    if (contact) { uuid(contact); if (kind === 'contacts') throw new BadRequestException('Customer filter does not apply to this list'); }
    if (filter && !['all', 'assigned', 'overdue', 'today', 'open', 'completed'].includes(filter)) throw new BadRequestException('Invalid task filter');
    if ((filter && filter !== 'all' && kind !== 'tasks') || (stage && kind !== 'deals') || (id && kind !== 'contacts')) throw new BadRequestException('Filter does not apply to this list');
    const today = text(params.today, 10) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today)) || new Date(today).toISOString().slice(0, 10) !== today) throw new BadRequestException('Invalid date');
    const client = await this.db.client(auth);
    await requireWorkspace(client, this.db, workspace);
    if (contact) await requireContact(client, this.db, workspace, contact);
    let query = client.from(kind).select('*', {count: 'exact'}).eq('workspace_id', workspace);
    if (contact) query = query.eq('contact_id', contact);
    if (id) query = query.eq('id', id);
    if (search) query = query.or(searchFilter(kind, search));
    if (stage) query = query.eq('stage', stage);
    if (kind === 'tasks') {
      if (filter === 'assigned') {
        const {data, error} = await client.auth.getUser();
        if (error || !data.user) throw new HttpException('Your session has expired', 401);
        query = query.eq('assigned_to', data.user.id);
      }
      if (filter === 'open' || filter === 'overdue') query = query.eq('done', false);
      if (filter === 'completed') query = query.eq('done', true);
      if (filter === 'overdue') query = query.lt('due_date', today);
      if (filter === 'today') query = query.eq('due_date', today);
      query = query.order('done').order('due_date');
    }
    query = query.order('created_at', {ascending: false}).order('id');
    const result = await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error?.code === 'PGRST103' && page > 0) {
      // A delete can remove the last page between requests. Keep the total so
      // the browser can move back to the final remaining page.
      const first = await query.range(0, 0);
      this.db.check(first.error);
      return {rows: [], total: first.count || 0, page, pageSize};
    }
    const {data, error, count} = result;
    this.db.check(error);
    const contacts = kind === 'contacts' ? {} : await linkedContacts(client, this.db, workspace, (data || []).map(row => row.contact_id));
    return {rows: (data || []).map(row => kind === 'contacts' ? row : {...row, contact: contacts[row.contact_id] || null}), total: count || 0, page, pageSize};
  }
}
