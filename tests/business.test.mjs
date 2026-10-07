import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('business workflows enforce permissions, execute transactional automations and calculate accurate reports',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
    for(const file of ['202610060001_foundation.sql','202610060002_crm_workflows.sql','202610060003_business_modules.sql','202610060004_record_dates.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
    await db.query("insert into auth.users values($1,'owner@example.com',now()),($2,'member@example.com',now())",[a,b]);
    async function asUser(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
    await asUser(a);const wa=(await db.query("select public.create_workspace('Business') as id")).rows[0].id;
    await db.query("insert into public.automation_rules(workspace_id,name,event,task_title,due_days,assigned_to) values($1,'New contact follow-up','contact_created','Call new customer',2,$2)",[wa,a]);
    const contact=(await db.query("insert into public.contacts(workspace_id,name) values($1,'Real client') returning id",[wa])).rows[0].id;
    let tasks=(await db.query('select * from public.tasks')).rows;assert.equal(tasks.length,1);assert.equal(tasks[0].assigned_to,a);assert.equal(tasks[0].contact_id,contact);
    await db.query("update public.contacts set company='Update should not trigger' where id=$1",[contact]);assert.equal((await db.query('select * from public.tasks')).rows.length,1);
    await db.query("insert into public.automation_rules(workspace_id,name,event,stage,task_title) values($1,'Won follow-up','deal_stage_changed','Won','Welcome customer')",[wa]);
    const deal=(await db.query("insert into public.deals(workspace_id,contact_id,title,value_cents) values($1,$2,'Sale',12345) returning id",[wa,contact])).rows[0].id;
    await db.query("update public.deals set stage='Won' where id=$1",[deal]);assert.equal((await db.query('select * from public.tasks')).rows.length,2);
    await db.query("update public.deals set stage='Won' where id=$1",[deal]);assert.equal((await db.query('select * from public.tasks')).rows.length,2);
    await db.query("update public.pipeline_stages set name='Closed won' where workspace_id=$1 and name='Won'",[wa]);assert.equal((await db.query('select * from public.tasks')).rows.length,2);
    assert.equal((await db.query('select * from public.automation_runs')).rows.length,2);
    const quote=(await db.query("insert into public.quotes(workspace_id,contact_id,title,items,tax_bps,total_cents) values($1,$2,'Proposal',$3::jsonb,750,1) returning *",[wa,contact,JSON.stringify([{description:'Service',quantity:2,unit_cents:1050}])])).rows[0];assert.equal(Number(quote.total_cents),2258);
    await assert.rejects(db.query("insert into public.quotes(workspace_id,title,items) values($1,'Invalid',$2::jsonb)",[wa,JSON.stringify([{quantity:1,unit_cents:100}])]),/Invalid quote/);
    await db.query("insert into public.appointments(workspace_id,contact_id,title,assigned_to,starts_at,ends_at) values($1,$2,'Meeting',$3,'2026-12-01T10:00Z','2026-12-01T11:00Z')",[wa,contact,a]);
    await assert.rejects(db.query("insert into public.appointments(workspace_id,title,assigned_to,starts_at,ends_at) values($1,'Collision',$2,'2026-12-01T10:30Z','2026-12-01T11:30Z')",[wa,a]),/already has an appointment/);
    await db.query("insert into public.appointments(workspace_id,title,assigned_to,starts_at,ends_at) values($1,'Next meeting',$2,'2026-12-01T11:00Z','2026-12-01T12:00Z')",[wa,a]);
    await db.query("insert into public.tickets(workspace_id,title,contact_id,status) values($1,'Support',$2,'resolved')",[wa,contact]);
    const report=(await db.query("select public.crm_reports($1,current_date-1,current_date+1) as r",[wa])).rows[0].r;assert.equal(report.contacts,1);assert.equal(report.won_count,1);assert.equal(report.won_value,12345);assert.equal(report.resolved_tickets,1);
    await asUser(b);const wb=(await db.query("select public.create_workspace('Other') as id")).rows[0].id;
    for(const table of ['automation_rules','automation_runs','quotes','tickets','appointments'])assert.equal((await db.query('select * from public.'+table)).rows.length,0);
    await assert.rejects(db.query('select public.crm_reports($1,current_date,current_date)',[wa]),/access denied/);
    await assert.rejects(db.query("insert into public.tickets(workspace_id,title,contact_id) values($1,'Foreign customer',$2)",[wb,contact]),/foreign key/);
    await db.exec('reset role');await db.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",[wa,b]);
    await asUser(b);
    assert.equal((await db.query('select * from public.quotes')).rows.length,1);
    await assert.rejects(db.query("insert into public.tickets(workspace_id,title) values($1,'Denied')",[wa]),/row-level security/);
    await assert.rejects(db.query("insert into public.automation_rules(workspace_id,name,event,task_title) values($1,'Denied','contact_created','Forbidden')",[wa]),/row-level security/);
    await asUser(a);await db.query("select public.manage_member($1,$2,'member')",[wa,b]);
    await db.query("update public.tickets set assigned_to=$1 where workspace_id=$2",[b,wa]);
    await db.query("select public.manage_member($1,$2,'viewer')",[wa,b]);assert.equal((await db.query('select assigned_to from public.tickets')).rows[0].assigned_to,null);
    await db.query("update public.deals set stage='New' where id=$1",[deal]);assert.equal((await db.query('select closed_at from public.deals')).rows[0].closed_at,null);
    await db.query("update public.pipeline_stages set kind='won' where workspace_id=$1 and name='New'",[wa]);assert.ok((await db.query('select closed_at from public.deals')).rows[0].closed_at);
    await db.query("update public.pipeline_stages set kind='won' where workspace_id=$1",[wa]);
    const defaultClosed=(await db.query("insert into public.deals(workspace_id,title,closed_at) values($1,'Default closed stage','2000-01-01') returning closed_at",[wa])).rows[0].closed_at;
    assert.ok(new Date(defaultClosed)>new Date('2026-01-01'));
  }finally{await db.close();}
});
