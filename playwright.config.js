import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  workers: 1,
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "node --experimental-sqlite backend/server.js",
    url: "http://127.0.0.1:4311/health",
    reuseExistingServer: true,
    timeout: 20000
  }
});
