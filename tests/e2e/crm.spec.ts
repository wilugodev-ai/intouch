import { test, expect } from '@playwright/test';
test('contact edits persist and search filters the list',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Contacts',exact:true}).click();
  await page.getByRole('button',{name:'Add contact',exact:true}).click();
  await page.getByLabel('Full name').fill('Taylor Example');
  await page.getByLabel('Email',{exact:true}).fill('taylor@example.com');
  await page.getByLabel('Company').fill('Test company');
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('cell',{name:'Taylor Example'})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Contacts',exact:true}).click();
  await page.getByRole('textbox',{name:'Search'}).fill('Taylor');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Full name').fill('Taylor Updated');
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByRole('cell',{name:'Taylor Updated'})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.getByText('No contacts match your search.')).toBeVisible();
});
test('pipeline and follow-ups can be updated',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Pipeline',exact:true}).click();
  await page.getByLabel('Stage for Brand studio partnership').selectOption('Won');
  await expect(page.locator('.kanban-column').filter({has:page.getByRole('heading',{name:'Won',exact:true})}).getByText('Brand studio partnership')).toBeVisible();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  const checkbox=page.getByRole('checkbox',{name:'Complete Send Sofia the service guide'});
  await checkbox.check(); await expect(checkbox).toBeChecked();
  await page.reload(); await page.getByRole('button',{name:'Tasks',exact:true}).click(); await expect(checkbox).toBeChecked();
});
test('demo reply stays local and channel setup never fakes a connection',async({page})=>{
  await page.goto('/'); await page.getByRole('button',{name:/^Inbox/}).click();
  await page.getByLabel('Try a reply').fill('Hello from the local preview');
  await page.getByRole('button',{name:'Save demo reply'}).click();
  await expect(page.getByText('Hello from the local preview')).toBeVisible();
  await expect(page.getByText(/Demo only/)).toBeVisible();
  await page.getByRole('button',{name:'Channels',exact:true}).click();
  await page.getByRole('button',{name:'View connection setup'}).first().click();
  await expect(page.getByText('Live connections are not available yet')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('mobile layout fits the screen',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await expect(page.getByRole('heading',{name:'A little closer. Every day.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Contacts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add contact',exact:true})).toBeVisible();
});
test('API rejects unauthenticated workspace access',async({request})=>{
  expect((await request.get('http://127.0.0.1:4100/v1/health')).status()).toBe(200);
  expect((await request.get('http://127.0.0.1:4100/v1/workspaces')).status()).toBe(401);
});
