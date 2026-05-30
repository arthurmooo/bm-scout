import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3030",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev -- --hostname 0.0.0.0 --port 3030",
    url: "http://localhost:3030",
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
