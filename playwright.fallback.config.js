import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "test-results/fallback-run",
  testMatch: ["renderer.spec.js", "render-frame.spec.js", "routes.spec.js", "orientation.spec.js"],
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    launchOptions: {
      timeout: 30000,
      // Software WebGL for machines without a physical GPU. Do not combine
      // these tests with the Vulkan compositor flags required by WebGPU CI.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
