import { defineConfig } from "@playwright/test";

/**
 * E2E smoke (TESTING.md §2: gate = pre-merge to `dev`). Boots the real
 * Next dev server; pages serve DB-first, so with fresh stored data no live
 * third-party API is needed. Not a CI job — it needs DATABASE_URL.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
