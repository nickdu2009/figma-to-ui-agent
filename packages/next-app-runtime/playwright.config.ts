import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");
}

export default defineConfig({
  testDir: "tests/browser",
  timeout: 20_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:43190",
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1200, height: 800 },
    locale: "en-US",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: {
    command: "vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port 43190",
    url: "http://127.0.0.1:43190",
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
