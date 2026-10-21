import { test, expect } from '@playwright/test';

test('appearance supports light, dark, system, reloads, and other tabs',async({page,context})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({colorScheme:'light'});
  await page.goto('/');
  const appearance=page.getByLabel('Appearance',{exact:true});
  await expect(appearance).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(20, 28, 24)');
  await expect(page.getByLabel('Password',{exact:true})).toHaveCSS('background-color','rgb(24, 33, 28)');
  await page.screenshot({path:'.data/touchlumo-dark-login.png',fullPage:true});
  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'dark'});
  await appearance.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const peer=await context.newPage();
  await peer.goto('/');
  await peer.getByLabel('Appearance',{exact:true}).selectOption('dark');
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.setViewportSize({width:390,height:844});
  await expect(appearance).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'.data/touchlumo-dark-login-mobile.png',fullPage:true});
  await peer.close();
  expect(errors).toEqual([]);
});

test('appearance remains usable when preference storage is unavailable',async({page})=>{
  await page.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(key){if(key==='intouch-theme')throw new Error('Unavailable');return get.call(this,key);};
    Storage.prototype.setItem=function(key,value){if(key==='intouch-theme')throw new Error('Unavailable');return set.call(this,key,value);};
  });
  await page.goto('/');
  await page.getByLabel('Appearance',{exact:true}).selectOption('dark');
  await expect(page.getByLabel('Appearance',{exact:true})).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByLabel('Appearance',{exact:true}).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
