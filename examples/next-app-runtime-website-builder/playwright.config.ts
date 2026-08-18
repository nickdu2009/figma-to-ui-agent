import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:43191",
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: {
    command: "vite --host 127.0.0.1 --port 43191",
    url: "http://127.0.0.1:43191",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
