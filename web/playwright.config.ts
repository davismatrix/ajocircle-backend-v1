import { defineConfig, devices } from "@playwright/test";

const live = process.env.AJO_LIVE_E2E === "1";
const port = live ? 3101 : 3100;

export default defineConfig({
  testDir: live ? "./e2e-live" : "./e2e",
  fullyParallel: true,
  workers: 2,
  timeout: live ? 60_000 : 30_000,
  expect: { timeout: 10_000 },
  outputDir: live ? "test-results-live" : "test-results",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: live ? { AJO_E2E: "live", API_URL: "http://127.0.0.1:8100/api/v1" } : { AJO_E2E: "1", NEXT_PUBLIC_FIREBASE_API_KEY: "", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "", NEXT_PUBLIC_FIREBASE_APP_ID: "" },
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
