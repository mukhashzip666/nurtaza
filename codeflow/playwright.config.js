import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: { viewport: { width: 800, height: 700 } },
});
