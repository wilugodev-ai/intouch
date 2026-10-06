import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  use: {baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', screenshot: 'only-on-failure'},
  webServer: [
    {command:'pnpm --filter @intouch/web start',url:'http://127.0.0.1:3100',reuseExistingServer:!process.env.CI,timeout:60000},
    {command:'pnpm --filter @intouch/api start',url:'http://127.0.0.1:4100/v1/health',reuseExistingServer:!process.env.CI,timeout:60000},
  ],
});
