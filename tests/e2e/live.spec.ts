import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const env=existsSync('.env.test.local')?parseEnv(readFileSync('.env.test.local','utf8')):{};
const url=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY,pub=env.SUPABASE_PUBLISHABLE_KEY;
async function remote(path:string,method='GET',body?:unknown,token=key){
  const response=await fetch(url+path,{method,signal:AbortSignal.timeout(15000),headers:{apikey:token===key?key:pub,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();if(!response.ok)throw Error(`Supabase request failed: ${response.status}`);return text?JSON.parse(text):null;
}
async function account(){
  const email=`intouch-test-${randomBytes(8).toString('hex')}@example.com`,password=randomBytes(24).toString('base64url');
  const user=await remote('/auth/v1/admin/users','POST',{email,password,email_confirm:true});
  return {id:user.id,email,password};
}
async function cleanup(id:string){
  const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${id}&role=eq.owner&select=workspace_id`);
  for(const {workspace_id} of memberships){
    for(const table of ['messages','conversations','channel_connections','tasks','deals','contacts'])await remote(`/rest/v1/${table}?workspace_id=eq.${workspace_id}`,'DELETE');
    await remote(`/rest/v1/workspaces?id=eq.${workspace_id}`,'DELETE');
  }
  await remote(`/auth/v1/admin/users/${id}`,'DELETE');
}
test('real CRM persists across browser sessions and isolates users',async({page,browser})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(120000);
  const a=await account(),b=await account();
  try{
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Business name').fill('Verification workspace');await page.getByRole('dialog').getByRole('button',{name:'Create workspace',exact:true}).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Add contact',exact:true}).click();
    await page.getByLabel('Full name').fill('Persistent customer');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('cell',{name:'Persistent customer'})).toBeVisible();
    await page.getByRole('button',{name:'Pipeline',exact:true}).click();await page.getByRole('button',{name:'New deal',exact:true}).first().click();await page.getByLabel('Title',{exact:true}).fill('Real opportunity');await page.getByLabel('Value (USD)').fill('1500.50');await page.getByRole('button',{name:'Save changes'}).click();await page.getByLabel('Stage for Real opportunity').selectOption('Won');
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Real follow-up');await page.getByRole('button',{name:'Save changes'}).click();await page.getByRole('checkbox',{name:'Complete Real follow-up'}).click();await expect(page.getByRole('checkbox',{name:'Complete Real follow-up'})).toBeChecked();
    const fresh=await browser.newContext();
    try{const p=await fresh.newPage();await p.goto('/');await p.getByLabel('Email',{exact:true}).fill(a.email);await p.getByLabel('Password',{exact:true}).fill(a.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('button',{name:'Contacts',exact:true}).click();await expect(p.getByRole('cell',{name:'Persistent customer'})).toBeVisible();await p.getByRole('button',{name:'Tasks',exact:true}).click();await expect(p.getByRole('checkbox',{name:'Complete Real follow-up'})).toBeChecked();}finally{await fresh.close();}
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:b.email,password:b.password},pub);
    const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${a.id}&select=workspace_id`);const workspace=memberships[0].workspace_id;
    const contacts=await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`);expect(contacts).toHaveLength(1);
    expect(await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`,'GET',undefined,session.access_token)).toEqual([]);
    const denied=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/state`,{headers:{Authorization:`Bearer ${session.access_token}`}});expect(denied.status).toBe(404);
    const modification=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts/${contacts[0].id}`,{method:'PATCH',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Intruder'})});expect(modification.status).toBe(404);
    await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Full name').fill('Updated customer');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('cell',{name:'Updated customer'})).toBeVisible();
    await page.getByRole('button',{name:'Edit',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByText('Add your first contact to get started.')).toBeVisible();
    await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  }finally{await cleanup(a.id);await cleanup(b.id);}
});
test('Supabase confirmation and recovery links establish a session and update passwords',async({page})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(60000);
  const email=`intouch-confirm-${randomBytes(8).toString('hex')}@example.com`,password=randomBytes(24).toString('base64url');
  const link=await remote('/auth/v1/admin/generate_link','POST',{type:'signup',email,password,redirect_to:'http://127.0.0.1:3100'});
  const id=link.id||link.user?.id;
  try{
    await page.goto(link.action_link||link.properties?.action_link);await expect(page.getByText('Private workspace',{exact:true})).toBeVisible({timeout:15000});
    await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
    const recovery=await remote('/auth/v1/admin/generate_link','POST',{type:'recovery',email,redirect_to:'http://127.0.0.1:3100'});
    await page.goto(recovery.action_link||recovery.properties?.action_link);await expect(page.getByRole('heading',{name:'Set a new password'})).toBeVisible({timeout:15000});
    const updated=randomBytes(24).toString('base64url');await page.getByLabel('New password').fill(updated);await page.getByRole('button',{name:'Update password',exact:true}).click();await expect(page.getByText('Your password has been updated.')).toBeVisible();
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email,password:updated},pub);expect(session.user.id).toBe(id);
  }finally{if(id)await cleanup(id);}
});
test('mobile sign-in has no sample records',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await expect(page.getByText('Sofia Martinez')).not.toBeVisible();});
test('API requires authentication',async({request})=>{expect((await request.get('http://127.0.0.1:4100/v1/workspaces')).status()).toBe(401);});

test('CRM workflows persist notes, imports, stages, invitations, and team permissions',async({page,browser})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(180000);
  const owner=await account(),teammate=await account();
  try{
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Business name').fill('Workflow verification');await page.getByRole('dialog').getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV file').setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('name,email,company,status,tags\nImported customer,customer@example.com,Real company,Lead,priority|renewal\nRepeated email,customer@example.com,Company,Lead,\n')});
    await page.getByRole('button',{name:'Preview import',exact:true}).click();await expect(page.getByText('2 rows · 1 repeated emails in file · 0 existing emails')).toBeVisible();await page.getByRole('button',{name:'Import contacts',exact:true}).click();await expect(page.getByText('1 contacts imported; 1 duplicates skipped.')).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Imported customer',exact:true}).click();await expect(page.getByText('priority',{exact:true})).toBeVisible();await page.getByLabel('Notes',{exact:true}).fill('Customer requested a follow-up call.');await page.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.getByText('Customer requested a follow-up call.')).toBeVisible();await expect(page.getByText('Note created',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Pipeline',exact:true}).click();await page.getByRole('button',{name:'New deal',exact:true}).first().click();await page.getByLabel('Title',{exact:true}).fill('Custom stage opportunity');await page.getByLabel('Contact',{exact:true}).selectOption({label:'Imported customer'});await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Manage stages',exact:true}).click();await page.getByLabel('Name',{exact:true}).first().fill('Discovery');await page.getByRole('button',{name:'Save stage',exact:true}).first().click();await expect(page.getByText('Stages saved.')).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByLabel('Stage for Custom stage opportunity')).toHaveValue('Discovery');
    await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(teammate.email);await page.getByLabel('Access',{exact:true}).selectOption('viewer');await page.getByRole('button',{name:'Create invitation link',exact:true}).click();const link=page.getByLabel('Invitation link',{exact:true});await expect(link).toHaveValue(/#invite=/);const invitation=await link.inputValue();
    const context=await browser.newContext();try{const memberPage=await context.newPage();await memberPage.goto(invitation);await memberPage.getByLabel('Email',{exact:true}).fill(teammate.email);await memberPage.getByLabel('Password',{exact:true}).fill(teammate.password);await memberPage.getByRole('button',{name:'Sign in',exact:true}).click();await memberPage.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(memberPage.getByLabel('Current workspace')).toContainText('Workflow verification');await memberPage.getByRole('button',{name:'Contacts',exact:true}).click();await expect(memberPage.getByRole('button',{name:'Imported customer',exact:true})).toBeVisible();await expect(memberPage.getByRole('button',{name:'Add contact',exact:true})).not.toBeVisible();await expect(memberPage.getByRole('button',{name:'Edit',exact:true})).toBeDisabled();}finally{await context.close();}
    await page.reload();await page.getByRole('button',{name:'Team',exact:true}).click();await page.getByLabel(`Role for ${teammate.email}`).selectOption('member');await expect(page.getByLabel(`Role for ${teammate.email}`)).toHaveValue('member');
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Assigned follow-up');await page.getByLabel('Assigned to',{exact:true}).selectOption({label:teammate.email});await page.getByLabel('Due date').fill('2026-01-01');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByLabel('Filter tasks').selectOption('Overdue');await expect(page.getByText('Assigned follow-up',{exact:true})).toBeVisible();
    const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${owner.id}&select=workspace_id`),workspace=memberships[0].workspace_id;
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:teammate.email,password:teammate.password},pub);
    const owned=await remote('/auth/v1/token?grant_type=password','POST',{email:owner.email,password:owner.password},pub);
    await remote('/rest/v1/rpc/manage_member','POST',{target:workspace,member_id:teammate.id,new_role:'viewer'},owned.access_token);
    const denied=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Denied viewer write'})});expect(denied.status).toBe(403);
    const tasks=await remote(`/rest/v1/tasks?workspace_id=eq.${workspace}`);expect(tasks[0].assigned_to).toBeNull();
  }finally{await cleanup(owner.id);await cleanup(teammate.id);}
});
