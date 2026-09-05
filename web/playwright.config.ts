import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  workers: 1,
  use: { baseURL: process.env.YHELPER_TEST_URL || "http://127.0.0.1:3020", browserName: "chromium" },
});
