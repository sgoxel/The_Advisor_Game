import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/webgpu",
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    launchOptions: {
      args: [
        "--enable-unsafe-webgpu",
        "--use-webgpu-adapter=swiftshader",
        "--disable-dawn-features=disallow_unsafe_apis",
        "--use-gpu-in-tests",
        "--enable-accelerated-2d-canvas",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: "npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
