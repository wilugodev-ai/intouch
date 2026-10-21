import { test, expect } from '@playwright/test';

test('Touchlumo branding and metadata appear on desktop and mobile sign-in and sign-up',async({page})=>{
  await page.goto('/');
  await expect(page).toHaveTitle('Touchlumo | Smarter Connections. Stronger Relationships.');
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content','Touchlumo');
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content','Touchlumo');
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content','Touchlumo');
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:844});
    for(const theme of ['light','dark']){
      await page.getByLabel('Appearance',{exact:true}).selectOption(theme);
      await expect(page.getByRole('link',{name:'Touchlumo home',exact:true})).toHaveText('Touchlumo.');
      await expect(page.getByText('WELCOME TO TOUCHLUMO',{exact:true})).toBeVisible();
      await expect(page.getByText('Smarter Connections. Stronger Relationships.',{exact:true})).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(/intouch/i);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
      await page.screenshot({path:`.data/rebrand-touchlumo/login-${width}-${theme}.png`,fullPage:true});
    }
  }
  await page.getByRole('button',{name:'New here? Create an account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Create your account',exact:true})).toBeVisible();
  await expect(page.getByText('WELCOME TO TOUCHLUMO',{exact:true})).toBeVisible();
});

test('public registration retains privacy metadata and Touchlumo branding on errors',async({page})=>{
  await page.goto('/register/branding-preview');
  await expect(page).toHaveTitle('Customer registration | Touchlumo');
  await expect(page.getByText('Powered by Touchlumo',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Form unavailable',exact:true})).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content','no-referrer');
  expect(await page.locator('body').innerText()).not.toMatch(/intouch/i);
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});
