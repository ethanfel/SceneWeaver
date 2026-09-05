import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4319', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { executablePath: process.env.SCENEWEAVER_CHROMIUM } },
  webServer: { command: 'node e2e/mock-server.mjs', url: 'http://127.0.0.1:4319/api/health', reuseExistingServer: false },
});
