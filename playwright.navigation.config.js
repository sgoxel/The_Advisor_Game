import { defineConfig } from "@playwright/test";
import fallback from "./playwright.fallback.config.js";
export default defineConfig({
  ...fallback,
  testMatch: ["navigation.spec.js", "streaming.spec.js"],
  outputDir: "test-results/navigation-run",
  timeout: 240000,
  use: { ...fallback.use, baseURL: "http://127.0.0.1:4180" },
  webServer: {
    command: "npm run preview -- --port 4180",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: !process.env.CI,
  },
});
