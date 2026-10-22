import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
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
    for(const table of ['contact_consent_events','registration_submissions','registration_forms','automation_runs','automation_rules','appointments','tickets','quotes','messages','conversations','channel_connections','tasks','deals','contacts'])await remote(`/rest/v1/${table}?workspace_id=eq.${workspace_id}`,'DELETE');
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
    await page.getByLabel('Full name').fill('Persistent customer');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('button',{name:'Persistent customer',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Pipeline',exact:true}).click();await page.getByRole('button',{name:'New deal',exact:true}).first().click();await page.getByLabel('Title',{exact:true}).fill('Real opportunity');await page.getByLabel('Value (USD)').fill('1500.50');await page.getByRole('button',{name:'Save changes'}).click();await page.getByLabel('Stage for Real opportunity').selectOption('Won');
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Real follow-up');await page.getByRole('button',{name:'Save changes'}).click();await page.getByRole('checkbox',{name:'Complete Real follow-up'}).click();await expect(page.getByRole('checkbox',{name:'Complete Real follow-up'})).toBeChecked();
    const fresh=await browser.newContext();
    try{const p=await fresh.newPage();await p.goto('/');await p.getByLabel('Email',{exact:true}).fill(a.email);await p.getByLabel('Password',{exact:true}).fill(a.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByRole('button',{name:'Contacts',exact:true}).click();await expect(p.getByRole('button',{name:'Persistent customer',exact:true})).toBeVisible();await p.getByRole('button',{name:'Tasks',exact:true}).click();await expect(p.getByRole('checkbox',{name:'Complete Real follow-up'})).toBeChecked();}finally{await fresh.close();}
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:b.email,password:b.password},pub);
    const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${a.id}&select=workspace_id`);const workspace=memberships[0].workspace_id;
    const contacts=await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`);expect(contacts).toHaveLength(1);
    expect(await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`,'GET',undefined,session.access_token)).toEqual([]);
    const denied=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/state`,{headers:{Authorization:`Bearer ${session.access_token}`}});expect(denied.status).toBe(404);
    const modification=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts/${contacts[0].id}`,{method:'PATCH',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Intruder'})});expect(modification.status).toBe(404);
    await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Full name').fill('Updated customer');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('button',{name:'Updated customer',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Edit',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByText('Add your first contact to get started.')).toBeVisible();
    await page.getByRole('button',{name:'Sign out',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();
  }finally{await cleanup(a.id);await cleanup(b.id);}
});
test('account button opens account actions on desktop and mobile and signs out',async({page})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(90000);
  const user=await account();
  try{
    await page.goto('/');
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    const trigger=page.getByRole('button',{name:'Your account',exact:true});
    const menu=page.getByRole('region',{name:'Account menu',exact:true});
    await trigger.click();
    await expect(menu.getByText(user.email,{exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Touchlumo home',exact:true})).toHaveText('Touchlumo.');
    expect(await page.getByRole('link',{name:'Touchlumo home',exact:true}).evaluate(element=>element.scrollWidth<=element.clientWidth)).toBeTruthy();
    await menu.getByLabel('Appearance',{exact:true}).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.screenshot({path:'.data/touchlumo-dark-account-desktop.png',fullPage:true});
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await menu.getByRole('button',{name:'Change password',exact:true}).click();
    await page.getByLabel('New password',{exact:true}).fill(user.password+'updated');
    await page.getByRole('button',{name:'Show password',exact:true}).click();
    await expect(page.getByLabel('New password',{exact:true})).toHaveAttribute('type','text');
    await page.getByRole('button',{name:'Hide password',exact:true}).click();
    await expect(page.getByLabel('New password',{exact:true})).toHaveAttribute('type','password');
    await page.getByRole('button',{name:'Update password',exact:true}).click();
    await expect(page.getByText('Your password has been updated.',{exact:true})).toBeVisible();
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:user.email,password:user.password+'updated'},pub);
    expect(session.user.id).toBe(user.id);
    await trigger.click();
    await menu.getByRole('button',{name:'New workspace',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByLabel('Appearance',{exact:true})).toHaveValue('dark');
    await page.screenshot({path:'.data/touchlumo-dark-account-mobile.png',fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    const bounds=await menu.boundingBox();
    expect(bounds&&bounds.x>=0&&bounds.x+bounds.width<=390).toBeTruthy();
    await page.getByText('Private workspace',{exact:true}).click();
    await expect(menu).not.toBeVisible();
    await trigger.click();
    await menu.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await expect(page.getByLabel('Appearance',{exact:true})).toHaveValue('dark');
  }finally{await cleanup(user.id);}
});

test('password visibility toggles on sign-in and sign-up without submitting',async({page})=>{
  await page.goto('/');
  const password=page.getByLabel('Password',{exact:true});
  await password.fill('Visibility test password');
  await expect(password).toHaveAttribute('type','password');
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  await expect(password).toHaveAttribute('type','text');
  await expect(password).toHaveValue('Visibility test password');
  await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Hide password',exact:true}).click();
  await expect(password).toHaveAttribute('type','password');
  await page.getByRole('button',{name:'New here? Create an account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Create your account',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Show password',exact:true}).click();
  await expect(password).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Hide password',exact:true}).click();
  await expect(password).toHaveAttribute('type','password');
});

test('inactivity logout resets on interaction but survives reload and clears the session',async({page})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(90000);
  const user=await account();
  try{
    await page.clock.install();
    await page.goto('/');
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    const trigger=page.getByRole('button',{name:'Your account',exact:true});
    await expect(trigger).toBeVisible();
    await page.clock.fastForward(29*60*1000);
    await trigger.click();
    await page.clock.fastForward(29*60*1000);
    await expect(trigger).toBeVisible();
    await page.reload();
    await expect(trigger).toBeVisible();
    await page.clock.fastForward(60*1000+1000);
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText:'30 minutes of inactivity'})).toHaveText('You were signed out after 30 minutes of inactivity. Please sign in again.');
    await expect(trigger).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    // A fresh password sign-in starts a new period of activity.
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(trigger).toBeVisible();
  }finally{await cleanup(user.id);}
});

test('returning after sleep expires an idle session even while offline',async({page,context})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(90000);
  const user=await account();
  try{
    await page.clock.install();
    await page.goto('/');
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Your account',exact:true})).toBeVisible();
    await context.setOffline(true);
    await page.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now())+30*60*1000+1000));
    // Simulate resuming without running the timer during sleep.
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText:'30 minutes of inactivity'})).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
  }finally{await context.setOffline(false);await cleanup(user.id);}
});

test('activity in another tab keeps the session active and idle logout reaches both tabs',async({page,context})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(90000);
  const user=await account();
  try{
    await page.clock.install();
    await page.goto('/');
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill(user.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('button',{name:'Your account',exact:true})).toBeVisible();
    const peer=await context.newPage();
    await peer.clock.install({time:new Date(await page.evaluate(()=>Date.now()))});
    await peer.goto('/');
    await expect(peer.getByRole('button',{name:'Your account',exact:true})).toBeVisible();
    await page.clock.fastForward(29*60*1000);
    await peer.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now())));
    await peer.bringToFront();
    await peer.getByRole('button',{name:'Your account',exact:true}).click();
    await page.clock.fastForward(2*60*1000);
    await expect(page.getByRole('button',{name:'Your account',exact:true})).toBeVisible();
    await peer.clock.setSystemTime(new Date(await page.evaluate(()=>Date.now())));
    await peer.clock.fastForward(28*60*1000+1000);
    await expect(peer.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Welcome back',exact:true})).toBeVisible();
    await peer.close();
  }finally{await cleanup(user.id);}
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
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Assigned follow-up');await page.getByLabel('Assigned to',{exact:true}).selectOption({label:teammate.email});await page.getByLabel('Due date').fill('2026-01-01');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByLabel('Filter tasks').selectOption({label:'Overdue'});await expect(page.getByText('Assigned follow-up',{exact:true})).toBeVisible();
    const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${owner.id}&select=workspace_id`),workspace=memberships[0].workspace_id;
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:teammate.email,password:teammate.password},pub);
    const owned=await remote('/auth/v1/token?grant_type=password','POST',{email:owner.email,password:owner.password},pub);
    await remote('/rest/v1/rpc/manage_member','POST',{target:workspace,member_id:teammate.id,new_role:'viewer'},owned.access_token);
    const denied=await fetch(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Denied viewer write'})});expect(denied.status).toBe(403);
    const tasks=await remote(`/rest/v1/tasks?workspace_id=eq.${workspace}`);expect(tasks[0].assigned_to).toBeNull();
  }finally{await cleanup(owner.id);await cleanup(teammate.id);}
});

test('business modules execute automations, manage quotes, appointments and support, and export reports',async({page})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(120000);
  const user=await account();
  try{
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Business name').fill('Business modules verification');await page.getByRole('dialog').getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Automations',exact:true}).click();await page.getByRole('button',{name:'New automation',exact:true}).click();await page.getByLabel('Rule name',{exact:true}).fill('Welcome new customers');await page.getByLabel('Follow-up title',{exact:true}).fill('Welcome call');await page.getByLabel('Assigned teammate',{exact:true}).selectOption({label:user.email});await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Add contact',exact:true}).click();await page.getByLabel('Full name').fill('Business customer');await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(page.getByText('Welcome call',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Quotes',exact:true}).click();await page.getByRole('button',{name:'New quote',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Service proposal');await page.getByLabel('Customer',{exact:true}).selectOption({label:'Business customer'});await page.getByLabel('Description 1',{exact:true}).fill('Service <b>literal text</b>');await page.getByLabel('Quantity 1',{exact:true}).fill('2');await page.getByLabel('Unit price USD 1',{exact:true}).fill('10.50');await page.getByLabel('Tax percent',{exact:true}).fill('7.5');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByText('$22.58 USD · Valid until not set')).toBeVisible();
    const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Print / PDF',exact:true}).click();const popup=await popupPromise;await expect(popup.getByText('Service <b>literal text</b>',{exact:true})).toBeVisible();await expect(popup.getByRole('heading',{name:'Total: $22.58 USD'})).toBeVisible();await popup.close();
    await page.getByRole('button',{name:'Appointments',exact:true}).click();await page.getByRole('button',{name:'New appointment',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Customer meeting');await page.getByLabel('Assigned teammate',{exact:true}).selectOption({label:user.email});await page.getByLabel('Starts at',{exact:true}).fill('2030-01-10T10:00');await page.getByLabel('Ends at',{exact:true}).fill('2030-01-10T11:00');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    const calendarPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Calendar file',exact:true}).click();const calendar=await calendarPromise;expect(calendar.suggestedFilename()).toBe('appointment.ics');const calendarText=readFileSync((await calendar.path())!,'utf8');expect(calendarText).toContain('PRODID:-//Touchlumo//CRM//EN');expect(calendarText).toMatch(/UID:[^\r\n]+@intouch/);
    await page.getByRole('button',{name:'New appointment',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Conflicting meeting');await page.getByLabel('Assigned teammate',{exact:true}).selectOption({label:user.email});await page.getByLabel('Starts at',{exact:true}).fill('2030-01-10T10:30');await page.getByLabel('Ends at',{exact:true}).fill('2030-01-10T11:30');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already has an appointment');await page.getByRole('button',{name:'Close dialog'}).click();
    await page.getByRole('button',{name:'Tickets',exact:true}).click();await page.getByRole('button',{name:'New ticket',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Customer support request');await page.getByLabel('Priority',{exact:true}).selectOption('urgent');await page.getByLabel('Record status',{exact:true}).selectOption('resolved');await page.getByLabel('Description',{exact:true}).fill('Issue fixed during the customer call.');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('article').getByText('Resolved',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Reports',exact:true}).click();await expect(page.locator('.stat-card').filter({hasText:'New contacts'}).locator('.stat-value')).toHaveText('1');await expect(page.locator('.stat-card').filter({hasText:'Resolved tickets'}).locator('.stat-value')).toHaveText('1');const reportPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();const report=await reportPromise;expect(report.suggestedFilename()).toBe('touchlumo-report.csv');expect(readFileSync((await report.path())!,'utf8')).toContain('Touchlumo sales report (USD)');
    await page.getByRole('button',{name:'Automations',exact:true}).click();await expect(page.getByText('Follow-up created ·',{exact:false})).toBeVisible();
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Tickets',exact:true}).click();await expect(page.getByText('Customer support request',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }finally{await cleanup(user.id);}
});

test('public registration collects optional birthdays and consent, requires review, and supports revocable sharing',async({page,browser})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(120000);
  const user=await account(),publicContext=await browser.newContext({viewport:{width:390,height:844}});
  try{
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Business name').fill('Registration business');await page.getByRole('dialog').getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Registration',exact:true}).click();await page.getByLabel('Accept public registrations').check();await page.getByRole('button',{name:'Save form',exact:true}).click();await expect(page.getByLabel('Registration link',{exact:true})).toHaveValue(/\/register\//);const link=await page.getByLabel('Registration link',{exact:true}).inputValue();
    await expect(page.locator('.registration-qr svg')).toBeVisible();const qrPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download QR code',exact:true}).click();const qr=await qrPromise;expect(qr.suggestedFilename()).toBe('customer-registration-qr.svg');const svg=readFileSync((await qr.path())!,'utf8');expect(svg).toContain('viewBox="-4 -4');expect(svg).toContain('<path');
    const customerPage=await publicContext.newPage();await customerPage.goto(link);await expect(customerPage.getByRole('heading',{name:'Customer registration'})).toBeVisible();await expect(customerPage.locator('input[name="marketing_email"]')).not.toBeChecked();await expect(customerPage.locator('input[name="marketing_whatsapp"]')).not.toBeChecked();
    await customerPage.getByLabel('Full name',{exact:true}).fill('Registered customer');await customerPage.getByLabel('Email',{exact:true}).fill('registration-customer@example.com');await customerPage.getByLabel('Birth month',{exact:true}).selectOption('2');await customerPage.getByLabel('Birth day',{exact:true}).fill('29');await customerPage.getByLabel('Preferred contact channel',{exact:true}).selectOption('email');await customerPage.locator('input[name="marketing_email"]').check();await customerPage.locator('input[name="acknowledged"]').check();
    expect(await customerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await customerPage.screenshot({path:'test-results/public-registration-mobile.png',fullPage:true});await customerPage.getByRole('button',{name:'Submit my details',exact:true}).click();await expect(customerPage.getByRole('heading',{name:'Thank you!'})).toBeVisible();
    const memberships=await remote(`/rest/v1/workspace_members?user_id=eq.${user.id}&select=workspace_id`),workspace=memberships[0].workspace_id;expect(await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`)).toHaveLength(0);
    await page.getByRole('button',{name:'Refresh submissions',exact:true}).click();await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('button',{name:'Create contact',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Registered customer',exact:true}).click();await expect(page.getByText('Birthday: 2/29',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Withdraw marketing consent',exact:true})).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Withdraw marketing consent',exact:true}).click();await expect(page.getByRole('button',{name:'Withdraw marketing consent',exact:true})).not.toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();
    await customerPage.goto(link);await customerPage.getByLabel('Full name',{exact:true}).fill('Updated registrant');await customerPage.getByLabel('Email',{exact:true}).fill('registration-customer@example.com');await customerPage.locator('input[name="acknowledged"]').check();await customerPage.getByRole('button',{name:'Submit my details',exact:true}).click();await expect(customerPage.getByRole('heading',{name:'Thank you!'})).toBeVisible();
    let contacts=await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`);expect(contacts).toHaveLength(1);expect(contacts[0].name).toBe('Registered customer');
    await page.getByRole('button',{name:'Registration',exact:true}).click();await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByLabel('Matching contact',{exact:true}).selectOption(contacts[0].id);await expect(page.getByRole('button',{name:'Update verified contact',exact:true})).toBeDisabled();await page.getByLabel('I verified with the customer that this submission belongs to them.').check();await page.getByRole('button',{name:'Update verified contact',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    contacts=await remote(`/rest/v1/contacts?workspace_id=eq.${workspace}`);expect(contacts).toHaveLength(1);expect(contacts[0].name).toBe('Updated registrant');expect(contacts[0].birth_month).toBe(2);expect(contacts[0].marketing_email).toBe(false);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Replace link',exact:true}).click();await expect(page.getByLabel('Registration link',{exact:true})).not.toHaveValue(link);const replacement=await page.getByLabel('Registration link',{exact:true}).inputValue();await customerPage.goto(link);await expect(customerPage.getByRole('heading',{name:'Form unavailable'})).toBeVisible();await customerPage.goto(replacement);await expect(customerPage.getByRole('heading',{name:'Customer registration'})).toBeVisible();
    await page.getByLabel('Accept public registrations').uncheck();await page.getByRole('button',{name:'Save form',exact:true}).click();await expect(page.getByText('Paused',{exact:true})).toBeVisible();await customerPage.reload();await expect(customerPage.getByRole('heading',{name:'Form unavailable'})).toBeVisible();
  }finally{await publicContext.close();await cleanup(user.id);}
});

test('search and pagination reach old records, keep totals accurate, and isolate workspaces',async({page,request})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');
  test.setTimeout(180000);
  const user=await account(),other=await account();
  try{
    const session=await remote('/auth/v1/token?grant_type=password','POST',{email:user.email,password:user.password});
    const otherSession=await remote('/auth/v1/token?grant_type=password','POST',{email:other.email,password:other.password});
    const headers={Authorization:`Bearer ${session.access_token}`};
    async function get(path:string){const response=await request.get(`http://127.0.0.1:4100/v1${path}`,{headers});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}
    const response=await request.post('http://127.0.0.1:4100/v1/workspaces',{headers,data:{name:'Pagination verification'}});
    expect(response.ok()).toBeTruthy();const {id:workspace}=await response.json();
    const otherResponse=await request.post('http://127.0.0.1:4100/v1/workspaces',{headers:{Authorization:`Bearer ${otherSession.access_token}`},data:{name:'Other pagination workspace'}});
    expect(otherResponse.ok()).toBeTruthy();const {id:otherWorkspace}=await otherResponse.json();
    const oldId=randomUUID(),specialTag='VIP, special ("quoted")';
    const contacts=Array.from({length:1005},(_,index)=>({id:index===1004?oldId:randomUUID(),workspace_id:workspace,name:index===1004?'Old customer outside first thousand':`Paged contact ${String(index).padStart(4,'0')}`,email:index===1004?'old-customer@example.com':'',phone:index===1004?'+12025550199':'',company:index===1004?'Old Company':'',status:index===1004?'Customer':'Lead',tags:index===1004?[specialTag]:[],created_at:index===1004?'2000-01-01T00:00:00Z':'2026-01-01T00:00:00Z'}));
    // All fixtures belong to this test's temporary workspace, never an existing business.
    for(let start=0;start<contacts.length;start+=200)await remote('/rest/v1/contacts','POST',contacts.slice(start,start+200));
    await remote('/rest/v1/contacts','POST',{workspace_id:otherWorkspace,name:'Other workspace secret'});
    await remote('/rest/v1/deals','POST',Array.from({length:24},(_,index)=>({workspace_id:workspace,title:index===22?'Rare pipeline opportunity':`Paged deal ${index}`,contact_id:oldId,value_cents:100,stage:index===23?'Won':'New',created_at:'2026-01-01T00:00:00Z'})));
    await remote('/rest/v1/tasks','POST',Array.from({length:60},(_,index)=>({workspace_id:workspace,title:index===59?'Rare overdue follow-up':`Paged task ${index}`,contact_id:oldId,assigned_to:user.id,done:index%2===0,due_date:'2000-01-01',created_at:'2026-01-01T00:00:00Z'})));
    const base=`/workspaces/${workspace}/records`;
    const first=await get(`${base}/contacts`),second=await get(`${base}/contacts?page=1`),last=await get(`${base}/contacts?page=40`);
    expect(first.total).toBe(1005);expect(first.rows).toHaveLength(25);expect(last.rows).toHaveLength(5);expect(last.rows.some((row:{id:string})=>row.id===oldId)).toBeTruthy();
    expect(first.rows.some((row:{id:string})=>second.rows.some((next:{id:string})=>next.id===row.id))).toBeFalsy();
    expect((await get(`${base}/contacts?search=${encodeURIComponent(specialTag)}`)).rows[0].id).toBe(oldId);
    expect((await get(`${base}/contacts?search=${encodeURIComponent('+12025550199')}`)).total).toBe(1);
    expect((await get(`${base}/contacts?search=${encodeURIComponent('),workspace_id.neq.bad')}`)).total).toBe(0);
    expect((await get(`${base}/contacts?search=${encodeURIComponent('%')}`)).total).toBe(0);
    const beyond=await get(`${base}/contacts?page=1000`);expect(beyond.total).toBe(1005);expect(beyond.rows).toHaveLength(0);
    const overdue=await get(`${base}/tasks?filter=overdue&today=2026-10-21&page=1`);
    expect(overdue.total).toBe(30);expect(overdue.rows).toHaveLength(5);expect(overdue.rows.every((task:{done:boolean;contact:{name:string}})=>!task.done&&task.contact.name==='Old customer outside first thousand')).toBeTruthy();
    expect((await get(`${base}/deals?stage=New&pageSize=10&page=2`)).rows).toHaveLength(3);
    const snapshot=await get(`/workspaces/${workspace}/snapshot`);
    expect(snapshot.summary.contacts).toBe(1005);expect(snapshot.summary.customers).toBe(1);expect(snapshot.summary.openTasks).toBe(30);expect(snapshot.summary.pipeline.find((stage:{name:string})=>stage.name==='New').count).toBe(23);expect(snapshot.contacts.length).toBeLessThan(100);
    for(const query of ['page=-1','page=1.5','pageSize=101','search=a&search=b','filter=invalid','today=2026-02-30'])expect((await request.get(`http://127.0.0.1:4100/v1${base}/tasks?${query}`,{headers})).status()).toBe(400);
    expect((await request.get(`http://127.0.0.1:4100/v1/workspaces/${otherWorkspace}/records/contacts`,{headers})).status()).toBe(404);
    expect((await request.get(`http://127.0.0.1:4100/v1${base}/contacts`)).status()).toBe(401);
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill(user.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.locator('.stat-card').filter({hasText:'Total contacts'}).locator('.stat-value')).toHaveText('1005');
    await page.getByRole('button',{name:'Contacts',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'Contacts pages'})).toContainText('1–25 of 1005');
    await page.getByRole('navigation',{name:'Contacts pages'}).getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByRole('navigation',{name:'Contacts pages'})).toContainText('Page 2 of 41');
    await page.getByLabel('Search',{exact:true}).fill('Old customer');await expect(page.getByRole('button',{name:'Old customer outside first thousand',exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Contacts pages'})).toContainText('Page 1 of 1');
    await page.getByRole('row').filter({hasText:'Old customer outside first thousand'}).getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Phone',{exact:true}).fill('+12025550198');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'Pipeline',exact:true}).click();await page.getByLabel('Search',{exact:true}).fill('Rare pipeline');await expect(page.getByText('Rare pipeline opportunity',{exact:true})).toBeVisible();await page.getByLabel('Stage for Rare pipeline opportunity').selectOption('Won');await expect(page.locator('.kanban-column').filter({has:page.getByRole('heading',{name:'Won',exact:true})}).getByText('Rare pipeline opportunity',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'New deal',exact:true}).first().click();await page.getByLabel('Find a contact',{exact:true}).fill('Old customer');await page.getByLabel('Contact',{exact:true}).selectOption({label:'Old customer outside first thousand'});await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByLabel('Filter tasks').selectOption({label:'Overdue'});await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('of 30');await page.getByLabel('Search',{exact:true}).fill('Rare overdue');await expect(page.getByText('Rare overdue follow-up',{exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Complete Rare overdue follow-up'}).click();await expect(page.getByText('No tasks match your search and filter.',{exact:true})).toBeVisible();
    await page.getByLabel('Search',{exact:true}).fill('');await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('of 29');await page.getByRole('navigation',{name:'Follow-up pages'}).getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('Page 2 of 2');
    const finalTasks=await get(`${base}/tasks?filter=overdue&today=2026-10-21&page=1`);const remaining=finalTasks.rows[0];for(const task of finalTasks.rows.slice(1))await remote(`/rest/v1/tasks?workspace_id=eq.${workspace}&id=eq.${task.id}`,'DELETE');
    await page.getByRole('checkbox',{name:`Complete ${remaining.title}`,exact:true}).click();await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('Page 1 of 1');await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('of 25');
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Contacts',exact:true}).click();await expect(page.getByRole('navigation',{name:'Contacts pages'})).toContainText('of 1005');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }finally{await cleanup(user.id);await cleanup(other.id);}
});

test('customer attachments upload, download, paginate, and enforce workspace roles',async({page,request,browser})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(180000);
  const owner=await account(),viewer=await account(),outsider=await account();
  let workspace='',contact='',token='';
  try{
    const login=await remote('/auth/v1/token?grant_type=password','POST',{email:owner.email,password:owner.password});token=login.access_token;
    const headers={Authorization:`Bearer ${token}`};
    const created=await request.post('http://127.0.0.1:4100/v1/workspaces',{headers,data:{name:'Attachment verification'}});expect(created.ok()).toBeTruthy();workspace=(await created.json()).id;
    const customers=await remote('/rest/v1/contacts','POST',[{workspace_id:workspace,name:'Customer with files'},{workspace_id:workspace,name:'Another customer'}]);contact=customers[0].id;
    await remote('/rest/v1/workspace_members','POST',{workspace_id:workspace,user_id:viewer.id,role:'viewer'});
    const base=`http://127.0.0.1:4100/v1/crm/${workspace}/contacts/${contact}/files`;
    const buffer=Buffer.from('Private customer attachment\n');
    for(let index=0;index<21;index++){
      const uploaded=await request.post(base,{headers,multipart:{file:{name:`document-${String(index).padStart(2,'0')}.txt`,mimeType:'text/plain',buffer}}});expect(uploaded.status(),await uploaded.text()).toBe(201);
    }
    const first=await (await request.get(base,{headers})).json(),second=await (await request.get(base+'?page=1',{headers})).json();expect(first.total).toBe(21);expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(1);
    const attachment=first.rows[0];
    const downloaded=await request.get(`${base}/${attachment.id}`,{headers});expect(downloaded.status()).toBe(200);expect(await downloaded.body()).toEqual(buffer);expect(downloaded.headers()['content-type']).toContain('application/octet-stream');expect(downloaded.headers()['cache-control']).toContain('no-store');expect(downloaded.headers()['x-content-type-options']).toBe('nosniff');
    const uppercase=base.replace(workspace,workspace.toUpperCase()).replace(contact,contact.toUpperCase());expect((await request.get(`${uppercase}/${attachment.id.toUpperCase()}`,{headers})).status()).toBe(200);
    expect((await request.get(base)).status()).toBe(401);expect((await request.post(base,{multipart:{file:{name:'anonymous.txt',mimeType:'text/plain',buffer}}})).status()).toBe(401);
    const viewerSession=await remote('/auth/v1/token?grant_type=password','POST',{email:viewer.email,password:viewer.password}),viewerHeaders={Authorization:`Bearer ${viewerSession.access_token}`};
    expect((await request.get(`${base}/${attachment.id}`,{headers:viewerHeaders})).status()).toBe(200);
    expect((await request.post(base,{headers:viewerHeaders,multipart:{file:{name:'denied.txt',mimeType:'text/plain',buffer}}})).status()).toBe(403);
    expect((await request.delete(`${base}/${attachment.id}`,{headers:viewerHeaders})).status()).toBe(403);
    const outside=await remote('/auth/v1/token?grant_type=password','POST',{email:outsider.email,password:outsider.password}),outsideHeaders={Authorization:`Bearer ${outside.access_token}`};
    expect((await request.get(base,{headers:outsideHeaders})).status()).toBe(404);
    expect((await request.delete(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts/${contact}`,{headers:outsideHeaders})).status()).toBe(404);
    expect((await request.get(base.replace(contact,customers[1].id)+`/${attachment.id}`,{headers})).status()).toBe(404);
    expect((await request.get(`${base}/not-a-file`,{headers})).status()).toBe(400);
    expect((await request.post(base,{headers,multipart:{file:{name:'unsafe.html',mimeType:'text/html',buffer:Buffer.from('<script>alert(1)</script>')}}})).status()).toBe(400);
    expect((await request.post(base,{headers,multipart:{file:{name:'fake.pdf',mimeType:'application/pdf',buffer}}})).status()).toBe(400);
    expect((await request.post(base,{headers,multipart:{file:{name:'large.txt',mimeType:'text/plain',buffer:Buffer.alloc(10*1024*1024+1,65)}}})).status()).toBe(413);
    expect((await request.delete(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts/${contact}`,{headers})).status()).toBe(409);
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Contacts',exact:true}).click();await page.getByRole('button',{name:'Customer with files',exact:true}).click();await page.getByRole('button',{name:'Files and documents',exact:true}).click();
    const section=page.getByRole('region',{name:'Customer attachments'});await expect(section.getByRole('navigation',{name:'Attachment pages'})).toContainText('21 files');
    await section.getByLabel('Customer file',{exact:true}).setInputFiles({name:'customer-note.txt',mimeType:'text/plain',buffer});await section.getByRole('button',{name:'Upload file',exact:true}).click();await expect(section.getByText('File uploaded.',{exact:true})).toBeVisible();
    const downloadEvent=page.waitForEvent('download');await section.getByRole('button',{name:'Download customer-note.txt',exact:true}).click();const download=await downloadEvent;expect(download.suggestedFilename()).toBe('customer-note.txt');expect(readFileSync((await download.path())!)).toEqual(buffer);
    await page.setViewportSize({width:390,height:844});await section.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();expect(await section.evaluate(element=>{const bounds=element.getBoundingClientRect();return [...element.querySelectorAll('input,button')].every(control=>{const box=control.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1;});})).toBeTruthy();
    page.once('dialog',dialog=>dialog.accept());await section.getByRole('button',{name:'Remove customer-note.txt',exact:true}).click();await expect(section.getByText('File removed.',{exact:true})).toBeVisible();
    const viewerContext=await browser.newContext();try{const viewerPage=await viewerContext.newPage();await viewerPage.goto('/');await viewerPage.getByLabel('Email',{exact:true}).fill(viewer.email);await viewerPage.getByLabel('Password',{exact:true}).fill(viewer.password);await viewerPage.getByRole('button',{name:'Sign in',exact:true}).click();await viewerPage.getByRole('button',{name:'Contacts',exact:true}).click();await viewerPage.getByRole('button',{name:'Customer with files',exact:true}).click();await viewerPage.getByRole('button',{name:'Files and documents',exact:true}).click();const viewerFiles=viewerPage.getByRole('region',{name:'Customer attachments'});await expect(viewerFiles.getByRole('button',{name:'Download '+attachment.name,exact:true})).toBeVisible();await expect(viewerFiles.getByRole('button',{name:'Upload file',exact:true})).toHaveCount(0);await expect(viewerFiles.getByRole('button',{name:/^Remove /})).toHaveCount(0);}finally{await viewerContext.close();}
    await remote('/rest/v1/rpc/manage_member','POST',{target:workspace,member_id:viewer.id,new_role:'member'},token);
    const memberUpload=await request.post(base,{headers:viewerHeaders,multipart:{file:{name:'member.txt',mimeType:'text/plain',buffer}}});expect(memberUpload.status()).toBe(201);const memberFile=await memberUpload.json();expect((await request.delete(`${base}/${memberFile.id}`,{headers:viewerHeaders})).status()).toBe(200);
    await remote('/rest/v1/rpc/manage_member','POST',{target:workspace,member_id:viewer.id,new_role:null},token);expect((await request.get(`${base}/${attachment.id}`,{headers:viewerHeaders})).status()).toBe(404);
    const files=(await (await request.get(base,{headers})).json()).rows;for(const file of files)expect((await request.delete(`${base}/${file.id}`,{headers})).status()).toBe(200);const remaining=(await (await request.get(base,{headers})).json()).rows;for(const file of remaining)await request.delete(`${base}/${file.id}`,{headers});expect((await request.get(`${base}/${attachment.id}`,{headers})).status()).toBe(404);
    expect((await request.delete(`http://127.0.0.1:4100/v1/workspaces/${workspace}/contacts/${contact}`,{headers})).status()).toBe(200);
  }finally{
    if(workspace&&contact&&token){const base=`http://127.0.0.1:4100/v1/crm/${workspace}/contacts/${contact}/files`,headers={Authorization:`Bearer ${token}`};for(let attempt=0;attempt<6;attempt++){const response=await request.get(base,{headers}).catch(()=>null);if(!response?.ok())break;const data=await response.json();if(!data.rows.length)break;for(const file of data.rows)await request.delete(`${base}/${file.id}`,{headers});}}
    await cleanup(owner.id);await cleanup(viewer.id);await cleanup(outsider.id);
  }
});

test('dedicated customer page manages linked records, bookmarks, and private workspace access',async({page,request,browser})=>{
  test.skip(!url||!key||!pub,'Configure .env.test.local for real Supabase tests.');test.setTimeout(240000);
  const owner=await account(),viewer=await account(),outsider=await account();let workspace='',contact='',token='';
  const apiRoot='http://127.0.0.1:4100/v1';
  try{
    token=(await remote('/auth/v1/token?grant_type=password','POST',{email:owner.email,password:owner.password})).access_token;const headers={Authorization:`Bearer ${token}`};
    await request.post(apiRoot+'/workspaces',{headers,data:{name:'Earlier workspace'}});
    const created=await request.post(apiRoot+'/workspaces',{headers,data:{name:'Customer page verification'}});expect(created.status()).toBe(201);workspace=(await created.json()).id;
    const customers=await remote('/rest/v1/contacts','POST',[{workspace_id:workspace,name:'Page customer',email:'page-customer@example.com',company:'Customer company'},{workspace_id:workspace,name:'Different customer',email:'',company:''}]);contact=customers[0].id;const other=customers[1].id;
    await remote('/rest/v1/workspace_members','POST',{workspace_id:workspace,user_id:viewer.id,role:'viewer'});
    await remote('/rest/v1/tasks','POST',[...Array.from({length:28},(_,index)=>({workspace_id:workspace,contact_id:contact,title:`Customer follow-up ${String(index).padStart(2,'0')}`,due_date:'2030-01-01'})),{workspace_id:workspace,contact_id:other,title:'Other customer task',due_date:'2030-01-01'},{workspace_id:workspace,contact_id:null,title:'Unlinked task',due_date:'2030-01-01'}]);
    await remote('/rest/v1/deals','POST',[...Array.from({length:12},(_,index)=>({workspace_id:workspace,contact_id:contact,title:`Customer deal ${index}`,stage:'New',value_cents:1000})),{workspace_id:workspace,contact_id:other,title:'Other customer deal',stage:'New',value_cents:1000}]);
    await remote('/rest/v1/quotes','POST',[...Array.from({length:51},(_,index)=>({workspace_id:workspace,contact_id:contact,title:`Customer quote ${index}`,items:[{description:'Verification service',quantity:1,unit_cents:1000}]})),{workspace_id:workspace,contact_id:other,title:'Other customer quote',items:[{description:'Other service',quantity:1,unit_cents:1000}]}],token);
    await remote('/rest/v1/appointments','POST',[{workspace_id:workspace,contact_id:contact,title:'Customer meeting',starts_at:'2035-01-10T10:00:00Z',ends_at:'2035-01-10T11:00:00Z'},{workspace_id:workspace,contact_id:other,title:'Other customer meeting',starts_at:'2035-01-10T11:00:00Z',ends_at:'2035-01-10T12:00:00Z'}]);
    await remote('/rest/v1/tickets','POST',[{workspace_id:workspace,contact_id:contact,title:'Customer support',status:'open'},{workspace_id:workspace,contact_id:other,title:'Other customer support',status:'open'}]);
    const base=`${apiRoot}/crm/${workspace}/contacts/${contact}`;
    const profile=await request.get(base+'/profile',{headers});expect(profile.status()).toBe(200);expect((await profile.json()).counts).toEqual({openTasks:28,deals:12,quotes:51,appointments:1,tickets:1});
    const tasks=await (await request.get(`${apiRoot}/workspaces/${workspace}/records/tasks?contact=${contact}&page=1`,{headers})).json();expect(tasks.total).toBe(28);expect(tasks.rows).toHaveLength(3);expect(tasks.rows.every((row:{contact_id:string})=>row.contact_id===contact)).toBeTruthy();
    const quotes=await (await request.get(`${apiRoot}/business/${workspace}/quotes?contact=${contact}&page=1`,{headers})).json();expect(quotes.total).toBe(51);expect(quotes.rows).toHaveLength(1);expect(quotes.rows[0].contact_id).toBe(contact);
    expect((await request.get(base+'/profile')).status()).toBe(401);
    expect((await request.get(`${apiRoot}/workspaces/${workspace}/records/tasks?contact=invalid`,{headers})).status()).toBe(400);
    expect((await request.get(`${apiRoot}/business/${workspace}/automations?contact=${contact}`,{headers})).status()).toBe(400);
    const foreign=randomUUID();expect((await request.get(`${apiRoot}/workspaces/${workspace}/records/deals?contact=${foreign}`,{headers})).status()).toBe(404);expect((await request.get(`${apiRoot}/business/${workspace}/tickets?contact=${foreign}`,{headers})).status()).toBe(404);
    const route=`/customers/${workspace}/${contact}`;
    await page.goto(route);await expect(page.getByRole('heading',{name:'Welcome back'})).toBeVisible();await expect(page.getByRole('heading',{name:'Page customer',exact:true})).toHaveCount(0);
    await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Page customer',exact:true})).toBeVisible();await expect(page.getByLabel('Current workspace',{exact:true})).toHaveValue(workspace);
    const sections=page.getByRole('navigation',{name:'Customer sections',exact:true});
    await expect(page.locator('.customer-metric').filter({hasText:'Open tasks'}).locator('strong')).toHaveText('28');
    await page.getByRole('button',{name:'Edit customer',exact:true}).click();await page.getByLabel('Full name',{exact:true}).fill('Updated page customer');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('heading',{name:'Updated page customer',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Updated page customer',exact:true})).toBeVisible({timeout:15000});
    await page.screenshot({path:'.data/customer-page-desktop.png',fullPage:true});
    await sections.getByRole('button',{name:'Activity',exact:true}).click();await page.getByLabel('Notes',{exact:true}).fill('Customer page activity note');await page.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.getByText('Customer page activity note',{exact:true})).toBeVisible();
    await sections.getByRole('button',{name:'Tasks',exact:true}).click();await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('of 28');await expect(page.getByText('Other customer task',{exact:true})).toHaveCount(0);await page.getByRole('navigation',{name:'Follow-up pages'}).getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('navigation',{name:'Follow-up pages'})).toContainText('26');
    await page.getByRole('button',{name:'New task',exact:true}).click();await expect(page.getByLabel('Contact',{exact:true})).toHaveValue(contact);await page.getByLabel('Title',{exact:true}).fill('Task made on customer page');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByLabel('Search',{exact:true}).fill('Task made on customer page');await expect(page.getByRole('checkbox',{name:'Complete Task made on customer page',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Complete Task made on customer page',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Complete Task made on customer page',exact:true})).toBeChecked();
    await sections.getByRole('button',{name:'Deals',exact:true}).click();const newStage=page.locator('.kanban-column').filter({has:page.getByRole('heading',{name:'New',exact:true})});await expect(newStage.locator('.deal-card')).toHaveCount(10);await expect(page.getByText('Other customer deal',{exact:true})).toHaveCount(0);await newStage.getByRole('button',{name:'Next',exact:true}).click();await expect(newStage.locator('.deal-card')).toHaveCount(2);await newStage.getByRole('button',{name:'New deal',exact:true}).click();await expect(page.getByLabel('Contact',{exact:true})).toHaveValue(contact);await page.getByLabel('Title',{exact:true}).fill('Deal made on customer page');await page.getByLabel('Value (USD)',{exact:true}).fill('125');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await sections.getByRole('button',{name:'Quotes',exact:true}).click();await expect(page.getByText('Other customer quote',{exact:true})).toHaveCount(0);const quotePages=page.locator('.customer-section .pagination');await quotePages.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.customer-section .business-row')).toHaveCount(1);await page.getByRole('button',{name:'New quote',exact:true}).click();await expect(page.getByLabel('Customer',{exact:true})).toHaveValue('Updated page customer');await page.getByLabel('Title',{exact:true}).fill('Quote made on customer page');await page.getByLabel('Description 1',{exact:true}).fill('Scoped service');await page.getByLabel('Unit price USD 1',{exact:true}).fill('35');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await sections.getByRole('button',{name:'Appointments',exact:true}).click();await expect(page.getByText('Customer meeting',{exact:true})).toBeVisible();await expect(page.getByText('Other customer meeting',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'New appointment',exact:true}).click();await expect(page.getByLabel('Customer',{exact:true})).toHaveValue('Updated page customer');await page.getByLabel('Title',{exact:true}).fill('Meeting made on customer page');await page.getByLabel('Starts at',{exact:true}).fill('2035-02-01T10:00');await page.getByLabel('Ends at',{exact:true}).fill('2035-02-01T11:00');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await sections.getByRole('button',{name:'Tickets',exact:true}).click();await expect(page.getByText('Customer support',{exact:true})).toBeVisible();await expect(page.getByText('Other customer support',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'New ticket',exact:true}).click();await expect(page.getByLabel('Customer',{exact:true})).toHaveValue('Updated page customer');await page.getByLabel('Title',{exact:true}).fill('Ticket made on customer page');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByText('Ticket made on customer page',{exact:true})).toBeVisible();
    await sections.getByRole('button',{name:'Files and documents',exact:true}).click();const files=page.getByRole('region',{name:'Customer attachments'});await files.getByLabel('Customer file',{exact:true}).setInputFiles({name:'customer-profile.txt',mimeType:'text/plain',buffer:Buffer.from('Customer page file')});await files.getByRole('button',{name:'Upload file',exact:true}).click();await expect(files.getByText('File uploaded.',{exact:true})).toBeVisible();await expect(files.getByRole('button',{name:'Download customer-profile.txt',exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'.data/customer-page-mobile-files.png',fullPage:true});
    await sections.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Your account',exact:true}).click();await page.getByLabel('Appearance',{exact:true}).selectOption('dark');await page.keyboard.press('Escape');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.screenshot({path:'.data/customer-page-mobile-dark.png',fullPage:true});
    const finalProfile=await (await request.get(base+'/profile',{headers})).json();expect(finalProfile.counts).toEqual({openTasks:28,deals:13,quotes:52,appointments:2,tickets:2});
    for(const [table,title] of [['tasks','Task made on customer page'],['deals','Deal made on customer page'],['quotes','Quote made on customer page'],['appointments','Meeting made on customer page'],['tickets','Ticket made on customer page']]){const rows=await remote(`/rest/v1/${table}?workspace_id=eq.${workspace}&title=eq.${encodeURIComponent(title)}`);expect(rows).toHaveLength(1);expect(rows[0].contact_id).toBe(contact);}
    await sections.getByRole('button',{name:'Quotes',exact:true}).click();await page.getByRole('article').filter({has:page.getByText('Quote made on customer page',{exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await sections.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.locator('.customer-metric').filter({hasText:'Quotes'}).locator('strong')).toHaveText('51');
    await page.getByRole('link',{name:'Back to contacts',exact:true}).click();await expect(page.getByLabel('Current workspace',{exact:true})).toHaveValue(workspace);await expect(page.getByRole('link',{name:'Open page for Updated page customer',exact:true})).toBeVisible();await page.getByRole('link',{name:'Open page for Updated page customer',exact:true}).click();await expect(page).toHaveURL(new RegExp(route+'$'));await expect(page.getByRole('heading',{name:'Updated page customer',exact:true})).toBeVisible();
    const viewerContext=await browser.newContext();try{const p=await viewerContext.newPage();await p.goto(route);await p.getByLabel('Email',{exact:true}).fill(viewer.email);await p.getByLabel('Password',{exact:true}).fill(viewer.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p.getByRole('heading',{name:'Updated page customer',exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Edit customer',exact:true})).toHaveCount(0);const tabs=p.getByRole('navigation',{name:'Customer sections',exact:true});await tabs.getByRole('button',{name:'Tasks',exact:true}).click();await expect(p.getByRole('button',{name:'New task',exact:true})).toHaveCount(0);await expect(p.getByRole('checkbox').first()).toBeDisabled();await tabs.getByRole('button',{name:'Quotes',exact:true}).click();await expect(p.getByRole('button',{name:'New quote',exact:true})).toHaveCount(0);await p.getByRole('button',{name:'View',exact:true}).first().click();await expect(p.getByLabel('Title',{exact:true})).toBeDisabled();await p.getByRole('button',{name:'Close dialog',exact:true}).click();await tabs.getByRole('button',{name:'Files and documents',exact:true}).click();await expect(p.getByRole('button',{name:'Download customer-profile.txt',exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Upload file',exact:true})).toHaveCount(0);}finally{await viewerContext.close();}
    const outsideToken=(await remote('/auth/v1/token?grant_type=password','POST',{email:outsider.email,password:outsider.password})).access_token;
    for(const path of [base+'/profile',`${apiRoot}/workspaces/${workspace}/records/tasks?contact=${contact}`,`${apiRoot}/business/${workspace}/quotes?contact=${contact}`])expect((await request.get(path,{headers:{Authorization:`Bearer ${outsideToken}`}})).status()).toBe(404);
    const outsideContext=await browser.newContext();try{const p=await outsideContext.newPage();await p.goto(route);await p.getByLabel('Email',{exact:true}).fill(outsider.email);await p.getByLabel('Password',{exact:true}).fill(outsider.password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p.getByRole('heading',{name:'Customer unavailable',exact:true})).toBeVisible();await expect(p.getByRole('heading',{name:'Updated page customer',exact:true})).toHaveCount(0);}finally{await outsideContext.close();}
  }finally{
    if(workspace&&contact&&token){const base=`${apiRoot}/crm/${workspace}/contacts/${contact}/files`,headers={Authorization:`Bearer ${token}`};const response=await request.get(base,{headers}).catch(()=>null);if(response?.ok())for(const file of (await response.json()).rows)await request.delete(`${base}/${file.id}`,{headers});}
    await cleanup(owner.id);await cleanup(viewer.id);await cleanup(outsider.id);
  }
});