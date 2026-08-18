import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath)
  throw new Error("PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");

export default defineConfig({
  testDir: "tests/browser",
  testIgnore: [
    "agent-flow.spec.ts",
    "preview.spec.ts",
    "persistence.spec.ts",
    "spec-benchmark-candidate.spec.ts",
  ],
  fullyParallel: false,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: [
    {
      command: "node server/index.ts",
      url: "http://127.0.0.1:3101/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VMA_AGENT_MODE: "probe", VMA_SERVER_PORT: "3101" },
    },
    {
      command: "vite --host 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/probe.html",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
