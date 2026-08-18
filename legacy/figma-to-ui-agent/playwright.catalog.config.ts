import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const browserExecutablePath = resolve(
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "catalog.spec.ts",
  outputDir: "./data/e2e/catalog-test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [
    ["list"],
    ["json", { outputFile: "./data/e2e/catalog-report.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "zh-CN",
    timezoneId: "UTC",
    serviceWorkers: "block",
    launchOptions: {
      executablePath: browserExecutablePath,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm run preview:catalog -- --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
