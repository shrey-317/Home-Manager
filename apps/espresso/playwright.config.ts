import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e suite runs against a production build served by `vite preview`, not the dev
 * server, because the service worker (and therefore the offline test) only exists in a
 * real build. BASE_PATH=/ keeps preview URLs at the root so specs can navigate to '/'.
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'pixel',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: {
    command: 'BASE_PATH=/ npm run build && BASE_PATH=/ npx vite preview --port ' + PORT,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
